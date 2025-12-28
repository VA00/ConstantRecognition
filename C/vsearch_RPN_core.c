/* vsearch_RPN_core.c - Core search implementation
 *
 * Author: Andrzej Odrzywolek, andrzej.odrzywolek@uj.edu.pl
 * Date: December 28, 2025
 *
 * This file contains ONLY the core search algorithm.
 * No knowledge of specific calculators or WASM wrappers.
 *
 * Compilation examples:
 *
 *   Standalone test (gcc/clang/icx):
 *     gcc -O2 -Wall main_vsearch_test.c vsearch_RPN_core.c -lm -o vsearch_test
 *     clang -O2 -Wall main_vsearch_test.c vsearch_RPN_core.c -lm -o vsearch_test
 *     icx -O2 -Wall main_vsearch_test.c vsearch_RPN_core.c -lm -o vsearch_test
 *
 *   WebAssembly (emcc, Linux):
 *     emcc -O2 -Wall vsearch_RPN_wasm.c vsearch_RPN_core.c -s WASM=1 \
 *          -s EXPORTED_FUNCTIONS='["_vsearch_RPN","_search_RPN","_search_RPN_hybrid","_free"]' \
 *          -s EXPORTED_RUNTIME_METHODS='["ccall","cwrap"]' -o vsearch.js
 *
 *   WebAssembly (emcc, Windows):
 *     Install emsdk first:
 *       git clone https://github.com/emscripten-core/emsdk.git
 *       cd emsdk
 *       .\emsdk install latest
 *       .\emsdk activate latest
 *     Then compile:
 *       emcc -O2 -Wall vsearch_RPN_wasm.c vsearch_RPN_core.c -s WASM=1 \
 *            -s EXPORTED_FUNCTIONS='["_vsearch_RPN","_search_RPN","_search_RPN_hybrid","_free"]' \
 *            -s EXPORTED_RUNTIME_METHODS='["ccall","cwrap"]' -o vsearch.js
 *
 *   Windows (cl.exe from Visual Studio Developer PowerShell):
 *     cl /O2 /W3 main_vsearch_test.c vsearch_RPN_core.c /Fe:vsearch_test.exe
 *
 *   Windows/Intel (icx.exe):
 *     Initialize environment:
 *       cmd.exe "/K" '"C:\Program Files (x86)\Intel\oneAPI\setvars.bat" && powershell'
 *     Then compile:
 *       icx -O2 -Wall main_vsearch_test.c vsearch_RPN_core.c -o vsearch_test
 */

/* Windows compatibility */
#ifdef _MSC_VER
#define _CRT_SECURE_NO_WARNINGS
#endif

#ifdef _WIN32
#define strdup _strdup
#endif

#ifdef _MSC_VER
#include <intrin.h>
#endif

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <math.h>
#include <float.h>

#include "vsearch_RPN_core.h"

/* ============================================================================
 * CONFIGURATION
 * ============================================================================ */

#define MAX_CODE_LENGTH  32
#define MAX_STACK_DEPTH  32
#define JSON_BUFFER_SIZE (1024 * 1024)
#define EPS_MAX          16

#define MIN(a, b) ((a) < (b) ? (a) : (b))

/* ============================================================================
 * BUILD INFO
 * ============================================================================ */

static const char BUILD_TIMESTAMP[] = __DATE__ " " __TIME__;

static const char COMPILER_VERSION[] =
#ifdef __VERSION__
    __VERSION__;
#elif defined(_MSC_VER)
    "MSVC " _CRT_STRINGIZE(_MSC_VER);
#else
    "Unknown";
#endif

static const char ARCH_INFO[] = 
#ifdef __x86_64__
    "x86_64";
#elif defined(__aarch64__)
    "ARM64";
#elif defined(__arm__)
    "ARM";
#elif defined(__wasm__)
    "WASM";  
#else
    "Unknown";
#endif

