/* vsearch_RPN_core.h - Core search function and types
 * 
 * Author: Andrzej Odrzywolek
 * Date: December 28, 2025
 *
 * The core search function accepts function pointer arrays.
 * It knows NOTHING about specific calculators (CALC4, etc.)
 */

#ifndef VSEARCH_RPN_CORE_H
#define VSEARCH_RPN_CORE_H

/* ============================================================================
 * CORE TYPES - Used by vsearch_RPN_core()
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
 * ARRAY SIZE MACRO - Use in calculator definition headers
 * ============================================================================ */

#define ARRAY_SIZE(arr) (sizeof(arr) / sizeof((arr)[0]))

/* ============================================================================
 * CORE SEARCH FUNCTION
 * 
 * Parameters:
 *   z, dz         - target value and uncertainty
 *   MinK, MaxK    - code length range
 *   cpu_id, ncpus - parallel execution parameters
 *   const_ops     - array of constants
 *   n_const       - number of constants
 *   unary_ops     - array of unary functions
 *   n_unary       - number of unary functions
 *   binary_ops    - array of binary operators
 *   n_binary      - number of binary operators
 *
 * Returns:
 *   JSON string (caller must free)
 * ============================================================================ */

char* vsearch_RPN_core(
    double z, double dz,
    int MinK, int MaxK,
    int cpu_id, int ncpus,
    const ConstOp* const_ops, int n_const,
    const UnaryOp* unary_ops, int n_unary,
    const BinaryOp* binary_ops, int n_binary
);

#endif /* VSEARCH_RPN_CORE_H */
