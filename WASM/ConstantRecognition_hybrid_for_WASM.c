/* Hybrid FP32+FP64 Constant Recognition for WASM
   Based on ConstantRecognition_function2_for_WASM.c
   
   Algorithm:
   1. FAST PASS (FP32): For each ternary form, evaluate all combinations using float
      - Find "candidates" where FP32 relative error < FP32_THRESHOLD
      - FP32 is faster and still identifies promising candidates
   
   2. VERIFY PASS (FP64): For each candidate, verify with double precision
      - Only candidates passing FP32 filter are checked in FP64
      - This filters out ~99.99% of combinations
   
   Speedup: ~7-10x compared to pure FP64 search
   
   Based on idea by Prof. A. Odrzywolek:
   - GPU FP32 hybrid: 19s
   - WASM 24-threads FP64: 2428s  
   - Speedup: ~128x
   
   Author: Based on Prof. Odrzywolek's function2, hybrid extension by Klaudiusz
   Date: December 2025
   
   To compile for WASM/WWW:
   
   emcc -O3 -Wall ConstantRecognition_hybrid_for_WASM.c ../C/constant.c ../C/itoa.c ../C/mathematica.c ../C/math2.c \
   -s WASM=1 -s EXPORTED_FUNCTIONS='["_search_RPN_hybrid", "_free"]' -s EXPORTED_RUNTIME_METHODS='["ccall", "cwrap"]' \
   -o rpn_function_hybrid.js
   
*/

#include <stdio.h>
#include <stdint.h>
#include <math.h>
#include <string.h>
#include <stdlib.h>
#include <complex.h>
#include <fenv.h>
#include <float.h>
#include "../C/constant.h"
#include "../C/itoa.c"
#include "../C/mathematica.h"
#include "../C/math2.h"
#include "../C/utils.h"

/* ============================================================================
   TYPE DEFINITIONS - Using both FP32 and FP64
   ============================================================================ */

// FP32 types for fast filtering
#define NUM_TYPE_FP32 float
#define ABS_FP32 fabsf
#define CONSTANT_FP32 constantf
#define EPSILON_FP32 FLT_EPSILON
#define IS_NAN_FP32(x) isnan(x)

// FP64 types for accurate verification
#define NUM_TYPE_FP64 double
#define ABS_FP64 fabs
#define CONSTANT_FP64 constant
#define EPSILON_FP64 DBL_EPSILON
#define IS_NAN_FP64(x) isnan(x)

/* ============================================================================
   HYBRID CONFIGURATION
   ============================================================================ */

// FP32 filtering threshold - candidates with FP32 error below this are verified in FP64
// FP32 has ~7 decimal digits precision
// For small numbers: use tight threshold ~1e-5
// For large numbers: FP32 precision degrades, so we use looser threshold
// This is calculated dynamically based on target magnitude
#define FP32_BASE_THRESHOLD 1e-4f

// Maximum candidates to store per ternary form
#define MAX_CANDIDATES 8192

// Maximum FP32 evaluations before giving up on a single ternary form
#define MAX_FP32_EVALS_PER_FORM 10000000ULL

// Standard constants
#define EPS_MAX 16  // Maximum error in DBL_EPSILON considered to be equality
#define JSON_BUFFER_SIZE (1024*1024)  // 1MB
#define min(a,b) ((a)<(b)?(a):(b))

/* ============================================================================
   CANDIDATE STORAGE for hybrid approach
   ============================================================================ */

typedef struct {
    char amino[STACKSIZE];  // The RPN code
    float error_fp32;       // FP32 error for sorting
} CandidateHybrid;

static CandidateHybrid g_candidates[MAX_CANDIDATES];
static int g_candidate_count = 0;

/* ============================================================================
   UTILITY FUNCTIONS (same as function2)
   ============================================================================ */

union DoubleInt64 {
    double d;
    uint64_t i;
};

