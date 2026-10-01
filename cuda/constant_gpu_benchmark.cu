// constant_gpu_benchmark.cu - hybrid FP32 GPU search + FP64 CPU verification, for benchmark runs
//
// Author: Andrzej Odrzywolek
// Date: October 1, 2026
// Code assist: Claude Opus 5.5
//
// Derived from constant_gpu_fp32_hybrid.cu (same CALC4 buttons: 13 constants, 18 functions,
// 5 operators; same FP32 kernel), changed for benchmark/run_cuda_v0.py:
//
//   * many targets per process, read from stdin as lines "id value"; the ternary forms are
//     generated and the GPU set up once
//   * shortest first, as Constant Recognition: after each code length K the FP32 candidates of
//     that K (relative error below THRESHOLD_EPS * FLT_EPSILON) are verified in FP64 on the CPU;
//     the search stops at the first K with a candidate within 16 DBL_EPSILON (SUCCESS), and
//     reports the one with the smallest FP64 error of that K
//   * a larger candidate buffer, reset for every K, and a report when it overflows
//   * one tab-separated output line per target:
//       id  SUCCESS|FAILURE  K  RPN  FP64_rel_err  candidates  overflow  milliseconds
//     RPN uses the Constant Recognition button names, but with this kernel's operand order:
//     "a, b, SUBTRACT" is a - b and "a, b, POWER" is a^b (Constant Recognition: b - a, b^a).
//     For a FAILURE the RPN is the best FP64 candidate found, if any (only formulas within the
//     FP32 threshold are candidates).
//
// Compile:  nvcc -O3 -arch=sm_120 constant_gpu_benchmark.cu -o constant_gpu_benchmark
// Usage:    constant_gpu_benchmark <MaxK> [threshold in FLT_EPSILON, default 64] < targets.txt

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <cuda_runtime.h>
#include <float.h>
#include <math.h>
#include <stdint.h>
#include <chrono>

#define STACKSIZE 16
#define MAX_K 12
#define N_CONST  13
#define N_UNARY  18
#define N_BINARY  5
#define EPS_MAX 16                      // FP64 "exact": relative error <= 16 DBL_EPSILON, as Constant Recognition
#define MAX_CANDIDATES (16 * 1024 * 1024)

#define CUDA_CHECK(call) { cudaError_t err = call; if (err != cudaSuccess) { fprintf(stderr, "CUDA error: %s\n", cudaGetErrorString(err)); exit(2); } }

__constant__ float d_const_values[N_CONST] = {
    3.14159265358979323846f, 2.71828182845904523536f, -1.0f, 1.61803398874989484820f,
    1.0f, 2.0f, 3.0f, 4.0f, 5.0f, 6.0f, 7.0f, 8.0f, 9.0f
};

struct Candidate {
    float fp32_error;
    unsigned long long idx;
    int form_id;
    int K;
};

struct FormDesc {
    char ternary[MAX_K + 1];
    int K;
    int radix[MAX_K];
    unsigned long long total;
};

static const char* CONST_NAMES[N_CONST] = {"PI", "EULER", "NEG", "GOLDENRATIO", "ONE", "TWO", "THREE", "FOUR",
                                           "FIVE", "SIX", "SEVEN", "EIGHT", "NINE"};
static const char* UNARY_NAMES[N_UNARY] = {"LOG", "EXP", "INV", "GAMMA", "SQRT", "SQR", "SIN", "ARCSIN", "COS",
                                           "ARCCOS", "TAN", "ARCTAN", "SINH", "ARCSINH", "COSH", "ARCCOSH", "TANH", "ARCTANH"};
static const char* BINARY_NAMES[N_BINARY] = {"PLUS", "TIMES", "SUBTRACT", "DIVIDE", "POWER"};
static const double CONST_VALUES[N_CONST] = {3.14159265358979323846, 2.71828182845904523536, -1.0, 1.61803398874989484820,
                                             1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0};

// ---------------------------------------------------------------------------- device (as the prototype)

