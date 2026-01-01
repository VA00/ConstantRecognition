/* vsearch_RPN_core.h - Unified constant and function recognition
 * 
 * Author: Andrzej Odrzywolek
 * Date: January 2, 2025
 *
 * Core types and function declarations for:
 *   - Constant recognition (no variable, single target)
 *   - Function recognition (variable x, tabulated data)
 *
 * The key insight: constant recognition is a special case of function
 * recognition where n_data=1 and variable x is not allowed.
 */

#ifndef VSEARCH_RPN_CORE_H
#define VSEARCH_RPN_CORE_H

/* Windows compatibility */
#ifdef _MSC_VER
#define _CRT_SECURE_NO_WARNINGS
#endif

#ifdef _WIN32
#define strdup _strdup
#endif

/* ============================================================================
 * CALCULATOR OPERATION TYPES
 * ============================================================================ */

typedef struct {
    double value;
    const char* name;
} ConstOp;

typedef struct {
    double (*func)(double);
    const char* name;
} UnaryOp;

typedef struct {
    double (*func)(double, double);
    const char* name;
} BinaryOp;

/* ============================================================================
 * DATA POINT
 * 
 * For constant recognition:
 *   - x is ignored (set to 0)
 *   - y is the target value
 *   - dy is the uncertainty (0 means unspecified)
 *
 * For function recognition:
 *   - x is the independent variable
 *   - y is the target value f(x)
 *   - dy is the uncertainty at this point (0 means unspecified)
 * ============================================================================ */

typedef struct {
    double x;    /* Independent variable (ignored for constants) */
    double y;    /* Target value */
    double dy;   /* Uncertainty/error bar (0 = unspecified) */
} DataPoint;

/* ============================================================================
 * ERROR METRICS
 * 
 * Continuous metrics (for general use):
 *   ERROR_ABS     - Absolute error: |computed - target|
 *   ERROR_REL     - Relative error: |computed/target - 1|
 *   ERROR_MSE     - Mean Squared Error: Σ(y-ŷ)²/n
 *   ERROR_MAE     - Mean Absolute Error: Σ|y-ŷ|/n
 *   ERROR_MAX     - Maximum Absolute Error: max|y-ŷ|
 *
 * Discrete metrics (for exact matching):
 *   ERROR_ULP     - Units in Last Place distance
 *   ERROR_HAMMING - Hamming distance on IEEE 754 bits
 * ============================================================================ */

typedef enum {
    ERROR_ABS,
    ERROR_REL,
    ERROR_MSE,
    ERROR_MAE,
    ERROR_MAX,
    ERROR_ULP,
    ERROR_HAMMING
} ErrorMetric;

/* ============================================================================
 * COMPARE MODE
 * 
 * Controls whether to use strict (<) or non-strict (<=) comparison
 * when updating the best candidate:
 *
 *   COMPARE_STRICT - err < best_err (default, first best wins)
 *   COMPARE_EQUAL  - err <= best_err (list all equivalents)
 *
 * COMPARE_EQUAL is useful for:
 *   - Discrete metrics (ULP, Hamming) where ties are common
 *   - Listing equivalent formula variants
 * ============================================================================ */

typedef enum {
    COMPARE_STRICT,   /* err < best_err */
    COMPARE_EQUAL     /* err <= best_err */
} CompareMode;

/* ============================================================================
 * SEARCH MODE
 * ============================================================================ */

typedef enum {
    MODE_CONSTANT,    /* No variable x, single target value */
    MODE_FUNCTION     /* Variable x allowed in any/all constant slots */
} SearchMode;

/* ============================================================================
 * UTILITY MACRO
 * ============================================================================ */

#define ARRAY_SIZE(arr) (sizeof(arr) / sizeof((arr)[0]))

/* ============================================================================
 * CORE SEARCH FUNCTION
 * 
 * Unified search for both constant and function recognition.
 * 
 * Parameters:
 *   mode          - MODE_CONSTANT or MODE_FUNCTION
 *   data, n_data  - target data points (n_data=1 for constants)
 *   MinK, MaxK    - RPN code length range to search
 *   cpu_id, ncpus - parallel work distribution
 *   const_ops, n_const   - available constants
 *   unary_ops, n_unary   - available unary functions
 *   binary_ops, n_binary - available binary operators
 *   metric        - which error metric to use
 *   compare       - COMPARE_STRICT or COMPARE_EQUAL
 *
 * Returns:
 *   JSON string with results (caller must free)
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
    CompareMode compare);

/* ============================================================================
 * CONVENIENCE WRAPPERS
 * ============================================================================ */

/* Constant recognition - simpler interface */
char* search_constant(
    double target, double delta,
    int MinK, int MaxK,
    int cpu_id, int ncpus,
    const ConstOp* const_ops, int n_const,
    const UnaryOp* unary_ops, int n_unary,
    const BinaryOp* binary_ops, int n_binary,
    ErrorMetric metric,
    CompareMode compare);

/* Function recognition - direct call to core */
char* search_function(
    const DataPoint* data, int n_data,
    int MinK, int MaxK,
    int cpu_id, int ncpus,
    const ConstOp* const_ops, int n_const,
    const UnaryOp* unary_ops, int n_unary,
    const BinaryOp* binary_ops, int n_binary,
    ErrorMetric metric,
    CompareMode compare);

#endif /* VSEARCH_RPN_CORE_H */
