// df64_ops.h - the buttons of mitm_cr.cpp in df64 arithmetic: values, derivatives and running error bounds, for the
// Metal backend (mitm_kernels.metal) and its host-side checks
//
// Author: Andrzej Odrzywolek
// Date: October 4, 2026
// Code assist: Claude Opus 5.5
//
// Common subset of C++17 and the Metal Shading Language, as df64.h. Operation numbers are mitm_cr.cpp's (U_*, B_*;
// the host checks the equality). The engine's operand order: t = top of the stack, "a, b, SUBTRACT" = b - a.
//
// Differences from mitm_cr's double-precision buttons, by design:
//   * usable values: finite, and 0 or of magnitude >= 2^-76 (1.3e-23). Apple GPUs flush subnormal floats to zero
//     in every math mode (test_df64 --ftz reproduces the GPU bit for bit), so the low part of a df64 value keeps its
//     bits only down to 2^-126: at 2^-76 that is still 2^-50 relative. The upper limit is float's, 3.4e38.
//   * a result flushed to zero is unusable unless zero is exact (x - x, 0 * y, log 1, sin 0, ...): exp(-100) = 0 in
//     df64, 3.7e-44 in double
//   * x^n for an integer |n| <= 64 by repeated squaring (2^3 = 8 exactly, as the C library); other powers as
//     exp(s log t)
//   * Gamma of the integers 1..21 exactly (factorials up to 21! fit into a df64; Apple's tgamma is exact there too)
//   * SINPI, COSPI, TANPI: as mitm_cr's sin(M_PI a) with the double M_PI (sinpi(1) = 1.2e-16, not 0), to first
//     order in M_PI - pi (dfo_sinpi_c)
// Error bounds (first order, as mitm_cr's eval_full, in units of u = 2^-48 relative to the result): per operation the
// maximum error measured by test_df64 (PHASE2_RESULTS.md), plus the inputs' bounds times the partial derivatives,
// which are evaluated in float (only a few bits are needed).

#ifndef DF64_OPS_H
#define DF64_OPS_H
#include "df64.h"

#if defined(__METAL_VERSION__)
#define DFO_F(fn) fn                                           // float library functions: cos, sin, log, ...
#else
#define DFO_F(fn) fn##f                                        // cosf, sinf, logf, ...
#endif

enum { DU_LOG, DU_EXP, DU_INV, DU_GAMMA, DU_SQRT, DU_SQR, DU_SIN, DU_ASIN, DU_COS, DU_ACOS, DU_TAN, DU_ATAN,
       DU_SINH, DU_ASINH, DU_COSH, DU_ACOSH, DU_TANH, DU_ATANH, DU_MINUS, DU_SINPI, DU_COSPI, DU_TANPI };
enum { DB_PLUS, DB_TIMES, DB_SUBTRACT, DB_DIVIDE, DB_POWER, DB_LOGARITHM, DB_ROOT, DB_ATAN2 };

#define DFO_U 3.5527136788005009e-15f                          // u = 2^-48
#define DFO_TINY 1.3234889800848443e-23f                       // 2^-76

DF_FN df64 dfo_nan() { return df_f(df_nan()); }
DF_FN bool dfo_zero(df64 a) { return a.hi == 0.0f; }
DF_FN bool dfo_usable(df64 a) { return df_finite(a.hi) && (a.hi == 0.0f || df_absf(a.hi) >= DFO_TINY); }
DF_FN df64 dfo_norm0(df64 a)                                   // -0 -> +0 in both parts (value keys)
{
    if (a.hi == 0.0f) a.hi = 0.0f;
    if (a.lo == 0.0f) a.lo = 0.0f;
    return a;
}
DF_FN df64 dfo_flushed(df64 r) { return dfo_zero(r) ? dfo_nan() : r; }   // a zero that is not exact

// order-preserving 64-bit key of a df64 value: the orderable bits of hi, then of lo (normalized pairs)
DF_FN df_u32 dfo_ord(float x)
{
    const df_u32 b = df_bits(x);
    return (b & 0x80000000u) ? ~b : (b | 0x80000000u);
}
DF_FN float dfo_unord(df_u32 k) { return df_from_bits((k & 0x80000000u) ? (k & 0x7FFFFFFFu) : ~k); }