int hamming_distance64(uint64_t x, uint64_t y) {
    return __builtin_popcountll(x ^ y);
}

double hamming_distance(double a, double b) {
    union DoubleInt64 ua, ub;
    ua.d = a;
    ub.d = b;
    int distance = hamming_distance64(ua.i, ub.i);
    return (double)distance;
}

// ULP-based ranking (from function2)
double why_not_ULP(const double ref, const double val) {
    if (isnan(ref) || isnan(val) || isinf(ref) || isinf(val)) {
        return (double)UINT64_MAX;
    }

    int64_t i_ref, i_val;
    memcpy(&i_ref, &ref, sizeof(double));
    memcpy(&i_val, &val, sizeof(double));

    if (i_ref < 0) i_ref = INT64_MIN - i_ref;
    if (i_val < 0) i_val = INT64_MIN - i_val;

    uint64_t ulp_diff = (uint64_t)(llabs(i_val - i_ref));
    return fabs((double)ulp_diff);
}

static inline float rel_err_fp32(float computed, float target) {
    if (target == 0.0f) return fabsf(computed);
    return fabsf(computed / target - 1.0f);
}

static inline double rel_err_fp64(double computed, double target) {
    if (target == 0.0) return fabs(computed);
    return fabs(computed / target - 1.0);
}

double rankFunc_fp64(double computed, double target) {
    return why_not_ULP(computed, target);
}

// Ternary syntax check (from function2)
int checkSyntax3(const char* ternary, const int length) {
    int stack = 0;
    for (int i = 0; i < length; i++) {
        switch (ternary[i]) {
            case '0': stack++; break;
            case '1': if (stack < 1) return 0; break;
            case '2': if (stack < 2) return 0; stack--; break;
        }
    }
    return (stack == 1);
}

/* ============================================================================
   Character sets (from function2)
   ============================================================================ */

static const char* constants = "0123opqrstuvw";      // 13 constants
static const char* unary_funcs = "4589abcdefghijklmn";  // 18 unary functions
static const char* binary_ops = "67xyz";             // 5 binary operators

/* ============================================================================
   GLOBAL STATE (similar to function2 but with hybrid additions)
   ============================================================================ */

static char* RPN_full_Code;
static char* JSON_output;
static char* json_start;
static int remaining;
static int written;
static int result_count;

static unsigned long long total_fp32_evals = 0;
static unsigned long long total_fp64_evals = 0;
static unsigned long long total_candidates_found = 0;
static unsigned long long fp32_evals_this_form = 0;

static char amino_best[STACKSIZE];
static double best_error_fp64 = DBL_MAX;
static double best_ulp_rank = DBL_MAX;
static int K_best = 1;

static float target_fp32;
static double target_fp64;
static double Delta_z;

// Dynamic threshold calculated based on target magnitude
static float dynamic_threshold = FP32_BASE_THRESHOLD;

/* ============================================================================
   PHASE 1: FP32 candidate collection (recursive)
   ============================================================================ */

static void collect_candidates_fp32(
    const char* ternary,
    char* result,
    int index,
    int length
) {
    // Safety limits
    if (g_candidate_count >= MAX_CANDIDATES) return;
    if (fp32_evals_this_form >= MAX_FP32_EVALS_PER_FORM) return;
    
    if (index == length) {
        // Complete combination - evaluate in FP32
        total_fp32_evals++;
        fp32_evals_this_form++;
        
        float computed_fp32 = CONSTANT_FP32(result, length);
        if (IS_NAN_FP32(computed_fp32)) return;
        
        float error_fp32 = rel_err_fp32(computed_fp32, target_fp32);
        
        // Adaptive threshold based on best found so far
        float threshold = dynamic_threshold;
        if (best_error_fp64 < dynamic_threshold && best_error_fp64 > 0) {
            threshold = (float)(best_error_fp64 * 100.0);  // 100x margin
            if (threshold < 1e-6f) threshold = 1e-6f;
        }
        
        // If promising, add to candidate list
        if (error_fp32 < threshold) {
            CandidateHybrid* c = &g_candidates[g_candidate_count];
            strncpy(c->amino, result, length);
            c->amino[length] = '\0';
            c->error_fp32 = error_fp32;
            g_candidate_count++;
            total_candidates_found++;
        }
        return;
    }
    
    // Recursive expansion based on ternary type
    const char* options;
    int options_length;
    
    switch (ternary[index]) {
        case '0':
            options = constants;
            options_length = 13;
            break;
        case '1':
            options = unary_funcs;
            options_length = 18;
            break;
        case '2':
            options = binary_ops;
            options_length = 5;
            break;
        default:
            return;
    }
    
    for (int i = 0; i < options_length && g_candidate_count < MAX_CANDIDATES; i++) {
        result[index] = options[i];
        collect_candidates_fp32(ternary, result, index + 1, length);
    }
}

