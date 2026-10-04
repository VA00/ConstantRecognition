// bench_df64.cu - the right-side generation of mitm_gpu in double and in df64 on the same GPU: speed, values lost to
// df64's range, and the distance of the df64 values from the double ones
//
// Author: Andrzej Odrzywolek
// Date: October 4, 2026
// Code assist: Claude Opus 5.5
//
// Every code of length <= KR without x (mitm_cr's right sides) is evaluated by the lockstep odometer of
// mitm_cuda.cu, once with double (CUDA's math library) and once with df64.h. Timed: counting the usable values (the
// generation step without output). Then one kernel evaluates both and compares: usable in double only (out of
// df64's range: |v| > 3.4e38 or < 2^-100, or trigonometric arguments beyond 1608), usable in df64 only, and the
// relative difference |df64 - double| / |double| in units of 2^-48 for the codes usable in both.
// Build: nvcc -O3 -arch=sm_120 -std=c++17 --fmad=false -Xcompiler "/fp:precise /EHsc" bench_df64.cu -o bench_df64
// Usage: bench_df64 [--kr 6] [--common]
#define MITM_LIBRARY
#include "../mitm_cr.cpp"
#include "df64.h"

#define CK(x) do { cudaError_t e_ = (x); if (e_ != cudaSuccess) { fprintf(stderr, "CUDA error: %s (%s:%d)\n", \
                   cudaGetErrorString(e_), __FILE__, __LINE__); exit(4); } } while (0)
static const unsigned FULL = 0xffffffffu;
static const int BLOCK = 256;

struct DG {
    double cval[64];
    df64 cdf[64];
    int uop[32], bop[8];
    int nc;
};
__constant__ DG c_g;

__device__ __forceinline__ bool d_usable(double v) { return isfinite(v) && (v == 0.0 || fabs(v) >= DBL_MIN); }

__device__ df64 un_df(int op, df64 a)
{
    switch (op) {
    case U_LOG: return df_log(a);     case U_EXP: return df_exp(a);     case U_INV: return df_inv(a);
    case U_GAMMA: return df_gamma(a); case U_SQRT: return df_sqrt(a);   case U_SQR: return df_sqr(a);
    case U_SIN: return df_sin(a);     case U_ASIN: return df_asin(a);   case U_COS: return df_cos(a);
    case U_ACOS: return df_acos(a);   case U_TAN: return df_tan(a);     case U_ATAN: return df_atan(a);
    case U_SINH: return df_sinh(a);   case U_ASINH: return df_asinh(a); case U_COSH: return df_cosh(a);
    case U_ACOSH: return df_acosh(a); case U_TANH: return df_tanh(a);   case U_ATANH: return df_atanh(a);
    default: return df_neg(a);
    }
}

__device__ df64 bin_df(int op, df64 t, df64 s)                // mitm_cr's order: t = top of the stack
{
    switch (op) {
    case B_PLUS: return df_add(t, s);  case B_TIMES: return df_mul(t, s); case B_SUBTRACT: return df_sub(t, s);
    case B_DIVIDE: return df_div(t, s); case B_POWER: return df_pow(t, s);
    default: return df_div(df_log(s), df_log(t));
    }
}

__device__ __forceinline__ int find_le(const uint64_t* a, int n, uint64_t x)
{
    int lo = 0, hi = n;
    while (hi - lo > 1) { const int m = (lo + hi) >> 1; if (a[m] <= x) lo = m; else hi = m; }
    return lo;
}

__device__ __forceinline__ int odo_step(int* dig, const Form& f)
{
    int i = f.K - 1;
    while (++dig[i] == f.radix[i]) { dig[i] = 0; i--; }
    return i;
}

