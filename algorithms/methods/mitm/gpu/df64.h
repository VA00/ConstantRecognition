// df64.h - double-float arithmetic: a value is the unevaluated sum hi + lo of two floats, |lo| <= ulp(hi) / 2
//
// Author: Andrzej Odrzywolek
// Date: October 4, 2026
// Code assist: Claude Opus 5.5
//
// For GPUs without fast FP64: Apple GPUs and WebGPU have no double at all, and consumer NVIDIA GPUs run double at
// 1/64 of the float rate (fp_rates.cu: float is 45-109 times faster than double on an RTX 5080). A df64 value has
// about 48 significant bits (unit roundoff u = 2^-48 = 3.6e-15) and the exponent range of float: magnitudes above
// 3.4e38 overflow, and below about 2^-100 = 7.9e-31 the low part loses bits. Such values are unusable (df_usable).
//
// One source for C++17 (CPU), CUDA and the Metal Shading Language: no recursion, no arrays, no references, no
// standard library in the functions; only +, -, *, fma, floor, comparisons and exact conversions. Division and
// square root are built from fma as well (a float division or sqrt need not be correctly rounded on every GPU). So
// the results are bit-identical on every platform that rounds float operations to nearest and does not contract or
// reorder them: never fast math; no FMA contraction (nvcc --fmad=false, clang/icx -ffp-contract=off, MSVC
// /fp:precise, Metal: the pragma below and MTLMathModeSafe). test_df64.cpp checks accuracy and bit identity.
//
// Error-free transformations: TwoSum (Knuth), FastTwoSum (Dekker), TwoProd with fma. Functions: the buttons of
// mitm_cr.cpp (sqrt, exp, log, sin, cos, tan, asin, acos, atan, sinh, cosh, tanh, asinh, acosh, atanh, pow, gamma)
// and digamma (for the derivative of gamma), with the special values of the C library where they matter here.
// Trigonometric arguments are reduced modulo pi/2 in four parts: accurate for |x| < 1024 pi/2; beyond, NaN.

#ifndef DF64_H
#define DF64_H

#if defined(__METAL_VERSION__)
#pragma METAL fp contract(off)
#define DF_FN static inline
#define DF_FMA(a, b, c) fma(a, b, c)
#define DF_FLOOR(x) floor(x)
typedef uint df_u32;
static inline df_u32 df_bits(float x) { return as_type<uint>(x); }
static inline float df_from_bits(df_u32 u) { return as_type<float>(u); }
#else
#include <cstdint>
#include <cstring>
#include <cmath>
#if defined(__clang__)
#pragma clang fp contract(off)
#elif defined(_MSC_VER)
#pragma fp_contract(off)
#endif
#ifdef __CUDACC__
#define DF_FN static __host__ __device__ __forceinline__
#else
#define DF_FN static inline
#endif
#define DF_FMA(a, b, c) fmaf(a, b, c)
#define DF_FLOOR(x) floorf(x)
typedef uint32_t df_u32;
DF_FN df_u32 df_bits(float x) { df_u32 u; memcpy(&u, &x, 4); return u; }
DF_FN float df_from_bits(df_u32 u) { float x; memcpy(&x, &u, 4); return x; }
#endif

struct df64 {
    float hi, lo;
};

DF_FN df64 df_make(float hi, float lo) { df64 r; r.hi = hi; r.lo = lo; return r; }
DF_FN df64 df_f(float a) { return df_make(a, 0.0f); }
DF_FN float df_inf() { return df_from_bits(0x7F800000u); }
DF_FN float df_nan() { return df_from_bits(0x7FC00000u); }
DF_FN bool df_finite(float x) { return x - x == 0.0f; }          // false for inf and NaN
DF_FN float df_absf(float x) { return x < 0.0f ? -x : x; }
// usable as a value of the search: finite, and 0 or of magnitude >= 2^-100 (the low part keeps its bits)
DF_FN bool df_usable(df64 a) { return df_finite(a.hi) && (a.hi == 0.0f || df_absf(a.hi) >= 7.88860905e-31f); }

// ---------------------------------------------------------------------------------------- error-free transforms

