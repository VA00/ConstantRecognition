// mitm_cuda.cu - the meet-in-the-middle search of ../mitm_cr.cpp with all of its work on an NVIDIA GPU (Phase 2)
//
// Author: Andrzej Odrzywolek
// Date: October 4, 2026
// Code assist: Claude Opus 5.5
//
// Same command line, input and output as mitm_cr (see the header of ../mitm_cr.cpp and ../PHASE2_PLAN.md), so
// that benchmark/run/run_mitm_v0.py --exe .../gpu/mitm_gpu.exe works unchanged. The host side (buttons, forms,
// ranks, RPN output, the Newton refinement of the closest pairs) is mitm_cr.cpp itself, included as a library.
// The buttons' formulas, their derivatives and the running error bounds (un, dun, bin, dbin, eval_full) are
// shared with the kernels through MITM_HD, so the GPU applies Phase 1's rules with CUDA's math library.
//
// Pipeline:
//   right sides  generated on the GPU, each thread an odometer over about 256 consecutive codes of one form (as
//                enum_R: only changed positions are evaluated again, a prefix with an unusable value is skipped as
//                a whole); sorted (CUB radix sort of 64-bit value keys with 32-bit ranks); one code per value kept,
//                the lowest rank, i.e. the shortest (CUB reduce by key); split by length. When all codes do not fit
//                into device memory at once, the values are counted per 2^20 key bins first and generated again for
//                every pass over a range of bins, as in mitm_cr. The tables stay on the device (one chunk per pass
//                and length, joined at the end).
//   left sides   per length a = 1, 2, ..., for all targets still open, in batches that fit into device memory:
//                generated with their derivatives and the guards of enum_L (kappa at every node on the path of x,
//                periodic guard, usable values), kappa at the root tested, sorted by value and then stably by
//                target, duplicate values dropped (the lowest rank kept), then matched: binary search in every
//                right-side table b <= bmax, the window |L - R| <= tol |T| |L'| walked closest first, at most maxtry
//                entries. The closest pairs (for FAILURE lines) need mitm_cr's noise check, two full evaluations:
//                passes over every 4096th and every 64th left value first set the thresholds, so few are needed.
//   verification --verify gpu (default): Newton steps, errcap and acceptance in the kernel; --verify host: the GPU
//                lists the candidates and the host decides with mitm_cr's own code (Worker::newton, r_error), in
//                mitm_cr's order (left value, then right length, then closest first).
//   result       per target the accepted equation of the smallest total length; ties by error, then by the order
//                in which mitm_cr meets them (length of L, then left value). A target with an equation of total
//                length <= a + 1 leaves the batch before length a. For a FAILURE: the closest pair of every total
//                length (noise check as mitm_cr), refined by Newton steps on the host, the closest one reported.
// Differences from mitm_cr by design: duplicate left values are dropped per batch (mitm_cr: per chunk of 2^20
// values); the candidate count follows the GPU's order; "ms" per target is the wall time of all targets divided
// by their number. CUDA's math library rounds differently from the CPU's (a few ulp), so the tables and the
// borderline decisions can differ slightly: every difference on benchmark v0 is listed in PHASE2_RESULTS.md.
//
// Build: build_mitm_gpu.bat (Windows) or make cuda (Linux); never with --use_fast_math.
// Usage: mitm_gpu [mitm_cr's options] [--verify gpu|host] [--vram GB] [--input FILE] < targets
//          --threads: host threads for --verify host and the final refinement; --list is not supported, --chunk
//          is ignored; --vram: device memory cap (default 80 % of the free memory); --input: targets from a file
//          (profilers may not pass stdin); --no-approx: FAILURE lines without the closest pair (timing only)
//        mitm_gpu --bench T tolrel [--kl 7] [--kr 8] [--common]     pair count as mitm_cr --bench
//        mitm_gpu --compare-r K [--kr 6] [--threads 12]             the tables against mitm_cr's (built on the host
//          with the host's math library), and the function behind every differing code of length <= K

#define MITM_LIBRARY
#include "../mitm_cr.cpp"
#include <cub/cub.cuh>
#include <unordered_map>

#define CK(x) do { cudaError_t e_ = (x); if (e_ != cudaSuccess) { fprintf(stderr, "CUDA error: %s (%s:%d)\n", \
                   cudaGetErrorString(e_), __FILE__, __LINE__); exit(4); } } while (0)

static const unsigned FULL = 0xffffffffu;
static const int UMAX = 512;                                   // codes per thread: at most (see unit_size)
static const int BLOCK = 256;
static const uint64_t SLICE = 1u << 20;                        // threads per generation launch (watchdog: < 0.5 s)

// ------------------------------------------------------------------------------------------------ device memory

static std::unordered_map<void*, size_t> g_alloc;
static size_t g_dev_cur = 0, g_dev_peak = 0;

template <class T>
static T* dalloc(size_t n)
{
    void* p = nullptr;
    const size_t b = std::max<size_t>(1, n) * sizeof(T);
    CK(cudaMalloc(&p, b));
    g_alloc[p] = b;
    g_dev_cur += b;
    g_dev_peak = std::max(g_dev_peak, g_dev_cur);
    return (T*)p;
}

static void dfree(void* p)
{
    if (!p) return;
    auto it = g_alloc.find(p);
    g_dev_cur -= it->second;
    g_alloc.erase(it);
    CK(cudaFree(p));
}

// one scratch buffer for CUB, grown on demand
static void* g_temp = nullptr;
static size_t g_temp_bytes = 0;
static void* temp_for(size_t bytes)
{
    if (bytes > g_temp_bytes) {
        dfree(g_temp);
        g_temp_bytes = bytes + bytes / 4;
        g_temp = dalloc<char>(g_temp_bytes);
    }
    return g_temp;
}

template <class T>
static T get1(const T* d)
{
    T h;
    CK(cudaMemcpy(&h, d, sizeof(T), cudaMemcpyDeviceToHost));
    return h;
}

static double sync_now()
{
    CK(cudaDeviceSynchronize());
    return now();
}

// ------------------------------------------------------------------------------------------------ device side

// the buttons, as eval_full expects them (members cval, uop, bop, nc)
struct DGram {
    double cval[64];
    int uop[32], bop[8];
    int nc, nu, nb, subok;
};
__constant__ DGram c_g;

__device__ __forceinline__ void load_gram(DGram& s)
{
    const int* src = (const int*)&c_g;
    int* dst = (int*)&s;
    for (int i = threadIdx.x; i < (int)(sizeof(DGram) / 4); i += blockDim.x) dst[i] = src[i];
    __syncthreads();
}

// usable() of mitm_cr: finite and not subnormal (subnormal values are kept by --bench)
__device__ __forceinline__ bool d_usable(double v, int subok)
{
    return isfinite(v) && (v == 0.0 || fabs(v) >= DBL_MIN || subok);
}

// last i in [0, n) with a[i] <= x (a[0] <= x)
__device__ __forceinline__ int find_le(const uint64_t* a, int n, uint64_t x)
{
    int lo = 0, hi = n;
    while (hi - lo > 1) {
        const int m = (lo + hi) >> 1;
        if (a[m] <= x) lo = m; else hi = m;
    }
    return lo;
}

// first i with R[i] >= x (n if none)
__device__ __forceinline__ uint64_t lower_bound_d(const double* R, uint64_t n, double x)
{
    uint64_t lo = 0, hi = n;
    while (lo < hi) {
        const uint64_t m = (lo + hi) >> 1;
        if (R[m] < x) lo = m + 1; else hi = m;
    }
    return lo;
}

// first i with R[i] > x (n if none)
__device__ __forceinline__ uint64_t upper_bound_d(const double* R, uint64_t n, double x)
{
    uint64_t lo = 0, hi = n;
    while (lo < hi) {
        const uint64_t m = (lo + hi) >> 1;
        if (R[m] <= x) lo = m + 1; else hi = m;
    }
    return lo;
}

// position of this lane's entry in an output array shared by all threads (one atomic per warp); all 32 lanes call it
__device__ __forceinline__ unsigned long long warp_append(bool has, unsigned long long* counter)
{
    const unsigned mask = __ballot_sync(FULL, has);
    if (!mask) return 0;
    const int lane = threadIdx.x & 31, leader = __ffs(mask) - 1;
    unsigned long long base = 0;
    if (lane == leader) base = atomicAdd(counter, (unsigned long long)__popc(mask));
    base = __shfl_sync(FULL, base, leader);
    return base + __popc(mask & ((1u << lane) - 1));
}

__device__ __forceinline__ void warp_add(unsigned long long v, unsigned long long* counter)
{
    for (int o = 16; o; o >>= 1) v += __shfl_down_sync(FULL, v, o);
    if ((threadIdx.x & 31) == 0 && v) atomicAdd(counter, v);
}

// The code of a rank: its form (forms sorted by offset) and digits
__device__ __forceinline__ const Form& code_of(const Form* fs, const uint64_t* off, int n, uint64_t rank, int* dig)
{
    const Form& f = fs[find_le(off, n, rank)];
    decode(f, rank - f.offset, dig);
    return f;
}

// The codes of one form are split into units of consecutive indices, one unit per thread. A unit's size is a
// multiple of the radices of the form's last positions (unit_size), so the threads of a warp, stepping through their
// units in lockstep, apply the same buttons at those positions at the same time (no divergence in the switch over
// the functions). The odometer of a thread re-evaluates only the positions it changed, and nothing while a prefix
// is unusable (bad = the first unusable position); the codes emitted are exactly those of enum_R and enum_L.
struct OdoR {
    int dig[MAXK];
    double val[MAXK];
    int bad;

    // evaluate positions p..K-1 (p <= bad); true if every value is usable
    __device__ bool eval(const Form& f, const DGram& g, int p)
    {
        const int K = f.K;
        for (int i = p; i < K; i++) {
            const int d = dig[i];
            double r;
            if (f.ar[i] == 0) r = g.cval[d];
            else if (f.ar[i] == 1) r = un(g.uop[d], val[i - 1]);
            else r = bin(g.bop[d], val[f.c1[i]], val[f.c2[i]]);
            if (!d_usable(r, g.subok)) { bad = i; return false; }
            val[i] = r;
        }
        bad = K;
        return true;
    }
};

struct OdoL {
    int dig[MAXK];
    double val[MAXK], der[MAXK];
    int bad;

