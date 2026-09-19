/* test_vsearch_complex.c - Tests for the complex-domain search engine
 *
 * Compilation:
 *   gcc -O2 -Wall test_vsearch_complex.c ../vsearch_RPN_complex.c -lm -o test_complex
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>
#include <complex.h>

#include "../vsearch_RPN_complex.h"
#include "../CALC4C.h"

static int failures = 0;

#define CHECK(cond, ...) do { \
    if (cond) { printf("[PASS] " __VA_ARGS__); printf("\n"); } \
    else      { printf("[FAIL] " __VA_ARGS__); printf("\n"); failures++; } \
} while (0)

/* Build a calculator from CALC4C minus a list of excluded names */
static int select_consts(CConstOp* out, const char* const* exclude, int n_exclude, int include_extras) {
    int n = 0;
    for (int i = 0; i < CALC4C_N_CONST; i++) {
        int skip = (!include_extras && i >= CALC4C_N_CORE_CONST);
        for (int j = 0; j < n_exclude && !skip; j++)
            if (strcmp(CALC4C_CONSTS[i].name, exclude[j]) == 0) skip = 1;
        if (!skip) out[n++] = CALC4C_CONSTS[i];
    }
    return n;
}

static int select_funcs(CUnaryOp* out, const char* const* exclude, int n_exclude) {
    int n = 0;
    for (int i = 0; i < CALC4C_N_UNARY; i++) {
        int skip = 0;
        for (int j = 0; j < n_exclude && !skip; j++)
            if (strcmp(CALC4C_FUNCS[i].name, exclude[j]) == 0) skip = 1;
        if (!skip) out[n++] = CALC4C_FUNCS[i];
    }
    return n;
}

/* The final summary is the LAST occurrence of these keys */
static double json_final_number(const char* json, const char* key) {
    char pattern[64];
    snprintf(pattern, sizeof(pattern), "\"%s\":", key);
    const char* last = NULL;
    for (const char* p = strstr(json, pattern); p; p = strstr(p + 1, pattern)) last = p;
    if (!last) return NAN;
    return atof(last + strlen(pattern));
}

/* RPN of the final summary (last "RPN" key in the document) */
static void final_rpn(const char* json, char* out, int out_size) {
    const char* pattern = "\"RPN\":\"";
    const char* last = NULL;
    for (const char* p = strstr(json, pattern); p; p = strstr(p + 1, pattern)) last = p;
    out[0] = '\0';
    if (!last) return;
    const char* start = last + strlen(pattern);
    const char* q = strchr(start, '"');
    int len = q ? (int)(q - start) : 0;
    if (len >= out_size) len = out_size - 1;
    memcpy(out, start, len);
    out[len] = '\0';
}

static void test_gamma(void) {
    double complex z = 1.3 + 0.7 * I;
    double complex lhs = c_gamma(z + 1.0);
    double complex rhs = z * c_gamma(z);
    double rel = cabs(lhs - rhs) / cabs(rhs);
    CHECK(rel < 1e-13, "Gamma(z+1) = z Gamma(z), rel. err %.2e", rel);

    z = 0.3 + 0.2 * I;   /* exercises the reflection branch */
    lhs = c_gamma(z) * c_gamma(1.0 - z);
    rhs = M_PI / csin(M_PI * z);
    rel = cabs(lhs - rhs) / cabs(rhs);
    CHECK(rel < 1e-13, "Gamma(z) Gamma(1-z) = pi/sin(pi z), rel. err %.2e", rel);

    /* Gamma(1+i), reference from Mathematica N[Gamma[1+I], 20] */
    double complex ref = 0.49801566811835604271 - 0.15494982830181068512 * I;
    double complex g = c_gamma(1.0 + 1.0 * I);
    rel = cabs(g - ref) / cabs(ref);
    CHECK(rel < 1e-13, "Gamma(1+i) matches reference, rel. err %.2e", rel);

    double gr = creal(c_gamma(0.5));
    CHECK(fabs(gr - sqrt(M_PI)) < 1e-15, "Gamma(1/2) = sqrt(pi) via real path");
}