DF_FN df64 df_two_sum(float a, float b)
{
    const float s = a + b, bb = s - a;
    return df_make(s, (a - (s - bb)) + (b - bb));
}
DF_FN df64 df_fast_two_sum(float a, float b)                   // |a| >= |b|
{
    const float s = a + b;
    return df_make(s, b - (s - a));
}
DF_FN df64 df_two_prod(float a, float b)
{
    const float p = a * b;
    return df_make(p, DF_FMA(a, b, -p));
}

// ---------------------------------------------------------------------------------------- arithmetic

DF_FN df64 df_neg(df64 a) { return df_make(-a.hi, -a.lo); }
DF_FN df64 df_abs(df64 a) { return a.hi < 0.0f ? df_neg(a) : a; }

DF_FN df64 df_add(df64 a, df64 b)
{
    df64 s = df_two_sum(a.hi, b.hi);
    if (!df_finite(s.hi)) return df_make(s.hi, 0.0f);
    const df64 t = df_two_sum(a.lo, b.lo);
    s.lo += t.hi;
    s = df_fast_two_sum(s.hi, s.lo);
    s.lo += t.lo;
    return df_fast_two_sum(s.hi, s.lo);
}
DF_FN df64 df_sub(df64 a, df64 b) { return df_add(a, df_neg(b)); }
DF_FN df64 df_add_f(df64 a, float b) { return df_add(a, df_f(b)); }

DF_FN df64 df_mul(df64 a, df64 b)
{
    df64 p = df_two_prod(a.hi, b.hi);
    if (!df_finite(p.hi)) return df_make(p.hi, 0.0f);
    p.lo = DF_FMA(a.hi, b.lo, p.lo);
    p.lo = DF_FMA(a.lo, b.hi, p.lo);
    return df_fast_two_sum(p.hi, p.lo);
}
DF_FN df64 df_mul_f(df64 a, float b)
{
    df64 p = df_two_prod(a.hi, b);
    if (!df_finite(p.hi)) return df_make(p.hi, 0.0f);
    p.lo = DF_FMA(a.lo, b, p.lo);
    return df_fast_two_sum(p.hi, p.lo);
}
DF_FN df64 df_sqr(df64 a) { return df_mul(a, a); }

// a * 2^k, exact (k in [-252, 254])
DF_FN df64 df_ldexp(df64 a, int k)
{
    int k1 = k / 2, k2 = k - k / 2;
    const float f1 = df_from_bits((df_u32)(k1 + 127) << 23), f2 = df_from_bits((df_u32)(k2 + 127) << 23);
    return df_make(a.hi * f1 * f2, a.lo * f1 * f2);
}

// 1/b of a float, by Newton steps from a bit-level estimate
DF_FN float df_rcp_f(float b)
{
    const df_u32 u = df_bits(b), s = u & 0x80000000u, m = u & 0x7FFFFFFFu;
    if (m >= 0x7F800000u) return m == 0x7F800000u ? df_from_bits(s) : b;     // inf -> 0, NaN -> NaN
    if (m == 0u) return df_from_bits(s | 0x7F800000u);                        // 0 -> inf
    float a = df_from_bits(m), sc = 1.0f;
    if (m >= 0x7E000000u) { a *= 0.25f; sc = 0.25f; }                         // |b| >= 2^125
    else if (m < 0x00800000u) { a *= 16777216.0f; sc = 16777216.0f; }        // subnormal b
    float x = df_from_bits(0x7EF311C3u - df_bits(a));                        // within 13 %
    for (int i = 0; i < 4; i++) {
        const float e = DF_FMA(-a, x, 1.0f);
        x = DF_FMA(x, e, x);
    }
    return df_from_bits(df_bits(x * sc) | s);
}