// x^n, |n| <= 64, by repeated squaring
DF_FN df64 dfo_powi(df64 t, int n)
{
    int m = n < 0 ? -n : n;
    df64 r = df_f(1.0f), p = t;
    while (m != 0) {
        if ((m & 1) != 0) r = df_mul(r, p);
        m >>= 1;
        if (m != 0) p = df_mul(p, p);
    }
    return n < 0 ? df_inv(r) : r;
}

DF_FN bool dfo_small_int(df64 s) { return s.lo == 0.0f && DF_FLOOR(s.hi) == s.hi && df_absf(s.hi) <= 64.0f; }

DF_FN df64 dfo_pow(df64 t, df64 s)                             // C's pow(t, s)
{
    if (dfo_small_int(s)) return dfo_powi(t, (int)s.hi);
    return df_pow(t, s);
}

DF_FN df64 dfo_gamma(df64 a)
{
    if (a.lo == 0.0f && a.hi >= 1.0f && a.hi <= 21.0f && DF_FLOOR(a.hi) == a.hi) {
        df64 p = df_f(1.0f);
        for (int k = 2; k < (int)a.hi; k++) p = df_mul_f(p, (float)k);
        return p;
    }
    return df_gamma(a);
}

DF_FN df64 dfo_cospi(df64 a) { return df_sinpi(df_add_f(a, 0.5f)); }

// sin, cos and tan of M_PI a as mitm_cr computes them with the double M_PI, which is 1.2e-16 below pi: to first order
// sin(M_PI a) = sin(pi a) + (M_PI - pi) a cos(pi a); the correction matters where the result is small (in double
// sinpi(1) = 1.2e-16, cospi(1/2) = 6.1e-17, tanpi(1/2) = 1.6e16), and there the other factor is +-1 to float
// precision. (The rounding of the product M_PI a in double is not reproduced; it is exact at integers and halves.)
#define DFO_DPI -1.2246467991473532e-16f                       // M_PI - pi
DF_FN df64 dfo_sinpi_c(df64 a)
{
    const df64 s = df_sinpi(a);
    if (!(df_absf(s.hi) < 0.125f)) return s;
    const float n = DF_FLOOR(a.hi + 0.5f);                     // near the integer n: cos(pi a) = (-1)^n sqrt(1 - s^2)
    const float c = ((((int)df_absf(n)) & 1) != 0 ? -1.0f : 1.0f) * DFO_F(sqrt)(1.0f - s.hi * s.hi);
    return df_add(s, df_f(DFO_DPI * a.hi * c));
}
DF_FN df64 dfo_cospi_c(df64 a)
{
    const df64 c = dfo_cospi(a);
    if (!(df_absf(c.hi) < 0.125f)) return c;
    const float n = DF_FLOOR(a.hi);                            // near n + 1/2: sin(pi a) = (-1)^n sqrt(1 - c^2)
    const float sn = ((((int)df_absf(n)) & 1) != 0 ? -1.0f : 1.0f) * DFO_F(sqrt)(1.0f - c.hi * c.hi);
    return df_sub(c, df_f(DFO_DPI * a.hi * sn));
}

DF_FN bool dfo_abs_le1(df64 a)                                // |a| <= 1 (as the double test of mitm_cr)
{
    const float h = df_absf(a.hi);
    return h < 1.0f || (h == 1.0f && (a.hi > 0.0f ? a.lo <= 0.0f : a.lo >= 0.0f));
}

DF_FN df64 dfo_atan2(df64 y, df64 x)                           // C's atan2(y, x)
{
    if (dfo_zero(x)) return dfo_zero(y) ? df_f(0.0f) : (y.hi > 0.0f ? df_pio2() : df_neg(df_pio2()));
    const df64 a = df_atan(df_div(y, x));
    if (x.hi > 0.0f) return a;
    return y.hi < 0.0f ? df_sub(a, df_pi()) : df_add(a, df_pi());
}

// ---------------------------------------------------------------------------------------- values

