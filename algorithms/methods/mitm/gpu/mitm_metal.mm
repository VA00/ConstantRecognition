// mitm_metal.mm - the meet-in-the-middle search of ../mitm_cr.cpp on an Apple GPU (Phase 2, Metal backend)
//
// Author: Andrzej Odrzywolek
// Date: October 4, 2026
// Code assist: Claude Opus 5.5
//
// Same command line, input and output as mitm_cr and mitm_gpu (CUDA), so that benchmark/run/run_mitm_v0.py --exe
// .../gpu/mitm_metal works unchanged. The host side (buttons, forms, ranks, RPN output, every decision in double
// precision) is mitm_cr.cpp itself, included as a library; the kernels are mitm_kernels.metal, compiled at run time.
//
// Apple GPUs have no double precision, so the GPU computes in df64 (pairs of floats, about 48 bits, df64.h) and only
// finds candidates; the host decides with mitm_cr's own rules in double:
//   right sides  generated on the GPU in df64, sorted (own LSD radix sort), one entry per df64 value with the lowest
//                rank, split by length (passes over value ranges when everything does not fit at once, as mitm_cr).
//                Then the host evaluates every entry in double (mitm_cr's buttons, in rank order: shared prefixes) and
//                stores the difference c = R_double - R_df64 as a float: the GPU compares with R_df64 + c, i.e. with
//                mitm_cr's own values. As mitm_cr, one code per double value: an entry whose double value is that of
//                a code of lower rank is dropped (c = NaN, as for values not usable in double). Entries whose double
//                value is more than cw u from their df64 value go to a side table per length, sorted by double value.
//                mitm_cr's error bound of every entry (eval_full's rule, computed on the GPU) is kept in one byte.
//   left sides   per length, for all open targets in batches: df64 values, derivatives, a first-order bound E of the
//                df64 rounding error and mitm_cr's double-precision bound, with enum_L's guards; corrected for the
//                rounding of T to df64; sorted by value, then by target; one entry per (target, df64 value)
//   matching     per distinct left value and right length b <= bmax: every right side with
//                |L - R_double| <= tol |T| |L'| + margin E (mitm_cr's window, widened by the df64 error of L) is a
//                candidate (none for a left value whose double-precision bound alone exceeds errcap: mitm_cr would
//                reject them all); without candidates, the closest pairs (near ties included) for the FAILURE lines
//   decisions    per target on the host, in mitm_cr's order: left values re-evaluated in double with enum_L's guards
//                and the kappa range, one code per double value (the lowest rank, with the records of the others);
//                per right length the candidates inside mitm_cr's window, closest first, at most maxtry, Newton steps,
//                errcap (Worker::newton, r_error), or the closest pair with mitm_cr's noise check: the same decisions
//                as mitm_cr whenever the GPU's records contain mitm_cr's pairs
//   result       per target the accepted equation of the smallest total length (ties: error, then mitm_cr's order);
//                for a FAILURE the closest pair, refined by Newton steps on the host, as mitm_cr
// Differences from mitm_cr by design: values outside df64's range (magnitudes above 3.4e38 or below 2^-76, and
// trigonometric arguments beyond 1608) are not generated on the GPU; two codes with the same df64 value but different
// double values are one entry on the GPU (the lower rank); duplicate left values are dropped per batch. Every
// difference on benchmark v0 is listed in PHASE2_RESULTS.md (section m3).
// Debugging: MITM_METAL_CHECK=1 (timings and tables), MITM_METAL_TRACE=id (the decisions of one target),
// MITM_METAL_FIND=value (table entries near a value).
//
// Build: make metal (clang++ -fobjc-arc, Metal and Foundation frameworks; no fast math anywhere)
// Usage: mitm_metal [mitm_cr's options] [--vram GB] [--margin 2] [--cw 32] [--cand-max 256] [--input FILE]
//                   [--verify host|gpu] [--tol-u 2] < targets
//          --vram: cap of the GPU buffers (default: 60 % of the GPU's recommended working set, at most --memcap);
//          --margin: the window's multiple of the error bound of L; --cw: right sides whose double value differs
//          from their df64 value by more than cw u may be missed (counted); --cand-max: candidates per left value
//          and right length (counted when reached); --threads: host threads for the decisions; --list unsupported;
//          --verify gpu: no double precision at all (what WebGPU gets without a WebAssembly verifier): candidates of
//          the df64 table inside tol-u u (default 2, i.e. 32 DBL_EPSILON) accepted by Newton steps and error bounds in
//          df64 on the GPU; --verify host (default): every decision in double on the host, as mitm_cr;
//          --df64-stats: the distance of the df64 values of the right sides from their double values
//        mitm_metal --bench T tolrel [--kl 7] [--kr 8] [--common]   pair count as mitm_cr --bench (df64 values)

#define MITM_LIBRARY
#include "../mitm_cr.cpp"
#include "metal_ctx.h"
#include "df64_ops.h"
#include "mitm_metal_shared.h"
#include "mitm_kernels_src.h"                                  // kMitmKernels (embed_metal.sh)
#include <unordered_map>

static_assert(sizeof(GForm) == 216, "GForm layout");
static_assert(DU_SINPI == U_SINPI && DU_MINUS == U_MINUS && DU_ATANH == U_ATANH && DB_ATAN2 == B_ATAN2 &&
              DB_LOGARITHM == B_LOGARITHM && DB_ROOT == B_ROOT, "operation codes of df64_ops.h");

static const uint64_t SLICE = 1u << 18;                        // threads per generation dispatch

// ------------------------------------------------------------------------------------------------ the device

struct Timers {
    double ctx = 0, r_count = 0, r_gen = 0, r_sort = 0, r_split = 0, r_corr = 0, r_total = 0;
    double l_gen = 0, l_sort = 0, l_match = 0, l_host = 0, l_final = 0;
};

struct Gpu {
    MetalCtx M;
    std::string name;
    double cap = 0;
    GGram gram;
    DArr<GForm> Lf, Rf;
    DArr<uint64_t> Loff, Roff;
    DArr<uint64_t> Rk[MAXK + 1];
    DArr<float> Rc[MAXK + 1];
    DArr<uint32_t> Rr[MAXK + 1];
    uint64_t Rn[MAXK + 1] = {};
    uint64_t codes = 0, finite = 0, distinct = 0, nan_corr = 0, big_corr = 0, dup_double = 0, nside = 0;
    uint64_t nvalues = 0;                                      // right sides usable in the search (distinct doubles)
    std::atomic<uint64_t> dhist[8] = {};                       // |double - df64| / |double| of the table, in u
    DArr<uint64_t> Sk[MAXK + 1];                               // side tables (see k_match)
    DArr<float> Sc[MAXK + 1];
    DArr<uint32_t> Sr[MAXK + 1];
    uint64_t Sn[MAXK + 1] = {};
    DArr<uint8_t> Re[MAXK + 1], Se[MAXK + 1];                  // mitm_cr's error bounds, quantized (MM_EQ_DECODE)
    int passes = 0;
    double cw = 32;                                            // walk margin, in u
    // scratch
    std::vector<DArr<uint32_t>> scan_ws;
    DArr<uint32_t> scan_total, rs_hist, ghist;
};

static GForm gform(const Form& f)
{
    GForm g;
    memset(&g, 0, sizeof g);
    for (int i = 0; i < f.K; i++) {
        g.stride[i] = f.stride[i];
        g.radix[i] = f.radix[i];
        g.ar[i] = (char)f.ar[i];
        g.c1[i] = (char)f.c1[i];
        g.c2[i] = (char)f.c2[i];
        g.dual[i] = f.dual[i] ? 1 : 0;
    }
    g.count = f.count;
    g.offset = f.offset;
    g.K = f.K;
    g.xpos = f.xpos;
    return g;
}

static df64 to_df(double x)
{
    const float hi = (float)x;
    return df_make(hi, (float)(x - (double)hi));
}

// codes per unit of a form: a multiple of the product of the radices of its last positions (<= 512), about 256
static uint32_t unit_size(const Form& f)
{
    uint64_t m = 1;
    for (int i = f.K - 1; i >= 0 && m * f.radix[i] <= 512; i--) m *= f.radix[i];
    return (uint32_t)(m * ((256 + m - 1) / m));
}

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

// scratch of the prefix sums for up to n entries (allocated before a command buffer that uses them)
static void scan_reserve(Gpu& G, uint64_t n)
{
    if (!G.scan_total.buf) G.scan_total = G.M.alloc<uint32_t>(16, true);
    for (int level = 0; n > MM_SCANB; level++) {
        n = (n + MM_SCANB - 1) / MM_SCANB;
        if ((int)G.scan_ws.size() <= level) G.scan_ws.push_back(DArr<uint32_t>());
        if (G.scan_ws[level].n < n) {
            G.M.free(G.scan_ws[level]);
            G.scan_ws[level] = G.M.alloc<uint32_t>(n + n / 4);
        }
    }
}

// encode an exclusive prefix sum of n counts (in may equal out); the total is in scan_total[level] after end()
static void enc_scan(Gpu& G, uint64_t in, uint64_t out, uint64_t n, int level = 0)
{
    const uint64_t nb = (n + MM_SCANB - 1) / MM_SCANB;
    ScanArgs A;
    memset(&A, 0, sizeof A);
    A.in = in; A.out = out; A.n = n; A.nblocks = (uint32_t)nb;
    A.total = G.scan_total.g() + 4 * level;
    if (nb > 1) {
        A.sums = G.scan_ws[level].g();
        G.M.add_groups("k_scan_up", nb, &A, sizeof A);
        enc_scan(G, A.sums, A.sums, nb, level + 1);
    }
    G.M.add_groups("k_scan_down", nb, &A, sizeof A);
}

// Stable LSD radix sort of (K, V) by key bits [0, nbits); K2, V2 are scratch of the same size. The result is in
// (K, V) (the arrays are swapped as needed). 64-bit keys: passes whose digit is the same for every key are skipped.
template <class KT>
static void radix_sort(Gpu& G, DArr<KT>& K, DArr<uint32_t>& V, DArr<KT>& K2, DArr<uint32_t>& V2, uint64_t n, int nbits)
{
    if (n < 2) return;
    const bool k64 = sizeof(KT) == 8;
    const uint32_t ntiles = (uint32_t)((n + MM_TILE2 - 1) / MM_TILE2);
    if (G.rs_hist.n < 256ull * ntiles) {
        G.M.free(G.rs_hist);
        G.rs_hist = G.M.alloc<uint32_t>(256ull * ntiles + 256ull * ntiles / 4);
    }
    scan_reserve(G, 256ull * ntiles);
    if (!G.ghist.buf) G.ghist = G.M.alloc<uint32_t>(8 * 256);
    std::vector<int> passes;
    const int np = (nbits + 7) / 8;
    if (k64) {
        memset(G.ghist.h(), 0, 8 * 256 * 4);
        SortArgs A;
        memset(&A, 0, sizeof A);
        A.kin = K.g(); A.ghist = G.ghist.g(); A.n = n;
        G.M.run("k_rs_ghist", std::min<uint64_t>(n, 1u << 18), &A, sizeof A);
        for (int d = 0; d < np; d++) {
            bool constant = false;
            for (int b = 0; b < 256; b++) if (G.ghist[d * 256 + b] == n) constant = true;
            if (!constant) passes.push_back(d);
        }
    } else
        for (int d = 0; d < np; d++) passes.push_back(d);
    for (int d : passes) {
        SortArgs A;
        memset(&A, 0, sizeof A);
        A.kin = K.g(); A.vin = V.g(); A.kout = K2.g(); A.vout = V2.g(); A.hist = G.rs_hist.g();
        A.n = n; A.ntiles = ntiles; A.shift = 8 * d;
        G.M.begin();
        G.M.add_groups(k64 ? "k_rs_hist2_64" : "k_rs_hist2_32", ntiles, &A, sizeof A);
        enc_scan(G, G.rs_hist.g(), G.rs_hist.g(), 256ull * ntiles);
        G.M.add_groups(k64 ? "k_rs_scatter2_64" : "k_rs_scatter2_32", ntiles, &A, sizeof A);
        G.M.end();
        std::swap(K, K2);
        std::swap(V, V2);
    }
}