DF_FN df64 df_div(df64 a, df64 b)
{
    const float r = df_rcp_f(b.hi);
    if (!df_finite(a.hi) || !df_finite(b.hi) || b.hi == 0.0f) return df_f(a.hi * r);
    const float q1 = a.hi * r;
    if (!df_finite(q1)) return df_f(q1);
    df64 rem = df_sub(a, df_mul_f(b, q1));
    const float q2 = rem.hi * r;
    rem = df_sub(rem, df_mul_f(b, q2));
    const float q3 = rem.hi * r;
    return df_add_f(df_fast_two_sum(q1, q2), q3);
}
DF_FN df64 df_inv(df64 a) { return df_div(df_f(1.0f), a); }

// 1/sqrt(a) of a positive normal float, by Newton steps from a bit-level estimate
DF_FN float df_rsqrt_f(float a)
{
    float sc = 1.0f;
    if (a < 7.88860905e-31f) { a *= 1.84467441e19f; sc = 4.294967296e9f; }   // a < 2^-100: times 2^64, result times 2^32
    else if (a > 1.26765060e30f) { a *= 5.42101086e-20f; sc = 2.32830644e-10f; }   // a > 2^100
    float y = df_from_bits(0x5F375A86u - (df_bits(a) >> 1));
    for (int i = 0; i < 4; i++) {
        const float t = a * y;
        const float e = DF_FMA(-t, y, 1.0f);
        y = DF_FMA(0.5f * y, e, y);
    }
    return y * sc;
}

DF_FN df64 df_sqrt(df64 a)
{
    if (!(a.hi > 0.0f)) return a.hi == 0.0f ? df_f(a.hi) : df_f(df_nan());
    if (!df_finite(a.hi)) return df_f(a.hi);
    const float y = df_rsqrt_f(a.hi), s = a.hi * y;           // s ~ sqrt(a), Karp's correction: + (a - s^2) y / 2
    const df64 d = df_sub(a, df_two_prod(s, s));
    return df_fast_two_sum(s, d.hi * y * 0.5f);
}

DF_FN bool df_lt(df64 a, df64 b) { return a.hi < b.hi || (a.hi == b.hi && a.lo < b.lo); }
DF_FN double df_to_double(df64 a) { return (double)a.hi + (double)a.lo; }     // host only (no double on Metal)

// ---------------------------------------------------------------------------------------- constants

DF_FN df64 df_pi() { return df_make(3.141592741e+00f, -8.742277657e-08f); }
DF_FN df64 df_pio2() { return df_make(1.570796371e+00f, -4.371138829e-08f); }
DF_FN df64 df_ln2() { return df_make(6.931471825e-01f, -1.904654212e-09f); }
DF_FN df64 df_half_log_2pi() { return df_make(9.189385176e-01f, 1.563417662e-08f); }

DF_FN df64 df_inv_fact(int n)                                  // 1/n!
{
    switch (n) {
    case 0: case 1: return df_f(1.0f);
    case 2: return df_f(0.5f);
    case 3: return df_make(1.666666716e-01f, -4.967053879e-09f);
    case 4: return df_make(4.166666791e-02f, -1.241763470e-09f);
    case 5: return df_make(8.333333768e-03f, -4.346172033e-10f);
    case 6: return df_make(1.388888923e-03f, -3.363109444e-11f);
    case 7: return df_make(1.984127011e-04f, -2.725596875e-12f);
    case 8: return df_make(2.480158764e-05f, -3.406996094e-13f);
    case 9: return df_make(2.755731884e-06f, 3.793571224e-14f);
    case 10: return df_make(2.755731998e-07f, -7.575112209e-15f);
    case 11: return df_make(2.505210794e-08f, 4.417623045e-16f);
    case 12: return df_make(2.087675588e-09f, 1.108283915e-16f);
    case 13: return df_make(1.605904437e-10f, -5.352526512e-18f);
    case 14: return df_make(1.147074536e-11f, 2.372207689e-19f);
    case 15: return df_make(7.647163610e-13f, 1.220071047e-20f);
    case 16: return df_make(4.779477256e-14f, 7.625444044e-22f);
    case 17: return df_make(2.811457359e-15f, -1.046208474e-22f);
    case 18: return df_make(1.561920681e-16f, 1.540447147e-24f);
    case 19: return df_make(8.220635078e-18f, 1.681478097e-25f);
    case 20: return df_make(4.110317591e-19f, 3.237511733e-27f);
    default: return df_make(1.957294152e-20f, -4.612945514e-28f);   // 21
    }
}