    __device__ bool eval(const Form& f, const DGram& g, int p, double x, bool xonce, bool want_der, double kminT, double pmax)
    {
        const int K = f.K, nc = g.nc;
        for (int i = p; i < K; i++) {
            const int d = dig[i];
            double r, dr = 0.0;
            if (f.ar[i] == 0) {
                if (i == f.xpos || d == nc) { r = x; dr = 1.0; } else r = g.cval[d];
            } else if (f.ar[i] == 1) {
                const double a = val[i - 1];
                if (pmax > 0 && periodic(g.uop[d]) && der[i - 1] != 0.0 && fabs(a) > pmax) { bad = i; return false; }
                r = un(g.uop[d], a);
                if (want_der && f.dual[i] && der[i - 1] != 0.0) dr = dun(g.uop[d], a, r) * der[i - 1];
            } else {
                const double t = val[f.c1[i]], s = val[f.c2[i]];
                r = bin(g.bop[d], t, s);
                if (want_der && f.dual[i]) dr = dbin(g.bop[d], t, s, r, der[f.c1[i]], der[f.c2[i]]);
            }
            if (!d_usable(r, g.subok) || !d_usable(dr, g.subok) || (xonce && want_der && f.dual[i] && dr == 0.0) ||
                (f.ar[i] != 0 && dr != 0.0 && fabs(r) < kminT * fabs(dr))) { bad = i; return false; }
            val[i] = r;
            der[i] = dr;
        }
        bad = K;
        return true;
    }
};

// the next code of a unit; returns the lowest position changed (a unit never steps past the last code of its form)
__device__ __forceinline__ int odo_step(int* dig, const Form& f)
{
    int i = f.K - 1;
    while (++dig[i] == f.radix[i]) { dig[i] = 0; i--; }
    return i;
}

// ---- right sides

struct RGen {
    const Form* forms;
    const uint64_t* uoff;                                      // uoff[i]: first unit of form i
    const uint32_t* usz;                                       // usz[i]: codes per unit of form i
    int nforms;
    uint64_t u0, u1;                                           // units of this launch
    int mode;                                                  // 0: count per key bin, 1: emit all, 2: emit bins [b0, b1)
    int b0, b1;
    unsigned long long* hist;
    uint64_t* keys;
    uint32_t* ranks;
    unsigned long long* cnt;
    uint64_t cap;
    unsigned long long* nfin;
};

__global__ void __launch_bounds__(BLOCK) k_gen_r(RGen A)
{
    __shared__ DGram g;
    load_gram(g);
    const uint64_t u = A.u0 + blockIdx.x * (uint64_t)BLOCK + threadIdx.x;
    OdoR s;
    s.bad = 0;
    const Form* f = A.forms;
    uint64_t r0 = 0;
    int n = 0;                                                 // codes of this thread
    if (u < A.u1) {
        const int fi = find_le(A.uoff, A.nforms, u);
        f = A.forms + fi;
        r0 = (u - A.uoff[fi]) * A.usz[fi];
        n = (int)(r0 + A.usz[fi] < f->count ? A.usz[fi] : f->count - r0);
        decode(*f, r0, s.dig);
    }
    unsigned long long nf = 0;
    for (int st = 0; __any_sync(FULL, st < n); st++) {
        bool has = false;
        uint64_t key = 0;
        if (st < n) {
            const int p = st ? odo_step(s.dig, *f) : 0;
            has = p <= s.bad && s.eval(*f, g, p);
            if (has) { nf++; key = key_of(s.val[f->K - 1] + 0.0); }
        }
        if (A.mode == 0) {
            if (has) atomicAdd(&A.hist[key >> 44], 1ULL);
            continue;
        }
        if (has && A.mode == 2) { const int b = (int)(key >> 44); has = b >= A.b0 && b < A.b1; }
        const unsigned long long pos = warp_append(has, A.cnt);
        if (has && pos < A.cap) { A.keys[pos] = key; A.ranks[pos] = (uint32_t)(f->offset + r0 + st); }
    }
    warp_add(nf, A.nfin);
}

__global__ void k_flag_range(const uint32_t* r, uint64_t n, uint32_t lo, uint64_t hi, uint8_t* flag)
{
    const uint64_t i = blockIdx.x * (uint64_t)BLOCK + threadIdx.x;
    if (i < n) flag[i] = r[i] >= lo && r[i] < hi;
}

__global__ void k_key_to_val(uint64_t* k, uint64_t n)
{
    const uint64_t i = blockIdx.x * (uint64_t)BLOCK + threadIdx.x;
    if (i < n) { const double v = val_of(k[i]); memcpy(k + i, &v, 8); }
}

struct MinU32 {
    __device__ __forceinline__ uint32_t operator()(uint32_t a, uint32_t b) const { return b < a ? b : a; }
};

// ---- left sides

struct LGen {
    const Form* forms;
    int f0, nf;                                                // forms of this length: [f0, f0 + nf)
    const uint64_t* uoff;                                      // first unit of each of them (per target)
    const uint32_t* usz;                                       // codes per unit
    uint64_t upt;                                              // units per target
    const uint32_t* act;                                       // open targets (flat index -> target)
    const double* T;
    uint64_t F0, F1, ti0;                                      // flat units [F0, F1) = (target ti, unit); first ti
    double kmin, kmax, pmax;
    int xonce, want_der, bench;
    double* V;
    double* D;
    uint64_t* LR;
    uint32_t* TG;                                              // ti - ti0
    unsigned long long* cnt;
    uint64_t cap;
    unsigned long long* stat;                                  // [0] left values, [1] skipped by kappa
};

__global__ void __launch_bounds__(BLOCK) k_gen_l(LGen A)
{
    __shared__ DGram g;
    load_gram(g);
    const uint64_t flat = A.F0 + blockIdx.x * (uint64_t)BLOCK + threadIdx.x;
    OdoL s;
    s.bad = 0;
    const Form* f = A.forms;
    uint64_t r0 = 0, ti = A.ti0;
    int n = 0;
    double T = 0, absT = 1, kminT = 0;
    if (flat < A.F1) {
        ti = flat / A.upt;
        const uint64_t u = flat - ti * A.upt;
        const int fi = find_le(A.uoff, A.nf, u);
        f = A.forms + A.f0 + fi;
        r0 = (u - A.uoff[fi]) * A.usz[fi];
        n = (int)(r0 + A.usz[fi] < f->count ? A.usz[fi] : f->count - r0);
        decode(*f, r0, s.dig);
        T = A.T[A.act[ti]];
        absT = T != 0.0 ? fabs(T) : 1.0;
        kminT = A.bench || T == 0.0 ? 0.0 : A.kmin * absT;
    }
    const uint32_t tg = (uint32_t)(ti - A.ti0);
    const double pmax = A.bench ? 0.0 : A.pmax;
    unsigned long long nl = 0, nk = 0;
    for (int st = 0; __any_sync(FULL, st < n); st++) {
        bool has = false;
        double v = 0, d = 0;
        if (st < n) {
            const int p = st ? odo_step(s.dig, *f) : 0;
            has = p <= s.bad && s.eval(*f, g, p, T, A.xonce, A.want_der, kminT, pmax);
            if (has) {
                v = s.val[f->K - 1];
                d = s.der[f->K - 1];
                if (A.bench) has = v != 0.0;
                else if (d == 0.0) has = false;
                else {
                    nl++;
                    // kappa at the root (mitm_cr's flush, pass 1), before duplicates are dropped
                    const double kap = fabs(v) / fabs(d) / absT;
                    if (!(kap >= A.kmin && kap <= A.kmax)) { nk++; has = false; }
                }
            }
        }
        const unsigned long long pos = warp_append(has, A.cnt);
        if (has && pos < A.cap) { A.V[pos] = v; A.D[pos] = d; A.LR[pos] = f->offset + r0 + st; A.TG[pos] = tg; }
    }
    warp_add(nl, A.stat);
    warp_add(nk, A.stat + 1);
}

__global__ void k_lkeys(const double* V, uint64_t n, uint64_t* key, uint32_t* idx)
{
    const uint64_t i = blockIdx.x * (uint64_t)BLOCK + threadIdx.x;
    if (i < n) { key[i] = key_of(V[i] + 0.0); idx[i] = (uint32_t)i; }
}

__global__ void k_gather_tg(const uint32_t* idx, uint64_t n, const uint32_t* TG, uint32_t* tg)
{
    const uint64_t i = blockIdx.x * (uint64_t)BLOCK + threadIdx.x;
    if (i < n) tg[i] = TG[idx[i]];
}

__global__ void k_iota(uint32_t* x, uint64_t n)
{
    const uint64_t i = blockIdx.x * (uint64_t)BLOCK + threadIdx.x;
    if (i < n) x[i] = (uint32_t)i;
}

// Entries sorted by value (keys Ks, entry indices Is), then stably by target (tgs; pos = the position in the
// value order; both null for a batch of one target): the first entry of every run of equal (target, value) selects
// the run's lowest rank, the others are dropped. The reads are sequential or monotone within a target; the ranks
// are read only for runs of more than one entry.
__global__ void k_dedup_l(const uint32_t* tgs, const uint32_t* pos, const uint64_t* Ks, const uint32_t* Is, uint64_t n,
                          const uint64_t* LR, uint32_t* sel)
{
    const uint64_t i = blockIdx.x * (uint64_t)BLOCK + threadIdx.x;
    if (i >= n) return;
    const uint64_t p = pos ? pos[i] : i;
    const uint32_t t = tgs ? tgs[i] : 0;
    const uint64_t k = Ks[p];
    if (i > 0 && (tgs ? tgs[i - 1] : 0) == t && Ks[pos ? pos[i - 1] : i - 1] == k) { sel[i] = 0xFFFFFFFFu; return; }
    uint32_t best = Is[p];
    uint64_t br = 0;
    bool first = true;
    for (uint64_t j = i + 1; j < n; j++) {
        if ((tgs ? tgs[j] : 0) != t) break;
        const uint64_t pj = pos ? pos[j] : j;
        if (Ks[pj] != k) break;
        if (first) { br = LR[best]; first = false; }
        const uint32_t e1 = Is[pj];
        if (LR[e1] < br) { br = LR[e1]; best = e1; }
    }
    sel[i] = best;
}

struct NotMax {
    __device__ __forceinline__ bool operator()(uint32_t x) const { return x != 0xFFFFFFFFu; }
};

// ---- matching

struct AccRec {                                                // an accepted equation (--verify gpu)
    double err, x;
    uint64_t lrank, rrank, order;
    uint32_t t;
    int a, b, pad;
};
struct ApxRec {                                                // a new closest pair of its total length
    double e;
    uint64_t lrank, rrank, order;
    uint32_t t;
    int a, b, pad;
};
struct CandRec {                                               // a candidate pair (--verify host)
    uint64_t lrank, rrank, order;
    uint32_t t;
    int a, b, tr;
};

