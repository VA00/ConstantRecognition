// test_df64.cpp - accuracy of df64.h against 40-digit references, and (built with nvcc -DDF64_CUDA_TEST, or as
// Objective-C++ with -DDF64_METAL_TEST) the same cases in a CUDA or Metal kernel, required bit-identical to the host
//
// Author: Andrzej Odrzywolek
// Date: October 4, 2026
// Code assist: Claude Opus 5.5
//
// Input: df64_ref.txt from gen_df64_ref.py. For every function: the number of cases, the maximum and the 99.9 %
// quantile of the relative error in units of u = 2^-48, and the cases with a non-finite result. With
// DF64_CUDA_TEST or DF64_METAL_TEST, every result of the kernel is compared bit by bit with the host's.
// Build: build_mitm_gpu.bat test (test_df64.exe with icx, test_df64_cuda.exe with nvcc --fmad=false); on the Mac
//        make test (test_df64 and test_df64_metal, see Makefile)
// Usage: test_df64 df64_ref.txt [--dump results.bin]
#include "df64_apply.h"
#include <cstdio>
#include <cstdlib>
#include <string>
#include <vector>
#include <map>
#include <algorithm>
#include <cstring>
#ifdef DF64_METAL_TEST
#include "metal_ctx.h"
#include "df64_metal_src.h"                                 // kDf64Source: df64.h and df64_apply.h (embed_metal.sh)
#endif

static const char* FNAME[F_COUNT] = {"add", "sub", "mul", "div", "sqrt", "exp", "log", "sin", "cos", "tan", "asin",
                                     "acos", "atan", "sinh", "cosh", "tanh", "asinh", "acosh", "atanh", "pow", "gamma",
                                     "digamma"};

struct Case {
    int f;
    df64 a, b;
    double ref;
};

#ifdef __CUDACC__
__global__ void k_apply(const Case* c, int n, df64* out)
{
    const int i = blockIdx.x * blockDim.x + threadIdx.x;
    if (i < n) out[i] = df_apply(c[i].f, c[i].a, c[i].b);
}
#endif

static float from_hex(const char* s)
{
    return df_from_bits((df_u32)strtoul(s, nullptr, 16));
}