static void test_evaluate(void) {
    double complex v;
    int ok = evaluate_rpn_complex("I, NEG, LOG, DIVIDE",
        CALC4C_CONSTS, CALC4C_N_CONST, CALC4C_FUNCS, CALC4C_N_UNARY, CALC4C_OPS, CALC4C_N_BINARY, &v);
    CHECK(ok && cabs(v - M_PI) < 1e-15, "I, NEG, LOG, DIVIDE = log(-1)/i = pi  (got %.17g%+.3gi)", creal(v), cimag(v));

    ok = evaluate_rpn_complex("ONE, TWO, SUBTRACT",
        CALC4C_CONSTS, CALC4C_N_CONST, CALC4C_FUNCS, CALC4C_N_UNARY, CALC4C_OPS, CALC4C_N_BINARY, &v);
    CHECK(ok && creal(v) == 1.0 && cimag(v) == 0.0, "ONE, TWO, SUBTRACT = 2 - 1 (top minus second)");

    ok = evaluate_rpn_complex("NEG, SQRT",
        CALC4C_CONSTS, CALC4C_N_CONST, CALC4C_FUNCS, CALC4C_N_UNARY, CALC4C_OPS, CALC4C_N_BINARY, &v);
    CHECK(ok && creal(v) == 0.0 && cimag(v) == 1.0, "NEG, SQRT = i");

    ok = evaluate_rpn_complex("CATALAN, SQR, GAMMA",
        CALC4C_CONSTS, CALC4C_N_CONST, CALC4C_FUNCS, CALC4C_N_UNARY, CALC4C_OPS, CALC4C_N_BINARY, &v);
    CHECK(ok && fabs(creal(v) - tgamma(CATALAN_VALUE * CATALAN_VALUE)) < 1e-15, "extra constants resolve by name");

    ok = evaluate_rpn_complex("EIGHT, TWO, LOGARITHM",
        CALC4C_CONSTS, CALC4C_N_CONST, CALC4C_FUNCS, CALC4C_N_UNARY, CALC4C_OPS, CALC4C_N_BINARY, &v);
    CHECK(ok && fabs(creal(v) - 3.0) < 1e-15 && cimag(v) == 0.0, "EIGHT, TWO, LOGARITHM = log_2(8) = 3 (base pushed last)");

    ok = evaluate_rpn_complex("I, MINUS, SQR",
        CALC4C_CONSTS, CALC4C_N_CONST, CALC4C_FUNCS, CALC4C_N_UNARY, CALC4C_OPS, CALC4C_N_BINARY, &v);
    CHECK(ok && creal(v) == -1.0 && cimag(v) == 0.0, "I, MINUS, SQR = (-i)^2 = -1");

    ok = evaluate_rpn_complex("ZERO, LOG",
        CALC4C_CONSTS, CALC4C_N_CONST, CALC4C_FUNCS, CALC4C_N_UNARY, CALC4C_OPS, CALC4C_N_BINARY, &v);
    CHECK(ok && isinf(creal(v)) && creal(v) < 0, "ZERO, LOG = -inf (evaluation reports non-finite values)");

    ok = evaluate_rpn_complex("ONE, PLUS",
        CALC4C_CONSTS, CALC4C_N_CONST, CALC4C_FUNCS, CALC4C_N_UNARY, CALC4C_OPS, CALC4C_N_BINARY, &v);
    CHECK(!ok, "stack underflow is rejected");

    ok = evaluate_rpn_complex("ONE, BOGUS",
        CALC4C_CONSTS, CALC4C_N_CONST, CALC4C_FUNCS, CALC4C_N_UNARY, CALC4C_OPS, CALC4C_N_BINARY, &v);
    CHECK(!ok, "unknown token is rejected");
}

static void test_search_nine(void) {
    const char* excl[] = { "NINE" };
    CConstOp consts[64];
    int nc = select_consts(consts, excl, 1, 0);
    char* json = search_constant_complex(9.0, 0.0, 1, 4, 0, 1,
        consts, nc, CALC4C_FUNCS, CALC4C_N_UNARY, CALC4C_OPS, CALC4C_N_BINARY, 0.0);
    char rpn[256];
    final_rpn(json, rpn, sizeof(rpn));
    int K = (int)json_final_number(json, "K");
    CHECK(strstr(json, "\"result\":\"SUCCESS\"") && K == 2 && strcmp(rpn, "THREE, SQR") == 0,
          "9 without NINE -> %s (K=%d)", rpn, K);
    free(json);
}