struct MArgs {
    const uint32_t* uniq;
    uint64_t k0, k1;                                           // entries [k0, k1) of uniq in this launch
    const double* V;
    const double* D;
    const uint64_t* LR;
    const uint32_t* TG;
    const uint32_t* act;
    uint64_t ti0;
    int a, KR, NS, maxtry, verify_gpu, no_apx, all_apx;
    int seed, stride;                                          // seed pass: every stride-th entry, closest pairs only
    const double* Rv[MAXK + 1];
    const uint32_t* Rr[MAXK + 1];
    uint64_t Rn[MAXK + 1];
    const Form* Lf;
    const uint64_t* Loff;
    int nLf;
    const Form* Rf;
    const uint64_t* Roff;
    int nRf;
    const double* T;
    double tol, errcap;
    int* best;                                                 // per target: shortest total accepted so far
    const int* succ;                                           // per target: accepted in an earlier length
    unsigned long long* apx;                                   // per (target, total): bits of the closest pair's e
    unsigned int* ncand;
    AccRec* acc;
    ApxRec* apr;
    CandRec* cand;
    unsigned long long* cnt;                                   // [0] acc, [1] apr, [2] cand
    uint64_t acc_cap, apx_cap, cand_cap;
    uint64_t batch;
    unsigned long long* stat;                                  // [2] maxtry reached, [3] rejected by errcap
};

// Worker::newton: Newton from T on L(x) = r; returns the root and, at T, the error bound of L and its derivative
__device__ double d_newton(const Form& f, const int* dig, const DGram& g, double T, double r, double& eL, double& dL)
{
    double x = T;
    for (int it = 0; it < 4; it++) {
        double v, d, e;
        eval_full(f, dig, g, x, v, d, e);
        if (it == 0) { eL = e; dL = d; }
        if (!isfinite(v) || !isfinite(d) || d == 0.0) return NAN;
        const double dx = (v - r) / d;
        if (dx == 0.0) break;
        x -= dx;
    }
    return x;
}

__device__ double d_r_error(const MArgs& A, const DGram& g, uint64_t rr)
{
    int dig[MAXK];
    const Form& f = code_of(A.Rf, A.Roff, A.nRf, rr, dig);
    double v, d, e;
    eval_full(f, dig, g, 0.0, v, d, e);
    return e;
}

__global__ void __launch_bounds__(BLOCK) k_match(MArgs A)
{
    __shared__ DGram g;
    load_gram(g);
    const uint64_t k = A.k0 + (blockIdx.x * (uint64_t)BLOCK + threadIdx.x) * A.stride;
    if (k >= A.k1) return;
    const uint32_t e = A.uniq[k];
    const double v = A.V[e], d = fabs(A.D[e]);
    const uint64_t lr = A.LR[e];
    const uint32_t t = A.act[A.ti0 + A.TG[e]];
    const double T = A.T[t], absT = T != 0.0 ? fabs(T) : 1.0, w = A.tol * absT * d;
    const uint64_t order = (A.batch << 32) | k;
    const int a = A.a;
    const bool want_apx = (A.all_apx || !A.succ[t]) && !A.no_apx;
    int bmax = A.KR;
    for (int b = 1; b <= bmax; b++) {
        if (A.verify_gpu) {                                    // ties allowed: total <= best total
            const int bt = *(volatile int*)(A.best + t);
            if (bt != INT_MAX && bt - a < bmax) { bmax = bt - a; if (b > bmax) break; }
        }
        const uint64_t n = A.Rn[b];
        if (!n) continue;
        const double* R = A.Rv[b];
        const uint64_t p = lower_bound_d(R, n, v);
        const double dl = p > 0 ? v - R[p - 1] : INFINITY, dr = p < n ? R[p] - v : INFINITY;
        const double dmin = dl < dr ? dl : dr;
        if (!(dmin < INFINITY)) continue;
        if (dmin > w) {                                        // no candidate: the closest pair is an approximation
            if (!want_apx) continue;
            const double ea = dmin / d / absT;
            unsigned long long* slot = A.apx + (uint64_t)t * A.NS + a + b;
            if (!(ea <= __longlong_as_double((long long)*(volatile unsigned long long*)slot))) continue;
            // kept only if its own rounding errors, mapped to x, are well below its distance from the target
            const uint64_t rr = A.Rr[b][dl <= dr ? p - 1 : p];
            int dig[MAXK];
            const Form& f = code_of(A.Lf, A.Loff, A.nLf, lr, dig);
            double v0, d0, eL;
            atomicAdd(A.stat + 4, 1ULL);
            eval_full(f, dig, g, T, v0, d0, eL);
            if (!((eL + d_r_error(A, g, rr)) / fabs(d0) / absT <= 0.25 * ea)) continue;
            const unsigned long long bits = (unsigned long long)__double_as_longlong(ea);
            const unsigned long long old = atomicMin(slot, bits);
            if (bits <= old) {
                const unsigned long long pos = atomicAdd(A.cnt + 1, 1ULL);
                if (pos < A.apx_cap) {
                    ApxRec& o = A.apr[pos];
                    o.e = ea; o.lrank = lr; o.rrank = rr; o.order = order; o.t = t; o.a = a; o.b = b;
                }
            }
            continue;
        }
        // The seed pass only lowers the closest-pair thresholds (fewer noise checks in the main pass). It goes on to
        // longer right sides even where the main pass may accept an equation and stop: that only adds closest pairs
        // to a target that has an equation, whose closest pairs are never reported.
        if (A.seed) continue;
        uint64_t l = p, r = p;                                 // next candidates: l - 1 (below), r (above)
        int tries = 0;
        bool accepted = false, exhausted = false;
        while (tries < A.maxtry) {
            const bool hl = l > 0 && v - R[l - 1] <= w, hr = r < n && R[r] - v <= w;
            if (!hl && !hr) { exhausted = true; break; }
            const uint64_t j = hl && (!hr || v - R[l - 1] <= R[r] - v) ? --l : r++;
            tries++;
            atomicAdd(A.ncand + t, 1u);
            const uint64_t rr = A.Rr[b][j];
            if (!A.verify_gpu) {
                const unsigned long long pos = atomicAdd(A.cnt + 2, 1ULL);
                if (pos < A.cand_cap) {
                    CandRec& o = A.cand[pos];
                    o.lrank = lr; o.rrank = rr; o.order = order; o.t = t; o.a = a; o.b = b; o.tr = tries;
                }
                continue;
            }
            const int total = a + b;
            if (total > *(volatile int*)(A.best + t)) continue;
            int dig[MAXK];
            const Form& f = code_of(A.Lf, A.Loff, A.nLf, lr, dig);
            double eL = INFINITY, dL = 0;
            const double x = d_newton(f, dig, g, T, R[j], eL, dL);
            const double err = fabs(x - T) / absT;
            const double ex = (eL + d_r_error(A, g, rr)) / fabs(dL) / absT;   // in this order: |L'| |T| can overflow
            if (!(err <= A.tol)) continue;
            if (!(ex <= A.errcap)) { atomicAdd(A.stat + 3, 1ULL); continue; }
            const unsigned long long pos = atomicAdd(A.cnt, 1ULL);
            if (pos < A.acc_cap) {
                AccRec& o = A.acc[pos];
                o.err = err; o.x = x; o.lrank = lr; o.rrank = rr; o.order = order; o.t = t; o.a = a; o.b = b;
            }
            atomicMin(A.best + t, total);
            accepted = true;
            break;
        }
        if (accepted) return;                                  // longer right sides only give longer equations
        if (!exhausted && tries >= A.maxtry) atomicAdd(A.stat + 2, 1ULL);
    }
}

// --bench: pairs |L - R| <= tolrel |L| of distinct left values with every table
__global__ void k_bench_pairs(const uint64_t* keys, uint64_t n, int KR, MArgs A, double tolrel, unsigned long long* pairs)
{
    const uint64_t i = blockIdx.x * (uint64_t)BLOCK + threadIdx.x;
    unsigned long long c = 0;
    if (i < n) {
        const double v = val_of(keys[i]), w = tolrel * fabs(v);
        for (int b = 1; b <= KR; b++) {
            const uint64_t lo = lower_bound_d(A.Rv[b], A.Rn[b], v - w);
            uint64_t hi = upper_bound_d(A.Rv[b], A.Rn[b], v + w);
            if (hi < lo) hi = lo;
            c += hi - lo;
        }
    }
    warp_add(c, pairs);
}

// ------------------------------------------------------------------------------------------------ host side

static uint64_t blocks(uint64_t n) { return (n + BLOCK - 1) / BLOCK; }

struct Timers {
    double ctx = 0;
    double r_count = 0, r_gen = 0, r_sort = 0, r_split = 0, r_xfer = 0, r_total = 0;
    double l_gen = 0, l_sort = 0, l_match = 0, l_xfer = 0, l_host = 0, l_final = 0;
};

struct Gpu {
    Form* Lf = nullptr;
    Form* Rf = nullptr;
    uint64_t* Loff = nullptr;
    uint64_t* Roff = nullptr;
    double* Rv[MAXK + 1] = {};
    uint32_t* Rr[MAXK + 1] = {};
    uint64_t Rn[MAXK + 1] = {};
    double cap = 0;                                            // device memory cap, bytes
    std::string name;
    uint64_t finite = 0, distinct = 0, codes = 0;
    int passes = 0;
};

// codes per unit of a form: a multiple of the product of the radices of its last positions (<= 512), about 256
static uint32_t unit_size(const Form& f)
{
    uint64_t M = 1;
    for (int i = f.K - 1; i >= 0 && M * f.radix[i] <= 512; i--) M *= f.radix[i];
    return (uint32_t)(M * ((256 + M - 1) / M));
}

// units of the forms [f0, f1): first unit of each (u, one more entry: the total) and codes per unit (sz)
static std::vector<uint64_t> units_of(const std::vector<Form>& fs, size_t f0, size_t f1, std::vector<uint32_t>& sz)
{
    std::vector<uint64_t> u(f1 - f0 + 1, 0);
    sz.assign(f1 - f0, 0);
    for (size_t i = f0; i < f1; i++) {
        sz[i - f0] = unit_size(fs[i]);
        u[i - f0 + 1] = u[i - f0] + (fs[i].count + sz[i - f0] - 1) / sz[i - f0];
    }
    return u;
}

