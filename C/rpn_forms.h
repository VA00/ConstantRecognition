/* rpn_forms.h - Enumeration of grammatical RPN ternary forms (header-only)
 *
 * Author: Andrzej Odrzywolek
 * Date: September 20, 2026
 * Code assist: Claude Fable 5.1
 *
 * A ternary form is the shape of an RPN code: digit 0 = constant (push),
 * 1 = unary function, 2 = binary operator. The form is grammatical when the
 * stack never underflows and holds exactly one value at the end. Their number
 * for length K is the Motzkin number M(K-1): 1, 1, 2, 4, 9, 21, 51, 127, 323,
 * 835, 2188, ... (OEIS A001006).
 *
 * Forms are identified by their base-3 value ("index") in [0, 3^K), most
 * significant digit first. Parallel chunking splits this index range, so a
 * chunk (cpu_id, ncpus) is the contiguous range
 *     [cpu_id * ceil(3^K / ncpus), min((cpu_id + 1) * ceil(3^K / ncpus), 3^K)).
 *
 * rpn_enumerate_forms() visits every grammatical form with index in
 * [start, end), in increasing index order, without constructing the
 * ungrammatical strings: a digit is appended only if the running stack depth
 * allows it (unary needs depth >= 1, binary needs depth >= 2), and a prefix is
 * abandoned as soon as the remaining digits cannot bring the depth back to 1.
 * The visited set and its order are identical to scanning all 3^K strings and
 * testing each with the same stack counter; only the cost differs, being
 * proportional to the number of grammatical forms instead of to 3^K. This
 * matters for small button sets at large K, where the Cartesian product over
 * buttons no longer dominates.
 *
 * State: one form of K digits, a depth counter and the recursion of depth K.
 */

#ifndef RPN_FORMS_H
#define RPN_FORMS_H

#include <stdint.h>

#define RPN_FORMS_MAX_K 40   /* 3^40 < 2^64 */

/* Called once per grammatical form. Return nonzero to stop the enumeration. */
typedef int (*RPNFormVisitor)(void* ctx, const char* form, int K, uint64_t index);

typedef struct {
    int K;
    uint64_t start, end;
    RPNFormVisitor visit;
    void* ctx;
    char form[RPN_FORMS_MAX_K];
    uint64_t pow3[RPN_FORMS_MAX_K + 1];
    uint64_t visited;
    uint64_t stopped_at;
    int stopped;
} RPNFormWalk;

static inline uint64_t rpn_pow3(int K) {
    uint64_t p = 1;
    for (int i = 0; i < K; i++) p *= 3;
    return p;
}

static inline void rpn_forms_walk(RPNFormWalk* w, int pos, int depth, uint64_t prefix) {
    int remaining = w->K - pos;
    uint64_t width = w->pow3[remaining];
    uint64_t lo = prefix * width;
    if (lo >= w->end || lo + width <= w->start) return;   /* subtree outside the chunk */
    if (depth > remaining + 1) return;                    /* cannot end at depth 1 */

    if (remaining == 0) {
        w->visited++;
        if (w->visit(w->ctx, w->form, w->K, prefix)) {
            w->stopped = 1;
            w->stopped_at = prefix;
        }
        return;
    }

    w->form[pos] = 0;                                     /* constant: always allowed */
    rpn_forms_walk(w, pos + 1, depth + 1, prefix * 3);
    if (w->stopped) return;
    if (depth >= 1) {                                     /* unary: needs one operand */
        w->form[pos] = 1;
        rpn_forms_walk(w, pos + 1, depth, prefix * 3 + 1);
        if (w->stopped) return;
    }
    if (depth >= 2) {                                     /* binary: needs two operands */
        w->form[pos] = 2;
        rpn_forms_walk(w, pos + 1, depth - 1, prefix * 3 + 2);
    }
}

/* Visits the grammatical forms of length K with index in [start, end).
 * Returns the number of forms visited. If the visitor stopped the walk,
 * *stopped_at receives the index of that form, otherwise UINT64_MAX. */
static inline uint64_t rpn_enumerate_forms(int K, uint64_t start, uint64_t end,
                                           RPNFormVisitor visit, void* ctx,
                                           uint64_t* stopped_at)
{
    RPNFormWalk w;
    w.K = K;
    w.start = start;
    w.end = end;
    w.visit = visit;
    w.ctx = ctx;
    w.visited = 0;
    w.stopped = 0;
    w.stopped_at = UINT64_MAX;
    w.pow3[0] = 1;
    for (int i = 1; i <= RPN_FORMS_MAX_K; i++) w.pow3[i] = w.pow3[i - 1] * 3;
    if (K >= 1 && K <= RPN_FORMS_MAX_K && start < end) rpn_forms_walk(&w, 0, 0, 0);
    if (stopped_at) *stopped_at = w.stopped_at;
    return w.visited;
}

#endif /* RPN_FORMS_H */
