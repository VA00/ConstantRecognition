// mitm_bench.cu - speed of the matching step of a meet-in-the-middle (RIES-like) search, three ways
//
// Author: Andrzej Odrzywolek
// Date: October 3, 2026
// Code assist: Claude Opus 5.5
//
// Grammar: constants 1..9, pi, e, phi; ln, exp, 1/x, sqrt, x^2; + * - / ^ (the symbols CALC4 shares with RIES).
// Right sides R: all postfix codes of length <= KR without x. Left sides L: all codes of length <= KL containing
// x at least once, evaluated at x = T. Task: count the pairs with |L - R| <= tol |L| (equations L(x) = R that
// hold at the target). The same values are matched three ways:
//   tree   std::multiset of R, lower_bound for every L in generation order (random access, like RIES's tree)
//   sort   std::sort of both arrays, then one sweep with two pointers (sequential access)
//   gpu    values generated on the GPU, thrust::sort (radix) of both in VRAM, vectorized lower/upper_bound
//          with the sorted L as queries; also timed: the same on the CPU-generated arrays copied to the GPU
// All counts must agree (up to the few values where CPU and GPU libm differ near the tolerance).
//
// Build (Windows, x64 Native Tools prompt): nvcc -O3 -arch=sm_120 -std=c++17 mitm_bench.cu -o mitm_bench
// Usage: mitm_bench KR KL [tol] [skip_tree]
#include <cstdio>
#include <cstdlib>
#include <cmath>
#include <cstring>
#include <vector>
#include <set>
#include <algorithm>
#include <chrono>
#include <thrust/device_vector.h>
#include <thrust/sort.h>
#include <thrust/binary_search.h>
#include <thrust/remove.h>
#include <thrust/unique.h>
#include <thrust/transform.h>
#include <thrust/transform_reduce.h>
#include <thrust/iterator/counting_iterator.h>
#ifdef _WIN32
#include <windows.h>
#include <psapi.h>
#pragma comment(lib, "psapi.lib")
#endif

#define MAXK 12
static const double T = 0.0072973525643;
static const int NC = 12, NU = 5, NB = 5;
static const double CV[NC + 1] = {3.14159265358979323846, 2.71828182845904523536, 1.61803398874989484820,
                                  1, 2, 3, 4, 5, 6, 7, 8, 9, T};   // index 12 = x (left sides only)
__constant__ double d_cv[NC + 1];

static double now() { return std::chrono::duration<double>(std::chrono::steady_clock::now().time_since_epoch()).count(); }
static double peak_gb() {
#ifdef _WIN32
    PROCESS_MEMORY_COUNTERS c; GetProcessMemoryInfo(GetCurrentProcess(), &c, sizeof c); return c.PeakWorkingSetSize / 1073741824.0;
#else
    return 0;
#endif
}

struct Form { char t[MAXK]; int K; int radix[MAXK]; unsigned long long total, offset; };

// valid ternary forms ('0' constant, '1' unary, '2' binary) of length 1..Kmax
static std::vector<Form> forms(int Kmax, int nconst) {
    std::vector<Form> out; unsigned long long off = 0;
    for (int K = 1; K <= Kmax; K++) {
        unsigned long long n3 = 1; for (int i = 0; i < K; i++) n3 *= 3;
        for (unsigned long long c = 0; c < n3; c++) {
            Form f; f.K = K; unsigned long long v = c; int sp = 0; bool ok = true; f.total = 1;
            for (int i = 0; i < K; i++) {
                int s = v % 3; v /= 3; f.t[i] = (char)s;
                if (s == 0) sp++; else if (s == 2) { if (sp < 2) { ok = false; break; } sp--; } else if (sp < 1) { ok = false; break; }
                f.radix[i] = s == 0 ? nconst : s == 1 ? NU : NB; f.total *= f.radix[i];
            }
            if (!ok || sp != 1) continue;
            f.offset = off; off += f.total; out.push_back(f);
        }
    }
    return out;
}