// The same sort, only encoded into the current command buffer (no wait between passes, no pass skipped): for keys
// whose digits all vary (df64 values). Buffers: sort_reserve first (no allocation while encoding).
static void sort_reserve(Gpu& G, uint64_t n)
{
    const uint64_t ntiles = (n + MM_TILE2 - 1) / MM_TILE2;
    if (G.rs_hist.n < 256ull * ntiles) {
        G.M.free(G.rs_hist);
        G.rs_hist = G.M.alloc<uint32_t>(256ull * ntiles + 256ull * ntiles / 4);
    }
    scan_reserve(G, 256ull * ntiles);
}

template <class KT>
static void enc_radix_sort(Gpu& G, DArr<KT>& K, DArr<uint32_t>& V, DArr<KT>& K2, DArr<uint32_t>& V2, uint64_t n, int nbits)
{
    if (n < 2) return;
    const bool k64 = sizeof(KT) == 8;
    const uint32_t ntiles = (uint32_t)((n + MM_TILE2 - 1) / MM_TILE2);
    for (int d = 0; d < (nbits + 7) / 8; d++) {
        SortArgs A;
        memset(&A, 0, sizeof A);
        A.kin = K.g(); A.vin = V.g(); A.kout = K2.g(); A.vout = V2.g(); A.hist = G.rs_hist.g();
        A.n = n; A.ntiles = ntiles; A.shift = 8 * d;
        G.M.add_groups(k64 ? "k_rs_hist2_64" : "k_rs_hist2_32", ntiles, &A, sizeof A);
        enc_scan(G, G.rs_hist.g(), G.rs_hist.g(), 256ull * ntiles);
        G.M.add_groups(k64 ? "k_rs_scatter2_64" : "k_rs_scatter2_32", ntiles, &A, sizeof A);
        std::swap(K, K2);
        std::swap(V, V2);
    }
}

static bool gpu_setup(Ctx& c, Gpu& G, double vram_gb, Timers& tm, double T0, bool verbose)
{
    // the longest left and right sides size the kernels' per-thread arrays (fewer registers: more threads in flight)
    char sizes[96];
    snprintf(sizes, sizeof sizes, "#define MM_LK %d\n#define MM_RK %d\n", std::max(1, c.o.kl), std::max(1, c.o.kr));
    const std::string err = G.M.init(std::string(sizes) + "#include <metal_stdlib>\nusing namespace metal;\n" + kMitmKernels);
    if (!err.empty()) { fprintf(stderr, "%s\n", err.c_str()); return false; }
    G.name = G.M.name();
    for (const char* k : {"k_gen_r", "k_rs_ghist", "k_rs_hist2_64", "k_rs_hist2_32", "k_rs_scatter2_64", "k_rs_scatter2_32", "k_scan_up",
                          "k_scan_down", "k_flag_head", "k_dedup_r", "k_dedup_r_min", "k_split_flag", "k_split_scatter", "k_gen_l", "k_lkeys",
                          "k_gather_tg", "k_dedup_l", "k_compact_sel", "k_match", "k_match_verify", "k_bench_pairs", "k_r_err"})
        G.M.pipe(k);                                           // compiled now, not inside the timed steps
    const double ws = G.M.working_set();
    G.cap = vram_gb > 0 ? vram_gb * 1073741824.0 : std::min(0.6 * ws, c.o.memcap_gb * 1073741824.0);
    G.M.cap = G.cap;
    tm.ctx = now() - T0;
    if (verbose)
        fprintf(stderr, "GPU: %s (Metal), recommended working set %.2f GB, cap %.2f GB; kernels compiled in %.2f s\n",
                G.name.c_str(), ws / 1073741824.0, G.cap / 1073741824.0, tm.ctx);
    memset(&G.gram, 0, sizeof G.gram);
    for (int i = 0; i < c.g.nc; i++) {
        const double v = c.g.cval[i];
        G.gram.cval[i] = to_df(v);
        G.gram.cerr[i] = (float)std::fabs(v - (double)G.gram.cval[i].hi - (double)G.gram.cval[i].lo);
    }
    for (int i = 0; i < c.g.nu; i++) G.gram.uop[i] = c.g.uop[i];
    for (int i = 0; i < c.g.nb; i++) G.gram.bop[i] = c.g.bop[i];
    G.gram.nc = c.g.nc; G.gram.nu = c.g.nu; G.gram.nb = c.g.nb;
    std::vector<GForm> lf, rf;
    std::vector<uint64_t> lo, ro;
    for (const Form& f : c.Lf) { lf.push_back(gform(f)); lo.push_back(f.offset); }
    for (const Form& f : c.Rf) { rf.push_back(gform(f)); ro.push_back(f.offset); }
    G.Lf = G.M.upload(lf);
    G.Rf = G.M.upload(rf);
    G.Loff = G.M.upload(lo);
    G.Roff = G.M.upload(ro);
    return true;
}

// ------------------------------------------------------------------------------------------------ right sides

// The double values (mitm_cr's enum_R; NaN if a node is not usable) of the codes of ranks rk[q0..q1), sorted, into
// out[idx[q]]: consecutive ranks share the prefix of their code, which is evaluated only once (as the odometer)
static void r_values_sorted(const Ctx& c, const uint32_t* rk, const uint32_t* idx, uint64_t q0, uint64_t q1, double* out)
{
    const Form* f = nullptr;
    int dig[MAXK], nd[MAXK], valid = 0;                        // val[0, valid) belongs to the digits dig
    double val[MAXK];
    for (uint64_t q = q0; q < q1; q++) {
        const uint64_t rank = rk[q];
        if (!f || rank < f->offset || rank >= f->offset + f->count) { f = &form_of(c.Rf, rank); valid = 0; }
        decode(*f, rank - f->offset, nd);
        int p = 0;
        while (p < valid && nd[p] == dig[p]) p++;
        int i = p;
        for (; i < f->K; i++) {
            const int d = dig[i] = nd[i];
            double r;
            if (f->ar[i] == 0) r = c.g.cval[d];
            else if (f->ar[i] == 1) r = un(c.g.uop[d], val[i - 1]);
            else r = bin(c.g.bop[d], val[f->c1[i]], val[f->c2[i]]);
            if (!usable(r)) break;
            val[i] = r;
        }
        for (int j = i + 1; j < f->K; j++) dig[j] = nd[j];
        valid = i;
        out[idx[q]] = i == f->K ? val[f->K - 1] : NAN;
    }
}

// the value of a right side in double as mitm_cr computes it (enum_R), NaN if a node is not usable
static double r_double(const Ctx& c, uint64_t rank)
{
    const Form& f = form_of(c.Rf, rank);
    int dig[MAXK];
    decode(f, rank - f.offset, dig);
    double val[MAXK];
    for (int i = 0; i < f.K; i++) {
        const int d = dig[i];
        double r;
        if (f.ar[i] == 0) r = c.g.cval[d];
        else if (f.ar[i] == 1) r = un(c.g.uop[d], val[i - 1]);
        else r = bin(c.g.bop[d], val[f.c1[i]], val[f.c2[i]]);
        if (!usable(r)) return NAN;
        val[i] = r;
    }
    return val[f.K - 1];
}

