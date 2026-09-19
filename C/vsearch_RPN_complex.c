/* vsearch_RPN_complex.c - Complex-domain constant recognition
 *
 * Author: Andrzej Odrzywolek, andrzej.odrzywolek@uj.edu.pl
 * Date: September 19, 2026
 * Code assist: Claude Fable 5.1
 *
 * Complex counterpart of vsearch_RPN_core.c, restricted to single-constant
 * recognition (MODE_CONSTANT). Differences from the real engine:
 *
 *   - Values are double complex; the error is |computed/target - 1|, the
 *     modulus of the complex relative error.
 *
 *   - Ternary forms come from rpn_enumerate_forms() (rpn_forms.h), shared
 *     with the real engine.
 *
 *   - Expressions are evaluated incrementally: the partial stack after
 *     position i is reused for every completion of positions i+1..K-1, so a
 *     leaf costs one function call rather than K.
 *
 *   - NaN and infinities propagate through intermediate values exactly as in
 *     the real engine; only a non-finite FINAL value is rejected. Both engines
 *     therefore evaluate the identical set of candidates.
 *
 *   - Every JSON row carries the computed value ("value_re", "value_im") so
 *     the frontend needs no complex arithmetic of its own.
 *
 * Memory: the search is memoryless like the real engine. The whole state is
 * the current ternary form (K bytes), the current button indices (K ints),
 * one evaluation stack of K complex values and a copy of the best code so
 * far; nothing is tabulated, hashed or memoized, and the hot loop does not
 * allocate. Only the 1 MiB JSON output buffer is malloc()ed, as before.
 *
 * The chunking convention (cpu_id, ncpus over the linear index space
 * [0, 3^K)), the binary-operator argument order f(top, second) and the RPN
 * text format are identical to the real engine, so the existing task queue
 * and RPN parsers work unchanged.
 *
 * Compilation (native test):
 *   gcc -O2 -Wall test/test_vsearch_complex.c vsearch_RPN_complex.c -lm
 */

#ifndef _MSC_VER

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <math.h>
#include <float.h>
#include <complex.h>

#include "vsearch_RPN_complex.h"
#include "rpn_forms.h"

/* ============================================================================
 * CONFIGURATION
 * ============================================================================ */

#define MAX_CODE_LENGTH   32
#define JSON_BUFFER_SIZE  (1024 * 1024)
#define JSON_ROW_RESERVE  1024      /* stop appending rows when less remains */
#define EPS_MAX           64        /* relative error accepted as exact, in DBL_EPSILON */

#define MIN(a, b) ((a) < (b) ? (a) : (b))

static const char BUILD_TIMESTAMP[] = __DATE__ " " __TIME__;

/* ============================================================================
 * SEARCH STATE
 * ============================================================================ */

typedef struct {
    /* problem */
    double complex target;
    double target_abs2;          /* |target|^2 */
    double delta;
    double cr_threshold;
    double exact_err2;           /* squared relative error accepted as exact */

    /* calculator */
    const CConstOp*  const_ops;  int n_const;
    const CUnaryOp*  unary_ops;  int n_unary;
    const CBinaryOp* binary_ops; int n_binary;
    int n_total;

    /* current level */
    int  K;
    char ternary[MAX_CODE_LENGTH];
    int  indices[MAX_CODE_LENGTH];

    /* best candidate so far */
    int found;
    int stop;
    double best_err2;
    double complex best_value;
    int  best_K;
    int  best_indices[MAX_CODE_LENGTH];
    char best_ternary[MAX_CODE_LENGTH];

    /* output */
    int cpu_id;
    char* json_ptr;
    int json_remaining;
    int result_count;
    uint64_t valid_ternary;
    uint64_t evaluations;
} CSearchState;

static inline int cfinite(double complex z) {
    return isfinite(creal(z)) && isfinite(cimag(z));
}

static inline double cnorm2(double complex z) {
    double re = creal(z), im = cimag(z);
    return re * re + im * im;
}

/* ============================================================================
 * CODE FORMATTING: "PI, EULER, PLUS"
 * ============================================================================ */