template <class T>
static T* upload(const std::vector<T>& h)
{
    T* d = dalloc<T>(h.size());
    if (!h.empty()) CK(cudaMemcpy(d, h.data(), h.size() * sizeof(T), cudaMemcpyHostToDevice));
    return d;
}

static void upload_grammar(const Grammar& g)
{
    DGram h;
    memset(&h, 0, sizeof h);
    for (int i = 0; i < g.nc; i++) h.cval[i] = g.cval[i];
    for (int i = 0; i < g.nu; i++) h.uop[i] = g.uop[i];
    for (int i = 0; i < g.nb; i++) h.bop[i] = g.bop[i];
    h.nc = g.nc; h.nu = g.nu; h.nb = g.nb;
    h.subok = g_subnormal_ok ? 1 : 0;
    CK(cudaMemcpyToSymbol(c_g, &h, sizeof h));
}

// The right-side tables on the GPU (see the header); false with c.stats.error on failure
static bool build_R_gpu(Ctx& c, Gpu& G, Timers& tm)
{
    const double t0 = sync_now();
    const std::vector<Form>& Rf = c.Rf;
    const int nR = (int)Rf.size();
    std::vector<uint32_t> usz;
    const std::vector<uint64_t> uoff = units_of(Rf, 0, Rf.size(), usz);
    const uint64_t nunits = uoff[nR], total = c.len_off[c.o.kr + 1];
    G.codes = total;
    if (total > 0xFFFFFFFFULL) { c.stats.error = "more than 2^32 right sides: 64-bit ranks are not implemented"; return false; }
    uint64_t* d_uoff = upload(uoff);
    uint32_t* d_usz = upload(usz);
    unsigned long long* d_cnt = dalloc<unsigned long long>(2);  // [0] entries, [1] finite
    CK(cudaMemset(d_cnt, 0, 2 * sizeof(unsigned long long)));

    RGen A;
    memset(&A, 0, sizeof A);
    A.forms = G.Rf; A.uoff = d_uoff; A.usz = d_usz; A.nforms = nR; A.cnt = d_cnt; A.nfin = d_cnt + 1;
    auto launch = [&](int mode, int b0, int b1) {
        A.mode = mode; A.b0 = b0; A.b1 = b1;
        for (uint64_t u = 0; u < nunits; u += SLICE) {
            A.u0 = u;
            A.u1 = std::min(nunits, u + SLICE);
            k_gen_r<<<(unsigned)blocks(A.u1 - A.u0), BLOCK>>>(A);
            CK(cudaGetLastError());
        }
    };

    // Passes over value ranges (key bins), planned one at a time with the device memory that remains. A pass holds
    // its pairs (key, rank) with the sort's double buffers; its distinct values stay on the device as one chunk per
    // length, and the chunks of a length are joined at the end (values ascending: passes go up in value).
    const double per_pair = 2 * 8 + 2 * 4 + 1 + 12;            // keys and ranks double buffered, flags, the chunks
    const double margin = 384e6;                               // CUB scratch and the record buffers
    const int NBIN = 1 << 20;
    auto room = [&]() { return (uint64_t)std::max(0.0, (G.cap - (double)g_dev_cur - margin) / per_pair); };
    const bool single = total <= room();
    std::vector<unsigned long long> H;
    if (!single) {
        unsigned long long* d_hist = dalloc<unsigned long long>(NBIN);
        CK(cudaMemset(d_hist, 0, NBIN * sizeof(unsigned long long)));
        A.hist = d_hist;
        launch(0, 0, 0);
        H.resize(NBIN);
        CK(cudaMemcpy(H.data(), d_hist, NBIN * sizeof(unsigned long long), cudaMemcpyDeviceToHost));
        dfree(d_hist);
        G.finite = get1(d_cnt + 1);
        tm.r_count = sync_now() - t0;
    }
    struct Chunk { double* v; uint32_t* r; uint64_t n; };
    std::vector<std::vector<Chunk>> chunks(c.o.kr + 1);
    int* d_num = dalloc<int>(1);
    uint64_t maxpass = 0;
    for (int b = 0;;) {
        uint64_t nmax = 0;
        int b0 = -1, b1 = -1;
        if (single) {
            if (G.passes) break;
            nmax = total;
        } else {
            while (b < NBIN && !H[b]) b++;
            if (b == NBIN) break;
            const uint64_t budget = room();
            b0 = b;
            while (b < NBIN && (nmax == 0 || nmax + H[b] <= budget)) nmax += H[b++];
            b1 = b;
            if (nmax > budget) { c.stats.error = "a value bin exceeds the device memory cap"; return false; }
        }
        G.passes++;
        maxpass = std::max(maxpass, nmax);
        uint64_t* K0 = dalloc<uint64_t>(nmax);
        uint64_t* K1 = dalloc<uint64_t>(nmax);
        uint32_t* R0 = dalloc<uint32_t>(nmax);
        uint32_t* R1 = dalloc<uint32_t>(nmax);
        uint8_t* F = dalloc<uint8_t>(nmax);
        A.keys = K0; A.ranks = R0; A.cap = nmax;
        double t1 = sync_now();
        CK(cudaMemset(d_cnt, 0, sizeof(unsigned long long)));
        if (single) { CK(cudaMemset(d_cnt + 1, 0, sizeof(unsigned long long))); launch(1, 0, 0); }
        else launch(2, b0, b1);
        const uint64_t n = get1(d_cnt);
        if (single) G.finite = get1(d_cnt + 1);
        if (n > nmax) { c.stats.error = "right-side pass overflow (internal error)"; return false; }
        double t2 = sync_now();
        tm.r_gen += t2 - t1;
        // sort by value key, then the lowest rank of every value
        cub::DoubleBuffer<uint64_t> kb(K0, K1);
        cub::DoubleBuffer<uint32_t> rb(R0, R1);
        size_t tb = 0;
        CK(cub::DeviceRadixSort::SortPairs(nullptr, tb, kb, rb, (int)n));
        CK(cub::DeviceRadixSort::SortPairs(temp_for(tb), tb, kb, rb, (int)n));
        uint64_t* Kc = kb.Current();
        uint64_t* Ka = kb.Alternate();
        uint32_t* Rc = rb.Current();
        uint32_t* Ra = rb.Alternate();
        tb = 0;
        CK(cub::DeviceReduce::ReduceByKey(nullptr, tb, Kc, Ka, Rc, Ra, d_num, MinU32(), (int)n));
        CK(cub::DeviceReduce::ReduceByKey(temp_for(tb), tb, Kc, Ka, Rc, Ra, d_num, MinU32(), (int)n));
        const uint64_t m = (uint64_t)get1(d_num);
        G.distinct += m;
        double t3 = sync_now();
        tm.r_sort += t3 - t2;
        // split by length (ranks of length k: [len_off[k], len_off[k+1]) ), in value order
        for (int k = 1; k <= c.o.kr; k++) {
            k_flag_range<<<(unsigned)blocks(m), BLOCK>>>(Ra, m, (uint32_t)c.len_off[k], c.len_off[k + 1], F);
            tb = 0;
            CK(cub::DeviceSelect::Flagged(nullptr, tb, Ka, F, Kc, d_num, (int)m));
            CK(cub::DeviceSelect::Flagged(temp_for(tb), tb, Ka, F, Kc, d_num, (int)m));
            const uint64_t mk = (uint64_t)get1(d_num);
            CK(cub::DeviceSelect::Flagged(temp_for(tb), tb, Ra, F, Rc, d_num, (int)m));
            if (!mk) continue;
            k_key_to_val<<<(unsigned)blocks(mk), BLOCK>>>(Kc, mk);
            Chunk ch = {dalloc<double>(mk), dalloc<uint32_t>(mk), mk};
            CK(cudaMemcpy(ch.v, Kc, mk * 8, cudaMemcpyDeviceToDevice));
            CK(cudaMemcpy(ch.r, Rc, mk * 4, cudaMemcpyDeviceToDevice));
            chunks[k].push_back(ch);
        }
        dfree(K0); dfree(K1); dfree(R0); dfree(R1); dfree(F);
        tm.r_split += sync_now() - t3;
    }
    dfree(d_num); dfree(d_cnt); dfree(d_uoff); dfree(d_usz);
    if (g_verbose)
        fprintf(stderr, "right sides: %llu codes of length <= %d; %d pass(es) of <= %llu; device memory cap %.2f GB; "
                "counting %.2f s\n", (unsigned long long)total, c.o.kr, G.passes, (unsigned long long)maxpass,
                G.cap / 1073741824.0, tm.r_count);
    // join the chunks of every length (a single chunk is the table itself); through host memory if the device
    // cannot hold a length's chunks and its table at once
    const double t5 = sync_now();
    double gb = 0;
    for (int k = 1; k <= c.o.kr; k++) {
        uint64_t nk = 0;
        for (const Chunk& ch : chunks[k]) nk += ch.n;
        G.Rn[k] = nk;
        gb += nk * 12.0 / 1073741824.0;
        if (chunks[k].size() == 1) { G.Rv[k] = chunks[k][0].v; G.Rr[k] = chunks[k][0].r; continue; }
        if (g_dev_cur + nk * 12.0 <= G.cap) {
            G.Rv[k] = dalloc<double>(nk);
            G.Rr[k] = dalloc<uint32_t>(nk);
            uint64_t o = 0;
            for (const Chunk& ch : chunks[k]) {
                CK(cudaMemcpy(G.Rv[k] + o, ch.v, ch.n * 8, cudaMemcpyDeviceToDevice));
                CK(cudaMemcpy(G.Rr[k] + o, ch.r, ch.n * 4, cudaMemcpyDeviceToDevice));
                o += ch.n;
                dfree(ch.v);
                dfree(ch.r);
            }
        } else {
            std::vector<double> hv(nk);
            std::vector<uint32_t> hr(nk);
            uint64_t o = 0;
            for (const Chunk& ch : chunks[k]) {
                CK(cudaMemcpy(hv.data() + o, ch.v, ch.n * 8, cudaMemcpyDeviceToHost));
                CK(cudaMemcpy(hr.data() + o, ch.r, ch.n * 4, cudaMemcpyDeviceToHost));
                o += ch.n;
                dfree(ch.v);
                dfree(ch.r);
            }
            G.Rv[k] = upload(hv);
            G.Rr[k] = upload(hr);
        }
    }
    tm.r_xfer = sync_now() - t5;
    tm.r_total = now() - t0;
    if (g_verbose)
        fprintf(stderr, "right sides: %llu distinct values (%.1f%% of the finite %llu), table %.2f GB; generate %.2f s + sort "
                "%.2f s + split %.2f s + join %.2f s; total build %.2f s, peak memory %.2f GB, peak device memory "
                "%.2f GB\n", (unsigned long long)G.distinct, 100.0 * G.distinct / std::max<uint64_t>(1, G.finite),
                (unsigned long long)G.finite, gb, tm.r_gen, tm.r_sort, tm.r_split, tm.r_xfer, tm.r_total, peak_gb(),
                g_dev_peak / 1073741824.0);
    return true;
}

