/* vsearch_RPN_complex.h - Complex-domain constant recognition
 *
 * Author: Andrzej Odrzywolek
 * Date: September 19, 2026
 * Code assist: Claude Fable 5.1
 *
 * Complex counterpart of the MODE_CONSTANT path in vsearch_RPN_core.h.
 * Not available under MSVC (no C99 complex support).
 */

#ifndef VSEARCH_RPN_COMPLEX_H
#define VSEARCH_RPN_COMPLEX_H

#ifndef _MSC_VER

#include <complex.h>

/* ============================================================================
 * CALCULATOR OPERATION TYPES (complex)
 * ============================================================================ */

typedef struct {
    double complex value;
    const char* name;
} CConstOp;

typedef struct {
    double complex (*func)(double complex);
    const char* name;
} CUnaryOp;

typedef struct {
    double complex (*func)(double complex, double complex);
    const char* name;
} CBinaryOp;

/* ============================================================================
 * SEARCH
 *
 * Finds the shortest RPN code whose value matches `target`.
 *
 *   delta        - absolute uncertainty of the target; 0 means exact search
 *                  (match iff relative error <= 64 * DBL_EPSILON)
 *   MinK, MaxK   - RPN code length range
 *   cpu_id/ncpus - chunk of the linear structure index space [0, 3^K),
 *                  identical to the real engine
 *   cr_threshold - minimum compression ratio for a tolerance-based match
 *                  (only used when delta > 0)
 *
 * Returns a JSON string in the same format as the real engine, with extra
 * fields "domain":"COMPLEX", "target_im", and per-row "value_re"/"value_im".
 * Caller must free().
 * ============================================================================ */

char* search_constant_complex(
    double complex target, double delta,
    int MinK, int MaxK,
    int cpu_id, int ncpus,
    const CConstOp* const_ops, int n_const,
    const CUnaryOp* unary_ops, int n_unary,
    const CBinaryOp* binary_ops, int n_binary,
    double cr_threshold);

/* ============================================================================
 * EVALUATION
 *
 * Evaluates a comma-separated RPN code of button names, e.g.
 * "I, NEG, LOG, DIVIDE". Returns 1 on success and stores the value in
 * *result (possibly non-finite); returns 0 on an unknown token or a
 * syntactically invalid code.
 * ============================================================================ */

int evaluate_rpn_complex(
    const char* rpn,
    const CConstOp* const_ops, int n_const,
    const CUnaryOp* unary_ops, int n_unary,
    const CBinaryOp* binary_ops, int n_binary,
    double complex* result);

#endif /* !_MSC_VER */
#endif /* VSEARCH_RPN_COMPLEX_H */