static void format_code(const CSearchState* st, const char* ternary, const int* indices,
                        int K, char* out, int out_size) {
    int pos = 0;
    for (int i = 0; i < K; i++) {
        const char* name = NULL;
        switch (ternary[i]) {
            case 0: name = st->const_ops[indices[i]].name;  break;
            case 1: name = st->unary_ops[indices[i]].name;  break;
            case 2: name = st->binary_ops[indices[i]].name; break;
        }
        if (!name) continue;
        int len = (int)strlen(name);
        if (pos + len + 3 >= out_size) break;
        if (i > 0) { out[pos++] = ','; out[pos++] = ' '; }
        memcpy(out + pos, name, len);
        pos += len;
    }
    out[pos] = '\0';
}

/* ============================================================================
 * JSON ROWS
 * ============================================================================ */

static void json_append(CSearchState* st, const char* text) {
    int w = snprintf(st->json_ptr, st->json_remaining, "%s", text);
    if (w < 0 || w >= st->json_remaining) return;
    st->json_ptr += w;
    st->json_remaining -= w;
}

static void json_row(CSearchState* st, const char* result, int K, double err,
                     double complex value, const char* code) {
    if (st->json_remaining < JSON_ROW_RESERVE) return;
    if (st->result_count > 0) json_append(st, ",\n");
    int w = snprintf(st->json_ptr, st->json_remaining,
        "{"
        "\"K\":%d, "
        "\"REL_ERR\":%.5e, "
        "\"result\":\"%s\", "
        "\"status\":\"RUNNING\", "
        "\"cpuId\":%d, "
        "\"value_re\":%.17g, "
        "\"value_im\":%.17g, "
        "\"RPN\":\"%s\""
        "}",
        K, err, result, st->cpu_id, creal(value), cimag(value), code);
    if (w < 0 || w >= st->json_remaining) return;
    st->json_ptr += w;
    st->json_remaining -= w;
    st->result_count++;
}

/* ============================================================================
 * LEAF: compare a fully evaluated expression with the target
 * ============================================================================ */

static inline void check_leaf(CSearchState* st, double complex v) {
    st->evaluations++;
    if (!cfinite(v)) return;   /* same rule as the real engine: only the final value must be finite */

    double err2 = (st->target_abs2 == 0.0) ? cnorm2(v)
                                           : cnorm2(v - st->target) / st->target_abs2;

    if (err2 < st->best_err2) {
        st->best_err2 = err2;
        st->best_value = v;
        st->best_K = st->K;
        memcpy(st->best_ternary, st->ternary, st->K);
        memcpy(st->best_indices, st->indices, st->K * sizeof(int));

        char code[512];
        format_code(st, st->ternary, st->indices, st->K, code, sizeof(code));
        json_row(st, "INTERMEDIATE", st->K, sqrt(err2), v, code);
    }

    int exact = (err2 <= st->exact_err2);
    if (!exact && st->delta > 0.0 && cnorm2(v - st->target) <= 4.0 * st->delta * st->delta) {
        double err = sqrt(err2);
        double compression = (err > 0.0)
            ? -log10(err) / (st->K * log10((double)st->n_total))
            : 10.0;
        if (compression >= st->cr_threshold) exact = 1;
    }
    if (exact) {
        st->found = 1;
        st->stop = 1;
    }
}

/* ============================================================================
 * LEAF ASSIGNMENT: recursive generator with incremental stack evaluation
 *
 * Invariant: generate(pos, stack, sp) returns with stack[0..sp-1] unchanged.
 * ============================================================================ */

static void generate(CSearchState* st, int pos, double complex* stack, int sp) {
    if (pos == st->K) {
        check_leaf(st, stack[0]);
        return;
    }

    switch (st->ternary[pos]) {
        case 0:  /* constant: push */
            for (int i = 0; i < st->n_const && !st->stop; i++) {
                st->indices[pos] = i;
                stack[sp] = st->const_ops[i].value;
                generate(st, pos + 1, stack, sp + 1);
            }
            break;

        case 1: {  /* unary: replace top */
            double complex x = stack[sp - 1];
            for (int i = 0; i < st->n_unary && !st->stop; i++) {
                st->indices[pos] = i;
                stack[sp - 1] = st->unary_ops[i].func(x);
                generate(st, pos + 1, stack, sp);
            }
            stack[sp - 1] = x;
            break;
        }

        case 2: {  /* binary: f(top, second) replaces both */
            double complex b = stack[sp - 1];
            double complex a = stack[sp - 2];
            for (int i = 0; i < st->n_binary && !st->stop; i++) {
                st->indices[pos] = i;
                stack[sp - 2] = st->binary_ops[i].func(b, a);
                generate(st, pos + 1, stack, sp - 1);
            }
            stack[sp - 2] = a;
            stack[sp - 1] = b;
            break;
        }
    }
}