int main(int argc, char** argv)
{
    if (argc < 2) { fprintf(stderr, "usage: test_df64 df64_ref.txt [--dump results.bin]\n"); return 2; }
    const char* dump = argc > 3 && std::string(argv[2]) == "--dump" ? argv[3] : nullptr;
    FILE* in = fopen(argv[1], "r");
    if (!in) { fprintf(stderr, "cannot open %s\n", argv[1]); return 2; }
    std::vector<Case> cs;
    char line[512];
    while (fgets(line, sizeof line, in)) {
        char name[32], t[5][64];
        const int k = sscanf(line, "%31s %63s %63s %63s %63s %63s", name, t[0], t[1], t[2], t[3], t[4]);
        int f = -1;
        for (int i = 0; i < F_COUNT; i++) if (FNAME[i] == std::string(name)) f = i;
        if (f < 0 || k < 4) continue;
        Case c;
        c.f = f;
        c.a = df_make(from_hex(t[0]), from_hex(t[1]));
        c.b = df_f(0.0f);
        if (k == 6) { c.b = df_make(from_hex(t[2]), from_hex(t[3])); c.ref = atof(t[4]); }
        else c.ref = atof(t[2]);
        cs.push_back(c);
    }
    fclose(in);
    const int n = (int)cs.size();
    std::vector<df64> host(n);
#if defined(DF64_METAL_TEST) && defined(__aarch64__)
    // --ftz: the host flushes subnormal floats to zero (FPCR.FZ), as Apple GPUs do in every math mode
    const bool ftz = argc > 2 && std::string(argv[argc - 1]) == "--ftz";
    uint64_t fpcr0 = __builtin_arm_rsr64("fpcr");
    if (ftz) __builtin_arm_wsr64("fpcr", fpcr0 | (1ULL << 24));
#endif
    for (int i = 0; i < n; i++) host[i] = df_apply(cs[i].f, cs[i].a, cs[i].b);
#if defined(DF64_METAL_TEST) && defined(__aarch64__)
    if (ftz) { __builtin_arm_wsr64("fpcr", fpcr0); printf("host: subnormal floats flushed to zero (FPCR.FZ)\n"); }
#endif
    if (dump) {
        FILE* o = fopen(dump, "wb");
        fwrite(host.data(), sizeof(df64), n, o);
        fclose(o);
    }
    const double u = 3.552713678800501e-15;                     // 2^-48
    std::map<int, std::vector<double>> err;
    std::vector<int> bad(F_COUNT, 0);
    std::vector<std::string> worst(F_COUNT);
    std::vector<double> wmax(F_COUNT, -1);
    for (int i = 0; i < n; i++) {
        const double got = (double)host[i].hi + (double)host[i].lo, ref = cs[i].ref;
        if (!std::isfinite(got)) { bad[cs[i].f]++; continue; }
        const double e = std::fabs(got - ref) / std::fabs(ref) / u;
        err[cs[i].f].push_back(e);
        if (e > wmax[cs[i].f]) {
            wmax[cs[i].f] = e;
            char b[160];
            snprintf(b, sizeof b, "x = %.17g%s%.17g", (double)cs[i].a.hi + cs[i].a.lo, cs[i].f == F_POW ||
                     cs[i].f <= F_DIV ? ", y = " : "", cs[i].f == F_POW || cs[i].f <= F_DIV ? (double)cs[i].b.hi + cs[i].b.lo : 0.0);
            worst[cs[i].f] = b;
        }
    }
    printf("function   cases   max (u)   99.9%% (u)   median (u)   non-finite   worst case\n");
    for (int f = 0; f < F_COUNT; f++) {
        std::vector<double>& v = err[f];
        if (v.empty()) continue;
        std::sort(v.begin(), v.end());
        printf("%-8s %7zu %9.2f %11.2f %12.2f %12d   %s\n", FNAME[f], v.size() + bad[f], v.back(),
               v[(size_t)(0.999 * (v.size() - 1))], v[v.size() / 2], bad[f], worst[f].c_str());
    }
    // a GPU's results, bit by bit against the host's
    auto compare = [&](const std::vector<df64>& dev, const char* label) {
        std::vector<int> diff(F_COUNT, 0);
        int ndiff = 0;
        for (int i = 0; i < n; i++)
            if (memcmp(&dev[i], &host[i], sizeof(df64)) != 0) {
                const bool both_nan = host[i].hi != host[i].hi && dev[i].hi != dev[i].hi;
                if (both_nan) continue;
                diff[cs[i].f]++;
                if (ndiff++ < 10)
                    printf("GPU differs: %s x = %.9g + %.9g: host %.9g + %.9g, GPU %.9g + %.9g\n", FNAME[cs[i].f], cs[i].a.hi,
                           cs[i].a.lo, host[i].hi, host[i].lo, dev[i].hi, dev[i].lo);
            }
        printf("\n%s vs host: %d of %d results differ in their bits\n", label, ndiff, n);
        for (int f = 0; f < F_COUNT; f++) if (diff[f]) printf("  %s: %d\n", FNAME[f], diff[f]);
    };
#ifdef __CUDACC__
    Case* d_c;
    df64* d_o;
    cudaMalloc(&d_c, n * sizeof(Case));
    cudaMalloc(&d_o, n * sizeof(df64));
    cudaMemcpy(d_c, cs.data(), n * sizeof(Case), cudaMemcpyHostToDevice);
    k_apply<<<(n + 255) / 256, 256>>>(d_c, n, d_o);
    std::vector<df64> dev(n);
    cudaMemcpy(dev.data(), d_o, n * sizeof(df64), cudaMemcpyDeviceToHost);
    compare(dev, "CUDA kernel");
#endif
#ifdef DF64_METAL_TEST
    {
        MetalCtx M;
        const std::string err = M.init(std::string("#include <metal_stdlib>\nusing namespace metal;\n") + kDf64Source +
                                       "\nstruct Args { device const int* f; device const df64* a; device const df64* b; device df64* out; uint n; };\n"
                                       "kernel void k_apply(constant Args& A [[buffer(0)]], uint i [[thread_position_in_grid]])\n"
                                       "{ if (i < A.n) A.out[i] = df_apply(A.f[i], A.a[i], A.b[i]); }\n");
        if (!err.empty()) { fprintf(stderr, "%s\n", err.c_str()); return 4; }
        DArr<int> f = M.alloc<int>(n);
        DArr<df64> a = M.alloc<df64>(n), b = M.alloc<df64>(n), o = M.alloc<df64>(n);
        for (int i = 0; i < n; i++) { f[i] = cs[i].f; a[i] = cs[i].a; b[i] = cs[i].b; }
        struct { uint64_t f, a, b, out; uint32_t n, pad; } args = {f.g(), a.g(), b.g(), o.g(), (uint32_t)n, 0};
        M.run("k_apply", n, &args, sizeof args);
        std::vector<df64> dev(o.h(), o.h() + n);
        compare(dev, ("Metal kernel (" + M.name() + ")").c_str());
    }
#endif
    return 0;
}