static bool build_R_metal(Ctx& c, Gpu& G, Timers& tm)
{
    MetalCtx& M = G.M;
    const double t0 = now();
    const std::vector<Form>& Rf = c.Rf;
    const int nR = (int)Rf.size();
    std::vector<uint32_t> usz;
    const std::vector<uint64_t> uoff = units_of(Rf, 0, Rf.size(), usz);
    const uint64_t nunits = uoff[nR], total = c.len_off[c.o.kr + 1];
    G.codes = total;
    if (total > 0xFFFFFFFFULL) { c.stats.error = "more than 2^32 right sides: 64-bit ranks are not implemented"; return false; }
    DArr<uint64_t> d_uoff = M.upload(uoff);
    DArr<uint32_t> d_usz = M.upload(usz);
    DArr<uint32_t> cnt = M.alloc<uint32_t>(2, true);
    RGenArgs A;
    memset(&A, 0, sizeof A);
    A.forms = G.Rf.g(); A.uoff = d_uoff.g(); A.usz = d_usz.g(); A.nforms = nR; A.cnt = cnt.g();
    auto launch = [&](int mode, int b0, int b1) {
        A.mode = mode; A.b0 = b0; A.b1 = b1;
        M.begin();
        for (uint64_t u = 0; u < nunits; u += SLICE) {
            A.u0 = u;
            A.u1 = std::min(nunits, u + SLICE);
            M.add("k_gen_r", A.u1 - A.u0, &A, sizeof A, &G.gram, sizeof G.gram);
        }
        M.end();
    };
    // Passes over value ranges (2^20 key bins), planned with the memory that remains: a pass holds its pairs
    // (key, rank) double buffered and the flags; its distinct values of each length go to chunks (key, rank,
    // correction), joined per length at the end.
    const double per_pair = 2 * 8 + 2 * 4 + 4 + 16;
    const double margin = 256e6;
    const int NBIN = 1 << 20;
    auto room = [&]() { return (uint64_t)std::max(0.0, (G.cap - (double)M.cur - margin) / per_pair); };
    const bool single = total <= room() && total < 0xFFFFFFFFULL;
    std::vector<uint32_t> H;
    if (!single) {
        DArr<uint32_t> hist = M.alloc<uint32_t>(NBIN, true);
        A.hist = hist.g();
        launch(0, 0, 0);
        H.assign(hist.h(), hist.h() + NBIN);
        M.free(hist);
        G.finite = cnt[1];
        tm.r_count = now() - t0;
    }
    struct Chunk { DArr<uint64_t> k; DArr<uint32_t> r; uint64_t n; };
    std::vector<std::vector<Chunk>> chunks(c.o.kr + 1);
    uint64_t maxpass = 0;
    // one set of pass buffers for all passes (fresh buffers cost page faults): room for them next to the chunks of
    // the table (12 bytes per distinct value, estimated as 60 % of the usable values)
    uint64_t pass_n = total;
    if (!single) {
        const double table_est = 12.0 * 0.6 * (double)G.finite;
        pass_n = (uint64_t)std::max(0.0, (G.cap - (double)M.cur - margin - table_est) / (2 * 8 + 2 * 4 + 4));
        pass_n = std::min<uint64_t>(pass_n, 0xFFFFFFF0ULL);
        uint64_t hmax = 0;
        for (int b = 0; b < NBIN; b++) hmax = std::max<uint64_t>(hmax, H[b]);
        if (pass_n < std::max<uint64_t>(hmax, G.finite / 64)) { c.stats.error = "right-side table exceeds the memory cap"; return false; }
    }
    DArr<uint64_t> K0 = M.alloc<uint64_t>(pass_n), K1 = M.alloc<uint64_t>(pass_n);
    DArr<uint32_t> R0 = M.alloc<uint32_t>(pass_n), R1 = M.alloc<uint32_t>(pass_n), FL = M.alloc<uint32_t>(pass_n);
    for (int b = 0;;) {
        uint64_t nmax = 0;
        int b0 = -1, b1 = -1;
        if (single) {
            if (G.passes) break;
            nmax = total;
        } else {
            while (b < NBIN && !H[b]) b++;
            if (b == NBIN) break;
            b0 = b;
            while (b < NBIN && (nmax == 0 || nmax + H[b] <= pass_n)) nmax += H[b++];
            b1 = b;
        }
        G.passes++;
        maxpass = std::max(maxpass, nmax);
        DArr<uint64_t> P0 = K0, P1 = K1;                       // (the sort swaps the handles)
        DArr<uint32_t> Q0 = R0, Q1 = R1;
        A.keys = K0.g(); A.ranks = R0.g(); A.cap = (uint32_t)std::min<uint64_t>(nmax, 0xFFFFFFFFULL);
        const double t1 = now();
        cnt[0] = 0;
        if (single) { cnt[1] = 0; launch(1, 0, 0); }
        else launch(2, b0, b1);
        const uint64_t n = cnt[0];
        if (single) G.finite = cnt[1];
        if (n > nmax) { c.stats.error = "right-side pass overflow (internal error)"; return false; }
        const double t2 = now();
        tm.r_gen += t2 - t1;
        radix_sort(G, P0, Q0, P1, Q1, n, 64);                  // sorted pairs in (P0, Q0)
        const double t2b = now();
        scan_reserve(G, n);
        DedupRArgs D;
        memset(&D, 0, sizeof D);
        D.K = P0.g(); D.R = Q0.g(); D.flag = FL.g(); D.Ko = P1.g(); D.Ro = Q1.g(); D.n = n;
        M.begin();
        M.add("k_flag_head", n, &D, sizeof D);
        enc_scan(G, FL.g(), FL.g(), n);
        M.add("k_dedup_r", n, &D, sizeof D);
        M.add("k_dedup_r_min", n, &D, sizeof D);
        M.end();
        const uint64_t m = n ? G.scan_total[0] : 0;            // distinct values, in (K1, R1)
        G.distinct += m;
        const double t3 = now();
        if (getenv("MITM_METAL_CHECK"))
            fprintf(stderr, "check: pass %d: %llu pairs, generate %.3f s, radix sort %.3f s, duplicates %.3f s\n", G.passes,
                    (unsigned long long)n, t2 - t1, t2b - t2, t3 - t2b);
        tm.r_sort += t3 - t2;
        for (int k = 1; k <= c.o.kr; k++) {                    // split by length, in value order
            SplitArgs S;
            memset(&S, 0, sizeof S);
            S.K = P1.g(); S.R = Q1.g(); S.flag = FL.g(); S.Ko = P0.g(); S.Ro = Q0.g(); S.n = m;
            S.lo = c.len_off[k]; S.hi = c.len_off[k + 1];
            M.begin();
            M.add("k_split_flag", m, &S, sizeof S);
            enc_scan(G, FL.g(), FL.g(), m);
            M.add("k_split_scatter", m, &S, sizeof S);
            M.end();
            const uint64_t mk = m ? G.scan_total[0] : 0;
            if (!mk) continue;
            Chunk ch;
            ch.k = M.alloc<uint64_t>(mk);
            ch.r = M.alloc<uint32_t>(mk);
            ch.n = mk;
            memcpy(ch.k.h(), P0.h(), mk * 8);
            memcpy(ch.r.h(), Q0.h(), mk * 4);
            chunks[k].push_back(ch);
        }
        tm.r_split += now() - t3;
    }
    M.free(K0); M.free(K1); M.free(R0); M.free(R1); M.free(FL);
    M.free(d_uoff); M.free(d_usz); M.free(cnt);
    if (g_verbose)
        fprintf(stderr, "right sides: %llu codes of length <= %d; %d pass(es) of <= %llu; memory cap %.2f GB; counting %.2f s\n",
                (unsigned long long)total, c.o.kr, G.passes, (unsigned long long)maxpass, G.cap / 1073741824.0, tm.r_count);
    // join the chunks of every length; then the double values, as corrections of the df64 values
    const double t5 = now();
    double gb = 0;
    const int NT = std::max(1u, std::thread::hardware_concurrency());
    std::atomic<uint64_t> nnan{0}, nbig{0}, ndup{0};
    uint64_t nside = 0;
    std::vector<double> shorter;                               // sorted double values of the shorter lengths
    for (int k = 1; k <= c.o.kr; k++) {
        uint64_t nk = 0;
        for (const Chunk& ch : chunks[k]) nk += ch.n;
        G.Rn[k] = nk;
        gb += nk * 16.0 / 1073741824.0;
        if (chunks[k].size() == 1) { G.Rk[k] = chunks[k][0].k; G.Rr[k] = chunks[k][0].r; }
        else {
            G.Rk[k] = M.alloc<uint64_t>(nk);
            G.Rr[k] = M.alloc<uint32_t>(nk);
            uint64_t o = 0;
            for (Chunk& ch : chunks[k]) {
                memcpy(G.Rk[k].h() + o, ch.k.h(), ch.n * 8);
                memcpy(G.Rr[k].h() + o, ch.r.h(), ch.n * 4);
                o += ch.n;
                M.free(ch.k);
                M.free(ch.r);
            }
        }
        G.Rc[k] = M.alloc<float>(nk);
        G.Re[k] = M.alloc<uint8_t>(nk);
        const uint64_t* K = G.Rk[k].h();
        const uint32_t* R = G.Rr[k].h();
        float* C = G.Rc[k].h();
        uint8_t* E = G.Re[k].h();
        const double cw = G.cw * DFO_U;
        const uint64_t blk = 1 << 16;
        const double tq0 = now();
        const double tq0b = now();
        // the double values, in blocks of the table sorted by rank (shared prefixes)
        std::unique_ptr<double[]> rdv_mem(new double[nk]);     // (not zero-filled: every entry is written below)
        double* rdv = rdv_mem.get();
        auto rg_of = [&](uint64_t i) { return (double)dfo_unord((uint32_t)(K[i] >> 32)) + (double)dfo_unord((uint32_t)K[i]); };
        double tsort = 0, teval = 0;
        const uint64_t SB = std::min<uint64_t>(nk, 1u << 26);
        DArr<uint32_t> RK = M.alloc<uint32_t>(SB), RK2 = M.alloc<uint32_t>(SB), IX = M.alloc<uint32_t>(SB), IX2 = M.alloc<uint32_t>(SB);
        for (uint64_t b0 = 0; b0 < nk; b0 += SB) {
            const uint64_t nb = std::min(SB, nk - b0);
            parallel_for(NT, (nb + blk - 1) / blk, [&](int, size_t bi) {
                for (uint64_t i = bi * blk; i < std::min(nb, (bi + 1) * blk); i++) { RK[i] = R[b0 + i]; IX[i] = (uint32_t)i; }
            });
            DArr<uint32_t> a = RK, a2 = RK2, x = IX, x2 = IX2;
            const double ts = now();
            radix_sort(G, a, x, a2, x2, nb, 32);
            {                                                  // mitm_cr's error bounds, on the GPU
                RErrArgs EA;
                memset(&EA, 0, sizeof EA);
                EA.R = a.g(); EA.idx = x.g(); EA.forms = G.Rf.g(); EA.offs = G.Roff.g(); EA.out = G.Re[k].g() + b0; EA.n = nb;
                EA.nforms = (int)c.Rf.size();
                M.begin();
                M.add("k_r_err", nb, &EA, sizeof EA, &G.gram, sizeof G.gram);
                M.end();
            }
            const double te = now();
            const uint64_t per = std::max<uint64_t>(1 << 12, (nb + 8 * NT - 1) / (8 * NT));
            parallel_for(NT, (nb + per - 1) / per, [&](int, size_t ci) {
                r_values_sorted(c, a.h(), x.h(), ci * per, std::min(nb, (ci + 1) * per), rdv + b0);
            });
            tsort += te - ts;
            teval += now() - te;
        }
        M.free(RK); M.free(RK2); M.free(IX); M.free(IX2);
        const double tq1 = now();
        // the corrections, and kind: 0 main table, 1 to the side table (double value beyond cw u of the df64 value),
        // 2 not usable in double or the double value of a shorter code (all shorter codes have lower ranks: mitm_cr
        // keeps those; the table is nearly sorted by double value, so the search in `shorter` gallops from the last hit)
        std::vector<uint8_t> kind(nk, 0);
        const double* sh = shorter.data();
        const size_t nsh = shorter.size();
        parallel_for(NT, (nk + blk - 1) / blk, [&](int, size_t bi) {
            uint64_t an = 0, ab = 0, ns = 0, hist[8] = {0};
            size_t h = 0;
            bool hset = false;
            for (uint64_t i = bi * blk; i < std::min(nk, (bi + 1) * blk); i++) {
                const double rd = rdv[i], rg = rg_of(i);
                if (std::isnan(rd)) { C[i] = NAN; kind[i] = 2; an++; continue; }
                C[i] = (float)(rd - rg);
                {                                              // |double - df64| / |double| in units of u = 2^-48
                    const double e = rd == 0.0 ? (rg == 0.0 ? 0.0 : 1e300) : std::fabs(rg - rd) / std::fabs(rd) / DFO_U;
                    hist[e < 1 ? 0 : e < 4 ? 1 : e < 16 ? 2 : e < 64 ? 3 : e < 256 ? 4 : e < 4096 ? 5 : e < 1048576 ? 6 : 7]++;
                }
                if (nsh) {
                    if (!hset) { h = std::lower_bound(sh, sh + nsh, rd) - sh; hset = true; }
                    else h = lower_from(sh, nsh, h, rd);
                    if (h < nsh && sh[h] == rd) { kind[i] = 2; C[i] = NAN; ns++; continue; }
                }
                const bool big = std::fabs(rd - rg) > cw * std::fabs(rg);
                ab += big;
                kind[i] = big ? 1 : 0;
            }
            nnan += an;
            nbig += ab;
            ndup += ns;
            for (int q = 0; q < 8; q++) G.dhist[q] += hist[q];
        });
        const double tq2 = now();
        // mitm_cr keeps one code per double value: a main entry whose double value equals that of a main entry of
        // lower rank is dropped (their df64 values are within 2 cw u of each other: neighbours in df64 order)
        parallel_for(NT, (nk + blk - 1) / blk, [&](int, size_t bi) {
            uint64_t nd = 0;
            for (uint64_t i = bi * blk; i < std::min(nk, (bi + 1) * blk); i++) {
                if ((kind[i] & 3) != 0) continue;              // (bits 0-1: the kind; bit 2: dropped, set below)
                const double rgi = rg_of(i), span = 2.5 * cw * std::fabs(rgi);
                bool d = false;
                for (uint64_t j = i + 1; j < nk && rg_of(j) - rgi <= span && !d; j++)
                    d = (kind[j] & 3) == 0 && rdv[j] == rdv[i] && R[j] < R[i];
                for (uint64_t j = i; j-- > 0 && rgi - rg_of(j) <= span && !d;)
                    d = (kind[j] & 3) == 0 && rdv[j] == rdv[i] && R[j] < R[i];
                if (d) kind[i] |= 4;
                nd += d;
            }
            ndup += nd;
        });
        const double tq3 = now();
        // the side table: sorted by double value, one entry per value (the lowest rank, also against the main table)
        struct SE { double rd; uint32_t rank; uint8_t eb; bool operator<(const SE& y) const { return rd < y.rd || (rd == y.rd && rank < y.rank); } };
        std::vector<SE> sv;
        {
            const uint64_t nblk = (nk + blk - 1) / blk;
            std::vector<uint64_t> cntb(nblk + 1, 0);
            parallel_for(NT, nblk, [&](int, size_t bi) {
                uint64_t n1 = 0;
                for (uint64_t i = bi * blk; i < std::min(nk, (bi + 1) * blk); i++) n1 += (kind[i] & 3) == 1;
                cntb[bi + 1] = n1;
            });
            for (uint64_t b = 0; b < nblk; b++) cntb[b + 1] += cntb[b];
            std::vector<SE> raw(cntb[nblk]);
            parallel_for(NT, nblk, [&](int, size_t bi) {
                uint64_t o = cntb[bi];
                for (uint64_t i = bi * blk; i < std::min(nk, (bi + 1) * blk); i++)
                    if ((kind[i] & 3) == 1) raw[o++] = {rdv[i], R[i], E[i]};
            });
            // sorted by double value on the GPU (stable), then within a run of equal values the lowest rank first
            const uint64_t ns = raw.size();
            if (ns > 0) {
                DArr<uint64_t> SK = M.alloc<uint64_t>(ns), SK2 = M.alloc<uint64_t>(ns);
                DArr<uint32_t> SI = M.alloc<uint32_t>(ns), SI2 = M.alloc<uint32_t>(ns);
                parallel_for(NT, (ns + blk - 1) / blk, [&](int, size_t bi) {
                    for (uint64_t i = bi * blk; i < std::min(ns, (bi + 1) * blk); i++) { SK[i] = key_of(raw[i].rd + 0.0); SI[i] = (uint32_t)i; }
                });
                radix_sort(G, SK, SI, SK2, SI2, ns, 64);
                sv.resize(ns);
                parallel_for(NT, (ns + blk - 1) / blk, [&](int, size_t bi) {
                    for (uint64_t i = bi * blk; i < std::min(ns, (bi + 1) * blk); i++) sv[i] = raw[SI[i]];
                });
                M.free(SK); M.free(SK2); M.free(SI); M.free(SI2);
                for (uint64_t i = 0; i < ns;) {
                    uint64_t j = i, m = i;
                    while (j < ns && sv[j].rd == sv[i].rd) { if (sv[j].rank < sv[m].rank) m = j; j++; }
                    std::swap(sv[i], sv[m]);
                    i = j;
                }
            }
        }
        std::vector<uint8_t> skeep(sv.size(), 0);
        auto lower_rg = [&](double x) {                        // first main index with rg >= x
            uint64_t lo = 0, hi = nk;
            while (lo < hi) { const uint64_t m = (lo + hi) / 2; if (rg_of(m) < x) lo = m + 1; else hi = m; }
            return lo;
        };
        parallel_for(NT, (sv.size() + 4095) / 4096, [&](int, size_t bi) {
            uint64_t nd = 0;
            for (size_t i = bi * 4096; i < std::min(sv.size(), (bi + 1) * 4096); i++) {
                if (i > 0 && sv[i - 1].rd == sv[i].rd) { nd++; continue; }   // (rd, rank) order: the first has the lowest rank
                const double rd = sv[i].rd;
                bool keep = true;
                for (uint64_t j = lower_rg(rd - 2.5 * cw * std::fabs(rd)); j < nk && rg_of(j) <= rd + 2.5 * cw * std::fabs(rd); j++) {
                    if ((kind[j] & 3) != 0 || (kind[j] & 4) || rdv[j] != rd) continue;
                    if (R[j] < sv[i].rank) keep = false; else kind[j] |= 8;   // (main entry dropped for this side entry)
                }
                if (keep) skeep[i] = 1; else nd++;
            }
            ndup += nd;
        });
        std::vector<SE> sk;
        for (size_t i = 0; i < sv.size(); i++) if (skeep[i]) sk.push_back(sv[i]);
        parallel_for(NT, (nk + blk - 1) / blk, [&](int, size_t bi) {
            uint64_t nd = 0;
            for (uint64_t i = bi * blk; i < std::min(nk, (bi + 1) * blk); i++)
                if ((kind[i] & 8) && !(kind[i] & 4)) { kind[i] |= 4; nd++; }
            ndup += nd;
        });
        std::atomic<uint64_t> nvalid_a{0};
        parallel_for(NT, (nk + blk - 1) / blk, [&](int, size_t bi) {
            uint64_t nv = 0;
            for (uint64_t i = bi * blk; i < std::min(nk, (bi + 1) * blk); i++) {
                if ((kind[i] & 4) || (kind[i] & 3) == 1) C[i] = NAN;
                if (!std::isnan(C[i])) nv++;
            }
            nvalid_a += nv;
        });
        const uint64_t nvalid = nvalid_a;
        std::vector<uint64_t> skey;
        std::vector<float> scor;
        std::vector<uint32_t> srank;
        std::vector<uint8_t> serr;
        for (const SE& x : sk) {
            const float hi = (float)x.rd, lo = (float)(x.rd - (double)hi);
            const df64 v = dfo_norm0(df_make(hi, lo));
            if (!dfo_usable(v)) continue;
            skey.push_back(((uint64_t)dfo_ord(v.hi) << 32) | dfo_ord(v.lo));
            scor.push_back((float)(x.rd - (double)hi - (double)lo));
            srank.push_back(x.rank);
            serr.push_back(x.eb);
        }
        if (getenv("MITM_METAL_CHECK"))
            fprintf(stderr, "check: length %d: double values %.3f s (GPU bounds %.3f, rank sort %.3f, values %.3f), kinds %.3f s, "
                    "duplicates %.3f s, side tables %.3f s\n", k, tq1 - tq0, tq0b - tq0, tsort, teval, tq2 - tq1, tq3 - tq2,
                    now() - tq3);
        G.Sn[k] = skey.size();
        nside += skey.size();
        G.nvalues += nvalid + skey.size();
        if (!skey.empty()) { G.Sk[k] = M.upload(skey); G.Sc[k] = M.upload(scor); G.Sr[k] = M.upload(srank); G.Se[k] = M.upload(serr); }
        // the double values of this length, for the longer ones
        if (k == c.o.kr) continue;
        std::vector<double> mine;
        for (uint64_t i = 0; i < nk; i++) if (!std::isnan(C[i])) mine.push_back(rdv[i]);
        for (const SE& x : sk) mine.push_back(x.rd);
        std::sort(mine.begin(), mine.end());
        std::vector<double> merged(shorter.size() + mine.size());
        std::merge(shorter.begin(), shorter.end(), mine.begin(), mine.end(), merged.begin());
        shorter.swap(merged);
    }
    for (int k = 1; k <= c.o.kr; k++)                         // every table with entries is on the GPU
        if ((G.Rn[k] && (!G.Rk[k].buf || !G.Rc[k].buf || !G.Rr[k].buf || !G.Re[k].buf)) ||
            (G.Sn[k] && (!G.Sk[k].buf || !G.Sc[k].buf || !G.Sr[k].buf || !G.Se[k].buf))) {
            c.stats.error = "right-side table of length " + std::to_string(k) + " missing on the GPU (internal error)";
            return false;
        }
    G.nan_corr = nnan;
    G.big_corr = nbig;
    G.dup_double = ndup;
    G.nside = nside;
    tm.r_corr = now() - t5;
    tm.r_total = now() - t0;
    if (g_verbose)
        fprintf(stderr, "right sides: %llu distinct values (%.1f%% of the finite %llu), table %.2f GB; generate %.2f s + sort "
                "%.2f s + split %.2f s + double values %.2f s; total build %.2f s, peak memory %.2f GB, peak GPU buffers "
                "%.2f GB; not usable in double: %llu, a double value of a shorter code: %llu, double value beyond cw = %g u: "
                "%llu (side tables: %llu); distinct double values in the search: %llu\n",
                (unsigned long long)G.distinct, 100.0 * G.distinct / std::max<uint64_t>(1, G.finite),
                (unsigned long long)G.finite, gb, tm.r_gen, tm.r_sort, tm.r_split, tm.r_corr, tm.r_total, peak_gb(),
                M.peak / 1073741824.0, (unsigned long long)G.nan_corr, (unsigned long long)G.dup_double, G.cw,
                (unsigned long long)G.big_corr, (unsigned long long)G.nside, (unsigned long long)G.nvalues);
    return true;
}