__host__ __device__ inline double eval_code(const char* t, int K, const int* radix, unsigned long long idx,
                                            const double* cv, int need_x) {
    double st[MAXK]; int sp = 0, nx = 0;
    for (int i = 0; i < K; i++) {
        int s = (int)(idx % radix[i]); idx /= radix[i];
        if (t[i] == 0) { st[sp++] = cv[s]; nx += (s == NC); }
        else if (t[i] == 1) {
            double a = st[sp - 1];
            st[sp - 1] = s == 0 ? log(a) : s == 1 ? exp(a) : s == 2 ? 1.0 / a : s == 3 ? sqrt(a) : a * a;
        } else {
            double b = st[--sp], a = st[sp - 1];
            st[sp - 1] = s == 0 ? a + b : s == 1 ? a * b : s == 2 ? a - b : s == 3 ? a / b : pow(a, b);
        }
    }
    double v = st[0];
    if (need_x && nx == 0) return NAN;
    return (isfinite(v) && v != 0.0) ? v : NAN;
}

static std::vector<double> generate_cpu(const std::vector<Form>& fs, int need_x) {
    std::vector<double> out;
    for (const Form& f : fs)
        for (unsigned long long i = 0; i < f.total; i++) {
            double v = eval_code(f.t, f.K, f.radix, i, CV, need_x);
            if (!std::isnan(v)) out.push_back(v);
        }
    return out;
}

__global__ void gen_kernel(Form f, double* out, int need_x) {
    unsigned long long i = blockIdx.x * (unsigned long long)blockDim.x + threadIdx.x;
    if (i < f.total) out[f.offset + i] = eval_code(f.t, f.K, f.radix, i, d_cv, need_x);
}
struct IsNan { __host__ __device__ bool operator()(double v) const { return isnan(v); } };

static thrust::device_vector<double> generate_gpu(const std::vector<Form>& fs) {
    unsigned long long n = fs.back().offset + fs.back().total;
    thrust::device_vector<double> v(n);
    int need_x = 0;    // set by caller through the form alphabet: forms with 13 constants are left sides
    for (const Form& f : fs) {
        need_x = (f.radix[0] == NC + 1 || std::count(f.radix, f.radix + f.K, NC + 1) > 0);
        unsigned long long blocks = (f.total + 255) / 256;
        gen_kernel<<<(unsigned)blocks, 256>>>(f, thrust::raw_pointer_cast(v.data()), need_x);
    }
    v.erase(thrust::remove_if(v.begin(), v.end(), IsNan()), v.end());
    v.shrink_to_fit();                                        // release the uncompacted buffer (VRAM budget)
    return v;
}

// --- matching ---
// Every variant keeps each distinct value once (as RIES keeps one expression per value).
static unsigned long long match_tree(const std::vector<double>& R, const std::vector<double>& L, double tol) {
    std::set<double> tree(R.begin(), R.end());               // inserted in generation order, duplicates dropped
    std::set<double> lset(L.begin(), L.end());               // distinct left values (queries in sorted order would
    std::vector<double> Lu(L.size());                        // help the tree; keep generation order instead)
    size_t m = 0;
    for (double l : L) if (lset.erase(l)) Lu[m++] = l;
    Lu.resize(m);
    unsigned long long n = 0;
    for (double l : Lu) {
        double d = tol * fabs(l);
        for (auto it = tree.lower_bound(l - d); it != tree.end() && *it <= l + d; ++it) n++;
    }
    return n;
}

static unsigned long long match_sorted(std::vector<double>& R, std::vector<double>& L, double tol, double* t_sort) {
    double t0 = now();
    std::sort(R.begin(), R.end()); std::sort(L.begin(), L.end());
    R.erase(std::unique(R.begin(), R.end()), R.end()); L.erase(std::unique(L.begin(), L.end()), L.end());
    *t_sort = now() - t0;
    unsigned long long n = 0; size_t lo = 0, hi = 0;
    for (double l : L) {                                      // window bounds are monotonic in l (tol < 1)
        double d = tol * fabs(l);
        while (lo < R.size() && R[lo] < l - d) lo++;
        if (hi < lo) hi = lo;
        while (hi < R.size() && R[hi] <= l + d) hi++;
        n += hi - lo;
    }
    return n;
}

struct Lo { double tol; __host__ __device__ double operator()(double l) const { return l - tol * fabs(l); } };
struct Hi { double tol; __host__ __device__ double operator()(double l) const { return l + tol * fabs(l); } };
struct Diff { __host__ __device__ unsigned long long operator()(const thrust::tuple<long long, long long>& t) const {
    return (unsigned long long)(thrust::get<1>(t) - thrust::get<0>(t)); } };