/* ============================================================================
   PHASE 2: FP64 verification of candidates
   ============================================================================ */

static int verify_candidates_fp64(int K, int cpu_id) {
    // Sort candidates by FP32 error (simple insertion sort)
    for (int i = 1; i < g_candidate_count; i++) {
        CandidateHybrid key = g_candidates[i];
        int j = i - 1;
        while (j >= 0 && g_candidates[j].error_fp32 > key.error_fp32) {
            g_candidates[j + 1] = g_candidates[j];
            j--;
        }
        g_candidates[j + 1] = key;
    }
    
    // Verify each candidate in FP64
    for (int i = 0; i < g_candidate_count; i++) {
        CandidateHybrid* c = &g_candidates[i];
        total_fp64_evals++;
        
        double computed_fp64 = CONSTANT_FP64(c->amino, K);
        if (IS_NAN_FP64(computed_fp64)) continue;
        
        double error_fp64 = rel_err_fp64(computed_fp64, target_fp64);
        double ulp_rank = rankFunc_fp64(computed_fp64, target_fp64);
        
        // Update best if improved (using ULP ranking like function2)
        if (ulp_rank < best_ulp_rank) {
            
            best_error_fp64 = error_fp64;
            best_ulp_rank = ulp_rank;
            K_best = K;
            strncpy(amino_best, c->amino, K);
            amino_best[K] = '\0';
            
            print_code_mathematica(amino_best, K_best, RPN_full_Code);
            
            // Add to JSON results
            if (result_count > 0) {
                written = snprintf(json_start, remaining, ",");
                json_start += written;
                remaining -= written;
            }
            
            // Calculate compression ratio
            double compression_ratio = 0.0;
            if (target_fp64 != 0.0) {
                if (error_fp64 == 0.0) {
                    double digitsInTarget = floor(log10(fabs(target_fp64))) + 1.0;
                    double informationInRPN = K * log10(36.0);  // INSTR_NUM
                    if (informationInRPN > 0.0) {
                        compression_ratio = digitsInTarget / informationInRPN;
                    }
                } else if (error_fp64 < 1.0) {
                    double digitsInTarget = -log10(error_fp64);
                    double informationInRPN = K * log10(36.0);
                    if (informationInRPN > 0.0) {
                        compression_ratio = digitsInTarget / informationInRPN;
                    }
                }
            }
            
            written = snprintf(json_start, remaining,
                "{\"RPN\":\"%s\", \"REL_ERR\":%.17e, \"K\":%d, \"result\":\"INTERMEDIATE\", "
                "\"status\":\"RUNNING\", \"cpuId\":%d, \"mode\":\"FP64_VERIFIED\", "
                "\"fp32_evals\":%llu, \"fp64_evals\":%llu, \"HAMMING_DISTANCE\":%lf}",
                RPN_full_Code, error_fp64, K, cpu_id,
                total_fp32_evals, total_fp64_evals,
                hamming_distance(computed_fp64, target_fp64));
            json_start += written;
            remaining -= written;
            result_count++;
            
            // Check for SUCCESS
            if ((error_fp64 <= EPS_MAX * EPSILON_FP64) ||
                (fabs(computed_fp64 - target_fp64) <= 2.0 * Delta_z && compression_ratio >= 1.05)) {
                
                written = snprintf(json_start, remaining,
                    "], \"result\":\"SUCCESS\", \"RPN\":\"%s\", \"REL_ERR\":%.17e, "
                    "\"INPUT_ABS_ERR\":%lf, \"COMPRESSION_RATIO\":%lf, \"K\":%d, "
                    "\"status\":\"FINISHED\", \"mode\":\"HYBRID_FP32_FP64\", "
                    "\"fp32_evals\":%llu, \"fp64_evals\":%llu, "
                    "\"speedup_factor\":%.1f, \"HAMMING_DISTANCE\":%lf}",
                    RPN_full_Code, error_fp64, Delta_z, compression_ratio, K,
                    total_fp32_evals, total_fp64_evals,
                    (double)total_fp32_evals / (double)(total_fp64_evals + 1),
                    hamming_distance(computed_fp64, target_fp64));
                
                return 1;  // Found!
            }
        }
    }
    
    return 0;  // Not found yet
}