// ------------------------------------------------------------------------------------------------ left sides

struct LBuf {
    uint64_t cap = 0;
    DArr<df64> V, D;
    DArr<float> E, EC;
    DArr<uint64_t> LR, K0, K1;
    DArr<uint32_t> TG, I0, I1, G0, G1, P1, sel, flag, uniq, cnt;
    void alloc(MetalCtx& M, uint64_t n)
    {
        cap = n;
        V = M.alloc<df64>(n); D = M.alloc<df64>(n); E = M.alloc<float>(n); EC = M.alloc<float>(n); LR = M.alloc<uint64_t>(n);
        TG = M.alloc<uint32_t>(n); K0 = M.alloc<uint64_t>(n); K1 = M.alloc<uint64_t>(n);
        I0 = M.alloc<uint32_t>(n); I1 = M.alloc<uint32_t>(n); G0 = M.alloc<uint32_t>(n); G1 = M.alloc<uint32_t>(n);
        P1 = M.alloc<uint32_t>(n);
        sel = M.alloc<uint32_t>(n); flag = M.alloc<uint32_t>(n); uniq = M.alloc<uint32_t>(n);
        cnt = M.alloc<uint32_t>(4, true);
    }
    static double bytes_per_entry() { return 8 + 8 + 4 + 4 + 8 + 4 + 8 + 8 + 4 + 4 + 4 + 4 + 4 + 4 + 4 + 4; }
};