static const char OS_INFO[] = 
#ifdef __linux__
    "Linux";
#elif defined(__APPLE__)
    "macOS";
#elif defined(_WIN32)
    "Windows";
#elif defined(__unix__)
    "Unix-like";
#else
    "Unknown";
#endif

/* ============================================================================
 * TERNARY UTILITIES
 *
 * Ternary encoding: 0=constant, 1=unary, 2=binary
 * Valid RPN iff stack depth remains >=1 throughout and equals 1 at end.
 * The count of valid ternary structures follows Motzkin numbers (OEIS A001006).
 * ============================================================================ */

static int check_ternary_syntax(const char* ternary, int length) {
    int stack = 0;
    for (int i = 0; i < length; i++) {
        switch (ternary[i]) {
            case 0: stack++; break;
            case 1: if (stack < 1) return 0; break;
            case 2: if (stack < 2) return 0; stack--; break;
        }
    }
    return (stack == 1);
}

static void int_to_ternary(uint64_t k, char* out, int K) {
    for (int i = K - 1; i >= 0; i--) {
        out[i] = (char)(k % 3);
        k /= 3;
    }
}

static int ternary_increment(char* ternary, int K) {
    for (int i = K - 1; i >= 0; i--) {
        ternary[i]++;
        if (ternary[i] < 3) return 1;
        ternary[i] = 0;
    }
    return 0;
}

/* ============================================================================
 * EXPRESSION EVALUATION
 * ============================================================================ */

static double evaluate_expression(
    const char* ternary, const int* indices, int K,
    const ConstOp* const_ops,
    const UnaryOp* unary_ops,
    const BinaryOp* binary_ops)
{
    double stack[MAX_STACK_DEPTH];
    int sp = 0;
    
    for (int i = 0; i < K; i++) {
        switch (ternary[i]) {
            case 0:
                if (sp >= MAX_STACK_DEPTH) return nan("");
                stack[sp++] = const_ops[indices[i]].value;
                break;
                
            case 1:
                if (sp < 1) return nan("");
                stack[sp-1] = unary_ops[indices[i]].func(stack[sp-1]);
                break;
                
            case 2:
                if (sp < 2) return nan("");
                sp--;
                {
                    double b = stack[sp];
                    double a = stack[sp-1];
                    stack[sp-1] = binary_ops[indices[i]].func(b, a);
                }
                break;
        }
    }
    
    return (sp == 1) ? stack[0] : nan("");
}

/* ============================================================================
 * CODE FORMATTING
 * ============================================================================ */

static void format_code(
    const char* ternary, const int* indices, int K,
    const ConstOp* const_ops,
    const UnaryOp* unary_ops,
    const BinaryOp* binary_ops,
    char* out, int out_size)
{
    int pos = 0;
    
    for (int i = 0; i < K && pos < out_size - 20; i++) {
        if (i > 0) {
            out[pos++] = ',';
            out[pos++] = ' ';
        }
        
        const char* name = NULL;
        switch (ternary[i]) {
            case 0: name = const_ops[indices[i]].name; break;
            case 1: name = unary_ops[indices[i]].name; break;
            case 2: name = binary_ops[indices[i]].name; break;
        }
        
        if (name) {
            int len = strlen(name);
            if (pos + len < out_size) {
                memcpy(out + pos, name, len);
                pos += len;
            }
        }
    }
    out[pos] = '\0';
}

/* ============================================================================
 * HAMMING DISTANCE
 * ============================================================================ */

static inline int popcount64(uint64_t x) {
#if defined(_MSC_VER)
    return (int)__popcnt64(x);
#elif defined(__GNUC__) || defined(__clang__)
    return __builtin_popcountll(x);
#else
    x = x - ((x >> 1) & 0x5555555555555555ULL);
    x = (x & 0x3333333333333333ULL) + ((x >> 2) & 0x3333333333333333ULL);
    x = (x + (x >> 4)) & 0x0f0f0f0f0f0f0f0fULL;
    return (int)((x * 0x0101010101010101ULL) >> 56);
#endif
}