DF_FN df64 dfo_un(int op, df64 a)
{
    switch (op) {
    case DU_LOG: return df_log(a);
    case DU_EXP: return dfo_flushed(df_exp(a));
    case DU_INV: return df_inv(a);
    case DU_GAMMA: return dfo_flushed(dfo_gamma(a));
    case DU_SQRT: return df_sqrt(a);
    case DU_SQR: return dfo_zero(a) ? a : dfo_flushed(df_sqr(a));
    case DU_SIN: return df_sin(a);
    case DU_ASIN: return df_asin(a);
    case DU_COS: return df_cos(a);
    case DU_ACOS: return df_acos(a);
    case DU_TAN: return df_tan(a);
    case DU_ATAN: return df_atan(a);
    case DU_SINH: return df_sinh(a);
    case DU_ASINH: return df_asinh(a);
    case DU_COSH: return df_cosh(a);
    case DU_ACOSH: return df_acosh(a);
    case DU_TANH: return df_tanh(a);
    case DU_ATANH: return df_atanh(a);
    case DU_SINPI: return dfo_abs_le1(a) ? dfo_sinpi_c(a) : dfo_nan();   // RIES: arguments |a| <= 1 only
    case DU_COSPI: return dfo_abs_le1(a) ? dfo_cospi_c(a) : dfo_nan();
    case DU_TANPI: return dfo_abs_le1(a) ? df_div(dfo_sinpi_c(a), dfo_cospi_c(a)) : dfo_nan();
    default: return df_neg(a);                                 // DU_MINUS
    }
}

DF_FN df64 dfo_bin(int op, df64 t, df64 s)
{
    switch (op) {
    case DB_PLUS: {
        const df64 r = df_add(t, s);
        return dfo_zero(r) && !(t.hi == -s.hi && t.lo == -s.lo) ? dfo_nan() : r;
    }
    case DB_TIMES: return dfo_zero(t) || dfo_zero(s) ? df_f(0.0f) : dfo_flushed(df_mul(t, s));
    case DB_SUBTRACT: {
        const df64 r = df_sub(t, s);
        return dfo_zero(r) && !(t.hi == s.hi && t.lo == s.lo) ? dfo_nan() : r;
    }
    case DB_DIVIDE: return dfo_zero(t) ? df_div(t, s) : dfo_flushed(df_div(t, s));
    case DB_POWER: return dfo_zero(t) ? dfo_pow(t, s) : dfo_flushed(dfo_pow(t, s));
    case DB_ROOT:                                              // the t-th root of s, as RIES's "s t v"
        if (dfo_zero(t)) return dfo_nan();
        if (s.hi < 0.0f) {
            if (!(t.hi == 3.0f && t.lo == 0.0f)) return dfo_nan();
            return df_neg(dfo_flushed(df_pow(df_neg(s), df_inv(t))));
        }
        return dfo_zero(s) ? df_f(0.0f) : dfo_flushed(df_pow(s, df_inv(t)));
    case DB_ATAN2: return dfo_atan2(s, t);                     // RIES's "s t A" = atan2(s, t)
    default: return df_div(df_log(s), df_log(t));              // DB_LOGARITHM: log_t(s)
    }
}

// ---------------------------------------------------------------------------------------- derivatives

DF_FN df64 dfo_dun(int op, df64 a, df64 r)                     // f'(a), given r = f(a)
{
    const df64 one = df_f(1.0f);
    switch (op) {
    case DU_LOG: return df_inv(a);
    case DU_EXP: return r;
    case DU_INV: return df_neg(df_sqr(r));
    case DU_GAMMA: return df_mul(r, df_digamma(a));
    case DU_SQRT: return df_div(df_f(0.5f), r);
    case DU_SQR: return df_mul_f(a, 2.0f);
    case DU_SIN: return df_cos(a);
    case DU_ASIN: return df_inv(df_sqrt(df_mul(df_sub(one, a), df_add(one, a))));
    case DU_COS: return df_neg(df_sin(a));
    case DU_ACOS: return df_neg(df_inv(df_sqrt(df_mul(df_sub(one, a), df_add(one, a)))));
    case DU_TAN: return df_add(one, df_sqr(r));
    case DU_ATAN: return df_inv(df_add(one, df_sqr(a)));
    case DU_SINH: return df_cosh(a);
    case DU_ASINH: return df_inv(df_sqrt(df_add(df_sqr(a), one)));
    case DU_COSH: return df_sinh(a);
    case DU_ACOSH: return df_inv(df_mul(df_sqrt(df_sub(a, one)), df_sqrt(df_add(a, one))));
    case DU_TANH: return df_sub(one, df_sqr(r));
    case DU_ATANH: return df_inv(df_mul(df_sub(one, a), df_add(one, a)));
    case DU_SINPI: return df_mul(df_pi(), dfo_cospi(a));
    case DU_COSPI: return df_neg(df_mul(df_pi(), df_sinpi(a)));
    case DU_TANPI: return df_mul(df_pi(), df_add(one, df_sqr(r)));
    default: return df_f(-1.0f);                               // DU_MINUS
    }
}

