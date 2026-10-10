// fp_rates_metal.mm - throughput of float and df64 arithmetic and library functions on an Apple GPU (Metal); the
// counterpart of fp_rates.cu (Apple GPUs have no double, so the comparison is float against df64.h)
//
// Author: Andrzej Odrzywolek
// Date: October 4, 2026
// Code assist: Claude Opus 5.5
//
// Every thread runs a dependent chain of N operations on its own value (no memory traffic); the result is stored so
// that the compiler cannot drop the work. Precise math (MTLMathModeSafe), as the search uses.
// Build: make fp_rates_metal   Usage: fp_rates_metal
#include "metal_ctx.h"
#include "df64_metal_src.h"                                    // kDf64Source: df64.h, df64_apply.h

static const char* kBench = R"MTL(
#define N 1024
#define FK(name, step) kernel void name(device float* out [[buffer(1)]], uint i [[thread_position_in_grid]]) \
    { float x = 0.5f + (float)i * 1e-9f, acc = 0.0f; for (int k = 0; k < N; k++) { step; } out[i] = x + acc; }
FK(f_fma,  x = fma(x, 0.999999f, 1e-7f))
FK(f_exp,  x = exp(x) * 0.3f; acc += x)
FK(f_log,  x = log(x + 2.0f); acc += x)
FK(f_sin,  x = sin(x) + 0.5f; acc += x)
FK(f_div,  x = 1.0f / (x + 3.0f); acc += x)
FK(f_sqrt, x = sqrt(x + 1.0f); acc += x)
#define DK(name, step) kernel void name(device float* out [[buffer(1)]], uint i [[thread_position_in_grid]]) \
    { df64 x = df_make(0.5f + (float)i * 1e-9f, 0.0f), acc = df_f(0.0f); \
      for (int k = 0; k < N; k++) { step; } out[i] = x.hi + acc.hi + x.lo; }
DK(d_fma,  x = df_add(df_mul(x, df_make(0.999999f, 1e-12f)), df_f(1e-7f)))
DK(d_exp,  x = df_mul_f(df_exp(x), 0.3f); acc = df_add(acc, x))
DK(d_log,  x = df_log(df_add_f(x, 2.0f)); acc = df_add(acc, x))
DK(d_sin,  x = df_add_f(df_sin(x), 0.5f); acc = df_add(acc, x))
DK(d_div,  x = df_div(df_f(1.0f), df_add_f(x, 3.0f)); acc = df_add(acc, x))
DK(d_sqrt, x = df_sqrt(df_add_f(x, 1.0f)); acc = df_add(acc, x))
)MTL";

int main()
{
    MetalCtx M;
    const std::string err = M.init(std::string("#include <metal_stdlib>\nusing namespace metal;\n") + kDf64Source + kBench);
    if (!err.empty()) { fprintf(stderr, "%s\n", err.c_str()); return 4; }
    const uint64_t threads = 1u << 20, N = 1024;
    DArr<float> out = M.alloc<float>(threads);
    const char* ops[6] = {"fma", "exp", "log", "sin", "1/x", "sqrt"};
    const char* fk[6] = {"f_fma", "f_exp", "f_log", "f_sin", "f_div", "f_sqrt"};
    const char* dk[6] = {"d_fma", "d_exp", "d_log", "d_sin", "d_div", "d_sqrt"};
    printf("%s (Metal), %llu threads x %llu dependent operations\n", M.name().c_str(), (unsigned long long)threads,
           (unsigned long long)N);
    printf("operation   float G/s   df64 G/s   float / df64\n");
    for (int i = 0; i < 6; i++) {
        double rate[2];
        for (int v = 0; v < 2; v++) {
            const char* k = v ? dk[i] : fk[i];
            M.pipe(k);
            for (int rep = 0; rep < 2; rep++) {                // the second run is timed
                M.begin();
                [M.enc setBuffer:out.buf offset:0 atIndex:1];
                M.add(k, threads, &threads, 8);
                const double g0 = M.gpu_seconds;
                M.end();
                rate[v] = threads * (double)N / (M.gpu_seconds - g0);
            }
        }
        printf("%-9s %10.1f %10.2f %12.1f\n", ops[i], rate[0] / 1e9, rate[1] / 1e9, rate[0] / rate[1]);
    }
    return 0;
}