// Buffers of one batch of left sides
struct LBuf {
    uint64_t cap = 0;
    double* V = nullptr;
    double* D = nullptr;
    uint64_t* LR = nullptr;
    uint32_t* TG = nullptr;
    uint64_t* K0 = nullptr;
    uint64_t* K1 = nullptr;
    uint32_t* I0 = nullptr;
    uint32_t* I1 = nullptr;
    uint32_t* G0 = nullptr;
    uint32_t* G1 = nullptr;
    uint32_t* sel = nullptr;
    uint32_t* uniq = nullptr;
    unsigned long long* cnt = nullptr;
    int* num = nullptr;
    void alloc(uint64_t n)
    {
        cap = n;
        V = dalloc<double>(n); D = dalloc<double>(n); LR = dalloc<uint64_t>(n); TG = dalloc<uint32_t>(n);
        K0 = dalloc<uint64_t>(n); K1 = dalloc<uint64_t>(n); I0 = dalloc<uint32_t>(n); I1 = dalloc<uint32_t>(n);
        G0 = dalloc<uint32_t>(n); G1 = dalloc<uint32_t>(n); sel = dalloc<uint32_t>(n); uniq = dalloc<uint32_t>(n);
        cnt = dalloc<unsigned long long>(1); num = dalloc<int>(1);
    }
    static double bytes_per_entry() { return 8 + 8 + 8 + 4 + 8 + 8 + 4 + 4 + 4 + 4 + 4 + 4; }
};

// Generate, sort and deduplicate the left sides of flat units [F0, F1) of length a; returns the number of distinct
// entries (indices in L.uniq, sorted by (target, value))
static uint64_t left_batch(LBuf& L, LGen& A, uint64_t F0, uint64_t F1, uint64_t& emitted, Timers& tm)
{
    double t0 = now();
    A.F0 = F0; A.F1 = F1; A.ti0 = F0 / A.upt;
    A.V = L.V; A.D = L.D; A.LR = L.LR; A.TG = L.TG; A.cnt = L.cnt; A.cap = L.cap;
    CK(cudaMemset(L.cnt, 0, sizeof(unsigned long long)));
    for (uint64_t f = F0; f < F1; f += SLICE) {
        A.F0 = f;
        A.F1 = std::min(F1, f + SLICE);
        k_gen_l<<<(unsigned)blocks(A.F1 - A.F0), BLOCK>>>(A);
        CK(cudaGetLastError());
    }
    A.F0 = F0; A.F1 = F1;
    const uint64_t n = get1(L.cnt);
    emitted = n;
    if (n > L.cap) { fprintf(stderr, "left-side batch overflow (internal error)\n"); exit(5); }
    double t1 = now();
    tm.l_gen += t1 - t0;
    if (n == 0) return 0;
    const uint64_t ntg = (F1 - 1) / A.upt - A.ti0 + 1;
    int tbits = 0;
    while ((1ULL << tbits) < ntg) tbits++;
    k_lkeys<<<(unsigned)blocks(n), BLOCK>>>(L.V, n, L.K0, L.I0);
    cub::DoubleBuffer<uint64_t> kb(L.K0, L.K1);
    cub::DoubleBuffer<uint32_t> ib(L.I0, L.I1);
    size_t tb = 0;
    CK(cub::DeviceRadixSort::SortPairs(nullptr, tb, kb, ib, (int)n));
    CK(cub::DeviceRadixSort::SortPairs(temp_for(tb), tb, kb, ib, (int)n));
    const uint32_t* tgs = nullptr;
    const uint32_t* pos = nullptr;
    if (tbits > 0) {                                           // stable: by target, values ascending within
        k_gather_tg<<<(unsigned)blocks(n), BLOCK>>>(ib.Current(), n, L.TG, L.G0);
        uint32_t* P0 = (uint32_t*)kb.Alternate();              // positions in the value order (the free key buffer)
        k_iota<<<(unsigned)blocks(n), BLOCK>>>(P0, n);
        cub::DoubleBuffer<uint32_t> gb(L.G0, L.G1), pb(P0, P0 + n);
        tb = 0;
        CK(cub::DeviceRadixSort::SortPairs(nullptr, tb, gb, pb, (int)n, 0, tbits));
        CK(cub::DeviceRadixSort::SortPairs(temp_for(tb), tb, gb, pb, (int)n, 0, tbits));
        tgs = gb.Current();
        pos = pb.Current();
    }
    k_dedup_l<<<(unsigned)blocks(n), BLOCK>>>(tgs, pos, kb.Current(), ib.Current(), n, L.LR, L.sel);
    tb = 0;
    CK(cub::DeviceSelect::If(nullptr, tb, L.sel, L.uniq, L.num, (int)n, NotMax()));
    CK(cub::DeviceSelect::If(temp_for(tb), tb, L.sel, L.uniq, L.num, (int)n, NotMax()));
    const uint64_t nu = (uint64_t)get1(L.num);
    tm.l_sort += now() - t1;
    return nu;
}

static void make_margs(MArgs& M, const Ctx& c, const Gpu& G)
{
    memset(&M, 0, sizeof M);
    for (int b = 1; b <= c.o.kr; b++) { M.Rv[b] = G.Rv[b]; M.Rr[b] = G.Rr[b]; M.Rn[b] = G.Rn[b]; }
    M.Lf = G.Lf; M.Loff = G.Loff; M.nLf = (int)c.Lf.size();
    M.Rf = G.Rf; M.Roff = G.Roff; M.nRf = (int)c.Rf.size();
    M.KR = c.o.kr;
}

// --compare-r: the GPU's right-side tables against mitm_cr's (built on the host with the host's math library), and
// the cause of every difference: all codes of length <= kmax are evaluated node by node on both sides, and the
// first node whose value differs (its inputs being equal) names the function that rounds differently
__global__ void k_eval_nodes(const Form* forms, const uint64_t* off, int nforms, uint64_t n, double* out)
{
    __shared__ DGram g;
    load_gram(g);
    const uint64_t r = blockIdx.x * (uint64_t)BLOCK + threadIdx.x;
    if (r >= n) return;
    int dig[MAXK];
    const Form& f = code_of(forms, off, nforms, r, dig);
    double val[MAXK];
    for (int i = 0; i < f.K; i++) {
        const int d = dig[i];
        double v;
        if (f.ar[i] == 0) v = g.cval[d];
        else if (f.ar[i] == 1) v = un(g.uop[d], val[i - 1]);
        else v = bin(g.bop[d], val[f.c1[i]], val[f.c2[i]]);
        val[i] = v;
        out[r * MAXK + i] = v;
    }
}

static bool same_double(double a, double b) { return memcmp(&a, &b, 8) == 0 || (a != a && b != b); }

static void compare_r(Ctx& c, const Gpu& G, int kmax)
{
    // 1. the tables, per length
    const double t0 = now();
    if (!build_R(c)) { fprintf(stderr, "host tables: %s\n", c.stats.error.c_str()); return; }
    fprintf(stderr, "compare: host tables built in %.2f s\n", now() - t0);
    printf("length\thost distinct\tGPU distinct\tsame value, same code\tsame value, other code\thost only\tGPU only\n");
    for (int k = 1; k <= c.o.kr; k++) {
        const RTable& H = c.Rb[k];
        std::vector<double> gv(G.Rn[k]);
        std::vector<uint32_t> gr(G.Rn[k]);
        if (G.Rn[k]) {
            CK(cudaMemcpy(gv.data(), G.Rv[k], G.Rn[k] * 8, cudaMemcpyDeviceToHost));
            CK(cudaMemcpy(gr.data(), G.Rr[k], G.Rn[k] * 4, cudaMemcpyDeviceToHost));
        }
        uint64_t same = 0, other = 0, honly = 0, gonly = 0;
        size_t i = 0, j = 0;
        while (i < H.v.size() || j < gv.size()) {
            if (j == gv.size() || (i < H.v.size() && H.v[i] < gv[j])) { honly++; i++; }
            else if (i == H.v.size() || gv[j] < H.v[i]) { gonly++; j++; }
            else { if (H.rank(i) == gr[j]) same++; else other++; i++; j++; }
        }
        printf("%d\t%zu\t%zu\t%llu\t%llu\t%llu\t%llu\n", k, H.v.size(), gv.size(), (unsigned long long)same,
               (unsigned long long)other, (unsigned long long)honly, (unsigned long long)gonly);
    }
    // 2. every code of length <= kmax, node by node
    kmax = std::min(kmax, c.o.kr);
    const uint64_t n = c.len_off[kmax + 1];
    std::vector<uint64_t> off(c.Rf.size());
    for (size_t i = 0; i < c.Rf.size(); i++) off[i] = c.Rf[i].offset;
    double* d_out = dalloc<double>(n * MAXK);
    k_eval_nodes<<<(unsigned)blocks(n), BLOCK>>>(G.Rf, G.Roff, (int)c.Rf.size(), n, d_out);
    CK(cudaGetLastError());
    std::vector<double> dv(n * MAXK);
    CK(cudaMemcpy(dv.data(), d_out, n * MAXK * 8, cudaMemcpyDeviceToHost));
    dfree(d_out);
    std::vector<uint64_t> by_u(U_COUNT, 0), by_b(B_COUNT, 0), calls_u(U_COUNT, 0), calls_b(B_COUNT, 0);
    uint64_t ndiff = 0, nfinite_diff = 0;
    struct Ex { uint64_t rank; int node; double h, d; };
    std::vector<Ex> ex;
    for (uint64_t r = 0; r < n; r++) {
        const Form& f = form_of(c.Rf, r);
        int dig[MAXK];
        decode(f, r - f.offset, dig);
        double val[MAXK];
        int first = -1;
        for (int i = 0; i < f.K; i++) {
            const int d = dig[i];
            double v;
            if (f.ar[i] == 0) v = c.g.cval[d];
            else if (f.ar[i] == 1) { v = un(c.g.uop[d], val[i - 1]); calls_u[c.g.uop[d]]++; }
            else { v = bin(c.g.bop[d], val[f.c1[i]], val[f.c2[i]]); calls_b[c.g.bop[d]]++; }
            val[i] = v;
            if (first < 0 && !same_double(v, dv[r * MAXK + i])) {
                first = i;
                if (f.ar[i] == 1) by_u[c.g.uop[d]]++; else if (f.ar[i] == 2) by_b[c.g.bop[d]]++;
            }
            if (first >= 0) break;                             // later nodes have unequal inputs
        }
        if (first >= 0) {
            ndiff++;
            const double h = val[first], d = dv[r * MAXK + first];
            if (std::isfinite(h) && std::isfinite(d)) nfinite_diff++;
            if (ex.size() < 40 && std::isfinite(h) && std::isfinite(d)) ex.push_back({r, first, h, d});
        }
    }
    printf("\ncodes of length <= %d: %llu; a node differs in %llu (both values finite at the first differing node: %llu)\n",
           kmax, (unsigned long long)n, (unsigned long long)ndiff, (unsigned long long)nfinite_diff);
    printf("function\tcalls (until the first difference)\tfirst difference here\tshare\n");
    for (int i = 0; i < U_COUNT; i++)
        if (calls_u[i]) printf("%s\t%llu\t%llu\t%.3g%%\n", UNAME[i], (unsigned long long)calls_u[i], (unsigned long long)by_u[i], 100.0 * by_u[i] / calls_u[i]);
    for (int i = 0; i < B_COUNT; i++)
        if (calls_b[i]) printf("%s\t%llu\t%llu\t%.3g%%\n", BNAME[i], (unsigned long long)calls_b[i], (unsigned long long)by_b[i], 100.0 * by_b[i] / calls_b[i]);
    printf("\nexamples (code, node, host value, GPU value, difference in ulp of the host value):\n");
    for (const Ex& e : ex) {
        const double ulp = std::nextafter(std::fabs(e.h), INFINITY) - std::fabs(e.h);
        printf("%s\t%d\t%.17g\t%.17g\t%.1f\n", rpn(form_of(c.Rf, e.rank), e.rank, c.g).c_str(), e.node, e.h, e.d, (e.d - e.h) / ulp);
    }
}