// Generate, sort and deduplicate the left sides of flat units [F0, F1) of one length; returns the number of distinct
// entries (L.uniq, sorted by (target, value))
static uint64_t left_batch(Gpu& G, LBuf& L, LGenArgs& A, uint64_t F0, uint64_t F1, uint64_t stat[3], Timers& tm)
{
    MetalCtx& M = G.M;
    const double t0 = now();
    A.ti0 = F0 / A.upt;
    A.V = L.V.g(); A.D = L.D.g(); A.E = L.E.g(); A.EC = L.EC.g(); A.LR = L.LR.g(); A.TG = L.TG.g(); A.cnt = L.cnt.g();
    A.cap = (uint32_t)std::min<uint64_t>(L.cap, 0xFFFFFFFFULL);
    memset(L.cnt.h(), 0, 16);
    M.begin();                                                 // all slices in one command buffer
    for (uint64_t f = F0; f < F1; f += SLICE) {
        A.F0 = f;
        A.F1 = std::min(F1, f + SLICE);
        M.add("k_gen_l", A.F1 - A.F0, &A, sizeof A, &G.gram, sizeof G.gram);
    }
    M.end();
    const uint64_t n = L.cnt[0];
    stat[0] += L.cnt[1];
    stat[1] += L.cnt[2];
    if (n > L.cap) { fprintf(stderr, "left-side batch overflow (internal error)\n"); exit(5); }
    const double t1 = now();
    tm.l_gen += t1 - t0;
    if (n == 0) return 0;
    const uint64_t ntg = (F1 - 1) / A.upt - A.ti0 + 1;
    int tbits = 0;
    while ((1ULL << tbits) < ntg) tbits++;
    // keys, sort by value, then by target, duplicates, compaction: one command buffer
    sort_reserve(G, n);
    scan_reserve(G, n);
    LSortArgs S;
    memset(&S, 0, sizeof S);
    S.V = L.V.g(); S.K = L.K0.g(); S.I = L.I0.g(); S.n = n;
    M.begin();
    M.add("k_lkeys", n, &S, sizeof S);
    DArr<uint64_t> K = L.K0, K2 = L.K1;
    DArr<uint32_t> I = L.I0, I2 = L.I1;
    enc_radix_sort(G, K, I, K2, I2, n, 64);                    // (K, I): sorted by value
    S.K = K.g(); S.I = I.g(); S.TG = L.TG.g(); S.LR = L.LR.g(); S.sel = L.sel.g(); S.flag = L.flag.g(); S.uniq = L.uniq.g();
    if (tbits > 0) {                                           // stable: by target, values ascending within
        DArr<uint32_t> Gk = L.G0, Gk2 = L.G1, P = I2, P2 = L.P1;
        S.G = Gk.g(); S.P = P.g();
        M.add("k_gather_tg", n, &S, sizeof S);
        enc_radix_sort(G, Gk, P, Gk2, P2, n, tbits);
        S.G = Gk.g(); S.P = P.g(); S.bytg = 1;
    } else S.bytg = 0;
    M.add("k_dedup_l", n, &S, sizeof S);
    enc_scan(G, L.flag.g(), L.flag.g(), n);
    M.add("k_compact_sel", n, &S, sizeof S);
    M.end();
    const uint64_t nu = G.scan_total[0];
    tm.l_sort += now() - t1;
    return nu;
}

// ------------------------------------------------------------------------------------------------ host decisions

// mitm_cr's left-side checks of one code at T in double: enum_L's guards on every node, then the kappa range at the
// root (flush, pass 1); the value and the derivative
static bool left_double(const Ctx& c, uint64_t lrank, double T, double& v, double& d)
{
    const Form& f = form_of(c.Lf, lrank);
    int dig[MAXK];
    decode(f, lrank - f.offset, dig);
    const double absT = T != 0.0 ? std::fabs(T) : 1.0;
    const double kminT = T != 0.0 ? c.o.kappa_min * absT : 0.0, pmax = c.o.periodic_max;
    const int nc = c.g.nc;
    double val[MAXK], der[MAXK];
    for (int i = 0; i < f.K; i++) {
        const int dg = dig[i];
        double r, dr = 0.0;
        if (f.ar[i] == 0) {
            if (i == f.xpos || dg == nc) { r = T; dr = 1.0; } else r = c.g.cval[dg];
        } else if (f.ar[i] == 1) {
            const double a = val[i - 1];
            const int op = c.g.uop[dg];
            if (pmax > 0 && periodic(op) && der[i - 1] != 0.0 && std::fabs(a) > pmax) return false;
            r = un(op, a);
            if (f.dual[i] && der[i - 1] != 0.0) dr = dun(op, a, r) * der[i - 1];
        } else {
            const double t = val[f.c1[i]], s = val[f.c2[i]];
            r = bin(c.g.bop[dg], t, s);
            if (f.dual[i]) dr = dbin(c.g.bop[dg], t, s, r, der[f.c1[i]], der[f.c2[i]]);
        }
        const bool dep = f.ar[i] == 1 ? der[i - 1] != 0.0 : f.ar[i] == 2 && (der[f.c1[i]] != 0.0 || der[f.c2[i]] != 0.0);
        if (!usable(r) || !usable(dr) || (dr == 0.0 && dep)) return false;
        if (f.ar[i] != 0 && dr != 0.0 && std::fabs(r) < kminT * std::fabs(dr)) return false;
        val[i] = r;
        der[i] = dr;
    }
    v = val[f.K - 1];
    d = der[f.K - 1];
    if (d == 0.0) return false;
    const double kap = std::fabs(v) / std::fabs(d) / absT;
    return kap >= c.o.kappa_min && kap <= c.o.kappa_max;
}

struct HCand {                                                 // a candidate on the host
    uint64_t lrank, order;
    uint32_t rrank, t;
    int b;
};

struct Best {
    Match m;
    uint64_t order = 0;
};

struct HostStats {
    std::atomic<uint64_t> cand{0}, rej_err{0}, maxtry{0}, outside{0}, ldrop{0};
};

// The decisions of one target for the left length a, as mitm_cr's flush and match_length would take them (see the
// header): hc = the GPU's candidates of this target (sorted by left value order, then b), ha = its closest pairs
static void decide(const Ctx& c, Worker& w, int a, Best& bb, TargetResult& res, std::vector<HCand>& hc,
                   std::vector<HCand>& ha, HostStats& hs)
{
    const Options& o = c.o;
    // the records of the GPU per left code: candidates (kind 0) and closest pairs of the lengths without candidates
    // (kind 1); every left code in double with mitm_cr's guards, in mitm_cr's order (double value, then rank), one code
    // per double value (the lowest rank)
    struct Rec { uint64_t lrank, order; uint32_t rrank; int b, kind; };
    std::vector<Rec> rec;
    rec.reserve(hc.size() + ha.size());
    for (const HCand& h : hc) rec.push_back({h.lrank, h.order, h.rrank, h.b, 0});
    for (const HCand& h : ha) rec.push_back({h.lrank, h.order, h.rrank, h.b, 1});
    std::sort(rec.begin(), rec.end(), [](const Rec& x, const Rec& y) {
        if (x.lrank != y.lrank) return x.lrank < y.lrank;
        if (x.b != y.b) return x.b < y.b;
        if (x.kind != y.kind) return x.kind < y.kind;
        return x.rrank < y.rrank;
    });
    struct LV { size_t i0, i1; uint64_t key, lrank, order; double v, d; };
    std::vector<LV> lvs;
    for (size_t i = 0; i < rec.size();) {
        size_t j = i;
        while (j < rec.size() && rec[j].lrank == rec[i].lrank) j++;
        LV x;
        x.i0 = i; x.i1 = j; x.lrank = rec[i].lrank; x.order = rec[i].order;
        if (left_double(c, x.lrank, w.T, x.v, x.d)) { x.key = key_of(x.v + 0.0); lvs.push_back(x); }
        else hs.ldrop++;
        i = j;
    }
    std::sort(lvs.begin(), lvs.end(), [](const LV& x, const LV& y) { return x.key < y.key || (x.key == y.key && x.lrank < y.lrank); });
    const char* trace = getenv("MITM_METAL_TRACE");            // debugging: the decisions of one target
    if (trace && strcmp(trace, w.id) == 0)
        for (const LV& L : lvs) {
            fprintf(stderr, "trace a=%d L=%s v=%.17g d=%.6g\n", a, rpn(form_of(c.Lf, L.lrank), L.lrank, c.g).c_str(), L.v, L.d);
            for (size_t q = L.i0; q < L.i1; q++) {
                const double rd = w.r_value(rec[q].rrank);
                fprintf(stderr, "   b=%d %s R=%s rd=%.17g dist/window=%.3g\n", rec[q].b, rec[q].kind ? "closest" : "candidate",
                        rpn(form_of(c.Rf, rec[q].rrank), rec[q].rrank, c.g).c_str(), rd, std::fabs(L.v - rd) / (w.tolT * std::fabs(L.d)));
            }
        }
    // a closest pair of total length a + b, kept as mitm_cr does (strictly closer, and its rounding errors well below its
    // distance)
    auto approx = [&](const LV& L, int b, uint32_t rrank, double dist) {
        Match& ap = res.approx[a + b];
        const double e = dist / std::fabs(L.d) / w.absT;
        if (!(e < ap.err)) return;
        const Form& f = form_of(c.Lf, L.lrank);
        int dig[MAXK];
        decode(f, L.lrank - f.offset, dig);
        double v0, d0, eL;
        eval_full(f, dig, c.g, w.T, v0, d0, eL);
        if ((eL + w.r_error(rrank)) / std::fabs(d0) / w.absT <= 0.25 * e) {
            ap.total = a + b; ap.la = a; ap.lb = b; ap.err = e; ap.lrank = L.lrank; ap.rrank = rrank; ap.accepted = false;
        }
    };
    struct RC { double rd, dist; uint32_t rrank; bool below; };
    std::vector<RC> win, all;
    std::vector<Rec> mr;                                       // the records of a double value
    for (size_t li = 0; li < lvs.size();) {
        // codes with the same double value: mitm_cr keeps the lowest rank (the first); it takes over the records of
        // the others (the same value, so the same right sides are close; judged with its own derivative)
        size_t lj = li + 1;
        while (lj < lvs.size() && lvs[lj].key == lvs[li].key) lj++;
        const LV& L = lvs[li];
        mr.clear();
        for (size_t k2 = li; k2 < lj; k2++) mr.insert(mr.end(), rec.begin() + lvs[k2].i0, rec.begin() + lvs[k2].i1);
        if (lj - li > 1)
            std::sort(mr.begin(), mr.end(), [](const Rec& x, const Rec& y) {
                if (x.b != y.b) return x.b < y.b;
                if (x.kind != y.kind) return x.kind < y.kind;
                return x.rrank < y.rrank;
            });
        li = lj;
        const double wv = w.tolT * std::fabs(L.d);
        size_t q = 0;
        const size_t qend = mr.size();
        bool done = false;
        for (int b = 1; b <= o.kr && !done; b++) {             // mitm_cr's flush: right lengths by increasing length
            const int bmax = bb.m.total == INT_MAX ? o.kr : std::min(o.kr, bb.m.total - a);
            if (b > bmax) break;
            all.clear();
            win.clear();
            while (q < qend && mr[q].b < b) q++;
            for (; q < qend && mr[q].b == b; q++) {
                if (mr[q].kind == 1) {                         // the GPU's closest pair of this length (no candidate)
                    const double rd = w.r_value(mr[q].rrank);
                    approx(L, b, mr[q].rrank, std::fabs(L.v - rd));
                    continue;
                }
                RC x;
                x.rrank = mr[q].rrank;
                x.rd = w.r_value(x.rrank);
                x.dist = std::fabs(L.v - x.rd);
                x.below = x.rd < L.v;
                all.push_back(x);
                if (x.dist <= wv) win.push_back(x);
            }
            if (all.empty()) continue;
            if (win.empty()) {                                 // no candidate in mitm_cr's window: the closest pair
                const RC* m = &all[0];
                for (const RC& x : all) if (x.dist < m->dist || (x.dist == m->dist && x.below && !m->below)) m = &x;
                approx(L, b, m->rrank, m->dist);
                continue;
            }
            // mitm_cr's table holds one code per double value (the lowest rank); closest first, below first on ties
            std::sort(win.begin(), win.end(), [](const RC& x, const RC& y) {
                if (x.rd != y.rd) {
                    if (x.dist != y.dist) return x.dist < y.dist;
                    return x.below && !y.below;
                }
                return x.rrank < y.rrank;
            });
            size_t m = 0;
            for (size_t i = 0; i < win.size(); i++)
                if (m == 0 || win[i].rd != win[m - 1].rd) win[m++] = win[i];
            win.resize(m);
            size_t tries = 0;
            for (const RC& x : win) {
                if (tries >= o.maxtry) break;
                tries++;
                res.candidates++;
                hs.cand++;
                const int total = a + b;
                if (total > bb.m.total) continue;
                double eL = INFINITY, dL = 0;
                const double xr = w.newton(L.lrank, x.rd, eL, dL);
                const double err = std::fabs(xr - w.T) / w.absT;
                const double ex = (eL + w.r_error(x.rrank)) / std::fabs(dL) / w.absT;
                if (!(err <= w.tol)) continue;
                if (!(ex <= w.errcap)) { hs.rej_err++; continue; }
                Match nm;
                nm.total = total; nm.la = a; nm.lb = b; nm.err = err; nm.x = xr; nm.lrank = L.lrank; nm.rrank = x.rrank;
                nm.accepted = true;
                if (nm.better(bb.m)) { bb.m = nm; bb.order = L.order; }
                if (res.approx[total].err >= err) res.approx[total] = nm;
                done = true;
                break;
            }
            if (!done && tries >= o.maxtry) hs.maxtry++;
        }
    }
}