__device__ __forceinline__ float apply_unary(int op, float x)
{
    switch (op) {
        case 0:  return logf(x);   case 1:  return expf(x);   case 2:  return 1.0f / x;  case 3:  return tgammaf(x);
        case 4:  return sqrtf(x);  case 5:  return x * x;     case 6:  return sinf(x);   case 7:  return asinf(x);
        case 8:  return cosf(x);   case 9:  return acosf(x);  case 10: return tanf(x);   case 11: return atanf(x);
        case 12: return sinhf(x);  case 13: return asinhf(x); case 14: return coshf(x);  case 15: return acoshf(x);
        case 16: return tanhf(x);  case 17: return atanhf(x); default: return nanf("");
    }
}

__device__ __forceinline__ float apply_binary(int op, float a, float b)
{
    switch (op) {
        case 0: return a + b; case 1: return a * b; case 2: return a - b; case 3: return a / b; case 4: return powf(a, b);
        default: return nanf("");
    }
}

__global__ void search_form_kernel(const char* __restrict__ ternary, int K, const int* __restrict__ radix,
                                   unsigned long long total, unsigned long long offset, float targetX, float threshold,
                                   Candidate* __restrict__ candidates, int* __restrict__ candidate_count,
                                   int max_candidates, int form_id)
{
    __shared__ int s_radix[MAX_K];
    __shared__ char s_ternary[MAX_K + 1];
    if (threadIdx.x < K) { s_radix[threadIdx.x] = radix[threadIdx.x]; s_ternary[threadIdx.x] = ternary[threadIdx.x]; }
    __syncthreads();

    unsigned long long idx = blockIdx.x * (unsigned long long)blockDim.x + threadIdx.x;
    if (idx >= total) return;
    unsigned long long global_idx = offset + idx;

    int slots[MAX_K];
    unsigned long long temp = global_idx;
    #pragma unroll
    for (int i = 0; i < MAX_K; i++) {
        if (i >= K) break;
        slots[i] = temp % s_radix[i];
        temp /= s_radix[i];
    }

    float stack[STACKSIZE];
    int sp = 0;
    for (int i = 0; i < K; i++) {
        char t = s_ternary[i];
        if (t == '0') stack[sp++] = d_const_values[slots[i]];
        else if (t == '1') stack[sp - 1] = apply_unary(slots[i], stack[sp - 1]);
        else { sp--; stack[sp - 1] = apply_binary(slots[i], stack[sp - 1], stack[sp]); }
    }
    float x = stack[0];
    if (isnan(x)) return;
    float rel_err = (targetX == 0.0f) ? fabsf(x) : fabsf(x / targetX - 1.0f);
    if (rel_err < threshold) {
        int slot = atomicAdd(candidate_count, 1);
        if (slot < max_candidates) {
            candidates[slot].fp32_error = rel_err;
            candidates[slot].idx = global_idx;
            candidates[slot].form_id = form_id;
            candidates[slot].K = K;
        }
    }
}

// ---------------------------------------------------------------------------- host

static int check_syntax(const char* ternary, int length)
{
    int stack = 0;
    for (int i = 0; i < length; i++) {
        if (ternary[i] == '0') stack++;
        else if (ternary[i] == '1') { if (stack < 1) return 0; }
        else { if (stack < 2) return 0; stack--; }
    }
    return stack == 1;
}

static int generate_forms(int K, FormDesc* forms, int max_forms)
{
    int count = 0;
    unsigned long long n = 1;
    for (int i = 0; i < K; i++) n *= 3;
    for (unsigned long long t = 0; t < n && count < max_forms; t++) {
        FormDesc f;
        f.K = K;
        f.total = 1;
        unsigned long long temp = t;
        for (int i = 0; i < K; i++) { f.ternary[i] = '0' + (temp % 3); temp /= 3; }
        f.ternary[K] = '\0';
        if (!check_syntax(f.ternary, K)) continue;
        for (int i = 0; i < K; i++) {
            f.radix[i] = f.ternary[i] == '0' ? N_CONST : f.ternary[i] == '1' ? N_UNARY : N_BINARY;
            f.total *= f.radix[i];
        }
        forms[count++] = f;
    }
    return count;
}