// mitm_cr --bench on the GPU
static void bench_gpu(Ctx& c, Gpu& G)
{
    const double t0 = sync_now();
    const uint64_t ncodes = c.Lf.empty() ? 0 : c.Lf.back().offset + c.Lf.back().count;
    std::vector<uint32_t> usz;
    const std::vector<uint64_t> uoff = units_of(c.Lf, 0, c.Lf.size(), usz);
    uint64_t* d_uoff = upload(uoff);
    uint32_t* d_usz = upload(usz);
    std::vector<double> hT(1, c.o.bench_T);
    std::vector<uint32_t> hact(1, 0);
    double* d_T = upload(hT);
    uint32_t* d_act = upload(hact);
    double* V = dalloc<double>(ncodes);
    double* D = dalloc<double>(ncodes);
    uint64_t* LR = dalloc<uint64_t>(ncodes);
    uint32_t* TG = dalloc<uint32_t>(ncodes);
    unsigned long long* cnt = dalloc<unsigned long long>(4);
    CK(cudaMemset(cnt, 0, 4 * sizeof(unsigned long long)));
    LGen A;
    memset(&A, 0, sizeof A);
    A.forms = G.Lf; A.f0 = 0; A.nf = (int)c.Lf.size(); A.uoff = d_uoff; A.usz = d_usz; A.upt = uoff.back(); A.act = d_act; A.T = d_T;
    A.xonce = 0; A.want_der = 0; A.bench = 1; A.V = V; A.D = D; A.LR = LR; A.TG = TG; A.cnt = cnt; A.cap = ncodes;
    A.stat = cnt + 2;
    for (uint64_t f = 0; f < A.upt; f += SLICE) {
        A.F0 = f;
        A.F1 = std::min(A.upt, f + SLICE);
        k_gen_l<<<(unsigned)blocks(A.F1 - A.F0), BLOCK>>>(A);
        CK(cudaGetLastError());
    }
    const uint64_t n = get1(cnt);
    uint64_t* K0 = dalloc<uint64_t>(n);
    uint64_t* K1 = dalloc<uint64_t>(n);
    int* num = dalloc<int>(1);
    k_lkeys<<<(unsigned)blocks(n), BLOCK>>>(V, n, K0, (uint32_t*)D);
    size_t tb = 0;
    CK(cub::DeviceRadixSort::SortKeys(nullptr, tb, K0, K1, (int)n));
    CK(cub::DeviceRadixSort::SortKeys(temp_for(tb), tb, K0, K1, (int)n));
    tb = 0;
    CK(cub::DeviceSelect::Unique(nullptr, tb, K1, K0, num, (int)n));
    CK(cub::DeviceSelect::Unique(temp_for(tb), tb, K1, K0, num, (int)n));
    const uint64_t nd = (uint64_t)get1(num);
    const double t1 = sync_now();
    MArgs M;
    make_margs(M, c, G);
    k_bench_pairs<<<(unsigned)blocks(nd), BLOCK>>>(K0, nd, c.o.kr, M, c.o.bench_tol, cnt + 1);
    const unsigned long long pairs = get1(cnt + 1);
    uint64_t nR = 0;
    for (int b = 1; b <= c.o.kr; b++) nR += G.Rn[b];
    fprintf(stderr, "bench: T = %.17g, tolrel %g: |L| = %llu finite non-zero, %llu distinct; |R| = %llu distinct (incl. 0); "
            "%llu pairs; left sides %.2f s, sweep %.2f s\n", c.o.bench_T, c.o.bench_tol, (unsigned long long)n,
            (unsigned long long)nd, (unsigned long long)nR, pairs, t1 - t0, sync_now() - t1);
    printf("%llu\n", pairs);
}

// order of two results of one target: mitm_cr keeps the first it meets among equal (total, error)
static bool before(int a1, uint64_t o1, int a2, uint64_t o2) { return a1 < a2 || (a1 == a2 && o1 < o2); }

struct Best {
    Match m;
    uint64_t order = 0;
};
struct ApxBest {
    bool set = false;
    double e = INFINITY;
    int a = 0, b = 0;
    uint64_t order = 0, lrank = 0, rrank = 0;
};

// The GPU, the buttons and the forms on it; returns false if no CUDA device
static bool gpu_setup(Ctx& c, Gpu& G, double vram_gb, Timers& tm, double T0, bool verbose)
{
    if (cudaSetDevice(0) != cudaSuccess || cudaFree(0) != cudaSuccess) { fprintf(stderr, "no CUDA device\n"); return false; }
    cudaDeviceProp prop;
    CK(cudaGetDeviceProperties(&prop, 0));
    size_t vfree = 0, vtotal = 0;
    CK(cudaMemGetInfo(&vfree, &vtotal));
    tm.ctx = now() - T0;
    G.cap = vram_gb > 0 ? vram_gb * 1073741824.0 : 0.8 * vfree;
    G.name = prop.name;
    if (verbose)
        fprintf(stderr, "GPU: %s, %d SMs, %.2f GB free of %.2f GB, cap %.2f GB; context %.2f s\n", prop.name,
                prop.multiProcessorCount, vfree / 1073741824.0, vtotal / 1073741824.0, G.cap / 1073741824.0, tm.ctx);
    upload_grammar(c.g);
    G.Lf = upload(c.Lf);
    G.Rf = upload(c.Rf);
    std::vector<uint64_t> lo(c.Lf.size()), ro(c.Rf.size());
    for (size_t i = 0; i < c.Lf.size(); i++) lo[i] = c.Lf[i].offset;
    for (size_t i = 0; i < c.Rf.size(); i++) ro[i] = c.Rf[i].offset;
    G.Loff = upload(lo);
    G.Roff = upload(ro);
    return true;
}

struct GpuSearch {
    bool verify_gpu = true;                                    // false: the host decides on the GPU's candidates
    bool no_apx = false;                                       // no closest pairs (timing only)
    bool all_apx = false;                                      // closest pair of every total length for every target
};                                                             // (the RIES-like tools), not only for the FAILUREs

struct GpuStats {
    double t_targets = 0, ms_each = 0;
    uint64_t nbatch = 0, sum_distinct = 0, sum_cand = 0, nrej_host = 0;
    unsigned long long st[8] = {};
};