// ------------------------------------------------------------------------------------------------ the search

struct MetalSearch {
    bool verify_gpu = false;                                   // accept in df64 alone (no double precision)
    double tolu = 2.0;                                         // --verify gpu: tolerance in units of u = 2^-48
    double margin = 2.0;
    int cand_max = 256;
    bool no_apx = false;
    bool all_apx = false;                                      // closest pair of every length for every target (RIES)
};

struct SearchStats {
    double t_targets = 0, ms_each = 0;
    uint64_t nbatch = 0, sum_distinct = 0, nleft = 0, nkappa = 0, ncand_gpu = 0, napx_gpu = 0, ncap = 0;
    HostStats hs;
};

// mitm_cr --bench on the GPU (df64 values)
static void bench_metal(Ctx& c, Gpu& G)
{
    MetalCtx& M = G.M;
    const double t0 = now();
    const uint64_t ncodes = c.Lf.empty() ? 0 : c.Lf.back().offset + c.Lf.back().count;
    std::vector<uint32_t> usz;
    const std::vector<uint64_t> uoff = units_of(c.Lf, 0, c.Lf.size(), usz);
    DArr<uint64_t> d_uoff = M.upload(uoff);
    DArr<uint32_t> d_usz = M.upload(usz);
    std::vector<df64> hT(1, to_df(c.o.bench_T));
    std::vector<float> hR(1, 0.0f);
    std::vector<uint32_t> hact(1, 0);
    DArr<df64> d_T = M.upload(hT);
    DArr<float> d_R = M.upload(hR);
    DArr<uint32_t> d_act = M.upload(hact);
    LBuf L;
    L.alloc(M, ncodes);
    LGenArgs A;
    memset(&A, 0, sizeof A);
    A.forms = G.Lf.g(); A.f0 = 0; A.nf = (int)c.Lf.size(); A.uoff = d_uoff.g(); A.usz = d_usz.g(); A.upt = uoff.back();
    A.act = d_act.g(); A.Tdf = d_T.g(); A.Tres = d_R.g(); A.want_der = 0; A.bench = 1;
    A.V = L.V.g(); A.D = L.D.g(); A.E = L.E.g(); A.EC = L.EC.g(); A.LR = L.LR.g(); A.TG = L.TG.g(); A.cnt = L.cnt.g();
    A.cap = (uint32_t)ncodes;
    for (uint64_t f = 0; f < A.upt; f += SLICE) {
        A.F0 = f;
        A.F1 = std::min(A.upt, f + SLICE);
        M.begin();
        M.add("k_gen_l", A.F1 - A.F0, &A, sizeof A, &G.gram, sizeof G.gram);
        M.end();
    }
    const uint64_t n = L.cnt[0];
    LSortArgs S;
    memset(&S, 0, sizeof S);
    S.V = L.V.g(); S.K = L.K0.g(); S.I = L.I0.g(); S.n = n;
    M.run("k_lkeys", n, &S, sizeof S);
    DArr<uint64_t> K = L.K0, K2 = L.K1;
    DArr<uint32_t> I = L.I0, I2 = L.I1;
    radix_sort(G, K, I, K2, I2, n, 64);
    std::vector<uint64_t> keys(K.h(), K.h() + n);
    keys.erase(std::unique(keys.begin(), keys.end()), keys.end());
    const uint64_t nd = keys.size();
    memcpy(K2.h(), keys.data(), nd * 8);
    const double t1 = now();
    BenchArgs B;
    memset(&B, 0, sizeof B);
    B.keys = K2.g(); B.pairs = I.g(); B.n = nd; B.tolrel = (float)c.o.bench_tol; B.KR = c.o.kr;
    for (int b = 1; b <= c.o.kr; b++) { B.Rk[b] = G.Rk[b].g(); B.Rn[b] = G.Rn[b]; }
    M.run("k_bench_pairs", nd, &B, sizeof B);
    unsigned long long pairs = 0;
    for (uint64_t i = 0; i < nd; i++) pairs += I[i];
    if (getenv("MITM_METAL_CHECK")) {                          // debugging: the same count on the host
        unsigned long long hp = 0;
        for (uint64_t i = 0; i < nd; i++) {
            const double v = (double)dfo_unord((uint32_t)(keys[i] >> 32)) + (double)dfo_unord((uint32_t)keys[i]);
            const double w = c.o.bench_tol * std::fabs(v);
            for (int b = 1; b <= c.o.kr; b++) {
                const uint64_t* R = G.Rk[b].h();
                auto val = [&](uint64_t k) { return (double)dfo_unord((uint32_t)(k >> 32)) + (double)dfo_unord((uint32_t)k); };
                uint64_t lo = 0, hi = G.Rn[b];
                while (lo < hi) { const uint64_t m = (lo + hi) / 2; if (val(R[m]) < v - w) lo = m + 1; else hi = m; }
                uint64_t j = lo;
                while (j < G.Rn[b] && val(R[j]) <= v + w) j++;
                hp += j - lo;
            }
            if (i < 5 || (i % 500000) == 0) fprintf(stderr, "check: left %llu value %.17g GPU pairs %u\n", (unsigned long long)i, v, I[i]);
        }
        fprintf(stderr, "check: host count %llu\n", hp);
    }
    uint64_t nR = 0;
    for (int b = 1; b <= c.o.kr; b++) nR += G.Rn[b];
    fprintf(stderr, "bench: T = %.17g, tolrel %g: |L| = %llu finite non-zero, %llu distinct; |R| = %llu distinct (incl. 0); "
            "%llu pairs; left sides %.2f s, sweep %.2f s\n", c.o.bench_T, c.o.bench_tol, (unsigned long long)n,
            (unsigned long long)nd, (unsigned long long)nR, pairs, t1 - t0, now() - t1);
    printf("%llu\n", pairs);
}

