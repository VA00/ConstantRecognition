/* vsearch_RPN_core.c - Unified constant and function recognition
 *
 * Author: Andrzej Odrzywolek, andrzej.odrzywolek@uj.edu.pl
 * Date: January 2, 2025
 *
 * Key insight: Constant recognition is a special case of function recognition:
 *   - Constant mode: no variable x allowed, n_data=1
 *   - Function mode: variable x allowed in any/all constant slots, n_data>=1
 *
 * Shared code:
 *   - Ternary form enumeration (Motzkin numbers)
 *   - Recursive generator structure  
 *   - Expression evaluation (with variable support)
 *   - Code formatting
 *   - JSON output
 *   - Stop criteria heuristics
 *
 * Compilation:
 *
 *   Standalone test (gcc/clang/icx):
 *     gcc -O2 -Wall main_vsearch_test.c vsearch_RPN_core.c utils.c -lm -o vsearch_test
 *
 *   WebAssembly (emcc):
 *     emcc -O2 -Wall vsearch_RPN_wasm.c vsearch_RPN_core.c utils.c -s WASM=1 \
 *          -s EXPORTED_FUNCTIONS='["_search_RPN","_search_RPN_hybrid","_vsearch_RPN","_free"]' \
 *          -s EXPORTED_RUNTIME_METHODS='["ccall","cwrap"]' -o vsearch.js
 */



#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <math.h>
#include <float.h>

#include "vsearch_RPN_core.h"
#include "utils.h"

/* ============================================================================
 * CONFIGURATION
 * ============================================================================ */

#define MAX_CODE_LENGTH  32
#define MAX_STACK_DEPTH  32
#define JSON_BUFFER_SIZE (1024 * 1024)
#define EPS_MAX          16    /* Maximum ULPs for "exact" match */

#define MIN(a, b) ((a) < (b) ? (a) : (b))

/* ============================================================================
 * BUILD INFO
 * ============================================================================ */

static const char BUILD_TIMESTAMP[] = __DATE__ " " __TIME__;

static const char COMPILER_VERSION[] =
#ifdef __VERSION__
    __VERSION__;
#elif defined(_MSC_VER)
    "MSVC";
#else
    "Unknown";
#endif

static const char ARCH_INFO[] = 
#ifdef __x86_64__
    "x86_64";
#elif defined(__aarch64__)
    "ARM64";
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
#elif defined(__EMSCRIPTEN__)
    "Emscripten";
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
 * UNIFIED EXPRESSION EVALUATION
 *
 * MODE_CONSTANT: indices[i] ∈ [0, n_const-1] → actual constants only
 * MODE_FUNCTION: indices[i] ∈ [0, n_const]   → 0=x, 1..n_const=constants
 * ============================================================================ */