static double hamming_distance(double a, double b) {
    uint64_t ua, ub;
    memcpy(&ua, &a, sizeof(double));
    memcpy(&ub, &b, sizeof(double));
    return (double) popcount64(ua ^ ub);
}

/* ============================================================================
 * SEARCH STATE
 * ============================================================================ */

typedef struct {
    double target;
    double delta;
    double best_err;
    double best_value;
    int best_K;
    int best_indices[MAX_CODE_LENGTH];
    char best_ternary[MAX_CODE_LENGTH];
    int found_exact;
    
    char* json_ptr;
    int json_remaining;
    int result_count;
    int cpu_id;
    
    const ConstOp* const_ops;
    int n_const;
    const UnaryOp* unary_ops;
    int n_unary;
    const BinaryOp* binary_ops;
    int n_binary;
} SearchState;

/* ============================================================================
 * RECURSIVE GENERATOR
 * ============================================================================ */

static int generate_and_evaluate(const char* ternary, int* indices, int pos, int K,
                                  SearchState* state) {
    if (state->found_exact) return 1;
    
    if (pos == K) {
        double val = evaluate_expression(ternary, indices, K,
                                        state->const_ops,
                                        state->unary_ops,
                                        state->binary_ops);
        if (isnan(val) || isinf(val)) return 0;
        
        double err = (state->target == 0.0) ? 
                     fabs(val) : fabs(val / state->target - 1.0);
        
        if (err < state->best_err) {
            state->best_err = err;
            state->best_value = val;
            state->best_K = K;
            memcpy(state->best_ternary, ternary, K);
            memcpy(state->best_indices, indices, K * sizeof(int));
            
            char code[512];
            format_code(ternary, indices, K,
                       state->const_ops, state->unary_ops, state->binary_ops,
                       code, sizeof(code));
            
            if (state->result_count > 0) {
                int w = snprintf(state->json_ptr, state->json_remaining, ",\n");
                state->json_ptr += w;
                state->json_remaining -= w;
            }
            
            int w = snprintf(state->json_ptr, state->json_remaining,
                "{\"RPN\":\"%s\", \"REL_ERR\":%.17e, \"K\":%d, "
                "\"result\":\"INTERMEDIATE\", \"status\":\"RUNNING\", "
                "\"cpuId\":%d, \"HAMMING_DISTANCE\":%lf}",
                code, err, K, state->cpu_id, hamming_distance(val, state->target));
            state->json_ptr += w;
            state->json_remaining -= w;
            state->result_count++;
            
            int n_total = state->n_const + state->n_unary + state->n_binary;
            double compression = (err > 0) ? -log10(err) / (K * log10(n_total)) : 10.0;
            
            if (err <= EPS_MAX * DBL_EPSILON ||
                (fabs(val - state->target) <= 2.0 * state->delta && compression >= 1.05)) {
                state->found_exact = 1;
                return 1;
            }
        }
        return 0;
    }
    
    int n_options;
    switch (ternary[pos]) {
        case 0: n_options = state->n_const; break;
        case 1: n_options = state->n_unary; break;
        case 2: n_options = state->n_binary; break;
        default: return 0;
    }
    
    for (int i = 0; i < n_options; i++) {
        indices[pos] = i;
        if (generate_and_evaluate(ternary, indices, pos + 1, K, state)) {
            return 1;
        }
    }
    return 0;
}

/* ============================================================================
 * CORE SEARCH FUNCTION
 * ============================================================================ */