// The search for a batch of targets (the right-side tables already on the GPU): per target, the shortest accepted
// equation (res.best), the closest pair of every total length (res.approx; for the FAILUREs, or for all targets with
// all_apx), refined by Newton steps on the host as mitm_cr does, and the candidate count. Returns false on a failure.
static bool gpu_search(Ctx& c, Gpu& G, const std::vector<std::string>& ids, const std::vector<double>& vals,
                       const GpuSearch& S, Timers& tm, GpuStats& gs, std::vector<TargetResult>& results)
{
    Options& o = c.o;
    const bool verify_gpu = S.verify_gpu, no_apx = S.no_apx;
    const size_t NT = ids.size();
    const int NS = o.kl + o.kr + 1;
    const double tol = o.tolrel > 0 ? o.tolrel : o.tol_eps * DBL_EPSILON;
    const double errcap = std::max(o.errcap, tol);
    const double t1 = sync_now();

    double* d_T = upload(vals);
    std::vector<int> hbest(NT, INT_MAX), hsucc(NT, 0);
    int* d_best = upload(hbest);
    int* d_succ = upload(hsucc);
    std::vector<unsigned long long> hapx((size_t)NT * NS, (unsigned long long)0x7FF0000000000000ULL);   // +inf
    unsigned long long* d_apx = upload(hapx);
    unsigned int* d_ncand = dalloc<unsigned int>(NT);
    CK(cudaMemset(d_ncand, 0, NT * sizeof(unsigned int)));
    uint32_t* d_act = dalloc<uint32_t>(NT);
    unsigned long long* d_stat = dalloc<unsigned long long>(8);
    CK(cudaMemset(d_stat, 0, 8 * sizeof(unsigned long long)));
    unsigned long long* d_rcnt = dalloc<unsigned long long>(3);
    const uint64_t ACC_CAP = 1 << 20, APX_CAP = 1 << 22, CAND_CAP = verify_gpu ? 1 : 1 << 22;
    AccRec* d_acc = dalloc<AccRec>(ACC_CAP);
    ApxRec* d_apr = dalloc<ApxRec>(APX_CAP);
    CandRec* d_cand = dalloc<CandRec>(CAND_CAP);
    std::vector<uint64_t*> d_luoff(o.kl + 2, nullptr);
    std::vector<uint32_t*> d_lusz(o.kl + 2, nullptr);
    std::vector<std::vector<uint64_t>> luoff(o.kl + 2), lcpre(o.kl + 2);
    std::vector<std::vector<uint32_t>> lusz(o.kl + 2);
    for (int a = 1; a <= o.kl; a++) {
        luoff[a] = units_of(c.Lf, c.Lbeg[a], c.Lbeg[a + 1], lusz[a]);
        d_luoff[a] = upload(luoff[a]);
        d_lusz[a] = upload(lusz[a]);
        lcpre[a].assign(1, 0);                                 // codes before each form of length a
        for (size_t i = c.Lbeg[a]; i < c.Lbeg[a + 1]; i++) lcpre[a].push_back(lcpre[a].back() + c.Lf[i].count);
    }
    // codes of length a before flat unit F (target F / upt, its unit F % upt)
    auto flat_codes = [&](int a, uint64_t F) {
        const uint64_t upt = luoff[a].back(), ti = F / upt, u = F - ti * upt;
        const size_t fi = std::upper_bound(luoff[a].begin(), luoff[a].end() - 1, u) - luoff[a].begin() - 1;
        const uint64_t f0 = c.Lbeg[a];
        return ti * lcpre[a].back() + lcpre[a][fi] + std::min<uint64_t>((u - luoff[a][fi]) * lusz[a][fi], c.Lf[f0 + fi].count);
    };
    // the batch buffers: what remains of the cap
    LBuf L;
    {
        const double room = G.cap - g_dev_cur - 512e6;       // CUB scratch and margin
        uint64_t cap = (uint64_t)std::max(1e6, room / LBuf::bytes_per_entry());
        cap = std::min<uint64_t>(cap, 0x7FFFFFFFULL);
        uint64_t need = 0;                                     // never more than the largest length needs
        for (int a = 1; a <= o.kl; a++) need = std::max<uint64_t>(need, (uint64_t)NT * lcpre[a].back());
        L.alloc(std::max<uint64_t>(UMAX, std::min(cap, need)));
    }

    // host results
    std::vector<Best> best(NT);
    std::vector<std::vector<ApxBest>> apx(NT, std::vector<ApxBest>(NS));
    std::vector<CandRec> hcand;
    std::vector<AccRec> hacc;
    std::vector<ApxRec> hapr;
    std::vector<uint64_t> nhost_cand(NT, 0);
    uint64_t sum_emitted = 0;
    int nthreads = std::max(1, o.threads);
    const size_t chunk0 = c.o.chunk;
    c.o.chunk = 1;                                             // the host Workers below need no chunk buffers
    std::vector<Worker*> workers;
    for (int t = 0; t < nthreads; t++) workers.push_back(new Worker(c));
    c.o.chunk = chunk0;
    auto setup_worker = [&](Worker& w, size_t t) {
        w.T = vals[t];
        w.absT = w.T != 0.0 ? std::fabs(w.T) : 1.0;
        w.tol = tol;
        w.tolT = tol * w.absT;
        w.errcap = errcap;
        w.id = ids[t].c_str();
    };

    for (int a = 1; a <= o.kl; a++) {
        std::vector<uint32_t> act;
        for (size_t t = 0; t < NT; t++)
            if (best[t].m.total == INT_MAX || best[t].m.total > a + 1) act.push_back((uint32_t)t);
        if (act.empty()) break;
        const uint64_t upt = luoff[a].back();
        if (upt == 0) continue;
        CK(cudaMemcpy(d_act, act.data(), act.size() * 4, cudaMemcpyHostToDevice));
        LGen A;
        memset(&A, 0, sizeof A);
        A.forms = G.Lf; A.f0 = (int)c.Lbeg[a]; A.nf = (int)(c.Lbeg[a + 1] - c.Lbeg[a]); A.uoff = d_luoff[a]; A.usz = d_lusz[a]; A.upt = upt;
        A.act = d_act; A.T = d_T; A.kmin = o.kappa_min; A.kmax = o.kappa_max; A.pmax = o.periodic_max;
        A.xonce = !o.anyx; A.want_der = 1; A.bench = 0; A.stat = d_stat;
        MArgs M;
        make_margs(M, c, G);
        M.a = a; M.NS = NS; M.maxtry = (int)std::min<size_t>(o.maxtry, INT_MAX); M.verify_gpu = verify_gpu; M.no_apx = no_apx;
        M.all_apx = S.all_apx;
        M.V = L.V; M.D = L.D; M.LR = L.LR; M.TG = L.TG; M.uniq = L.uniq; M.act = d_act; M.T = d_T; M.tol = tol;
        M.errcap = errcap; M.best = d_best; M.succ = d_succ; M.apx = d_apx; M.ncand = d_ncand; M.acc = d_acc;
        M.apr = d_apr; M.cand = d_cand; M.cnt = d_rcnt; M.acc_cap = ACC_CAP; M.apx_cap = APX_CAP; M.cand_cap = CAND_CAP;
        M.stat = d_stat;
        const uint64_t nflat = (uint64_t)act.size() * upt;
        for (uint64_t F0 = 0, F1; F0 < nflat; F0 = F1) {
            // the largest batch whose codes fit into the buffers (at least one unit)
            const uint64_t c0 = flat_codes(a, F0);
            uint64_t lo = F0 + 1, hi = nflat;
            while (lo < hi) {
                const uint64_t mid = lo + (hi - lo + 1) / 2;
                if (flat_codes(a, mid) - c0 <= L.cap) lo = mid; else hi = mid - 1;
            }
            F1 = lo;
            uint64_t emitted = 0;
            const uint64_t nu = left_batch(L, A, F0, F1, emitted, tm);
            sum_emitted += emitted;
            gs.sum_distinct += nu;
            if (!nu) continue;
            const double t2 = now();
            CK(cudaMemset(d_rcnt, 0, 3 * sizeof(unsigned long long)));
            M.ti0 = A.ti0;
            M.batch = gs.nbatch++;
            static const int STRIDE[3] = {4096, 64, 1};             // seed passes, then the main pass
            for (int pass = no_apx ? 2 : 0; pass < 3; pass++) {
                M.seed = pass < 2;
                M.stride = STRIDE[pass];
                for (uint64_t k = 0; k < nu; k += 16 * SLICE * M.stride) {
                    M.k0 = k;
                    M.k1 = std::min(nu, k + 16 * SLICE * M.stride);
                    k_match<<<(unsigned)blocks((M.k1 - M.k0 + M.stride - 1) / M.stride), BLOCK>>>(M);
                    CK(cudaGetLastError());
                }
            }
            unsigned long long rc[3];
            CK(cudaMemcpy(rc, d_rcnt, sizeof rc, cudaMemcpyDeviceToHost));
            const double t3 = now();
            tm.l_match += t3 - t2;
            if (rc[0] > ACC_CAP || rc[1] > APX_CAP || rc[2] > CAND_CAP) {
                fprintf(stderr, "record buffers overflow (%llu accepted, %llu approximations, %llu candidates)\n", rc[0], rc[1], rc[2]);
                return false;
            }
            const size_t o0 = hacc.size(), o1 = hapr.size(), o2 = hcand.size();
            hacc.resize(o0 + rc[0]);
            hapr.resize(o1 + rc[1]);
            hcand.resize(o2 + rc[2]);
            if (rc[0]) CK(cudaMemcpy(hacc.data() + o0, d_acc, rc[0] * sizeof(AccRec), cudaMemcpyDeviceToHost));
            if (rc[1]) CK(cudaMemcpy(hapr.data() + o1, d_apr, rc[1] * sizeof(ApxRec), cudaMemcpyDeviceToHost));
            if (rc[2]) CK(cudaMemcpy(hcand.data() + o2, d_cand, rc[2] * sizeof(CandRec), cudaMemcpyDeviceToHost));
            tm.l_xfer += now() - t3;
        }
        // the results of this length
        const double t4 = now();
        for (const AccRec& r : hacc) {
            Best& bb = best[r.t];
            const int total = r.a + r.b;
            const Match& m = bb.m;
            if (total < m.total || (total == m.total && (r.err < m.err || (r.err == m.err && before(r.a, r.order, m.la, bb.order))))) {
                Match nm;
                nm.total = total; nm.la = r.a; nm.lb = r.b; nm.err = r.err; nm.x = r.x; nm.lrank = r.lrank; nm.rrank = r.rrank;
                nm.accepted = true;
                bb.m = nm;
                bb.order = r.order;
            }
        }
        hacc.clear();
        for (const ApxRec& r : hapr) {
            ApxBest& s = apx[r.t][r.a + r.b];
            if (!s.set || r.e < s.e || (r.e == s.e && before(r.a, r.order, s.a, s.order))) {
                s.set = true; s.e = r.e; s.a = r.a; s.b = r.b; s.order = r.order; s.lrank = r.lrank; s.rrank = r.rrank;
            }
        }
        hapr.clear();
        if (!verify_gpu && !hcand.empty()) {                   // mitm_cr's decisions on the GPU's candidates
            std::sort(hcand.begin(), hcand.end(), [](const CandRec& x, const CandRec& y) {
                if (x.t != y.t) return x.t < y.t;
                if (x.order != y.order) return x.order < y.order;
                if (x.b != y.b) return x.b < y.b;
                return x.tr < y.tr;
            });
            std::vector<size_t> starts;
            for (size_t i = 0; i < hcand.size(); i++) if (i == 0 || hcand[i].t != hcand[i - 1].t) starts.push_back(i);
            starts.push_back(hcand.size());
            std::atomic<uint64_t> rej{0};
            parallel_for(nthreads, starts.size() - 1, [&](int tid, size_t si) {
                Worker& w = *workers[tid];
                const size_t i0 = starts[si], i1 = starts[si + 1];
                const uint32_t t = hcand[i0].t;
                setup_worker(w, t);
                Best& bb = best[t];
                size_t i = i0;
                while (i < i1) {                               // one left value
                    size_t j = i;
                    while (j < i1 && hcand[j].order == hcand[i].order) j++;
                    const int bmax = bb.m.total == INT_MAX ? o.kr : std::min(o.kr, bb.m.total - a);
                    for (size_t q = i; q < j; q++) {
                        const CandRec& r = hcand[q];
                        if (r.b > bmax) break;
                        nhost_cand[t]++;
                        const int total = r.a + r.b;
                        if (total > bb.m.total) continue;
                        double eL = INFINITY, dL = 0;
                        const double x = w.newton(r.lrank, w.r_value(r.rrank), eL, dL);
                        const double err = std::fabs(x - w.T) / w.absT;
                        const double ex = (eL + w.r_error(r.rrank)) / std::fabs(dL) / w.absT;
                        if (!(err <= tol)) continue;
                        if (!(ex <= errcap)) { rej++; continue; }
                        Match nm;
                        nm.total = total; nm.la = r.a; nm.lb = r.b; nm.err = err; nm.x = x; nm.lrank = r.lrank;
                        nm.rrank = r.rrank; nm.accepted = true;
                        if (nm.better(bb.m)) { bb.m = nm; bb.order = r.order; }
                        break;
                    }
                    i = j;
                }
            });
            gs.nrej_host += rej;
            hcand.clear();
        }
        for (size_t t = 0; t < NT; t++) {
            hbest[t] = best[t].m.total;
            hsucc[t] = best[t].m.total != INT_MAX;
        }
        CK(cudaMemcpy(d_best, hbest.data(), NT * 4, cudaMemcpyHostToDevice));
        CK(cudaMemcpy(d_succ, hsucc.data(), NT * 4, cudaMemcpyHostToDevice));
        tm.l_host += now() - t4;
    }

    // closest pairs (of the targets without an equation, or of all with all_apx): refined by Newton steps on the
    // host, as mitm_cr
    const double t5 = sync_now();
    std::vector<unsigned int> ncand(NT);
    CK(cudaMemcpy(ncand.data(), d_ncand, NT * 4, cudaMemcpyDeviceToHost));
    CK(cudaMemcpy(gs.st, d_stat, sizeof gs.st, cudaMemcpyDeviceToHost));
    gs.t_targets = t5 - t1;
    gs.ms_each = NT ? 1e3 * gs.t_targets / NT : 0.0;
    results.assign(NT, TargetResult());
    parallel_for(nthreads, NT, [&](int tid, size_t t) {
        Worker& w = *workers[tid];
        setup_worker(w, t);
        TargetResult& res = results[t];
        res.approx.assign(NS, Match());
        if (best[t].m.total != INT_MAX) res.best = best[t].m;
        if (best[t].m.total == INT_MAX || S.all_apx)
            for (int n = 0; n < NS; n++) {
                const ApxBest& s = apx[t][n];
                if (!s.set) continue;
                Match& ap = res.approx[n];
                ap.total = n; ap.la = s.a; ap.lb = s.b; ap.err = s.e; ap.lrank = s.lrank; ap.rrank = s.rrank; ap.accepted = false;
                double x;
                if (w.newton_root(ap.lrank, w.r_value(ap.rrank), x)) { ap.err = std::fabs(x - w.T) / w.absT; ap.x = x; }
                else ap = Match();
            }
        if (res.best.total != INT_MAX && !(res.approx[res.best.total].err < res.best.err))
            res.approx[res.best.total] = res.best;                 // as mitm_cr: an accepted pair is its length's closest
        res.candidates = verify_gpu ? ncand[t] : nhost_cand[t];
        res.ms = gs.ms_each;
    });
    tm.l_final = now() - t5;
    for (size_t t = 0; t < NT; t++) gs.sum_cand += verify_gpu ? ncand[t] : nhost_cand[t];
    for (Worker* w : workers) delete w;
    (void)sum_emitted;
    return true;
}