// MODE 0: double, MODE 1: df64 (counting usable values); MODE 2: both, with the comparison
template <int MODE>
__global__ void __launch_bounds__(BLOCK) k_gen(const Form* forms, const uint64_t* uoff, const uint32_t* usz, int nforms,
                                               uint64_t u0, uint64_t u1, unsigned long long* cnt, unsigned long long* hist,
                                               double xd, df64 xf)
{
    __shared__ DG g;
    {
        const int* s = (const int*)&c_g;
        int* d = (int*)&g;
        for (int i = threadIdx.x; i < (int)(sizeof(DG) / 4); i += blockDim.x) d[i] = s[i];
        __syncthreads();
    }
    const uint64_t u = u0 + blockIdx.x * (uint64_t)BLOCK + threadIdx.x;
    int dig[MAXK], badd = 0, badf = 0, n = 0;
    double vd[MAXK];
    df64 vf[MAXK];
    const Form* f = forms;
    if (u < u1) {
        const int fi = find_le(uoff, nforms, u);
        f = forms + fi;
        const uint64_t r0 = (u - uoff[fi]) * usz[fi];
        n = (int)(r0 + usz[fi] < f->count ? usz[fi] : f->count - r0);
        decode(*f, r0, dig);
    }
    unsigned long long c0 = 0, c1 = 0, c2 = 0, c3 = 0;
    for (int st = 0; __any_sync(FULL, st < n); st++) {
        if (st >= n) continue;
        const int p = st ? odo_step(dig, *f) : 0;
        const int K = f->K;
        bool okd = false, okf = false;
        if (MODE != 1 && p <= badd) {
            int i = p;
            for (; i < K; i++) {
                const int d = dig[i];
                double r;
                if (f->ar[i] == 0) r = i == f->xpos ? xd : g.cval[d];
                else if (f->ar[i] == 1) r = un(g.uop[d], vd[i - 1]);
                else r = bin(g.bop[d], vd[f->c1[i]], vd[f->c2[i]]);
                if (!d_usable(r)) break;
                vd[i] = r;
            }
            badd = i;
        }
        if (MODE != 0 && p <= badf) {
            int i = p;
            for (; i < K; i++) {
                const int d = dig[i];
                df64 r;
                if (f->ar[i] == 0) r = i == f->xpos ? xf : g.cdf[d];
                else if (f->ar[i] == 1) r = un_df(g.uop[d], vf[i - 1]);
                else r = bin_df(g.bop[d], vf[f->c1[i]], vf[f->c2[i]]);
                if (!df_usable(r)) break;
                vf[i] = r;
            }
            badf = i;
        }
        okd = MODE != 1 && badd == K;
        okf = MODE != 0 && badf == K;
        c0 += okd;
        c1 += okf;
        if (MODE == 2) {
            c2 += okd && !okf;
            c3 += okf && !okd;
            if (okd && okf) {
                const double a = vd[K - 1], b = (double)vf[K - 1].hi + (double)vf[K - 1].lo;
                const double e = a == 0.0 ? (b == 0.0 ? 0.0 : 1e300) : fabs(b - a) / fabs(a) / 3.552713678800501e-15;
                int bin = e < 1 ? 0 : e < 4 ? 1 : e < 16 ? 2 : e < 64 ? 3 : e < 256 ? 4 : e < 4096 ? 5 : e < 1048576 ? 6 : 7;
                atomicAdd(hist + bin, 1ULL);
            }
        }
    }
    atomicAdd(cnt + 0, c0);
    atomicAdd(cnt + 1, c1);
    atomicAdd(cnt + 2, c2);
    atomicAdd(cnt + 3, c3);
}