DF_FN df64 df_inv_odd(int n)                                   // 1/(2n+1)
{
    switch (n) {
    case 0: return df_f(1.0f);
    case 1: return df_make(3.333333433e-01f, -9.934107759e-09f);
    case 2: return df_make(2.000000030e-01f, -2.980232283e-09f);
    case 3: return df_make(1.428571492e-01f, -6.386212004e-09f);
    case 4: return df_make(1.111111119e-01f, -8.278422947e-10f);
    case 5: return df_make(9.090909362e-02f, -2.709302116e-09f);
    case 6: return df_make(7.692307979e-02f, -2.865607973e-09f);
    case 7: return df_make(6.666667014e-02f, -3.476937627e-09f);
    case 8: return df_make(5.882352963e-02f, -2.191347243e-10f);
    case 9: return df_make(5.263157934e-02f, -3.921358238e-10f);
    case 10: return df_make(4.761904851e-02f, -8.869738832e-10f);
    default: return df_make(4.347826168e-02f, -8.098456905e-10f);   // 11
    }
}

DF_FN df64 df_atan_k8(int k)                                   // atan(k/8)
{
    switch (k) {
    case 0: return df_f(0.0f);
    case 1: return df_make(1.243549958e-01f, -1.240382241e-09f);
    case 2: return df_make(2.449786663e-01f, -3.178677765e-09f);
    case 3: return df_make(3.587706685e-01f, 1.763949875e-09f);
    case 4: return df_make(4.636476040e-01f, 5.012158688e-09f);
    case 5: return df_make(5.585992932e-01f, 2.211159789e-08f);
    case 6: return df_make(6.435011029e-01f, 5.868937336e-09f);
    case 7: return df_make(7.188299894e-01f, 1.018833551e-08f);
    default: return df_make(7.853981853e-01f, -2.185569414e-08f);   // 8
    }
}

DF_FN df64 df_stirling(int k)                                  // B_2k / (2k (2k - 1)), log gamma
{
    switch (k) {
    case 1: return df_make(8.333333582e-02f, -2.483526940e-09f);
    case 2: return df_make(-2.777777845e-03f, 6.726218887e-11f);
    case 3: return df_make(7.936508046e-04f, -1.090238750e-11f);
    case 4: return df_make(-5.952381180e-04f, 2.272870607e-11f);
    case 5: return df_make(8.417508216e-04f, 2.018649484e-11f);
    case 6: return df_make(-1.917526941e-03f, 2.328823245e-11f);
    case 7: return df_make(6.410256494e-03f, -8.358023301e-11f);
    default: return df_make(-2.955065295e-02f, -6.437690936e-10f);  // 8
    }
}

DF_FN df64 df_bern_2k(int k)                                   // B_2k / (2k), digamma
{
    switch (k) {
    case 1: return df_make(8.333333582e-02f, -2.483526940e-09f);
    case 2: return df_make(-8.333333768e-03f, 4.346172033e-10f);
    case 3: return df_make(3.968254197e-03f, -2.291349194e-10f);
    case 4: return df_make(-4.166666884e-03f, 2.173086017e-10f);
    case 5: return df_make(7.575757802e-03f, -2.257751763e-10f);
    case 6: return df_make(-2.109279670e-02f, 6.054165502e-10f);
    case 7: return df_make(8.333333582e-02f, -2.483526940e-09f);
    default: return df_make(-4.432598054e-01f, 1.519334103e-09f);   // 8
    }
}

// ---------------------------------------------------------------------------------------- exp, log