/* ============================================================================
 * FORM VISITOR: one grammatical ternary form -> all button assignments
 * (forms come from rpn_enumerate_forms() in rpn_forms.h)
 * ============================================================================ */

static int visit_form(void* ctx, const char* form, int K, uint64_t index) {
    CSearchState* st = (CSearchState*)ctx;
    (void)index;
    st->valid_ternary++;
    memcpy(st->ternary, form, K);
    double complex stack[MAX_CODE_LENGTH];
    generate(st, 0, stack, 0);
    return st->stop;
}

/* ============================================================================
 * SEARCH
 * ============================================================================ */

char* search_constant_complex(
    double complex target, double delta,
    int MinK, int MaxK,
    int cpu_id, int ncpus,
    const CConstOp* const_ops, int n_const,
    const CUnaryOp* unary_ops, int n_unary,
    const CBinaryOp* binary_ops, int n_binary,
    double cr_threshold)
{
    char* json_output = (char*)malloc(JSON_BUFFER_SIZE);
    if (!json_output) return strdup("{\"error\":\"Memory allocation failed\"}");

    if (MinK < 1) MinK = 1;
    if (MaxK > MAX_CODE_LENGTH) MaxK = MAX_CODE_LENGTH;
    if (ncpus < 1) ncpus = 1;
    if (delta < 0.0) delta = 0.0;

    CSearchState st;
    memset(&st, 0, sizeof(st));
    st.target = target;
    st.target_abs2 = cnorm2(target);
    st.delta = delta;
    st.cr_threshold = cr_threshold;
    st.exact_err2 = (EPS_MAX * DBL_EPSILON) * (EPS_MAX * DBL_EPSILON);
    st.const_ops = const_ops;   st.n_const = n_const;
    st.unary_ops = unary_ops;   st.n_unary = n_unary;
    st.binary_ops = binary_ops; st.n_binary = n_binary;
    st.n_total = n_const + n_unary + n_binary;
    st.best_err2 = DBL_MAX;
    st.best_K = 0;
    st.cpu_id = cpu_id;
    st.json_ptr = json_output;
    st.json_remaining = JSON_BUFFER_SIZE;

    int w = snprintf(st.json_ptr, st.json_remaining,
        "{\n"
        "\"buildTime\": \"%s\",\n"
        "\"mode\": \"CONSTANT\",\n"
        "\"domain\": \"COMPLEX\",\n"
        "\"metric\": \"REL\",\n"
        "\"compare\": \"STRICT\",\n"
        "\"n_data\": 1,\n"
        "\"target\": %.17g,\n"
        "\"target_im\": %.17g,\n"
        "\"delta\": %.17g,\n"
        "\"num_to_find\": 1,\n"
        "\"cpuId\": %d,\n"
        "\"ncpus\": %d,\n"
        "\"minK\": %d,\n"
        "\"maxK\": %d,\n"
        "\"n_const\": %d,\n"
        "\"n_unary\": %d,\n"
        "\"n_binary\": %d,\n"
        "\"n_total\": %d,\n"
        "\"results\": [\n",
        BUILD_TIMESTAMP, creal(target), cimag(target), delta,
        cpu_id, ncpus, MinK, MaxK,
        n_const, n_unary, n_binary, st.n_total);
    st.json_ptr += w;
    st.json_remaining -= w;

    for (int K = MinK; K <= MaxK && !st.stop; K++) {
        st.K = K;
        uint64_t n_ternary = rpn_pow3(K);
        uint64_t chunk = (n_ternary + ncpus - 1) / ncpus;
        uint64_t start = (uint64_t)cpu_id * chunk;
        uint64_t end = MIN(start + chunk, n_ternary);
        rpn_enumerate_forms(K, start, end, visit_form, &st, NULL);

        /* Best of the level so far (same role as K_BEST in the real engine) */
        if (!st.stop && st.best_K > 0) {
            char code[512];
            format_code(&st, st.best_ternary, st.best_indices, st.best_K, code, sizeof(code));
            json_row(&st, "K_BEST", K, sqrt(st.best_err2), st.best_value, code);
        }
    }

    /* Finalize */
    char final_code[512];
    format_code(&st, st.best_ternary, st.best_indices, st.best_K, final_code, sizeof(final_code));
    double best_err = (st.best_K > 0) ? sqrt(st.best_err2) : DBL_MAX;

    double compression = 0.0;
    if (st.target_abs2 > 0.0 && st.best_K > 0) {
        double informationInRPN = st.best_K * log10((double)st.n_total);
        if (informationInRPN > 0.0) {
            if (best_err == 0.0) {
                double digitsInTarget = floor(log10(sqrt(st.target_abs2))) + 1.0;
                compression = digitsInTarget / informationInRPN;
            } else if (best_err < 1.0) {
                compression = -log10(best_err) / informationInRPN;
            }
        }
    }

    w = snprintf(st.json_ptr, st.json_remaining,
        "],\n \"result\":\"%s\", \"RPN\":\"%s\", \"REL_ERR\":%.17e, "
        "\"INPUT_ABS_ERR\":%.17g, \"COMPRESSION_RATIO\":%lf, \"K\":%d, "
        "\"status\":\"FINISHED\", "
        "\"value_re\":%.17g, \"value_im\":%.17g, "
        "\"num_found\":%d, \"num_not_found\":%d, "
        "\"valid_ternary\":%llu, \"evaluations\":%llu}",
        st.found ? "SUCCESS" : "FAILURE", final_code, best_err,
        delta, compression, st.best_K,
        creal(st.best_value), cimag(st.best_value),
        st.found ? 1 : 0, st.found ? 0 : 1,
        (unsigned long long)st.valid_ternary,
        (unsigned long long)st.evaluations);
    (void)w;

    return json_output;
}