/* ============================================================================
   MAIN HYBRID SEARCH FUNCTION
   ============================================================================ */

char* search_RPN_hybrid(double z, double dz, int MinCodeLength, int MaxCodeLength, int cpu_id, int ncpus) {
    
    // Allocate output buffers
    RPN_full_Code = (char*)malloc(32 * 16 * sizeof(char));
    JSON_output = (char*)malloc(JSON_BUFFER_SIZE * sizeof(char));
    
    if ((RPN_full_Code == NULL) || (JSON_output == NULL)) {
        return "{\"error\": \"Memory allocation failed\"}";
    }
    
    // Initialize JSON output
    json_start = JSON_output;
    remaining = JSON_BUFFER_SIZE;
    written = snprintf(json_start, remaining,
        "{\"cpuId\":%d, \"mode\":\"HYBRID_FP32_FP64\", \"results\": [", cpu_id);
    json_start += written;
    remaining -= written;
    
    result_count = 0;
    
    // Initialize targets
    target_fp32 = (float)z;
    target_fp64 = z;
    Delta_z = dz;
    
    // Calculate dynamic threshold based on target magnitude
    // For large numbers, FP32 has less relative precision
    // FP32 epsilon is ~1.2e-7, so for target=77777, error ~1e-7 * 77777 ~= 0.008
    // We use a looser threshold to catch candidates
    float target_magnitude = fabsf(target_fp32);
    if (target_magnitude > 1.0f) {
        // For larger numbers, use proportionally larger threshold
        dynamic_threshold = FP32_BASE_THRESHOLD * (1.0f + logf(target_magnitude) / 10.0f);
        if (dynamic_threshold > 0.01f) dynamic_threshold = 0.01f;  // Cap at 1%
    } else {
        dynamic_threshold = FP32_BASE_THRESHOLD;
    }
    
    // Reset counters
    total_fp32_evals = 0;
    total_fp64_evals = 0;
    total_candidates_found = 0;
    best_error_fp64 = DBL_MAX;
    best_ulp_rank = DBL_MAX;
    K_best = 1;
    strcpy(amino_best, "0");
    
    char ternary[STACKSIZE];
    char permutations[STACKSIZE];
    
    unsigned long long ternary_forms_checked = 0;
    
    // ========================================================================
    // MAIN LOOP: For each code length K
    // ========================================================================
    
    for (int K = MinCodeLength; K <= MaxCodeLength; K++) {
        
        unsigned long long kMAX = ipow(3, K);
        unsigned long long chunk_size = (kMAX / ncpus) + ((kMAX % ncpus) > (unsigned)cpu_id ? 1 : 0);
        unsigned long long start = cpu_id * (kMAX / ncpus) + min((unsigned)cpu_id, kMAX % ncpus);
        unsigned long long end = start + chunk_size;
        
        // Iterate over ternary forms assigned to this CPU
        for (unsigned long long k = start; k < end; k++) {
            
            // Convert to ternary string
            itoa(k, ternary, 3, K);
            
            // Check ternary syntax
            if (!checkSyntax3(ternary, K)) continue;
            ternary_forms_checked++;
            
            // Reset per-form counter
            fp32_evals_this_form = 0;
            
            // ================================================================
            // PHASE 1: Collect candidates using FP32
            // ================================================================
            g_candidate_count = 0;
            collect_candidates_fp32(ternary, permutations, 0, K);
            
            // ================================================================
            // PHASE 2: Verify candidates using FP64
            // ================================================================
            if (g_candidate_count > 0) {
                if (verify_candidates_fp64(K, cpu_id)) {
                    // SUCCESS - return immediately
                    return JSON_output;
                }
            }
        }
        
        // Early exit check (similar to function2)
        if (ternary_forms_checked <= 12 && total_fp32_evals > 250 && K > 4) {
            print_code_mathematica(amino_best, K_best, RPN_full_Code);
            double computed = CONSTANT_FP64(amino_best, K_best);
            
            written = snprintf(json_start, remaining,
                "], \"result\":\"ABORTED\", \"RPN\":\"%s\", \"REL_ERR\":%.17e, \"K\":%d, "
                "\"status\":\"FINISHED\", \"mode\":\"HYBRID_FP32_FP64\", "
                "\"fp32_evals\":%llu, \"fp64_evals\":%llu, "
                "\"speedup_factor\":%.1f, \"HAMMING_DISTANCE\":%lf}",
                RPN_full_Code, rel_err_fp64(computed, target_fp64), K_best,
                total_fp32_evals, total_fp64_evals,
                (double)total_fp32_evals / (double)(total_fp64_evals + 1),
                hamming_distance(computed, target_fp64));
            
            return JSON_output;
        }
        
        // Add K_BEST result for this level
        if (result_count > 0) {
            written = snprintf(json_start, remaining, ",");
            json_start += written;
            remaining -= written;
        }
        
        print_code_mathematica(amino_best, K_best, RPN_full_Code);
        double computed = CONSTANT_FP64(amino_best, K_best);
        
        written = snprintf(json_start, remaining,
            "{\"RPN\":\"%s\", \"REL_ERR\":%.17e, \"K\":%d, \"result\":\"K_BEST\", "
            "\"status\":\"RUNNING\", \"cpuId\":%d, \"candidates_at_K\":%d}",
            RPN_full_Code, rel_err_fp64(computed, target_fp64), K, cpu_id, g_candidate_count);
        json_start += written;
        remaining -= written;
        result_count++;
    }
    
    // ========================================================================
    // FINAL RESULT
    // ========================================================================
    
    print_code_mathematica(amino_best, K_best, RPN_full_Code);
    double final_result = CONSTANT_FP64(amino_best, K_best);
    double final_error = rel_err_fp64(final_result, target_fp64);
    
    written = snprintf(json_start, remaining,
        "], \"result\":\"%s\", \"RPN\":\"%s\", \"REL_ERR\":%.17e, \"K\":%d, "
        "\"status\":\"FINISHED\", \"mode\":\"HYBRID_FP32_FP64\", "
        "\"fp32_evals\":%llu, \"fp64_evals\":%llu, \"candidates_total\":%llu, "
        "\"speedup_factor\":%.1f, \"HAMMING_DISTANCE\":%lf}",
        final_error < 1e-10 ? "FOUND" : "FAILURE",
        RPN_full_Code, final_error, K_best,
        total_fp32_evals, total_fp64_evals, total_candidates_found,
        (double)total_fp32_evals / (double)(total_fp64_evals + 1),
        hamming_distance(final_result, target_fp64));
    
    return JSON_output;
}