#ifndef MITM_GPU_LIBRARY
int main(int argc, char** argv)
{
    Ctx c;
    Options& o = c.o;
    const char* eval_code = nullptr;
    const char* input = nullptr;
    double eval_x = 0, vram_gb = 0;
    GpuSearch S;
    int compare_kmax = 0;
    for (int i = 1; i < argc; i++) {
        std::string a = argv[i];
        auto next = [&]() { if (i + 1 >= argc) { fprintf(stderr, "missing value for %s\n", a.c_str()); exit(2); } return argv[++i]; };
        if (a == "--kl") o.kl = atoi(next());
        else if (a == "--kr") o.kr = atoi(next());
        else if (a == "--common") { o.consts = COMMON_CONSTS; o.funcs = COMMON_FUNCS; o.ops = CALC4_OPS; }
        else if (a == "--consts") o.consts = next();
        else if (a == "--funcs") o.funcs = next();
        else if (a == "--ops") o.ops = next();
        else if (a == "--anyx") o.anyx = true;
        else if (a == "--list") { fprintf(stderr, "--list is not supported by mitm_gpu (use mitm_cr)\n"); return 2; }
        else if (a == "--tol") o.tol_eps = atof(next());
        else if (a == "--tolrel") o.tolrel = atof(next());
        else if (a == "--kappa-min") o.kappa_min = atof(next());
        else if (a == "--kappa-max") o.kappa_max = atof(next());
        else if (a == "--errcap") o.errcap = atof(next());
        else if (a == "--maxtry") o.maxtry = (size_t)atof(next());
        else if (a == "--periodic-max") o.periodic_max = atof(next());
        else if (a == "--threads") o.threads = atoi(next());
        else if (a == "--memcap") o.memcap_gb = atof(next());
        else if (a == "--chunk") next();
        else if (a == "--vram") vram_gb = atof(next());
        else if (a == "--input") input = next();
        else if (a == "--compare-r") compare_kmax = atoi(next());
        else if (a == "--no-approx") S.no_apx = true;              // timing only: FAILURE lines without the closest pair
        else if (a == "--verify") {
            const std::string v = next();
            if (v == "gpu") S.verify_gpu = true;
            else if (v == "host") S.verify_gpu = false;
            else { fprintf(stderr, "--verify gpu|host\n"); return 2; }
        }
        else if (a == "--bench") { o.bench = true; o.anyx = true; g_subnormal_ok = true; o.bench_T = atof(next()); o.bench_tol = atof(next()); }
        else if (a == "--eval") { eval_code = next(); eval_x = atof(next()); }
        else { fprintf(stderr, "unknown option %s (see the header of mitm_cuda.cu)\n", a.c_str()); return 2; }
    }
    const std::string gerr = make_grammar(c.g, o.consts, o.funcs, o.ops);
    if (!gerr.empty()) { fprintf(stderr, "buttons: %s\n", gerr.c_str()); return 2; }
    if (eval_code) return eval_mode(c.g, eval_code, eval_x);
    if (c.g.nc > 63 || c.g.nu > 32 || c.g.nb > 8) { fprintf(stderr, "too many buttons for the GPU tables\n"); return 2; }
    if (o.kappa_max < 0) o.kappa_max = 2 * (o.tolrel > 0 ? o.tolrel / DBL_EPSILON : o.tol_eps);
    if (o.kl < 1 || o.kl > MAXK || o.kr < 1 || o.kr > MAXK) { fprintf(stderr, "bad lengths\n"); return 2; }
    const double T0 = now(), C0 = cpu_seconds();
    Timers tm;

    setup_right(c);
    setup_left(c);
    const uint64_t nLcodes = c.Lf.empty() ? 0 : c.Lf.back().offset + c.Lf.back().count;
    fprintf(stderr, "grammar: %d constants, %d functions, %d operators; left sides: x %s, length <= %d, %llu codes "
            "per target; tol %g, kappa %g..%g, errcap %g, maxtry %zu, verify %s\n",
            c.g.nc, c.g.nu, c.g.nb, o.anyx ? "any number of times" : "exactly once", o.kl, (unsigned long long)nLcodes,
            o.tolrel > 0 ? o.tolrel : o.tol_eps * DBL_EPSILON, o.kappa_min, o.kappa_max, o.errcap, o.maxtry,
            S.verify_gpu ? "gpu" : "host");

    Gpu G;
    if (!gpu_setup(c, G, vram_gb, tm, T0, true)) return 4;
    if (!build_R_gpu(c, G, tm)) { fprintf(stderr, "%s\n", c.stats.error.c_str()); return 3; }
    const double t_R = now() - T0, cpu_R = cpu_seconds() - C0;
    if (o.bench) { bench_gpu(c, G); return 0; }
    if (compare_kmax) { compare_r(c, G, compare_kmax); return 0; }

    // targets
    std::vector<std::string> ids;
    std::vector<double> vals;
    {
        char line[512], id[256];
        FILE* in = input ? fopen(input, "r") : stdin;
        if (!in) { fprintf(stderr, "cannot open %s\n", input); return 2; }
        while (fgets(line, sizeof line, in)) {
            double v;
            if (sscanf(line, "%255s %lf", id, &v) == 2) { ids.push_back(id); vals.push_back(v); }
        }
    }
    GpuStats gs;
    std::vector<TargetResult> results;
    if (!gpu_search(c, G, ids, vals, S, tm, gs, results)) return 5;

    // one line per target, in mitm_cr's format
    const double t6 = now();
    {
        const size_t chunk0 = c.o.chunk;
        c.o.chunk = 1;
        Worker w(c);
        c.o.chunk = chunk0;
        for (size_t t = 0; t < ids.size(); t++) {
            w.id = ids[t].c_str();
            w.T = vals[t];
            w.absT = w.T != 0.0 ? std::fabs(w.T) : 1.0;
            w.res = results[t];
            w.listing.clear();
            fputs(w.line().c_str(), stdout);
        }
        fflush(stdout);
    }
    tm.l_final += now() - t6;
    const unsigned long long* st = gs.st;
    fprintf(stderr, "targets: %zu in %.2f s wall (%.1f ms each); GPU: left sides %.2f s, sort %.2f s, match %.2f s (verify %s), "
            "transfers %.2f s; host: results %.2f s, closest pairs %.2f s; %llu batches; %llu left values (%llu distinct per "
            "chunk; skipped: %llu by kappa; maxtry reached %llu times), %llu candidates (%llu rejected by errcap)\n",
            ids.size(), gs.t_targets + tm.l_final, gs.ms_each, tm.l_gen, tm.l_sort, tm.l_match,
            S.verify_gpu ? "on the GPU, included" : "on the host", tm.l_xfer, tm.l_host, tm.l_final,
            (unsigned long long)gs.nbatch, st[0], (unsigned long long)gs.sum_distinct, st[1], st[2],
            (unsigned long long)gs.sum_cand, (unsigned long long)(S.verify_gpu ? st[3] : gs.nrej_host));
    fprintf(stderr, "closest pairs: %llu noise checks on the GPU\n", st[4]);
    fprintf(stderr, "total: %.2f s wall (right sides %.2f s), CPU %.2f s (right sides %.2f s), peak memory %.2f GB, "
            "peak device memory %.2f GB\n", now() - T0, t_R, cpu_seconds() - C0, cpu_R, peak_gb(), g_dev_peak / 1073741824.0);
    return 0;
}
#endif