int main(int argc, char** argv)
{
    Ctx c;
    const char* left = nullptr;                                // --left FILE: left sides (x once, length <= --kl)
    for (int i = 1; i < argc; i++) {
        std::string a = argv[i];
        if (a == "--kr" && i + 1 < argc) c.o.kr = atoi(argv[++i]);
        else if (a == "--kl" && i + 1 < argc) c.o.kl = atoi(argv[++i]);
        else if (a == "--left" && i + 1 < argc) left = argv[++i];
        else if (a == "--common") { c.o.consts = COMMON_CONSTS; c.o.funcs = COMMON_FUNCS; }
    }
    make_grammar(c.g, c.o.consts, c.o.funcs, c.o.ops);
    setup_right(c);
    setup_left(c);
    std::vector<double> targets;
    if (left) {                                                // the right-side forms are replaced by the left ones
        FILE* in = fopen(left, "r");
        char line[512], id[256];
        double v;
        while (in && fgets(line, sizeof line, in)) if (sscanf(line, "%255s %lf", id, &v) == 2) targets.push_back(v);
        if (in) fclose(in);
        c.Rf = c.Lf;
        c.len_off.assign(c.o.kr + 2, c.Lf.back().offset + c.Lf.back().count);
    }
    DG h;
    memset(&h, 0, sizeof h);
    for (int i = 0; i < c.g.nc; i++) {
        h.cval[i] = c.g.cval[i];
        const float hi = (float)c.g.cval[i];
        h.cdf[i] = df_make(hi, (float)(c.g.cval[i] - hi));
    }
    for (int i = 0; i < c.g.nu; i++) h.uop[i] = c.g.uop[i];
    for (int i = 0; i < c.g.nb; i++) h.bop[i] = c.g.bop[i];
    h.nc = c.g.nc;
    CK(cudaMemcpyToSymbol(c_g, &h, sizeof h));
    // units as mitm_gpu (unit_size)
    std::vector<uint64_t> uoff(1, 0);
    std::vector<uint32_t> usz;
    for (const Form& f : c.Rf) {
        uint64_t M = 1;
        for (int i = f.K - 1; i >= 0 && M * f.radix[i] <= 512; i--) M *= f.radix[i];
        usz.push_back((uint32_t)(M * ((256 + M - 1) / M)));
        uoff.push_back(uoff.back() + (f.count + usz.back() - 1) / usz.back());
    }
    Form* d_f;
    uint64_t* d_uoff;
    uint32_t* d_usz;
    unsigned long long *d_cnt, *d_hist;
    CK(cudaMalloc(&d_f, c.Rf.size() * sizeof(Form)));
    CK(cudaMalloc(&d_uoff, uoff.size() * 8));
    CK(cudaMalloc(&d_usz, usz.size() * 4));
    CK(cudaMalloc(&d_cnt, 4 * 8));
    CK(cudaMalloc(&d_hist, 8 * 8));
    CK(cudaMemcpy(d_f, c.Rf.data(), c.Rf.size() * sizeof(Form), cudaMemcpyHostToDevice));
    CK(cudaMemcpy(d_uoff, uoff.data(), uoff.size() * 8, cudaMemcpyHostToDevice));
    CK(cudaMemcpy(d_usz, usz.data(), usz.size() * 4, cudaMemcpyHostToDevice));
    const uint64_t nunits = uoff.back(), SL = 1 << 18;
    double xd = 0;
    df64 xf = df_f(0.0f);
    auto run = [&](int mode, bool reset) {
        if (reset) {
            CK(cudaMemset(d_cnt, 0, 32));
            CK(cudaMemset(d_hist, 0, 64));
        }
        CK(cudaDeviceSynchronize());
        const double t0 = now();
        for (uint64_t u = 0; u < nunits; u += SL) {
            const uint64_t u1 = std::min(nunits, u + SL);
            const unsigned nb = (unsigned)((u1 - u + BLOCK - 1) / BLOCK);
            if (mode == 0) k_gen<0><<<nb, BLOCK>>>(d_f, d_uoff, d_usz, (int)c.Rf.size(), u, u1, d_cnt, d_hist, xd, xf);
            else if (mode == 1) k_gen<1><<<nb, BLOCK>>>(d_f, d_uoff, d_usz, (int)c.Rf.size(), u, u1, d_cnt, d_hist, xd, xf);
            else k_gen<2><<<nb, BLOCK>>>(d_f, d_uoff, d_usz, (int)c.Rf.size(), u, u1, d_cnt, d_hist, xd, xf);
            CK(cudaGetLastError());
        }
        CK(cudaDeviceSynchronize());
        return now() - t0;
    };
    const uint64_t total = c.len_off[c.o.kr + 1];
    unsigned long long cnt[4], hist[8];
    if (left) {
        double t = 0;
        CK(cudaMemset(d_cnt, 0, 32));
        CK(cudaMemset(d_hist, 0, 64));
        for (double T : targets) {
            xd = T;
            const float hi = (float)T;
            xf = df_make(hi, (float)(T - hi));
            t += run(2, false);
        }
        CK(cudaMemcpy(cnt, d_cnt, 32, cudaMemcpyDeviceToHost));
        printf("left sides of length <= %d (x once, no guards), %zu targets, %llu codes each: usable in double %llu, "
               "df64 %llu; double only %llu (%.3f%%), df64 only %llu; %.2f s\n", c.o.kl, targets.size(),
               (unsigned long long)c.len_off[1], cnt[0], cnt[1], cnt[2], 100.0 * cnt[2] / std::max(1ULL, cnt[0]), cnt[3], t);
        return 0;
    }
    run(0, true);                                              // warm-up
    const double td = run(0, true), tf = run(1, true);
    run(2, true);
    CK(cudaMemcpy(cnt, d_cnt, 32, cudaMemcpyDeviceToHost));
    CK(cudaMemcpy(hist, d_hist, 64, cudaMemcpyDeviceToHost));
    cudaDeviceProp p;
    cudaGetDeviceProperties(&p, 0);
    printf("%s; right sides of length <= %d: %llu codes\n", p.name, c.o.kr, (unsigned long long)total);
    printf("generation (counting usable values): double %.3f s (%.2f G codes/s), df64 %.3f s (%.2f G codes/s), df64 / double "
           "speed %.2f\n", td, total / td / 1e9, tf, total / tf / 1e9, td / tf);
    printf("usable: double %llu, df64 %llu; double only %llu (%.3f%%), df64 only %llu\n", cnt[0], cnt[1], cnt[2],
           100.0 * cnt[2] / std::max(1ULL, cnt[0]), cnt[3]);
    const char* lab[8] = {"< 1", "1-4", "4-16", "16-64", "64-256", "256-4096", "4096-2^20", ">= 2^20"};
    unsigned long long both = 0;
    for (int i = 0; i < 8; i++) both += hist[i];
    printf("|df64 - double| / |double| in units of 2^-48, codes usable in both (%llu):\n", both);
    for (int i = 0; i < 8; i++) printf("  %-10s %12llu  %7.3f%%\n", lab[i], hist[i], 100.0 * hist[i] / std::max(1ULL, both));
    return 0;
}