// slots of a candidate, then its FP64 value (CPU, C99 math as Constant Recognition's engine)
static void decode(const FormDesc* f, unsigned long long idx, int* slots)
{
    for (int i = 0; i < f->K; i++) { slots[i] = idx % f->radix[i]; idx /= f->radix[i]; }
}

static double evaluate_fp64(const FormDesc* f, const int* slots)
{
    double stack[STACKSIZE];
    int sp = 0;
    for (int i = 0; i < f->K; i++) {
        int s = slots[i];
        if (f->ternary[i] == '0') stack[sp++] = CONST_VALUES[s];
        else if (f->ternary[i] == '1') {
            double x = stack[sp - 1], y;
            switch (s) {
                case 0: y = log(x); break;   case 1: y = exp(x); break;    case 2: y = 1.0 / x; break;  case 3: y = tgamma(x); break;
                case 4: y = sqrt(x); break;  case 5: y = x * x; break;     case 6: y = sin(x); break;   case 7: y = asin(x); break;
                case 8: y = cos(x); break;   case 9: y = acos(x); break;   case 10: y = tan(x); break;  case 11: y = atan(x); break;
                case 12: y = sinh(x); break; case 13: y = asinh(x); break; case 14: y = cosh(x); break; case 15: y = acosh(x); break;
                case 16: y = tanh(x); break; default: y = atanh(x); break;
            }
            stack[sp - 1] = y;
        } else {
            sp--;
            double a = stack[sp - 1], b = stack[sp], y;
            switch (s) {
                case 0: y = a + b; break; case 1: y = a * b; break; case 2: y = a - b; break; case 3: y = a / b; break;
                default: y = pow(a, b); break;
            }
            stack[sp - 1] = y;
        }
    }
    return stack[0];
}

static void rpn_string(const FormDesc* f, const int* slots, char* out, size_t size)
{
    out[0] = '\0';
    for (int i = 0; i < f->K; i++) {
        const char* name = f->ternary[i] == '0' ? CONST_NAMES[slots[i]] : f->ternary[i] == '1' ? UNARY_NAMES[slots[i]] : BINARY_NAMES[slots[i]];
        if (i) strncat(out, ", ", size - strlen(out) - 1);
        strncat(out, name, size - strlen(out) - 1);
    }
}