/* ============================================================================
 * EVALUATION OF A NAMED RPN CODE
 * ============================================================================ */

int evaluate_rpn_complex(
    const char* rpn,
    const CConstOp* const_ops, int n_const,
    const CUnaryOp* unary_ops, int n_unary,
    const CBinaryOp* binary_ops, int n_binary,
    double complex* result)
{
    double complex stack[MAX_CODE_LENGTH];
    int sp = 0;
    const char* p = rpn;

    while (*p) {
        while (*p == ' ' || *p == ',' || *p == '\t' || *p == '\n') p++;
        if (!*p) break;
        const char* q = p;
        while (*q && *q != ' ' && *q != ',' && *q != '\t' && *q != '\n') q++;
        size_t len = (size_t)(q - p);
        p = q;

        int matched = 0;
        for (int i = 0; i < n_const && !matched; i++) {
            if (strlen(const_ops[i].name) == len && strncmp(const_ops[i].name, q - len, len) == 0) {
                if (sp >= MAX_CODE_LENGTH) return 0;
                stack[sp++] = const_ops[i].value;
                matched = 1;
            }
        }
        for (int i = 0; i < n_unary && !matched; i++) {
            if (strlen(unary_ops[i].name) == len && strncmp(unary_ops[i].name, q - len, len) == 0) {
                if (sp < 1) return 0;
                stack[sp - 1] = unary_ops[i].func(stack[sp - 1]);
                matched = 1;
            }
        }
        for (int i = 0; i < n_binary && !matched; i++) {
            if (strlen(binary_ops[i].name) == len && strncmp(binary_ops[i].name, q - len, len) == 0) {
                if (sp < 2) return 0;
                double complex b = stack[sp - 1];
                double complex a = stack[sp - 2];
                stack[sp - 2] = binary_ops[i].func(b, a);
                sp--;
                matched = 1;
            }
        }
        if (!matched) return 0;
    }

    if (sp != 1) return 0;
    *result = stack[0];
    return 1;
}

#endif /* !_MSC_VER */