DF_FN df64 df_exp(df64 a)
{
    if (a.hi != a.hi) return a;
    if (a.hi > 88.7228394f) return df_f(df_inf());
    if (a.hi < -87.3365479f) return df_f(0.0f);
    // a = k ln2 + r, ln2 in four parts (k times each of the first two is exact)
    const float k = DF_FLOOR(a.hi * 1.44269502f + 0.5f);
    df64 r = df_sub(a, df_f(k * 6.931762695e-01f));
    r = df_sub(r, df_f(k * -2.908892930e-05f));
    r = df_sub(r, df_two_prod(k, -4.201083925e-11f));
    r = df_sub(r, df_two_prod(k, 1.688525028e-15f));
    // e^r = (e^s)^256, s = r / 256: Taylor of e^s - 1, then (1 + p)^2 - 1 = 2p + p^2 eight times
    const df64 s = df_mul_f(r, 0.00390625f);
    df64 p = df_inv_fact(7);
    for (int n = 6; n >= 1; n--) p = df_add(df_inv_fact(n), df_mul(s, p));
    p = df_mul(s, p);
    for (int i = 0; i < 8; i++) p = df_add(df_mul_f(p, 2.0f), df_sqr(p));
    return df_ldexp(df_add_f(p, 1.0f), (int)k);
}

// log(1 + y) = 2 atanh(z), z = y / (2 + y), for |z| <= 0.172 (y in [-0.293, 0.415])
DF_FN df64 df_log1p_small(df64 y)
{
    const df64 z = df_div(y, df_add_f(y, 2.0f)), z2 = df_sqr(z);
    df64 t = df_inv_odd(11);
    for (int n = 10; n >= 0; n--) t = df_add(df_inv_odd(n), df_mul(z2, t));
    return df_mul_f(df_mul(z, t), 2.0f);
}

DF_FN df64 df_log(df64 a)
{
    if (!(a.hi > 0.0f)) return a.hi == 0.0f ? df_f(-df_inf()) : df_f(df_nan());
    if (!df_finite(a.hi)) return a;
    // a = m 2^e, m in [sqrt(1/2), sqrt(2)): log a = log(1 + (m - 1)) + e ln2
    int e = (int)((df_bits(a.hi) >> 23) & 0xFFu) - 127;
    if (e == -127) { a = df_ldexp(a, 64); e = (int)((df_bits(a.hi) >> 23) & 0xFFu) - 127 - 64; }   // subnormal hi
    df64 m = df_ldexp(a, -e);
    if (m.hi > 1.41421354f) { m = df_mul_f(m, 0.5f); e++; }
    const df64 l = df_log1p_small(df_add_f(m, -1.0f));
    return e == 0 ? l : df_add(l, df_mul_f(df_ln2(), (float)e));
}

DF_FN df64 df_log1p(df64 y)
{
    if (y.hi > -0.29f && y.hi < 0.41f) return df_log1p_small(y);
    return df_log(df_add_f(y, 1.0f));
}

// ---------------------------------------------------------------------------------------- trigonometric

struct df_red {
    df64 r;
    int j;
};

// a = j pi/2 + r, |r| <= pi/4; pi/2 in five parts (the first three of 14 bits: j times them is exact, |j| < 1024;
// together 90 bits, so that r keeps its relative accuracy down to |r| ~ 1e-12 next to a multiple of pi/2)
DF_FN df_red df_reduce_pio2(df64 a)
{
    df_red o;
    const float j = DF_FLOOR(a.hi * 6.36619747e-01f + 0.5f);
    df64 r = df_sub(a, df_f(j * 1.570800781e+00f));
    r = df_sub(r, df_f(j * -4.454515874e-06f));
    r = df_sub(r, df_f(j * 6.077272019e-11f));
    r = df_sub(r, df_two_prod(j, -1.715124510e-15f));
    r = df_sub(r, df_two_prod(j, 1.056299898e-23f));
    o.r = r;
    o.j = (int)j;
    return o;
}

DF_FN df64 df_sin_taylor(df64 r)                               // |r| <= pi/4
{
    const df64 r2 = df_sqr(r);
    df64 t = df_inv_fact(21);
    for (int n = 19; n >= 1; n -= 2) t = df_sub(df_inv_fact(n), df_mul(r2, t));
    return df_mul(r, t);
}

DF_FN df64 df_cos_taylor(df64 r)
{
    const df64 r2 = df_sqr(r);
    df64 t = df_inv_fact(20);
    for (int n = 18; n >= 0; n -= 2) t = df_sub(df_inv_fact(n), df_mul(r2, t));
    return t;
}