DF_FN df64 dfo_dbin(int op, df64 t, df64 s, df64 r, df64 dt, df64 ds)
{
    switch (op) {
    case DB_PLUS: return df_add(dt, ds);
    case DB_TIMES: return df_add(df_mul(dt, s), df_mul(t, ds));
    case DB_SUBTRACT: return df_sub(dt, ds);
    case DB_DIVIDE: return df_div(df_sub(dt, df_mul(r, ds)), s);
    case DB_POWER:                                             // r = t^s
        if (dfo_zero(ds)) return dfo_zero(dt) ? df_f(0.0f) : df_mul(df_mul(s, dfo_pow(t, df_add_f(s, -1.0f))), dt);
        if (dfo_zero(dt)) return df_mul(df_mul(r, df_log(t)), ds);
        return df_mul(r, df_add(df_mul(ds, df_log(t)), df_div(df_mul(s, dt), t)));
    case DB_ROOT: {                                            // r = s^(1/t)
        const df64 a = dfo_zero(ds) ? df_f(0.0f) : df_div(df_mul(r, ds), df_mul(s, t));
        const df64 b = dfo_zero(dt) ? df_f(0.0f) : df_div(df_mul(df_mul(r, df_log(s)), dt), df_sqr(t));
        return df_sub(a, b);
    }
    case DB_ATAN2: {                                           // r = atan2(s, t); scaled: t^2 + s^2 can overflow
        const float at = df_absf(t.hi), as = df_absf(s.hi);
        const df64 m = at > as ? df_abs(t) : df_abs(s);
        const df64 tm = df_div(t, m), sm = df_div(s, m);
        return df_div(df_sub(df_mul(tm, ds), df_mul(sm, dt)), df_mul(m, df_add(df_sqr(tm), df_sqr(sm))));
    }
    default: {                                                 // r = ln s / ln t
        const df64 a = dfo_zero(ds) ? df_f(0.0f) : df_div(ds, s);
        const df64 b = dfo_zero(dt) ? df_f(0.0f) : df_div(df_mul(r, dt), t);
        return df_div(df_sub(a, b), df_log(t));
    }
    }
}

// ---------------------------------------------------------------------------------------- error bounds

DF_FN float dfo_digamma_f(float x)                             // rough psi(x), for error bounds only
{
    float acc = 0.0f;
    if (x < 0.5f) {                                            // psi(x) = psi(1 - x) - pi / tan(pi x)
        const float t = DFO_F(tan)(3.14159265f * x);
        acc = -3.14159265f / t;
        x = 1.0f - x;
    }
    for (int i = 0; i < 64 && x < 6.0f; i++) { acc -= 1.0f / x; x += 1.0f; }
    return acc + DFO_F(log)(x) - 0.5f / x - 1.0f / (12.0f * x * x);
}

// error of the operation itself, in units of u relative to |r| (test_df64's maxima, rounded up)
DF_FN float dfo_w_un(int op)
{
    switch (op) {
    case DU_LOG: return 4.5f;      case DU_EXP: return 1.5f;   case DU_INV: return 1.5f;
    case DU_GAMMA: return 64.0f;   case DU_SQRT: return 4.5f;  case DU_SQR: return 2.5f;
    case DU_SIN: return 3.0f;      case DU_ASIN: return 3.5f;  case DU_COS: return 3.0f;
    case DU_ACOS: return 5.5f;     case DU_TAN: return 3.0f;   case DU_ATAN: return 2.5f;
    case DU_SINH: return 2.5f;     case DU_ASINH: return 2.5f; case DU_COSH: return 2.0f;
    case DU_ACOSH: return 4.5f;    case DU_TANH: return 3.5f;  case DU_ATANH: return 3.5f;
    case DU_SINPI: case DU_COSPI: case DU_TANPI: return 6.0f;
    default: return 0.0f;                                      // DU_MINUS
    }
}