// The search for a batch of targets (the right-side tables on the GPU); per target the shortest accepted equation and
// the closest pair of every total length (for the FAILUREs, or all with all_apx), refined on the host as mitm_cr.
static bool metal_search(Ctx& c, Gpu& G, const std::vector<std::string>& ids, const std::vector<double>& vals,
                         const MetalSearch& S, Timers& tm, SearchStats& ss, std::vector<TargetResult>& results)
{
    MetalCtx& M = G.M;
    Options& o = c.o;
    const size_t NT = ids.size();
    const int NS = o.kl + o.kr + 1;
    const double tol = o.tolrel > 0 ? o.tolrel : o.tol_eps * DBL_EPSILON;
    const double errcap = std::max(o.errcap, tol);
    const double t1 = now();

    std::vector<df64> hT(NT);
    std::vector<float> hR(NT), habs(NT);
    for (size_t t = 0; t < NT; t++) {
        hT[t] = to_df(vals[t]);
        hR[t] = (float)(vals[t] - (double)hT[t].hi - (double)hT[t].lo);
        habs[t] = vals[t] != 0.0 ? (float)std::fabs(vals[t]) : 1.0f;
    }
    DArr<df64> d_T = M.upload(hT);
    DArr<float> d_R = M.upload(hR), d_abs = M.upload(habs);
    DArr<int> d_best = M.alloc<int>(NT), d_succ = M.alloc<int>(NT, true);
    for (size_t t = 0; t < NT; t++) d_best[t] = INT_MAX;
    DArr<uint32_t> d_apx = M.alloc<uint32_t>((size_t)NT * NS);
    DArr<uint32_t> d_act = M.alloc<uint32_t>(NT);
    DArr<uint32_t> d_mcnt = M.alloc<uint32_t>(16, true);
    const uint64_t ACC_CAP = 1 << 20;
    DArr<AccRec> d_acc = M.alloc<AccRec>(S.verify_gpu ? ACC_CAP : 1);
    std::vector<std::pair<AccRec, uint64_t>> hacc;             // accepted in df64, with their order
    uint64_t nverify = 0;
    uint64_t whist[8] = {0};
    const uint64_t CAND_CAP = 1 << 22, APX_CAP = 1 << 20;
    DArr<CandRec> d_cand = M.alloc<CandRec>(CAND_CAP);
    DArr<ApxRec> d_apr = M.alloc<ApxRec>(APX_CAP);
    std::vector<DArr<uint64_t>> d_luoff(o.kl + 2);
    std::vector<DArr<uint32_t>> d_lusz(o.kl + 2);
    std::vector<std::vector<uint64_t>> luoff(o.kl + 2), lcpre(o.kl + 2);
    std::vector<std::vector<uint32_t>> lusz(o.kl + 2);
    for (int a = 1; a <= o.kl; a++) {
        luoff[a] = units_of(c.Lf, c.Lbeg[a], c.Lbeg[a + 1], lusz[a]);
        d_luoff[a] = M.upload(luoff[a]);
        d_lusz[a] = M.upload(lusz[a]);
        lcpre[a].assign(1, 0);                                 // codes before each form of length a
        for (size_t i = c.Lbeg[a]; i < c.Lbeg[a + 1]; i++) lcpre[a].push_back(lcpre[a].back() + c.Lf[i].count);
    }
    auto flat_codes = [&](int a, uint64_t F) {                 // codes of length a before flat unit F
        const uint64_t upt = luoff[a].back(), ti = F / upt, u = F - ti * upt;
        const size_t fi = std::upper_bound(luoff[a].begin(), luoff[a].end() - 1, u) - luoff[a].begin() - 1;
        const uint64_t f0 = c.Lbeg[a];
        return ti * lcpre[a].back() + lcpre[a][fi] + std::min<uint64_t>((u - luoff[a][fi]) * lusz[a][fi], c.Lf[f0 + fi].count);
    };
    LBuf L;
    {
        const double room = G.cap - (double)M.cur - 256e6;
        uint64_t cap = (uint64_t)std::max(1e6, room / LBuf::bytes_per_entry());
        cap = std::min<uint64_t>(cap, 0x7FFFFFFFULL);
        uint64_t need = 0;
        for (int a = 1; a <= o.kl; a++) need = std::max<uint64_t>(need, (uint64_t)NT * lcpre[a].back());
        L.alloc(M, std::max<uint64_t>(4096, std::min(cap, need)));
    }

    std::vector<Best> best(NT);
    results.assign(NT, TargetResult());
    for (size_t t = 0; t < NT; t++) results[t].approx.assign(NS, Match());
    const int nthreads = std::max(1, o.threads > 1 ? o.threads : (int)std::thread::hardware_concurrency());
    const size_t chunk0 = c.o.chunk;
    c.o.chunk = 1;                                             // the host Workers need no chunk buffers
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
    std::vector<HCand> hcand, hapx;

    for (int a = 1; a <= o.kl; a++) {
        std::vector<uint32_t> act;
        for (size_t t = 0; t < NT; t++)
            if (best[t].m.total == INT_MAX || best[t].m.total > a + 1) act.push_back((uint32_t)t);
        if (act.empty()) break;
        const uint64_t upt = luoff[a].back();
        if (upt == 0) continue;
        memcpy(d_act.h(), act.data(), act.size() * 4);
        for (size_t i = 0; i < (size_t)NT * NS; i++) d_apx[i] = 0x7F800000u;   // +inf
        LGenArgs A;
        memset(&A, 0, sizeof A);
        A.forms = G.Lf.g(); A.f0 = (int)c.Lbeg[a]; A.nf = (int)(c.Lbeg[a + 1] - c.Lbeg[a]); A.uoff = d_luoff[a].g();
        A.usz = d_lusz[a].g(); A.upt = upt; A.act = d_act.g(); A.Tdf = d_T.g(); A.Tres = d_R.g();
        A.kmin = (float)o.kappa_min; A.kmax = (float)o.kappa_max; A.pmax = (float)o.periodic_max; A.errcap = (float)errcap;
        A.want_der = 1; A.bench = 0;
        MatchArgs MA;
        memset(&MA, 0, sizeof MA);
        MA.V = L.V.g(); MA.D = L.D.g(); MA.E = L.E.g(); MA.EC = L.EC.g(); MA.LR = L.LR.g(); MA.TG = L.TG.g();
        MA.uniq = L.uniq.g();
        MA.act = d_act.g(); MA.absT = d_abs.g(); MA.best = d_best.g(); MA.succ = d_succ.g(); MA.apx = d_apx.g();
        MA.cand = d_cand.g(); MA.apr = d_apr.g(); MA.cnt = d_mcnt.g();
        for (int b = 1; b <= o.kr; b++) {
            MA.Rk[b] = G.Rk[b].g(); MA.Rc[b] = G.Rc[b].g(); MA.Rr[b] = G.Rr[b].g(); MA.Rn[b] = G.Rn[b];
            MA.Sk[b] = G.Sk[b].g(); MA.Sc[b] = G.Sc[b].g(); MA.Sr[b] = G.Sr[b].g(); MA.Sn[b] = G.Sn[b];
            MA.Re[b] = G.Re[b].g(); MA.Se[b] = G.Se[b].g();
        }
        MA.tol = (float)tol; MA.margin = (float)S.margin; MA.cw = (float)G.cw;
        MA.cand_cap = (uint32_t)CAND_CAP; MA.apx_cap = (uint32_t)APX_CAP;
        MA.a = a; MA.KR = o.kr; MA.NS = NS; MA.cand_max = S.cand_max; MA.all_apx = S.all_apx; MA.no_apx = S.no_apx;
        MA.Lf = G.Lf.g(); MA.Loff = G.Loff.g(); MA.Rf = G.Rf.g(); MA.Roff = G.Roff.g(); MA.Tdf = d_T.g(); MA.Tres = d_R.g();
        MA.acc = d_acc.g(); MA.errcap = (float)errcap; MA.acc_cap = (uint32_t)d_acc.n; MA.nLf = (int)c.Lf.size();
        MA.nRf = (int)c.Rf.size(); MA.verify = S.verify_gpu; MA.maxtry = (int)std::min<size_t>(o.maxtry, 1 << 20);
        MA.tolv = (float)std::max(tol, S.tolu * DFO_U);
        MA.stats = getenv("MITM_METAL_CHECK") ? 1 : 0;
        const uint64_t nflat = (uint64_t)act.size() * upt;
        for (uint64_t F0 = 0, F1; F0 < nflat; F0 = F1) {
            const uint64_t c0 = flat_codes(a, F0);             // the largest batch that fits (at least one unit)
            uint64_t lo = F0 + 1, hi = nflat;
            while (lo < hi) {
                const uint64_t mid = lo + (hi - lo + 1) / 2;
                if (flat_codes(a, mid) - c0 <= L.cap) lo = mid; else hi = mid - 1;
            }
            F1 = lo;
            uint64_t st3[3] = {0, 0, 0};
            const uint64_t nu = left_batch(G, L, A, F0, F1, st3, tm);
            ss.nleft += st3[0];
            ss.nkappa += st3[1];
            ss.sum_distinct += nu;
            if (!nu) continue;
            const double t2 = now();
            MA.ti0 = A.ti0;
            const uint64_t batch = ss.nbatch++;
            // dispatches over ranges of left values; a range whose records overflow the buffers is split
            std::vector<std::pair<uint64_t, uint64_t>> todo(1, {0, nu});
            const uint64_t KCH = getenv("MITM_METAL_KCH") ? (uint64_t)atoll(getenv("MITM_METAL_KCH")) : 1 << 20;
            for (uint64_t k = KCH; k < nu; k += KCH) todo.back().second = k, todo.push_back({k, std::min(nu, k + KCH)});
            std::reverse(todo.begin(), todo.end());
            while (!todo.empty()) {
                const auto rg = todo.back();
                todo.pop_back();
                memset(d_mcnt.h(), 0, 64);
                MA.k0 = rg.first;
                MA.k1 = rg.second;
                M.begin();
                M.add(S.verify_gpu ? "k_match_verify" : "k_match", rg.second - rg.first, &MA, sizeof MA, &G.gram, sizeof G.gram);
                M.end();
                const uint64_t nc = d_mcnt[0], na = d_mcnt[1], nacc = d_mcnt[3];
                if (nc > CAND_CAP || na > APX_CAP || nacc > d_acc.n) {
                    if (getenv("MITM_METAL_CHECK"))
                        fprintf(stderr, "check: length %d, left values %llu..%llu: %llu candidates, %llu closest pairs: split\n", a,
                                (unsigned long long)rg.first, (unsigned long long)rg.second, (unsigned long long)nc,
                                (unsigned long long)na);
                    if (rg.second - rg.first <= 1) { fprintf(stderr, "candidate buffer overflow at one left value\n"); return false; }
                    const uint64_t mid = rg.first + (rg.second - rg.first) / 2;
                    todo.push_back({mid, rg.second});
                    todo.push_back({rg.first, mid});
                    continue;                                  // (the closest-pair slots only got lower: harmless)
                }
                ss.ncand_gpu += nc;
                ss.napx_gpu += na;
                ss.ncap += d_mcnt[2];
                nverify += d_mcnt[12];
                for (uint64_t i = 0; i < nacc; i++) hacc.push_back({d_acc[i], (batch << 32) | d_acc[i].k});
                for (int i = 0; i < 8; i++) whist[i] += d_mcnt[4 + i];
                for (uint64_t i = 0; i < nc; i++) {
                    const CandRec& r = d_cand[i];
                    hcand.push_back({r.lrank, (batch << 32) | r.k, r.rrank, r.t, r.b});
                }
                for (uint64_t i = 0; i < na; i++) {
                    const ApxRec& r = d_apr[i];
                    hapx.push_back({r.lrank, (batch << 32) | r.k, r.rrank, r.t, r.b});
                }
            }
            tm.l_match += now() - t2;
        }
        // the decisions of this length, per target on the host (--verify gpu: the GPU's, in df64)
        const double t4 = now();
        for (const auto& pr : hacc) {
            const AccRec& r = pr.first;
            Best& bb = best[r.t];
            const int total = a + r.b;
            const double err = r.err, x = (double)r.x.hi + (double)r.x.lo;
            const Match& m = bb.m;
            if (total < m.total || (total == m.total && (err < m.err || (err == m.err && pr.second < bb.order)))) {
                Match nm;
                nm.total = total; nm.la = a; nm.lb = r.b; nm.err = err; nm.x = x; nm.lrank = r.lrank; nm.rrank = r.rrank;
                nm.accepted = true;
                bb.m = nm;
                bb.order = pr.second;
                if (results[r.t].approx[total].err >= err) results[r.t].approx[total] = nm;
            }
        }
        hacc.clear();
        auto by_target = [](std::vector<HCand>& v) {
            std::sort(v.begin(), v.end(), [](const HCand& x, const HCand& y) {
                if (x.t != y.t) return x.t < y.t;
                if (x.order != y.order) return x.order < y.order;
                if (x.b != y.b) return x.b < y.b;
                return x.rrank < y.rrank;
            });
        };
        by_target(hcand);
        by_target(hapx);
        std::vector<size_t> cs(NT + 1, 0), as(NT + 1, 0);
        for (const HCand& h : hcand) cs[h.t + 1]++;
        for (const HCand& h : hapx) as[h.t + 1]++;
        for (size_t t = 0; t < NT; t++) { cs[t + 1] += cs[t]; as[t + 1] += as[t]; }
        parallel_for(nthreads, act.size(), [&](int tid, size_t ai) {
            const uint32_t t = act[ai];
            if (cs[t] == cs[t + 1] && as[t] == as[t + 1]) return;
            Worker& w = *workers[tid];
            setup_worker(w, t);
            std::vector<HCand> hc(hcand.begin() + cs[t], hcand.begin() + cs[t + 1]);
            if (getenv("MITM_METAL_CHECK") && hc.size() > 20000) {
                std::map<uint64_t, size_t> per;
                for (const HCand& h : hc) per[h.lrank]++;
                std::vector<std::pair<size_t, uint64_t>> top;
                for (auto& kv : per) top.push_back({kv.second, kv.first});
                std::sort(top.rbegin(), top.rend());
                std::string s;
                for (size_t i = 0; i < std::min<size_t>(3, top.size()); i++)
                    s += "  [" + rpn(form_of(c.Lf, top[i].second), top[i].second, c.g) + "] " + std::to_string(top[i].first);
                fprintf(stderr, "check: target %s a=%d: %zu candidates, %zu left values;%s\n", ids[t].c_str(), a, hc.size(), per.size(), s.c_str());
            }
            std::vector<HCand> ha(hapx.begin() + as[t], hapx.begin() + as[t + 1]);
            decide(c, w, a, best[t], results[t], hc, ha, ss.hs);
        });
        hcand.clear();
        hapx.clear();
        for (size_t t = 0; t < NT; t++) {
            d_best[t] = best[t].m.total;
            d_succ[t] = best[t].m.total != INT_MAX;
        }
        tm.l_host += now() - t4;
    }

    if (getenv("MITM_METAL_CHECK"))
        fprintf(stderr, "check: window / mitm_cr's window: <=4 %llu, <=16 %llu, <=64 %llu, <=256 %llu, <=1024 %llu, <=4096 %llu, "
                "<=16384 %llu, more %llu\n", (unsigned long long)whist[0], (unsigned long long)whist[1], (unsigned long long)whist[2],
                (unsigned long long)whist[3], (unsigned long long)whist[4], (unsigned long long)whist[5], (unsigned long long)whist[6],
                (unsigned long long)whist[7]);
    // closest pairs (of the targets without an equation, or of all with all_apx): refined by Newton steps, as mitm_cr
    const double t5 = now();
    ss.t_targets = t5 - t1;
    ss.ms_each = NT ? 1e3 * ss.t_targets / NT : 0.0;
    parallel_for(nthreads, NT, [&](int tid, size_t t) {
        Worker& w = *workers[tid];
        setup_worker(w, t);
        TargetResult& res = results[t];
        if (best[t].m.total != INT_MAX) res.best = best[t].m;
        for (int n = 0; n < NS; n++) {
            Match& ap = res.approx[n];
            if (ap.total == INT_MAX || ap.accepted) continue;
            if (best[t].m.total != INT_MAX && !S.all_apx) continue;
            double x;
            if (w.newton_root(ap.lrank, w.r_value(ap.rrank), x)) { ap.err = std::fabs(x - w.T) / w.absT; ap.x = x; }
            else ap = Match();
        }
        res.ms = ss.ms_each;
    });
    tm.l_final = now() - t5;
    for (Worker* w : workers) delete w;
    if (S.verify_gpu) ss.hs.cand += nverify;
    return true;
}