DF_FN bool df_trig_ok(df64 a) { return df_finite(a.hi) && df_absf(a.hi) < 1608.0f; }

DF_FN df64 df_sin(df64 a)
{
    if (!df_trig_ok(a)) return df_f(df_nan());
    const df_red d = df_reduce_pio2(a);
    switch (d.j & 3) {
    case 0: return df_sin_taylor(d.r);
    case 1: return df_cos_taylor(d.r);
    case 2: return df_neg(df_sin_taylor(d.r));
    default: return df_neg(df_cos_taylor(d.r));
    }
}

DF_FN df64 df_cos(df64 a)
{
    if (!df_trig_ok(a)) return df_f(df_nan());
    const df_red d = df_reduce_pio2(a);
    switch (d.j & 3) {
    case 0: return df_cos_taylor(d.r);
    case 1: return df_neg(df_sin_taylor(d.r));
    case 2: return df_neg(df_cos_taylor(d.r));
    default: return df_sin_taylor(d.r);
    }
}

DF_FN df64 df_tan(df64 a)
{
    if (!df_trig_ok(a)) return df_f(df_nan());
    const df_red d = df_reduce_pio2(a);
    const df64 s = df_sin_taylor(d.r), c = df_cos_taylor(d.r);
    return (d.j & 1) ? df_neg(df_div(c, s)) : df_div(s, c);
}

DF_FN df64 df_atan(df64 a)
{
    if (a.hi != a.hi) return a;
    const bool neg = a.hi < 0.0f;
    df64 x = df_abs(a);
    const bool inv = x.hi > 1.0f;
    if (inv) x = df_inv(x);                                    // inf -> 0
    // atan x = atan(c) + atan((x - c) / (1 + x c)), c = k/8 the nearest, |z| <= 1/16
    const float kf = DF_FLOOR(x.hi * 8.0f + 0.5f), c = kf * 0.125f;
    const df64 z = df_div(df_add_f(x, -c), df_add_f(df_mul_f(x, c), 1.0f)), z2 = df_sqr(z);
    df64 t = df_inv_odd(8);
    for (int n = 7; n >= 0; n--) t = df_sub(df_inv_odd(n), df_mul(z2, t));
    df64 r = df_add(df_atan_k8((int)kf), df_mul(z, t));
    if (inv) r = df_sub(df_pio2(), r);
    return neg ? df_neg(r) : r;
}

DF_FN df64 df_asin(df64 a)
{
    if (!(df_absf(a.hi) <= 1.0f)) return df_f(df_nan());
    if (df_absf(a.hi) == 1.0f && a.lo == 0.0f) return a.hi > 0.0f ? df_pio2() : df_neg(df_pio2());
    const df64 c = df_sqrt(df_mul(df_add_f(df_neg(a), 1.0f), df_add_f(a, 1.0f)));   // sqrt((1 - a)(1 + a))
    return df_atan(df_div(a, c));
}

DF_FN df64 df_acos(df64 a)
{
    if (!(df_absf(a.hi) <= 1.0f)) return df_f(df_nan());
    // acos a = 2 atan(sqrt((1 - a) / (1 + a)))
    const df64 q = df_div(df_add_f(df_neg(a), 1.0f), df_add_f(a, 1.0f));
    return df_mul_f(df_atan(df_sqrt(q)), 2.0f);
}

// ---------------------------------------------------------------------------------------- hyperbolic

DF_FN df64 df_sinh_taylor(df64 a)                              // |a| < 0.5
{
    const df64 a2 = df_sqr(a);
    df64 t = df_inv_fact(17);
    for (int n = 15; n >= 1; n -= 2) t = df_add(df_inv_fact(n), df_mul(a2, t));
    return df_mul(a, t);
}

DF_FN df64 df_sinh(df64 a)
{
    if (!df_finite(a.hi)) return a;
    if (df_absf(a.hi) < 0.5f) return df_sinh_taylor(a);
    const df64 e = df_exp(df_abs(a));
    const df64 r = df_mul_f(df_sub(e, df_inv(e)), 0.5f);
    return a.hi < 0.0f ? df_neg(r) : r;
}