DF_FN float dfo_w_bin(int op, float r)
{
    switch (op) {
    case DB_PLUS: case DB_SUBTRACT: return 1.5f;
    case DB_TIMES: return 2.5f;
    case DB_DIVIDE: return 1.5f;
    case DB_POWER: case DB_ROOT: return 6.0f + df_absf(DFO_F(log)(df_absf(r) + 1e-30f));   // exp amplifies |log r| u
    case DB_ATAN2: return 5.0f;
    default: return 10.0f;                                     // DB_LOGARITHM
    }
}

// |f'(a)| in float (r = f(a))
DF_FN float dfo_p_un(int op, float a, float r)
{
    const float pi = 3.14159265f;
    switch (op) {
    case DU_LOG: return 1.0f / df_absf(a);
    case DU_EXP: return df_absf(r);
    case DU_INV: return r * r;
    case DU_GAMMA: return df_absf(r * dfo_digamma_f(a));
    case DU_SQRT: return 0.5f / df_absf(r);
    case DU_SQR: return 2.0f * df_absf(a);
    case DU_SIN: return df_absf(DFO_F(cos)(a));
    case DU_COS: return df_absf(DFO_F(sin)(a));
    case DU_ASIN: case DU_ACOS: return 1.0f / DFO_F(sqrt)(df_absf((1.0f - a) * (1.0f + a)));
    case DU_TAN: return 1.0f + r * r;
    case DU_ATAN: return 1.0f / (1.0f + a * a);
    case DU_SINH: return DFO_F(cosh)(a);
    case DU_COSH: return df_absf(DFO_F(sinh)(a));
    case DU_ASINH: return 1.0f / DFO_F(sqrt)(a * a + 1.0f);
    case DU_ACOSH: return 1.0f / DFO_F(sqrt)(df_absf(a * a - 1.0f));
    case DU_TANH: return df_absf(1.0f - r * r);
    case DU_ATANH: return 1.0f / df_absf((1.0f - a) * (1.0f + a));
    case DU_SINPI: return pi * df_absf(DFO_F(cos)(pi * a));
    case DU_COSPI: return pi * df_absf(DFO_F(sin)(pi * a));
    case DU_TANPI: return pi * (1.0f + r * r);
    default: return 1.0f;                                      // DU_MINUS
    }
}

struct dfo_pp {
    float t, s;
};

// |dr/dt| and |dr/ds| in float (r = op(t, s))
DF_FN dfo_pp dfo_p_bin(int op, float t, float s, float r)
{
    float pt, ps;
    switch (op) {
    case DB_PLUS: case DB_SUBTRACT: pt = 1.0f; ps = 1.0f; break;
    case DB_TIMES: pt = df_absf(s); ps = df_absf(t); break;
    case DB_DIVIDE: pt = 1.0f / df_absf(s); ps = df_absf(r / s); break;
    case DB_POWER: pt = df_absf(r * s / t); ps = df_absf(r * DFO_F(log)(df_absf(t))); break;
    case DB_ROOT: pt = df_absf(r * DFO_F(log)(df_absf(s)) / (t * t)); ps = df_absf(r / (s * t)); break;
    case DB_ATAN2: {
        const float m = df_absf(t) > df_absf(s) ? df_absf(t) : df_absf(s), tm = t / m, sm = s / m;
        pt = df_absf(sm) / (m * (tm * tm + sm * sm));
        ps = df_absf(tm) / (m * (tm * tm + sm * sm));
        break;
    }
    default: {                                                 // r = ln s / ln t
        const float lt = DFO_F(log)(df_absf(t));
        pt = df_absf(r / (t * lt));
        ps = df_absf(1.0f / (s * lt));
        break;
    }
    }
    dfo_pp p;
    p.t = pt;
    p.s = ps;
    return p;
}

#endif