char* vsearch_RPN_core(
    double z, double dz,
    int MinK, int MaxK,
    int cpu_id, int ncpus,
    const ConstOp* const_ops, int n_const,
    const UnaryOp* unary_ops, int n_unary,
    const BinaryOp* binary_ops, int n_binary)
{
    char* json_output = (char*)malloc(JSON_BUFFER_SIZE);
    if (!json_output) {
        return strdup("{\"error\":\"Memory allocation failed\"}");
    }
    
    SearchState state = {
        .target = z,
        .delta = dz,
        .best_err = DBL_MAX,
        .best_value = 0.0,
        .best_K = 1,
        .found_exact = 0,
        .json_ptr = json_output,
        .json_remaining = JSON_BUFFER_SIZE,
        .result_count = 0,
        .cpu_id = cpu_id,
        .const_ops = const_ops,
        .n_const = n_const,
        .unary_ops = unary_ops,
        .n_unary = n_unary,
        .binary_ops = binary_ops,
        .n_binary = n_binary
    };
    
    state.best_ternary[0] = 0;
    state.best_indices[0] = 0;
    
    int w = snprintf(state.json_ptr, state.json_remaining, "{\n"); 
    state.json_ptr += w; state.json_remaining -= w;

    w = snprintf(state.json_ptr, state.json_remaining, "\"z\":  %.17lf,\n", z);
    state.json_ptr += w; state.json_remaining -= w;
    w = snprintf(state.json_ptr, state.json_remaining, "\"dz\": %.17lf,\n", dz);
    state.json_ptr += w; state.json_remaining -= w;
    w = snprintf(state.json_ptr, state.json_remaining, "\"minK\":  %d,\n", MinK);
    state.json_ptr += w; state.json_remaining -= w;
    w = snprintf(state.json_ptr, state.json_remaining, "\"maxK\":  %d,\n", MaxK);
    state.json_ptr += w; state.json_remaining -= w;
    w = snprintf(state.json_ptr, state.json_remaining, "\"cpuId\": %d,\n", cpu_id);
    state.json_ptr += w; state.json_remaining -= w;
    w = snprintf(state.json_ptr, state.json_remaining, "\"ncpus\": %d,\n", ncpus);
    state.json_ptr += w; state.json_remaining -= w;
    w = snprintf(state.json_ptr, state.json_remaining, "\"n_const\": %d,\n", n_const);
    state.json_ptr += w; state.json_remaining -= w;
    w = snprintf(state.json_ptr, state.json_remaining, "\"n_unary\": %d,\n", n_unary);
    state.json_ptr += w; state.json_remaining -= w;
    w = snprintf(state.json_ptr, state.json_remaining, "\"n_binary\": %d,\n", n_binary);
    state.json_ptr += w; state.json_remaining -= w;
    w = snprintf(state.json_ptr, state.json_remaining, "\"n_total\": %d,\n", n_const + n_unary + n_binary);
    state.json_ptr += w; state.json_remaining -= w;
    w = snprintf(state.json_ptr, state.json_remaining, "\"buildTime\": \"%s\",\n", BUILD_TIMESTAMP);
    state.json_ptr += w; state.json_remaining -= w;
    w = snprintf(state.json_ptr, state.json_remaining, "\"compiler\":  \"%s\",\n", COMPILER_VERSION);
    state.json_ptr += w; state.json_remaining -= w;
    w = snprintf(state.json_ptr, state.json_remaining, "\"arch\":      \"%s\",\n", ARCH_INFO);
    state.json_ptr += w; state.json_remaining -= w;
    w = snprintf(state.json_ptr, state.json_remaining, "\"os\":        \"%s\",\n", OS_INFO);
    state.json_ptr += w; state.json_remaining -= w;
    
    w = snprintf(state.json_ptr, state.json_remaining, "\"results\": [\n"); 
    state.json_ptr += w; state.json_remaining -= w;

    char ternary[MAX_CODE_LENGTH];
    int indices[MAX_CODE_LENGTH];
    
    uint64_t total_ternary = 0;
    uint64_t valid_ternary = 0;
    
    for (int K = MinK; K <= MaxK && !state.found_exact; K++) {
        uint64_t n_ternary = 1;
        for (int i = 0; i < K; i++) n_ternary *= 3;
        
        uint64_t chunk = (n_ternary + ncpus - 1) / ncpus;
        uint64_t start = (uint64_t)cpu_id * chunk;
        uint64_t end = MIN(start + chunk, n_ternary);
        
        int_to_ternary(start, ternary, K);
        
        for (uint64_t t = start; t < end && !state.found_exact; t++) {
            total_ternary++;
            
            if (check_ternary_syntax(ternary, K)) {
                valid_ternary++;
                generate_and_evaluate(ternary, indices, 0, K, &state);
            }
            
            if (t < end - 1) {
                ternary_increment(ternary, K);
            }
        }
        
        /* Emit K_BEST after each level */
        if (!state.found_exact && state.best_K > 0) {
            char code[512];
            format_code(state.best_ternary, state.best_indices, state.best_K,
                       state.const_ops, state.unary_ops, state.binary_ops,
                       code, sizeof(code));
            
            if (state.result_count > 0) {
                w = snprintf(state.json_ptr, state.json_remaining, ",");
                state.json_ptr += w;
                state.json_remaining -= w;
            }
            
            w = snprintf(state.json_ptr, state.json_remaining,
                "{\"RPN\":\"%s\", \"REL_ERR\":%.17e, \"K\":%d, "
                "\"result\":\"K_BEST\", \"status\":\"RUNNING\", "
                "\"cpuId\":%d, \"HAMMING_DISTANCE\":%lf}",
                code, state.best_err, K, cpu_id, 
                hamming_distance(state.best_value, z));
            state.json_ptr += w;
            state.json_remaining -= w;
            state.result_count++;
        }
        
        /* Early abort for hopeless searches */
        if (valid_ternary <= 12 && total_ternary > 250 && K > 4) {
            char code[512];
            format_code(state.best_ternary, state.best_indices, state.best_K,
                       state.const_ops, state.unary_ops, state.binary_ops,
                       code, sizeof(code));
            
            w = snprintf(state.json_ptr, state.json_remaining,
                "], \"result\":\"ABORTED\", \"RPN\":\"%s\", \"REL_ERR\":%.17e, "
                "\"K\":%d, \"status\":\"FINISHED\", \"HAMMING_DISTANCE\":%lf}",
                code, state.best_err, state.best_K,
                hamming_distance(state.best_value, z));
            
            return json_output;
        }
    }
    
    /* Final result */
    char code[512];
    format_code(state.best_ternary, state.best_indices, state.best_K,
               state.const_ops, state.unary_ops, state.binary_ops,
               code, sizeof(code));
    
    double compression;
    int n_total = n_const + n_unary + n_binary;
    
    if (z == 0.0) {
        compression = 0.0;
    } else {
        if (state.best_err == 0.0) {
            double digitsInTarget = floor(log10(fabs(z))) + 1.0;
            double informationInRPN = state.best_K * log10(n_total);
            compression = (informationInRPN <= 0.0) ? 0.0 : digitsInTarget / informationInRPN;
        } else {
            double digitsInTarget = -log10(state.best_err);
            double informationInRPN = state.best_K * log10(n_total);
            compression = (state.best_err >= 1.0 || informationInRPN <= 0.0) ? 
                         0.0 : digitsInTarget / informationInRPN;
        }
    }
    
    const char* result_type = state.found_exact ? "SUCCESS" : "FAILURE";
    
    w = snprintf(state.json_ptr, state.json_remaining,
        "], \"result\":\"%s\", \"RPN\":\"%s\", \"REL_ERR\":%.17e, "
        "\"INPUT_ABS_ERR\":%lf, \"COMPRESSION_RATIO\":%lf, \"K\":%d, "
        "\"status\":\"FINISHED\", \"HAMMING_DISTANCE\":%lf}",
        result_type, code, state.best_err, dz, compression, state.best_K,
        hamming_distance(state.best_value, z));
    
    return json_output;
}