static void test_search_pi_complex(void) {
    /* Remove PI and every trig / inverse trig function: pi is then reachable
       only through the complex plane, e.g. log(-1)/i */
    const char* excl_c[] = { "PI" };
    const char* excl_f[] = { "SIN", "ARCSIN", "COS", "ARCCOS", "TAN", "ARCTAN", "GAMMA" };
    CConstOp consts[64];
    CUnaryOp funcs[64];
    int nc = select_consts(consts, excl_c, 1, 1);
    int nu = select_funcs(funcs, excl_f, 7);
    char* json = search_constant_complex(M_PI, 0.0, 1, 4, 0, 1,
        consts, nc, funcs, nu, CALC4C_OPS, CALC4C_N_BINARY, 0.0);
    char rpn[256];
    final_rpn(json, rpn, sizeof(rpn));
    int K = (int)json_final_number(json, "K");
    double re = json_final_number(json, "value_re");
    double im = json_final_number(json, "value_im");
    CHECK(strstr(json, "\"result\":\"SUCCESS\"") && K <= 4 && fabs(re - M_PI) < 1e-14 && fabs(im) < 1e-14,
          "pi without PI and trig -> %s (K=%d, value %.17g%+.2gi)", rpn, K, re, im);
    CHECK(strstr(rpn, "I") != NULL || strstr(rpn, "NEG") != NULL, "formula for pi uses the complex plane");
    free(json);
}

static void test_search_sqrt_witness(void) {
    /* Remove SQRT; ask for Sqrt[Catalan] with CATALAN as a button */
    const char* excl_f[] = { "SQRT", "GAMMA" };
    CUnaryOp funcs[64];
    int nu = select_funcs(funcs, excl_f, 2);
    double complex target = csqrt(CATALAN_VALUE + 0.0 * I);
    char* json = search_constant_complex(target, 0.0, 1, 5, 0, 1,
        CALC4C_CONSTS, CALC4C_N_CONST, funcs, nu, CALC4C_OPS, CALC4C_N_BINARY, 0.0);
    char rpn[256];
    final_rpn(json, rpn, sizeof(rpn));
    int K = (int)json_final_number(json, "K");
    CHECK(strstr(json, "\"result\":\"SUCCESS\"") && strstr(rpn, "CATALAN") != NULL,
          "Sqrt[Catalan] without SQRT -> %s (K=%d)", rpn, K);
    free(json);
}

static void test_search_complex_target(void) {
    /* Target 1 + i: shortest is e.g. I, ONE, PLUS (K=3) or NEG, SQRT, ONE, PLUS */
    const char* excl_f[] = { "GAMMA" };
    CUnaryOp funcs[64];
    int nu = select_funcs(funcs, excl_f, 1);
    char* json = search_constant_complex(1.0 + 1.0 * I, 0.0, 1, 4, 0, 1,
        CALC4C_CONSTS, CALC4C_N_CONST, funcs, nu, CALC4C_OPS, CALC4C_N_BINARY, 0.0);
    char rpn[256];
    final_rpn(json, rpn, sizeof(rpn));
    int K = (int)json_final_number(json, "K");
    double re = json_final_number(json, "value_re");
    double im = json_final_number(json, "value_im");
    CHECK(strstr(json, "\"result\":\"SUCCESS\"") && K == 3 && fabs(re - 1.0) < 1e-15 && fabs(im - 1.0) < 1e-15,
          "1+i -> %s (K=%d)", rpn, K);
    free(json);
}