static unsigned long long match_gpu(thrust::device_vector<double>& R, thrust::device_vector<double>& L, double tol,
                                    double* t_sort, double* t_match) {
    cudaDeviceSynchronize(); double t0 = now();
    thrust::sort(R.begin(), R.end()); thrust::sort(L.begin(), L.end());
    R.erase(thrust::unique(R.begin(), R.end()), R.end()); L.erase(thrust::unique(L.begin(), L.end()), L.end());
    cudaDeviceSynchronize(); *t_sort = now() - t0; t0 = now();
    unsigned long long total = 0;
    const size_t chunk = 1 << 26;                             // bounded scratch memory
    thrust::device_vector<double> q(std::min(chunk, L.size()));
    thrust::device_vector<long long> lo(q.size()), hi(q.size());
    for (size_t s = 0; s < L.size(); s += chunk) {
        size_t m = std::min(chunk, L.size() - s);
        thrust::transform(L.begin() + s, L.begin() + s + m, q.begin(), Lo{tol});
        thrust::lower_bound(R.begin(), R.end(), q.begin(), q.begin() + m, lo.begin());
        thrust::transform(L.begin() + s, L.begin() + s + m, q.begin(), Hi{tol});
        thrust::upper_bound(R.begin(), R.end(), q.begin(), q.begin() + m, hi.begin());
        auto z = thrust::make_zip_iterator(thrust::make_tuple(lo.begin(), hi.begin()));
        total += thrust::transform_reduce(z, z + m, Diff(), 0ULL, thrust::plus<unsigned long long>());
    }
    cudaDeviceSynchronize(); *t_match = now() - t0;
    return total;
}

int main(int argc, char** argv) {
    int KR = argc > 1 ? atoi(argv[1]) : 6, KL = argc > 2 ? atoi(argv[2]) : 6;
    double tol = argc > 3 ? atof(argv[3]) : 1e-12;
    int skip_tree = argc > 4 ? atoi(argv[4]) : 0;
    cudaMemcpyToSymbol(d_cv, CV, sizeof CV);
    auto fR = forms(KR, NC), fL = forms(KL, NC + 1);
    printf("KR=%d KL=%d tol=%g\n", KR, KL, tol);

    double t0 = now();
    std::vector<double> R = generate_cpu(fR, 0), L = generate_cpu(fL, 1);
    double t_gen_cpu = now() - t0;
    printf("CPU generation: |R| = %zu, |L| = %zu, equations covered %.3e, %.2f s\n", R.size(), L.size(),
           (double)R.size() * L.size(), t_gen_cpu);

    if (!skip_tree) {
        t0 = now(); unsigned long long n = match_tree(R, L, tol);
        printf("tree   : %llu matches, %.2f s (build + queries), peak RSS %.2f GB\n", n, now() - t0, peak_gb());
    }
    {   // GPU on the CPU-generated values (copy included)
        cudaDeviceSynchronize(); double t1 = now();
        thrust::device_vector<double> dR(R.begin(), R.end()), dL(L.begin(), L.end());
        cudaDeviceSynchronize(); double t_copy = now() - t1, ts, tm;
        unsigned long long n = match_gpu(dR, dL, tol, &ts, &tm);
        printf("gpu (CPU values): %llu matches, copy %.2f s + sort %.2f s + match %.2f s = %.2f s\n", n, t_copy, ts, tm, t_copy + ts + tm);
    }
    {
        std::vector<double> R2 = R, L2 = L; double ts;
        t0 = now(); unsigned long long n = match_sorted(R2, L2, tol, &ts);
        printf("sort   : %llu matches, %.2f s (sort %.2f s + sweep %.2f s), peak RSS %.2f GB\n", n, now() - t0, ts, now() - t0 - ts, peak_gb());
    }
    {   // everything on the GPU
        cudaDeviceSynchronize(); double t1 = now();
        thrust::device_vector<double> dR = generate_gpu(fR), dL = generate_gpu(fL);
        cudaDeviceSynchronize(); double t_gen = now() - t1, ts, tm;
        size_t fr, totm; cudaMemGetInfo(&fr, &totm);
        unsigned long long n = match_gpu(dR, dL, tol, &ts, &tm);
        printf("gpu (all on GPU): %llu matches, |R| = %zu, |L| = %zu, generate %.2f s + sort %.2f s + match %.2f s = %.2f s, VRAM used %.2f GB\n",
               n, dR.size(), dL.size(), t_gen, ts, tm, t_gen + ts + tm, (totm - fr) / 1073741824.0);
    }
    return 0;
}