static double evaluate_expression(
    const char* ternary, const int* indices, int K,
    const ConstOp* const_ops, int n_const,
    const UnaryOp* unary_ops,
    const BinaryOp* binary_ops,
    SearchMode mode,
    double x_value)   /* Only used in MODE_FUNCTION */
{
    double stack[MAX_STACK_DEPTH];
    int sp = 0;
    
    for (int i = 0; i < K; i++) {
        switch (ternary[i]) {
            case 0:  /* Constant (or variable in function mode) */
                if (sp >= MAX_STACK_DEPTH) return nan("");
                if (mode == MODE_FUNCTION && indices[i] == 0) {
                    stack[sp++] = x_value;  /* Index 0 = variable x */
                } else {
                    /* In function mode, constant indices are shifted by 1 */
                    int const_idx = (mode == MODE_FUNCTION) ? 
                                    indices[i] - 1 : indices[i];
                    stack[sp++] = const_ops[const_idx].value;
                }
                break;
                
            case 1:  /* Unary function */
                if (sp < 1) return nan("");
                stack[sp-1] = unary_ops[indices[i]].func(stack[sp-1]);
                break;
                
            case 2:  /* Binary operator */
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
 * CHECK IF EXPRESSION CONTAINS VARIABLE (function mode only)
 * ============================================================================ */

static int contains_variable(const char* ternary, const int* indices, int K) {
    for (int i = 0; i < K; i++) {
        if (ternary[i] == 0 && indices[i] == 0) {
            return 1;
        }
    }
    return 0;
}

/* ============================================================================
 * UNIFIED ERROR COMPUTATION
 * 
 * Computes the error between computed values and target data using
 * the specified metric. Supports both continuous and discrete metrics.
 * ============================================================================ */

static double compute_error(
    const char* ternary, const int* indices, int K,
    const ConstOp* const_ops, int n_const,
    const UnaryOp* unary_ops,
    const BinaryOp* binary_ops,
    SearchMode mode,
    const DataPoint* data, int n_data,
    ErrorMetric metric)
{
    double error = 0.0;
    double max_err = 0.0;
    int valid_points = 0;
    
    for (int i = 0; i < n_data; i++) {
        double computed = evaluate_expression(
            ternary, indices, K,
            const_ops, n_const, unary_ops, binary_ops,
            mode, data[i].x);
        
        if (isnan(computed) || isinf(computed)) {
            if (mode == MODE_FUNCTION) {
                /* Penalty for invalid points - formula might work elsewhere */
                error += 1e10;
                valid_points++;
            }
            continue;
        }
        
        double target = data[i].y;
        double diff = computed - target;
        double abs_diff = fabs(diff);
        
        switch (metric) {
            case ERROR_ABS:
                error += abs_diff;
                break;
                
            case ERROR_REL:
                if (target == 0.0) {
                    error += abs_diff;
                } else {
                    error += fabs(computed / target - 1.0);
                }
                break;
                
            case ERROR_MSE:
                error += diff * diff;
                break;
                
            case ERROR_MAE:
                error += abs_diff;
                break;
                
            case ERROR_MAX:
                if (abs_diff > max_err) max_err = abs_diff;
                break;
                
            case ERROR_ULP:
                error += (double)compute_ULP_distance(target, computed);
                break;
                
            case ERROR_HAMMING:
                error += (double)compute_hamming_distance(target, computed);
                break;
        }
        valid_points++;
    }
    
    if (valid_points == 0) return DBL_MAX;
    
    if (metric == ERROR_MAX) return max_err;
    
    /* For single-point constant recognition, don't average */
    if (n_data == 1) return error;
    
    return error / valid_points;
}

/* ============================================================================
 * CODE FORMATTING
 * ============================================================================ */

static void format_code(
    const char* ternary, const int* indices, int K,
    const ConstOp* const_ops,
    const UnaryOp* unary_ops,
    const BinaryOp* binary_ops,
    SearchMode mode,
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
            case 0:
                if (mode == MODE_FUNCTION && indices[i] == 0) {
                    name = "x";
                } else {
                    int const_idx = (mode == MODE_FUNCTION) ? 
                                    indices[i] - 1 : indices[i];
                    name = const_ops[const_idx].name;
                }
                break;
            case 1: 
                name = unary_ops[indices[i]].name; 
                break;
            case 2: 
                name = binary_ops[indices[i]].name; 
                break;
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
 * SEARCH STATE
 * ============================================================================ */

typedef struct {
    /* Mode and data */
    SearchMode mode;
    const DataPoint* data;
    int n_data;
    ErrorMetric metric;
    CompareMode compare;
    
    /* Calculator definition */
    const ConstOp* const_ops;
    int n_const;
    const UnaryOp* unary_ops;
    int n_unary;
    const BinaryOp* binary_ops;
    int n_binary;
    
    /* Best result tracking */
    double best_err;
    double best_value;
    int best_K;
    int best_indices[MAX_CODE_LENGTH];
    char best_ternary[MAX_CODE_LENGTH];
    int found_exact;
    
    /* Statistics */
    uint64_t total_ternary;
    uint64_t valid_ternary;
    uint64_t evaluations;
    
    /* JSON output */
    char* json_ptr;
    int json_remaining;
    int result_count;
    int cpu_id;
} SearchState;

/* ============================================================================
 * RECURSIVE GENERATOR
 * ============================================================================ */

static int generate_and_evaluate(
    const char* ternary, int* indices, int pos, int K,
    SearchState* state)
{
    if (state->found_exact) return 1;
    
    if (pos == K) {
        /* In function mode, skip expressions without variable */
        if (state->mode == MODE_FUNCTION && 
            !contains_variable(ternary, indices, K)) {
            return 0;
        }
        
        state->evaluations++;
        
        /* Compute error */
        double err = compute_error(
            ternary, indices, K,
            state->const_ops, state->n_const,
            state->unary_ops, state->binary_ops,
            state->mode,
            state->data, state->n_data, state->metric);
        
        /* Check if this is a new best (using compare mode) */
        int is_better = (state->compare == COMPARE_STRICT) ? 
                        (err < state->best_err) : (err <= state->best_err);
        
        if (is_better) {
            state->best_err = err;
            state->best_K = K;
            memcpy(state->best_ternary, ternary, K);
            memcpy(state->best_indices, indices, K * sizeof(int));
            
            /* Store computed value for constant mode */
            if (state->mode == MODE_CONSTANT) {
                state->best_value = evaluate_expression(
                    ternary, indices, K,
                    state->const_ops, state->n_const,
                    state->unary_ops, state->binary_ops,
                    state->mode, 0.0);
            }
            
            /* Output intermediate result */
            char code[512];
            format_code(ternary, indices, K,
                state->const_ops, state->unary_ops, state->binary_ops,
                state->mode, code, sizeof(code));
            
            if (state->result_count > 0) {
                int w = snprintf(state->json_ptr, state->json_remaining, ",\n");
                state->json_ptr += w;
                state->json_remaining -= w;
            }
            
            /* Compute Hamming distance for JSON output */
            double target = state->data[0].y;
            double computed = state->best_value;
            int hamming = compute_hamming_distance(target, computed);
            
            int w = snprintf(state->json_ptr, state->json_remaining,
                "{\"RPN\":\"%s\", \"REL_ERR\":%.17e, \"K\":%d, "
                "\"result\":\"INTERMEDIATE\", \"status\":\"RUNNING\", "
                "\"cpuId\":%d, \"HAMMING_DISTANCE\":%d}",
                code, err, K, state->cpu_id, hamming);
            state->json_ptr += w;
            state->json_remaining -= w;
            state->result_count++;
            
            /* Check for exact match (constant mode) */
            if (state->mode == MODE_CONSTANT) {
                double target = state->data[0].y;
                double delta = state->data[0].dy;
                
                /* Compression ratio heuristic */
                int n_total = state->n_const + state->n_unary + state->n_binary;
                double compression = (err > 0) ? -log10(err) / (K * log10(n_total)) : 10.0;
                
                if (err <= EPS_MAX * DBL_EPSILON ||
                    (delta > 0 && fabs(state->best_value - target) <= 2.0 * delta && compression >= 1.05)) {
                    state->found_exact = 1;
                    return 1;
                }
            }
            
            /* Check for good enough match (function mode) */
            if (state->mode == MODE_FUNCTION && err < 1e-12) {
                state->found_exact = 1;
                return 1;
            }
        }
        return 0;
    }
    
    /* Determine options for this position */
    int n_options;
    
    switch (ternary[pos]) {
        case 0:
            /* Constant slots:
             * MODE_CONSTANT: indices 0..n_const-1 (actual constants)
             * MODE_FUNCTION: indices 0..n_const   (0=x, 1..n_const=constants)
             */
            n_options = (state->mode == MODE_FUNCTION) ? 
                        state->n_const + 1 : state->n_const;
            break;
        case 1:
            n_options = state->n_unary;
            break;
        case 2:
            n_options = state->n_binary;
            break;
        default:
            return 0;
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

char* vsearch_core(
    SearchMode mode,
    const DataPoint* data, int n_data,
    int MinK, int MaxK,
    int cpu_id, int ncpus,
    const ConstOp* const_ops, int n_const,
    const UnaryOp* unary_ops, int n_unary,
    const BinaryOp* binary_ops, int n_binary,
    ErrorMetric metric,
    CompareMode compare)
{
    char* json_output = (char*)malloc(JSON_BUFFER_SIZE);
    if (!json_output) {
        return strdup("{\"error\":\"Memory allocation failed\"}");
    }
    
    SearchState state = {
        .mode = mode,
        .data = data,
        .n_data = n_data,
        .metric = metric,
        .compare = compare,
        .const_ops = const_ops,
        .n_const = n_const,
        .unary_ops = unary_ops,
        .n_unary = n_unary,
        .binary_ops = binary_ops,
        .n_binary = n_binary,
        .best_err = DBL_MAX,
        .best_value = 0.0,
        .best_K = 1,
        .found_exact = 0,
        .total_ternary = 0,
        .valid_ternary = 0,
        .evaluations = 0,
        .json_ptr = json_output,
        .json_remaining = JSON_BUFFER_SIZE,
        .result_count = 0,
        .cpu_id = cpu_id
    };
    
    /* Initialize best to first constant (fallback) */
    state.best_ternary[0] = 0;
    state.best_indices[0] = (mode == MODE_FUNCTION) ? 1 : 0;
    
    /* JSON header */
    const char* mode_str = (mode == MODE_CONSTANT) ? "CONSTANT" : "FUNCTION";
    const char* metric_str[] = {"ABS", "REL", "MSE", "MAE", "MAX", "ULP", "HAMMING"};
    const char* compare_str = (compare == COMPARE_STRICT) ? "STRICT" : "EQUAL";
    
    int w = snprintf(state.json_ptr, state.json_remaining,
        "{\n"
        "\"mode\": \"%s\",\n"
        "\"metric\": \"%s\",\n"
        "\"compare\": \"%s\",\n"
        "\"n_data\": %d,\n"
        "\"target\": %.17g,\n"
        "\"delta\": %.17g,\n"
        "\"cpuId\": %d,\n"
        "\"ncpus\": %d,\n"
        "\"minK\": %d,\n"
        "\"maxK\": %d,\n"
        "\"n_const\": %d,\n"
        "\"n_unary\": %d,\n"
        "\"n_binary\": %d,\n"
        "\"n_total\": %d,\n"
        "\"buildTime\": \"%s\",\n"
        "\"compiler\": \"%s\",\n"
        "\"arch\": \"%s\",\n"
        "\"os\": \"%s\",\n"
        "\"results\": [\n",
        mode_str, metric_str[metric], compare_str,
        n_data, data[0].y, data[0].dy,
        cpu_id, ncpus, MinK, MaxK,
        n_const, n_unary, n_binary,
        n_const + n_unary + n_binary,
        BUILD_TIMESTAMP, COMPILER_VERSION, ARCH_INFO, OS_INFO);
    state.json_ptr += w;
    state.json_remaining -= w;
    
    char ternary[MAX_CODE_LENGTH];
    int indices[MAX_CODE_LENGTH];
    
    for (int K = MinK; K <= MaxK && !state.found_exact; K++) {
        uint64_t n_ternary = 1;
        for (int i = 0; i < K; i++) n_ternary *= 3;
        
        uint64_t chunk = (n_ternary + ncpus - 1) / ncpus;
        uint64_t start = (uint64_t)cpu_id * chunk;
        uint64_t end = MIN(start + chunk, n_ternary);
        
        int_to_ternary(start, ternary, K);
        
        for (uint64_t t = start; t < end && !state.found_exact; t++) {
            state.total_ternary++;
            
            if (check_ternary_syntax(ternary, K)) {
                state.valid_ternary++;
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
                state.mode, code, sizeof(code));
            
            double target = state.data[0].y;
            int hamming = compute_hamming_distance(target, state.best_value);
            
            if (state.result_count > 0) {
                w = snprintf(state.json_ptr, state.json_remaining, ",\n");
                state.json_ptr += w;
                state.json_remaining -= w;
            }
            
            w = snprintf(state.json_ptr, state.json_remaining,
                "{\"RPN\":\"%s\", \"REL_ERR\":%.17e, \"K\":%d, "
                "\"result\":\"K_BEST\", \"status\":\"RUNNING\", "
                "\"cpuId\":%d, \"HAMMING_DISTANCE\":%d}",
                code, state.best_err, K, cpu_id, hamming);
            state.json_ptr += w;
            state.json_remaining -= w;
            state.result_count++;
        }
        
        /* Early abort for hopeless searches (fine-tuned for CALC4) */
        if (state.valid_ternary <= 12 && state.total_ternary > 250 && K > 4) {
            char code[512];
            format_code(state.best_ternary, state.best_indices, state.best_K,
                state.const_ops, state.unary_ops, state.binary_ops,
                state.mode, code, sizeof(code));
            
            double target = state.data[0].y;
            int hamming = compute_hamming_distance(target, state.best_value);
            
            w = snprintf(state.json_ptr, state.json_remaining,
                "], \"result\":\"ABORTED\", \"RPN\":\"%s\", \"REL_ERR\":%.17e, "
                "\"K\":%d, \"status\":\"FINISHED\", \"HAMMING_DISTANCE\":%d, "
                "\"total_ternary\":%llu, \"valid_ternary\":%llu, \"evaluations\":%llu}",
                code, state.best_err, state.best_K, hamming,
                (unsigned long long)state.total_ternary,
                (unsigned long long)state.valid_ternary,
                (unsigned long long)state.evaluations);
            
            return json_output;
        }
    }
    
    /* Final result */
    char code[512];
    format_code(state.best_ternary, state.best_indices, state.best_K,
        state.const_ops, state.unary_ops, state.binary_ops,
        state.mode, code, sizeof(code));
    
    /* Compute compression ratio */
    double compression;
    int n_total = n_const + n_unary + n_binary;
    double target = data[0].y;
    double delta = data[0].dy;
    
    if (target == 0.0) {
        compression = 0.0;
    } else if (state.best_err == 0.0) {
        double digitsInTarget = floor(log10(fabs(target))) + 1.0;
        double informationInRPN = state.best_K * log10(n_total);
        compression = (informationInRPN <= 0.0) ? 0.0 : digitsInTarget / informationInRPN;
    } else {
        double digitsInTarget = -log10(state.best_err);
        double informationInRPN = state.best_K * log10(n_total);
        compression = (state.best_err >= 1.0 || informationInRPN <= 0.0) ? 
                     0.0 : digitsInTarget / informationInRPN;
    }
    
    int hamming = compute_hamming_distance(target, state.best_value);
    const char* result_type = state.found_exact ? "SUCCESS" : "FAILURE";
    
    w = snprintf(state.json_ptr, state.json_remaining,
        "],\n \"result\":\"%s\", \"RPN\":\"%s\", \"REL_ERR\":%.17e, "
        "\"INPUT_ABS_ERR\":%lf, \"COMPRESSION_RATIO\":%lf, \"K\":%d, "
        "\"status\":\"FINISHED\", \"HAMMING_DISTANCE\":%d, "
        "\"total_ternary\":%llu, \"valid_ternary\":%llu, \"evaluations\":%llu}",
        result_type, code, state.best_err, delta, compression, state.best_K, hamming,
        (unsigned long long)state.total_ternary,
        (unsigned long long)state.valid_ternary,
        (unsigned long long)state.evaluations);
    
    return json_output;
}

/* ============================================================================
 * PUBLIC API: CONSTANT RECOGNITION
 * ============================================================================ */

char* search_constant(
    double target, double delta,
    int MinK, int MaxK,
    int cpu_id, int ncpus,
    const ConstOp* const_ops, int n_const,
    const UnaryOp* unary_ops, int n_unary,
    const BinaryOp* binary_ops, int n_binary,
    ErrorMetric metric,
    CompareMode compare)
{
    /* Wrap single value as one-element dataset */
    DataPoint data[1] = {{.x = 0.0, .y = target, .dy = delta}};
    
    return vsearch_core(
        MODE_CONSTANT,
        data, 1,
        MinK, MaxK,
        cpu_id, ncpus,
        const_ops, n_const,
        unary_ops, n_unary,
        binary_ops, n_binary,
        metric, compare);
}

/* ============================================================================
 * PUBLIC API: FUNCTION RECOGNITION
 * ============================================================================ */

char* search_function(
    const DataPoint* data, int n_data,
    int MinK, int MaxK,
    int cpu_id, int ncpus,
    const ConstOp* const_ops, int n_const,
    const UnaryOp* unary_ops, int n_unary,
    const BinaryOp* binary_ops, int n_binary,
    ErrorMetric metric,
    CompareMode compare)
{
    return vsearch_core(
        MODE_FUNCTION,
        data, n_data,
        MinK, MaxK,
        cpu_id, ncpus,
        const_ops, n_const,
        unary_ops, n_unary,
        binary_ops, n_binary,
        metric, compare);
}
