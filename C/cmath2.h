/* cmath2.h - Complex-domain calculator functions (header-only)
 *
 * Author: Andrzej Odrzywolek
 * Date: September 19, 2026
 * Code assist: Claude Fable 5.1
 *
 * Wrappers around <complex.h> used by CALC4C.h. Every function takes and
 * returns double complex, so all of them fit the CUnaryOp / CBinaryOp
 * function-pointer types of vsearch_RPN_complex.h.
 *
 * When the argument is real and the real-valued result is defined, the real
 * libm function is used instead of the C99 complex one. This is faster and,
 * for several musl/emscripten complex functions (casin, cacos, catanh, cpow),
 * noticeably more accurate. In a brute-force search most intermediate values
 * are real, so this path dominates.
 *
 * Multiplication and division use the plain textbook formulas. Clang's
 * default __muldc3/__divdc3 helpers recover infinities correctly, but the
 * search engine discards any non-finite intermediate value anyway, so the
 * extra cost buys nothing here.
 */

#ifndef CMATH2_H
#define CMATH2_H

#ifndef _MSC_VER   /* MSVC has no C99 complex support */

#define _USE_MATH_DEFINES
#include <math.h>
#include <complex.h>

static inline int c_is_real(double complex z) { return cimag(z) == 0.0; }

static inline double complex c_mul(double complex a, double complex b) {
    double ar = creal(a), ai = cimag(a), br = creal(b), bi = cimag(b);
    return CMPLX(ar * br - ai * bi, ar * bi + ai * br);
}

static inline double complex c_div(double complex a, double complex b) {
    double ar = creal(a), ai = cimag(a), br = creal(b), bi = cimag(b);
    double d = br * br + bi * bi;
    return CMPLX((ar * br + ai * bi) / d, (ai * br - ar * bi) / d);
}

/* ============================================================================
 * COMPLEX GAMMA
 *
 * Lanczos approximation (g = 7, n = 9), with the reflection formula for
 * Re(z) < 1/2. Relative accuracy is about 1e-15 in the complex plane; real
 * arguments are routed to tgamma() which is more accurate still.
 * ============================================================================ */

static inline double complex cgamma_lanczos(double complex z) {
    static const double c[9] = {
         0.99999999999980993,
       676.5203681218851,
     -1259.1392167224028,
       771.32342877765313,
      -176.61502916214059,
        12.507343278686905,
        -0.13857109526572012,
         9.9843695780195716e-6,
         1.5056327351493116e-7
    };
    if (creal(z) < 0.5) {
        /* Gamma(z) Gamma(1-z) = pi / sin(pi z) */
        double complex s = csin(M_PI * z);
        return c_div(M_PI, c_mul(s, cgamma_lanczos(1.0 - z)));
    }
    z -= 1.0;
    double complex x = c[0];
    for (int i = 1; i < 9; i++) x += c_div(c[i], z + (double)i);
    double complex t = z + 7.5;
    return c_mul(c_mul(sqrt(2.0 * M_PI) * cpow(t, z + 0.5), cexp(-t)), x);
}

/* ============================================================================
 * UNARY FUNCTIONS (CALC4 names)
 * ============================================================================ */

static inline double complex c_log(double complex z) {
    return (c_is_real(z) && creal(z) > 0.0) ? log(creal(z)) : clog(z);
}
static inline double complex c_exp(double complex z) {
    return c_is_real(z) ? exp(creal(z)) : cexp(z);
}
static inline double complex c_inv(double complex z) {
    return c_is_real(z) ? 1.0 / creal(z) : c_div(1.0, z);
}
static inline double complex c_gamma(double complex z) {
    return c_is_real(z) ? tgamma(creal(z)) : cgamma_lanczos(z);
}
static inline double complex c_sqrt(double complex z) {
    return (c_is_real(z) && creal(z) >= 0.0) ? sqrt(creal(z)) : csqrt(z);
}
static inline double complex c_sqr(double complex z) {
    return c_mul(z, z);
}
static inline double complex c_sin(double complex z) {
    return c_is_real(z) ? sin(creal(z)) : csin(z);
}
static inline double complex c_asin(double complex z) {
    return (c_is_real(z) && fabs(creal(z)) <= 1.0) ? asin(creal(z)) : casin(z);
}
static inline double complex c_cos(double complex z) {
    return c_is_real(z) ? cos(creal(z)) : ccos(z);
}
static inline double complex c_acos(double complex z) {
    return (c_is_real(z) && fabs(creal(z)) <= 1.0) ? acos(creal(z)) : cacos(z);
}
static inline double complex c_tan(double complex z) {
    return c_is_real(z) ? tan(creal(z)) : ctan(z);
}
static inline double complex c_atan(double complex z) {
    return c_is_real(z) ? atan(creal(z)) : catan(z);
}
static inline double complex c_sinh(double complex z) {
    return c_is_real(z) ? sinh(creal(z)) : csinh(z);
}
static inline double complex c_asinh(double complex z) {
    return c_is_real(z) ? asinh(creal(z)) : casinh(z);
}
static inline double complex c_cosh(double complex z) {
    return c_is_real(z) ? cosh(creal(z)) : ccosh(z);
}
static inline double complex c_acosh(double complex z) {
    return (c_is_real(z) && creal(z) >= 1.0) ? acosh(creal(z)) : cacosh(z);
}
static inline double complex c_tanh(double complex z) {
    return c_is_real(z) ? tanh(creal(z)) : ctanh(z);
}
static inline double complex c_minus(double complex z) {
    return -z;
}
static inline double complex c_atanh(double complex z) {
    return (c_is_real(z) && fabs(creal(z)) < 1.0) ? atanh(creal(z)) : catanh(z);
}

/* ============================================================================
 * BINARY OPERATORS (CALC4 names)
 *
 * Signature f(first, second) = first op second. The search engine applies
 * f(top_of_stack, second_from_top), the same convention as the real engine.
 * ============================================================================ */

static inline double complex c_plus(double complex a, double complex b)     { return a + b; }
static inline double complex c_times(double complex a, double complex b)    { return c_mul(a, b); }
static inline double complex c_subtract(double complex a, double complex b) { return a - b; }
static inline double complex c_divide(double complex a, double complex b)   { return c_div(a, b); }

/* log_a(b) = log(b)/log(a), same argument order as ln() in math2.h */
static inline double complex c_logarithm(double complex a, double complex b) {
    return c_div(c_log(b), c_log(a));
}

static inline double complex c_power(double complex a, double complex b) {
    if (c_is_real(a) && c_is_real(b)) {
        double x = creal(a), y = creal(b);
        /* real pow() is exact for these cases and agrees with the principal
           branch of cpow(); it also keeps 0^0 = 1 like the real engine */
        if (x > 0.0 || y == floor(y) || (x == 0.0 && y > 0.0)) return pow(x, y);
    }
    return cpow(a, b);
}

#endif /* !_MSC_VER */
#endif /* CMATH2_H */