DF_FN df64 df_cosh(df64 a)
{
    if (a.hi != a.hi) return a;
    const df64 e = df_exp(df_abs(a));
    return df_mul_f(df_add(e, df_inv(e)), 0.5f);
}

DF_FN df64 df_tanh(df64 a)
{
    if (a.hi != a.hi) return a;
    const float x = df_absf(a.hi);
    if (x > 17.5f) return df_f(a.hi > 0.0f ? 1.0f : -1.0f);   // 1 - 2 e^-2x rounds to 1 in df64
    if (x < 0.5f) {
        const df64 s = df_sinh_taylor(a);
        return df_div(s, df_sqrt(df_add_f(df_sqr(s), 1.0f)));
    }
    const df64 e2 = df_exp(df_mul_f(df_abs(a), 2.0f));
    const df64 r = df_div(df_add_f(e2, -1.0f), df_add_f(e2, 1.0f));
    return a.hi < 0.0f ? df_neg(r) : r;
}

DF_FN df64 df_asinh(df64 a)
{
    if (!df_finite(a.hi)) return a;
    const df64 x = df_abs(a);
    df64 r;
    if (x.hi > 1e9f) r = df_add(df_log(x), df_ln2());                     // log(2x), x^2 + 1 = x^2
    else if (x.hi < 0.5f) {                                                // log1p(x + x^2 / (1 + sqrt(1 + x^2)))
        const df64 q = df_sqrt(df_add_f(df_sqr(x), 1.0f));
        r = df_log1p(df_add(x, df_div(df_sqr(x), df_add_f(q, 1.0f))));
    } else r = df_log(df_add(x, df_sqrt(df_add_f(df_sqr(x), 1.0f))));
    return a.hi < 0.0f ? df_neg(r) : r;
}

DF_FN df64 df_acosh(df64 a)
{
    if (!(a.hi >= 1.0f)) return df_f(df_nan());
    if (!df_finite(a.hi)) return a;
    if (a.hi > 1e9f) return df_add(df_log(a), df_ln2());
    const df64 t = df_add_f(a, -1.0f);                         // log1p(t + sqrt(t (t + 2)))
    return df_log1p(df_add(t, df_sqrt(df_mul(t, df_add_f(t, 2.0f)))));
}

DF_FN df64 df_atanh(df64 a)
{
    if (!(df_absf(a.hi) <= 1.0f)) return df_f(df_nan());
    if (df_absf(a.hi) == 1.0f && a.lo == 0.0f) return df_f(a.hi * df_inf());
    // atanh a = log1p(2a / (1 - a)) / 2 near 0; log((1 + a) / (1 - a)) / 2 elsewhere (1 + a and 1 - a are exact)
    const df64 om = df_add_f(df_neg(a), 1.0f);
    if (df_absf(a.hi) < 0.5f) return df_mul_f(df_log1p(df_div(df_mul_f(a, 2.0f), om)), 0.5f);
    return df_mul_f(df_log(df_div(df_add_f(a, 1.0f), om)), 0.5f);
}

// ---------------------------------------------------------------------------------------- pow, gamma, digamma

DF_FN bool df_is_int(df64 a) { return DF_FLOOR(a.hi) == a.hi && DF_FLOOR(a.lo) == a.lo; }
DF_FN bool df_is_odd(df64 a)                                   // an integer below 2^24 in magnitude, odd
{
    return df_is_int(a) && a.lo == 0.0f && df_absf(a.hi) < 16777216.0f && ((int)df_absf(a.hi) & 1) == 1;
}

// t^s as the C library's pow for the values the search meets
DF_FN df64 df_pow(df64 t, df64 s)
{
    if (s.hi == 0.0f) return df_f(1.0f);
    if (t.hi == 1.0f && t.lo == 0.0f) return df_f(1.0f);
    if (t.hi != t.hi || s.hi != s.hi) return df_f(df_nan());
    if (t.hi == 0.0f) return s.hi > 0.0f ? df_f(df_is_odd(s) ? t.hi : 0.0f) : df_f(df_is_odd(s) ? df_from_bits(df_bits(t.hi) | 0x7F800000u) : df_inf());
    bool neg = false;
    if (t.hi < 0.0f) {
        if (!df_is_int(s)) return df_f(df_nan());
        neg = df_is_odd(s);
        t = df_neg(t);
    }
    const df64 r = df_exp(df_mul(s, df_log(t)));
    return neg ? df_neg(r) : r;
}