int main(int argc, char** argv)
{
    if (argc < 2) { fprintf(stderr, "Usage: %s <MaxK> [threshold in FLT_EPSILON] < targets\n", argv[0]); return 2; }
    int MaxK = atoi(argv[1]);
    float threshold = (float)((argc > 2 ? atof(argv[2]) : 64.0) * FLT_EPSILON);
    if (MaxK < 1 || MaxK > MAX_K) { fprintf(stderr, "MaxK must be 1..%d\n", MAX_K); return 2; }

    cudaDeviceProp prop;
    CUDA_CHECK(cudaGetDeviceProperties(&prop, 0));
    int max_forms = 200000;
    FormDesc* forms = (FormDesc*)malloc(max_forms * sizeof(FormDesc));
    int offsets[MAX_K + 2] = {0};
    int n_forms = 0;
    unsigned long long total_formulas = 0;
    for (int K = 1; K <= MaxK; K++) {
        offsets[K] = n_forms;
        n_forms += generate_forms(K, forms + n_forms, max_forms - n_forms);
        for (int i = offsets[K]; i < n_forms; i++) total_formulas += forms[i].total;
    }
    offsets[MaxK + 1] = n_forms;
    fprintf(stderr, "GPU %s, MaxK %d, %d forms, %llu formulas, threshold %.1f FLT_EPSILON\n",
            prop.name, MaxK, n_forms, total_formulas, threshold / FLT_EPSILON);

    Candidate *d_cand, *h_cand = (Candidate*)malloc(MAX_CANDIDATES * sizeof(Candidate));
    int* d_count;
    char* d_ternary;
    int* d_radix;
    CUDA_CHECK(cudaMalloc(&d_cand, MAX_CANDIDATES * sizeof(Candidate)));
    CUDA_CHECK(cudaMalloc(&d_count, sizeof(int)));
    CUDA_CHECK(cudaMalloc(&d_ternary, (size_t)n_forms * (MAX_K + 1)));
    CUDA_CHECK(cudaMalloc(&d_radix, (size_t)n_forms * MAX_K * sizeof(int)));
    for (int i = 0; i < n_forms; i++) {   // all forms on the device once
        CUDA_CHECK(cudaMemcpy(d_ternary + (size_t)i * (MAX_K + 1), forms[i].ternary, MAX_K + 1, cudaMemcpyHostToDevice));
        CUDA_CHECK(cudaMemcpy(d_radix + (size_t)i * MAX_K, forms[i].radix, MAX_K * sizeof(int), cudaMemcpyHostToDevice));
    }

    const int threads = 256;
    const unsigned long long chunk = 1ULL << 26;
    char line[256], id[64], rpn[1024], best_rpn[1024];
    while (fgets(line, sizeof line, stdin)) {
        double target;
        if (sscanf(line, "%63s %lf", id, &target) != 2) continue;
        auto t0 = std::chrono::steady_clock::now();
        float targetX = (float)target;
        double best_err = DBL_MAX;
        int best_K = 0, success = 0, overflow = 0;
        long long n_candidates = 0;
        best_rpn[0] = '\0';
        for (int K = 1; K <= MaxK && !success; K++) {
            int zero = 0;
            CUDA_CHECK(cudaMemcpy(d_count, &zero, sizeof(int), cudaMemcpyHostToDevice));
            for (int fid = offsets[K]; fid < offsets[K + 1]; fid++) {
                const FormDesc* f = &forms[fid];
                for (unsigned long long off = 0; off < f->total; off += chunk) {
                    unsigned long long cnt = f->total - off < chunk ? f->total - off : chunk;
                    int blocks = (int)((cnt + threads - 1) / threads);
                    search_form_kernel<<<blocks, threads>>>(d_ternary + (size_t)fid * (MAX_K + 1), K, d_radix + (size_t)fid * MAX_K,
                                                            cnt, off, targetX, threshold, d_cand, d_count, MAX_CANDIDATES, fid);
                }
            }
            int count;
            CUDA_CHECK(cudaMemcpy(&count, d_count, sizeof(int), cudaMemcpyDeviceToHost));
            if (count > MAX_CANDIDATES) { overflow = 1; count = MAX_CANDIDATES; }
            n_candidates += count;
            if (count == 0) continue;
            CUDA_CHECK(cudaMemcpy(h_cand, d_cand, (size_t)count * sizeof(Candidate), cudaMemcpyDeviceToHost));
            double best_K_err = DBL_MAX;
            for (int c = 0; c < count; c++) {
                int slots[MAX_K];
                const FormDesc* f = &forms[h_cand[c].form_id];
                decode(f, h_cand[c].idx, slots);
                double v = evaluate_fp64(f, slots);
                if (isnan(v) || isinf(v)) continue;
                double err = target == 0.0 ? fabs(v) : fabs(v / target - 1.0);
                if (err < best_K_err) {
                    best_K_err = err;
                    rpn_string(f, slots, rpn, sizeof rpn);
                    if (err < best_err || err <= EPS_MAX * DBL_EPSILON) { best_err = err; best_K = K; strcpy(best_rpn, rpn); }
                }
            }
            if (best_K_err <= EPS_MAX * DBL_EPSILON) success = 1;
        }
        double ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();
        printf("%s\t%s\t%d\t%s\t%.5e\t%lld\t%d\t%.1f\n", id, success ? "SUCCESS" : "FAILURE", best_K, best_rpn,
               best_err == DBL_MAX ? 1.0 : best_err, n_candidates, overflow, ms);
        fflush(stdout);
    }
    cudaFree(d_cand); cudaFree(d_count); cudaFree(d_ternary); cudaFree(d_radix);
    free(h_cand); free(forms);
    return 0;
}