static void test_chunk_coverage(void) {
    /* The union of all chunks must visit every valid structure exactly once:
       Motzkin numbers 1,1,2,4,9,21,51 for K=1..7 sum to 89 */
    const int ncpus = 7;
    unsigned long long total_valid = 0, total_evals = 0;
    for (int cpu = 0; cpu < ncpus; cpu++) {
        char* json = search_constant_complex(123456.789 + 0.5 * I, 0.0, 1, 7, cpu, ncpus,
            CALC4C_CONSTS, 3, CALC4C_FUNCS, 2, CALC4C_OPS, 2, 0.0);   /* tiny calculator */
        total_valid += (unsigned long long)json_final_number(json, "valid_ternary");
        total_evals += (unsigned long long)json_final_number(json, "evaluations");
        free(json);
    }
    CHECK(total_valid == 89, "chunks cover all valid structures once (%llu / 89)", total_valid);

    /* Single chunk must agree with the union */
    char* json = search_constant_complex(123456.789 + 0.5 * I, 0.0, 1, 7, 0, 1,
        CALC4C_CONSTS, 3, CALC4C_FUNCS, 2, CALC4C_OPS, 2, 0.0);
    unsigned long long single_evals = (unsigned long long)json_final_number(json, "evaluations");
    free(json);
    CHECK(single_evals == total_evals, "evaluation count independent of chunking (%llu vs %llu)", single_evals, total_evals);
}

static void test_nonfinite_propagation(void) {
    /* Same rule as the real engine: NaN and infinities propagate, only the
       final value must be finite. exp(exp(9)) = +inf and atan(+inf) = pi/2,
       so {NINE} x {EXP, ARCTAN} reaches pi/2 at K=4 through the infinity. */
    CConstOp consts[1] = { { 9.0, "NINE" } };
    CUnaryOp funcs[2] = { { c_exp, "EXP" }, { c_atan, "ARCTAN" } };
    char* json = search_constant_complex(M_PI / 2.0, 0.0, 1, 5, 0, 1,
        consts, 1, funcs, 2, CALC4C_OPS, 0, 0.0);
    char rpn[256];
    final_rpn(json, rpn, sizeof(rpn));
    CHECK(strstr(json, "\"result\":\"SUCCESS\"") && strcmp(rpn, "NINE, EXP, EXP, ARCTAN") == 0,
          "infinities propagate like the real engine: pi/2 = %s", rpn);
    free(json);

    /* exp(log(0)) = 0 with {ZERO} x {LOG, EXP}: -inf as an intermediate is fine */
    CConstOp zero[1] = { { 0.0, "ZERO" } };
    CUnaryOp lf[2] = { { c_log, "LOG" }, { c_exp, "EXP" } };
    json = search_constant_complex(0.0, 0.0, 3, 3, 0, 1, zero, 1, lf, 2, CALC4C_OPS, 0, 0.0);
    final_rpn(json, rpn, sizeof(rpn));
    CHECK(strstr(json, "\"result\":\"SUCCESS\"") && strcmp(rpn, "ZERO, LOG, EXP") == 0,
          "exp(log 0) = 0 is accepted: %s", rpn);
    free(json);
}

static void test_tolerance(void) {
    /* 3.1416 with delta 5e-5: PI (K=1) is within tolerance and has CR above threshold */
    const char* excl_f[] = { "GAMMA" };
    CUnaryOp funcs[64];
    int nu = select_funcs(funcs, excl_f, 1);
    char* json = search_constant_complex(3.1416, 5e-5, 1, 3, 0, 1,
        CALC4C_CONSTS, CALC4C_N_CORE_CONST, funcs, nu, CALC4C_OPS, CALC4C_N_BINARY, 1.0);
    char rpn[256];
    final_rpn(json, rpn, sizeof(rpn));
    CHECK(strstr(json, "\"result\":\"SUCCESS\"") && strcmp(rpn, "PI") == 0, "3.1416 +- 5e-5 -> %s", rpn);
    free(json);
}

int main(void) {
    printf("=== Complex-domain search tests ===\n");
    test_gamma();
    test_evaluate();
    test_search_nine();
    test_search_pi_complex();
    test_search_sqrt_witness();
    test_search_complex_target();
    test_chunk_coverage();
    test_nonfinite_propagation();
    test_tolerance();
    printf("===================================\n");
    if (failures) { printf("%d test(s) FAILED\n", failures); return 1; }
    printf("All tests passed\n");
    return 0;
}