// sin(pi x), |x| < 2^23: x = n + r with n the nearest integer (exact), sin(pi x) = (-1)^n sin(pi r)
DF_FN df64 df_sinpi(df64 x)
{
    float n = DF_FLOOR(x.hi + 0.5f);
    df64 r = df_add_f(x, -n);
    const float m = DF_FLOOR(r.hi + 0.5f);                     // x.lo can carry r past 1/2
    n += m;
    r = df_add_f(r, -m);
    const df64 s = df_sin(df_mul(df_pi(), r));
    return ((int)df_absf(n) & 1) ? df_neg(s) : s;
}

// Gamma: Stirling's series on [10, 11), reached by the recurrence from either side (exp amplifies the absolute
// error of log Gamma, which stays below 16 there), reflection below 1/2
DF_FN df64 df_gamma_pos(df64 x)                                // x >= 1/2
{
    df64 prod = df_f(1.0f), up = df_f(1.0f);
    while (x.hi < 10.0f) { prod = df_mul(prod, x); x = df_add_f(x, 1.0f); }
    while (x.hi >= 11.0f) { x = df_add_f(x, -1.0f); up = df_mul(up, x); }
    const df64 ix = df_inv(x), ix2 = df_sqr(ix);
    df64 t = df_stirling(8);
    for (int k = 7; k >= 1; k--) t = df_add(df_stirling(k), df_mul(ix2, t));
    const df64 lg = df_add(df_add(df_sub(df_mul(df_add_f(x, -0.5f), df_log(x)), x), df_half_log_2pi()), df_mul(ix, t));
    return df_mul(df_div(df_exp(lg), prod), up);
}

DF_FN df64 df_gamma(df64 x)
{
    if (x.hi != x.hi) return x;
    if (x.hi <= 0.0f && df_is_int(x)) return df_f(df_nan());
    if (x.hi > 35.5f) return df_f(df_inf());
    if (x.hi >= 0.5f) return df_gamma_pos(x);
    if (x.hi < -40.0f) return df_f(0.0f);                     // below 1e-46: no usable value
    // Gamma(x) = pi / (sin(pi x) Gamma(1 - x))
    return df_div(df_pi(), df_mul(df_sinpi(x), df_gamma_pos(df_add_f(df_neg(x), 1.0f))));
}

DF_FN df64 df_digamma_pos(df64 x)                              // x >= 1/2
{
    df64 acc = df_f(0.0f);
    while (x.hi < 10.0f) { acc = df_sub(acc, df_inv(x)); x = df_add_f(x, 1.0f); }
    const df64 ix = df_inv(x), ix2 = df_sqr(ix);
    df64 t = df_bern_2k(8);
    for (int k = 7; k >= 1; k--) t = df_add(df_bern_2k(k), df_mul(ix2, t));
    // psi(x) = log x - 1/(2x) - sum B_2k / (2k x^2k)
    return df_add(acc, df_sub(df_sub(df_log(x), df_mul_f(ix, 0.5f)), df_mul(ix2, t)));
}

DF_FN df64 df_digamma(df64 x)
{
    if (x.hi != x.hi) return x;
    if (x.hi <= 0.0f && df_is_int(x)) return df_f(df_nan());
    if (x.hi >= 0.5f) return df_digamma_pos(x);
    // psi(x) = psi(1 - x) - pi / tan(pi x) = psi(1 - x) - pi cos(pi x) / sin(pi x)
    const df64 s = df_sinpi(x), c = df_sinpi(df_add_f(x, 0.5f));
    return df_sub(df_digamma_pos(df_add_f(df_neg(x), 1.0f)), df_div(df_mul(df_pi(), c), s));
}

#endif