#ifndef MITM_METAL_LIBRARY
int main(int argc, char** argv)
{
    Ctx c;
    Options& o = c.o;
    const char* eval_code = nullptr;
    const char* input = nullptr;
    double eval_x = 0, vram_gb = 0;
    bool df64_stats = false;
    MetalSearch S;
    Gpu G;
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
        else if (a == "--list") { fprintf(stderr, "--list is not supported by mitm_metal (use mitm_cr)\n"); return 2; }
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
        else if (a == "--margin") S.margin = atof(next());
        else if (a == "--cw") G.cw = atof(next());
        else if (a == "--cand-max") S.cand_max = atoi(next());
        else if (a == "--input") input = next();
        else if (a == "--no-approx") S.no_apx = true;
        else if (a == "--verify") {
            const std::string v = next();
            if (v == "gpu") S.verify_gpu = true;
            else if (v == "host") S.verify_gpu = false;
            else { fprintf(stderr, "--verify gpu|host\n"); return 2; }
        }
        else if (a == "--tol-u") S.tolu = atof(next());
        else if (a == "--df64-stats") df64_stats = true;
        else if (a == "--bench") { o.bench = true; o.anyx = true; g_subnormal_ok = true; o.bench_T = atof(next()); o.bench_tol = atof(next()); }
        else if (a == "--eval") { eval_code = next(); eval_x = atof(next()); }
        else { fprintf(stderr, "unknown option %s (see the header of mitm_metal.mm)\n", a.c_str()); return 2; }
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
            "per target; tol %g, kappa %g..%g, errcap %g, maxtry %zu, verify %s; window margin %g, cw %g u\n",
            c.g.nc, c.g.nu, c.g.nb, o.anyx ? "any number of times" : "exactly once", o.kl, (unsigned long long)nLcodes,
            o.tolrel > 0 ? o.tolrel : o.tol_eps * DBL_EPSILON, o.kappa_min, o.kappa_max, o.errcap, o.maxtry,
            S.verify_gpu ? "gpu (df64 alone)" : "host", S.margin, G.cw);
    if (S.verify_gpu)
        fprintf(stderr, "verify gpu: accepted in df64 alone within %g relative (%g u), right sides by their df64 values\n",
                std::max(o.tolrel > 0 ? o.tolrel : o.tol_eps * DBL_EPSILON, S.tolu * DFO_U), S.tolu);

    if (!gpu_setup(c, G, vram_gb, tm, T0, true)) return 4;
    if (!build_R_metal(c, G, tm)) { fprintf(stderr, "%s\n", c.stats.error.c_str()); return 3; }
    const double t_R = now() - T0, cpu_R = cpu_seconds() - C0;
    if (getenv("MITM_METAL_CHECK")) {                          // debugging: the tables sorted and distinct
        for (int k = 1; k <= o.kr; k++) {
            uint64_t bad = 0, eq = 0;
            for (uint64_t i = 1; i < G.Rn[k]; i++) { if (G.Rk[k][i] < G.Rk[k][i - 1]) bad++; if (G.Rk[k][i] == G.Rk[k][i - 1]) eq++; }
            fprintf(stderr, "check: length %d: %llu entries, %llu out of order, %llu equal neighbours\n", k,
                    (unsigned long long)G.Rn[k], (unsigned long long)bad, (unsigned long long)eq);
        }
    }
    if (df64_stats) {
        const char* lab[8] = {"< 1", "1-4", "4-16", "16-64", "64-256", "256-4096", "4096-2^20", ">= 2^20"};
        uint64_t both = 0;
        for (int q = 0; q < 8; q++) both += G.dhist[q];
        fprintf(stderr, "df64: right sides of length <= %d usable in df64 and in double: %llu; |df64 - double| / |double| in "
                "units of u = 2^-48:\n", o.kr, (unsigned long long)both);
        for (int q = 0; q < 8; q++)
            fprintf(stderr, "  %-10s %12llu  %7.3f%%\n", lab[q], (unsigned long long)G.dhist[q].load(),
                    100.0 * G.dhist[q] / std::max<uint64_t>(1, both));
    }
    if (const char* fv = getenv("MITM_METAL_FIND")) {          // debugging: table entries near a value
        const double x = atof(fv);
        for (int k = 1; k <= o.kr; k++)
            for (uint64_t i = 0; i < G.Rn[k]; i++) {
                const double rg = (double)dfo_unord((uint32_t)(G.Rk[k][i] >> 32)) + (double)dfo_unord((uint32_t)G.Rk[k][i]);
                if (std::fabs(rg - x) <= 1e-12 * std::fabs(x))
                    fprintf(stderr, "find: length %d entry %llu: %s df64 %.17g corr %g -> %.17g\n", k, (unsigned long long)i,
                            rpn(form_of(c.Rf, G.Rr[k][i]), G.Rr[k][i], c.g).c_str(), rg, G.Rc[k][i], rg + G.Rc[k][i]);
            }
        for (int k = 1; k <= o.kr; k++)
            for (uint64_t i = 0; i < G.Sn[k]; i++) {
                const double rg = (double)dfo_unord((uint32_t)(G.Sk[k][i] >> 32)) + (double)dfo_unord((uint32_t)G.Sk[k][i]);
                if (std::fabs(rg - x) <= 1e-12 * std::fabs(x))
                    fprintf(stderr, "find: side table %d entry %llu: %s df64 %.17g corr %g -> %.17g\n", k, (unsigned long long)i,
                            rpn(form_of(c.Rf, G.Sr[k][i]), G.Sr[k][i], c.g).c_str(), rg, G.Sc[k][i], rg + G.Sc[k][i]);
            }
    }
    if (o.bench) { bench_metal(c, G); return 0; }

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
    SearchStats ss;
    std::vector<TargetResult> results;
    if (!metal_search(c, G, ids, vals, S, tm, ss, results)) return 5;

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
    uint64_t ncand = 0;
    for (const TargetResult& r : results) ncand += r.candidates;
    fprintf(stderr, "targets: %zu in %.2f s wall (%.1f ms each); GPU: left sides %.2f s, sort %.2f s, match %.2f s; host: "
            "decisions %.2f s, closest pairs %.2f s; %llu batches; %llu left values (%llu distinct per batch; skipped: %llu "
            "by kappa; maxtry reached %llu times), %llu candidates (%llu rejected by errcap)\n",
            ids.size(), ss.t_targets + tm.l_final, ss.ms_each, tm.l_gen, tm.l_sort, tm.l_match, tm.l_host, tm.l_final,
            (unsigned long long)ss.nbatch, (unsigned long long)ss.nleft, (unsigned long long)ss.sum_distinct,
            (unsigned long long)ss.nkappa, (unsigned long long)ss.hs.maxtry.load(), (unsigned long long)ncand,
            (unsigned long long)ss.hs.rej_err.load());
    fprintf(stderr, "GPU window: %llu candidates for the host (cand-max reached %llu times), %llu closest pairs; left values "
            "dropped by the double-precision guards: %llu; GPU time %.2f s\n", (unsigned long long)ss.ncand_gpu,
            (unsigned long long)ss.ncap, (unsigned long long)ss.napx_gpu, (unsigned long long)ss.hs.ldrop.load(),
            G.M.gpu_seconds);
    fprintf(stderr, "total: %.2f s wall (right sides %.2f s), CPU %.2f s (right sides %.2f s), peak memory %.2f GB, "
            "peak GPU buffers %.2f GB\n", now() - T0, t_R, cpu_seconds() - C0, cpu_R, peak_gb(), G.M.peak / 1073741824.0);
    return 0;
}
#endif
