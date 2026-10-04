// mitm_cr.cpp - meet-in-the-middle constant recognition on the CPU (Phase 1 of the RIES speed-up)
//
// Author: Andrzej Odrzywolek
// Date: October 3, 2026
// Code assist: Claude Opus 5.5
//
// Finds equations L(x) = R that hold at a target value T. L is a postfix code containing x (by default exactly
// once), R a code without x, both over the CALC4 buttons (C/CALC4.h: 13 constants, 18 functions, 5 operators) or,
// with --common, over the symbols CALC4 shares with RIES's defaults (1..9, pi, e, phi; ln, exp, 1/x, sqrt, x^2;
// + * - / ^). As RIES, it meets in the middle: instead of evaluating every formula of length |L| + |R|, it
// evaluates the two halves separately and matches sorted values. Unlike RIES:
//   * codes are enumerated without dead ends: valid postfix shapes, then every button assignment by an odometer
//     whose last position turns fastest; only the positions that changed are evaluated again (the value of every
//     node is kept per position: no stack, no undo); a prefix with a non-finite value is skipped as a whole
//   * the right sides do not depend on the target: they are built once, deduplicated by value (the shortest code
//     kept for every double) and sorted; all targets of a batch (stdin) reuse this table
//   * left sides are evaluated per target together with their derivative d/dx (dual numbers), sorted and
//     deduplicated in chunks; each chunk is matched against the table in one sweep: a small index of every
//     B-th value (mostly in cache) is searched by galloping from the previous position, and the table block of
//     each window is prefetched 16 left values ahead, so the DRAM latency of the lookups overlaps
//
// Matching. A pair (L, R) is a candidate if the Newton root x* = T - (L(T) - R)/L'(T) satisfies
// |x* - T| <= tol |T|, i.e. |L(T) - R| <= tol |T| |L'(T)|. A candidate is refined by Newton steps on L(x) = R from
// T and accepted if the root stays within tol |T|. Three guards against equations that hold at T without saying
// anything about T (not in the plan; found necessary on the first test, see PHASE1_RESULTS.md):
//   * kappa = |L(T)| / (|L'(T)| |T|) must lie in [kappa_min, kappa_max]. Rounding L(T) to double alone moves the
//     root by up to eps kappa / 2 (relative), so above kappa_max = 2 tol / eps the equation cannot locate x within
//     tol: such matches are coincidences of rounding (L(T) and R the same double), up to saturated L
//     (tanh(36 x) = 1 holds in double precision for every x > 1). Below kappa_min, L is so steep or so
//     close to 0 that R is needed only to relative precision tol / kappa: tan(exp(1/x)) = -1 has roots 1e-64
//     apart near alpha, and x - 1 = R with R = 1e-12 matches by chance. The chance of a random match grows as
//     1/kappa; kappa_min = 1/32 was chosen on benchmark v0 (sweep in PHASE1_RESULTS.md). kappa_min also applies
//     to every intermediate node on the path of x (during the enumeration): tanh(tan(exp(x^2))) has a normal
//     kappa at x = -5.3, but tan of exp(x^2) = 1.8e12 is a pseudo-random number whose roots lie 1e-14 apart, and
//     tanh brings it within a few ulp of 1, where every double is some right side.
//     Subnormal values (lost precision) are unusable, as final and as intermediate results.
//   * a left side whose window holds more than maxwin right sides is skipped (a guard of the running time)
//   * running error bounds of both sides at T (first order, per operation 0.5-4 ulp), divided by |L'(T)| |T|,
//     must be <= errcap: the equation, evaluated in double precision, must determine x at all.
// Per target, the accepted equation with the smallest total length |L| + |R| is reported (ties: the smallest
// error), as Constant Recognition reports the shortest formula. Left sides are processed by increasing length,
// and the search stops as soon as no shorter equation is possible.
//
// Output, one tab-separated line per target (statistics and timings go to stderr):
//   id  SUCCESS|FAILURE  total_length  LHS_RPN  RHS_RPN  rel_err  candidates  ms
// RPN in Constant Recognition's button names, x for the unknown, with the engine's operand order (C/CALC4.h):
// "a, b, SUBTRACT" is b - a and "a, b, POWER" is b^a. For a FAILURE the closest pair found is shown. rel_err is
// |x - T| / |T| for the refined root x. candidates = pairs inside the value window.
//
// Build: icx /O3 /fp:precise /std:c++17 /EHsc mitm_cr.cpp   (or cl /O2 ..., g++ -O3 -std=c++17 -pthread ...)
//        IEEE semantics are required (non-finite values are tested): never build with fast-math.
// Usage: mitm_cr [--kl 5] [--kr 6] [--common] [--anyx] [--tol 16] [--kappa-min 0.03125] [--kappa-max 2*tol]
//                [--errcap 1e-12] [--maxwin 1000] [--threads 1] [--memcap 16] [--chunk 1048576] [--list] < targets
//                (targets: lines "id value"; tol in DBL_EPSILON; --list prints every accepted equation as #MATCH)
//        mitm_cr --bench T tolrel [--kl 7] [--kr 8] [--common]    pair count as mitm_bench.cu: x any number of
//                times, both sides deduplicated by value, |L - R| <= tolrel |L|
//        mitm_cr --eval "RPN" x                                   value of one code (engine's operand order)

#define _USE_MATH_DEFINES
#define _CRT_SECURE_NO_WARNINGS
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <cstdint>
#include <cfloat>
#include <climits>
#include <vector>
#include <string>
#include <algorithm>
#include <atomic>
#include <thread>
#include <mutex>
#include <chrono>
#if defined(_MSC_VER) && !defined(__clang__)
#include <immintrin.h>
#define PREFETCH(p) _mm_prefetch((const char*)(p), _MM_HINT_T0)
#else
#define PREFETCH(p) __builtin_prefetch(p)                       // clang, icx, gcc; a no-op in WebAssembly
#endif
#ifdef _WIN32
#define NOMINMAX
#include <windows.h>
#include <psapi.h>
#pragma comment(lib, "psapi.lib")
#else
#include <sys/resource.h>
#endif

static const int MAXK = 12;

// ------------------------------------------------------------------------------------------------ grammar

enum { U_LOG, U_EXP, U_INV, U_GAMMA, U_SQRT, U_SQR, U_SIN, U_ASIN, U_COS, U_ACOS, U_TAN, U_ATAN,
       U_SINH, U_ASINH, U_COSH, U_ACOSH, U_TANH, U_ATANH };
static const char* UNAME[18] = {"LOG", "EXP", "INV", "GAMMA", "SQRT", "SQR", "SIN", "ARCSIN", "COS", "ARCCOS",
                                "TAN", "ARCTAN", "SINH", "ARCSINH", "COSH", "ARCCOSH", "TANH", "ARCTANH"};
enum { B_PLUS, B_TIMES, B_SUBTRACT, B_DIVIDE, B_POWER };
static const char* BNAME[5] = {"PLUS", "TIMES", "SUBTRACT", "DIVIDE", "POWER"};

struct Grammar {
    int nc = 0, nu = 0, nb = 5;
    double cval[16];
    const char* cname[16];
    int uop[18];
};

static Grammar calc4()
{
    Grammar g;
    const double cv[13] = {M_PI, M_E, -1.0, 1.61803398874989484820458683436563812, 1, 2, 3, 4, 5, 6, 7, 8, 9};
    const char* cn[13] = {"PI", "EULER", "NEG", "GOLDENRATIO", "ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX",
                          "SEVEN", "EIGHT", "NINE"};
    g.nc = 13;
    for (int i = 0; i < 13; i++) { g.cval[i] = cv[i]; g.cname[i] = cn[i]; }
    g.nu = 18;
    for (int i = 0; i < 18; i++) g.uop[i] = i;
    return g;
}

static Grammar common_grammar()
{
    Grammar g;
    const double cv[12] = {M_PI, M_E, 1.61803398874989484820458683436563812, 1, 2, 3, 4, 5, 6, 7, 8, 9};
    const char* cn[12] = {"PI", "EULER", "GOLDENRATIO", "ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN",
                          "EIGHT", "NINE"};
    g.nc = 12;
    for (int i = 0; i < 12; i++) { g.cval[i] = cv[i]; g.cname[i] = cn[i]; }
    const int uo[5] = {U_LOG, U_EXP, U_INV, U_SQRT, U_SQR};
    g.nu = 5;
    for (int i = 0; i < 5; i++) g.uop[i] = uo[i];
    return g;
}

static double digamma(double x)
{
    if (x <= 0.0) {
        if (x == std::floor(x)) return NAN;
        return digamma(1.0 - x) - M_PI / std::tan(M_PI * x);
    }
    double r = 0.0;
    while (x < 6.0) { r -= 1.0 / x; x += 1.0; }
    const double f = 1.0 / (x * x);
    return r + std::log(x) - 0.5 / x - f * (1.0 / 12 - f * (1.0 / 120 - f * (1.0 / 252 - f * (1.0 / 240 - f / 132))));
}

static inline double un(int op, double a)
{
    switch (op) {
    case U_LOG: return std::log(a);    case U_EXP: return std::exp(a);     case U_INV: return 1.0 / a;
    case U_GAMMA: return std::tgamma(a); case U_SQRT: return std::sqrt(a); case U_SQR: return a * a;
    case U_SIN: return std::sin(a);    case U_ASIN: return std::asin(a);   case U_COS: return std::cos(a);
    case U_ACOS: return std::acos(a);  case U_TAN: return std::tan(a);     case U_ATAN: return std::atan(a);
    case U_SINH: return std::sinh(a);  case U_ASINH: return std::asinh(a); case U_COSH: return std::cosh(a);
    case U_ACOSH: return std::acosh(a); case U_TANH: return std::tanh(a);  default: return std::atanh(a);
    }
}

// f'(a), given r = f(a)
static inline double dun(int op, double a, double r)
{
    switch (op) {
    case U_LOG: return 1.0 / a;               case U_EXP: return r;                 case U_INV: return -r * r;
    case U_GAMMA: return r * digamma(a);      case U_SQRT: return 0.5 / r;          case U_SQR: return 2.0 * a;
    case U_SIN: return std::cos(a);           case U_ASIN: return 1.0 / std::sqrt((1.0 - a) * (1.0 + a));
    case U_COS: return -std::sin(a);          case U_ACOS: return -1.0 / std::sqrt((1.0 - a) * (1.0 + a));
    case U_TAN: return 1.0 + r * r;           case U_ATAN: return 1.0 / (1.0 + a * a);
    case U_SINH: return std::cosh(a);         case U_ASINH: return 1.0 / std::sqrt(a * a + 1.0);
    case U_COSH: return std::sinh(a);         case U_ACOSH: return 1.0 / (std::sqrt(a - 1.0) * std::sqrt(a + 1.0));
    case U_TANH: return 1.0 - r * r;          default: return 1.0 / ((1.0 - a) * (1.0 + a));
    }
}

// the engine's order: t = top of the stack (pushed last), s = second; "a, b, SUBTRACT" = b - a
static inline double bin(int op, double t, double s)
{
    switch (op) {
    case B_PLUS: return t + s; case B_TIMES: return t * s; case B_SUBTRACT: return t - s;
    case B_DIVIDE: return t / s; default: return std::pow(t, s);
    }
}

static inline double dbin(int op, double t, double s, double r, double dt, double ds)
{
    switch (op) {
    case B_PLUS: return dt + ds;
    case B_TIMES: return dt * s + t * ds;
    case B_SUBTRACT: return dt - ds;
    case B_DIVIDE: return (dt - r * ds) / s;
    default:                                                   // r = t^s
        if (ds == 0.0) return dt == 0.0 ? 0.0 : s * std::pow(t, s - 1.0) * dt;
        if (dt == 0.0) return r * std::log(t) * ds;
        return r * (ds * std::log(t) + s * dt / t);
    }
}

// ------------------------------------------------------------------------------------------------ forms

// One shape (postfix arities) with a radix per position. Codes of a form are numbered by the mixed-radix index
// with the last position turning fastest; ranks are global (offset of the form + index).
struct Form {
    int K = 0, xpos = -1;                      // xpos: left sides, position of the (first) x leaf
    int8_t ar[MAXK], c1[MAXK], c2[MAXK];       // arity; children: c1 = top operand / argument, c2 = second operand
    bool dual[MAXK];                           // left sides: the node may depend on x
    int radix[MAXK];
    uint64_t stride[MAXK], count = 0, offset = 0;
};

static std::vector<Form> shapes(int K)
{
    std::vector<Form> out;
    uint64_t n3 = 1;
    for (int i = 0; i < K; i++) n3 *= 3;
    for (uint64_t c = 0; c < n3; c++) {
        Form f;
        f.K = K;
        uint64_t v = c;
        int st[MAXK], sp = 0;
        bool ok = true;
        for (int i = 0; i < K; i++) {
            const int a = (int)(v % 3);
            v /= 3;
            f.ar[i] = (int8_t)a;
            f.c1[i] = f.c2[i] = -1;
            f.dual[i] = false;
            if (a == 0) st[sp++] = i;
            else if (a == 1) { if (sp < 1) { ok = false; break; } f.c1[i] = (int8_t)st[sp - 1]; st[sp - 1] = i; }
            else {
                if (sp < 2) { ok = false; break; }
                f.c1[i] = (int8_t)st[sp - 1]; f.c2[i] = (int8_t)st[sp - 2]; sp--; st[sp - 1] = i;
            }
        }
        if (ok && sp == 1) out.push_back(f);
    }
    return out;
}

static void finish(Form& f)
{
    f.stride[f.K - 1] = 1;
    for (int i = f.K - 2; i >= 0; i--) f.stride[i] = f.stride[i + 1] * f.radix[i + 1];
    f.count = f.stride[0] * f.radix[0];
}

static std::vector<Form> right_forms(const Grammar& g, int KR)
{
    std::vector<Form> out;
    uint64_t off = 0;
    for (int K = 1; K <= KR; K++)
        for (Form f : shapes(K)) {
            for (int i = 0; i < K; i++) f.radix[i] = f.ar[i] == 0 ? g.nc : f.ar[i] == 1 ? g.nu : g.nb;
            finish(f);
            f.offset = off;
            off += f.count;
            out.push_back(f);
        }
    return out;
}

// x exactly once: one form per shape and leaf j (x at j, radix 1). anyx: leaf j is the first x, the leaves after
// it may be x too (digit nc), so every code with at least one x is enumerated once.
static std::vector<Form> left_forms(const Grammar& g, int KL, bool anyx)
{
    std::vector<Form> out;
    uint64_t off = 0;
    for (int K = 1; K <= KL; K++)
        for (const Form& s : shapes(K))
            for (int j = 0; j < K; j++) {
                if (s.ar[j] != 0) continue;
                Form f = s;
                f.xpos = j;
                for (int i = 0; i < K; i++) {
                    if (f.ar[i] == 0) {
                        f.radix[i] = i == j ? 1 : (anyx && i > j) ? g.nc + 1 : g.nc;
                        f.dual[i] = i == j || (anyx && i > j);
                    } else {
                        f.radix[i] = f.ar[i] == 1 ? g.nu : g.nb;
                        f.dual[i] = f.dual[f.c1[i]] || (f.c2[i] >= 0 && f.dual[f.c2[i]]);
                    }
                }
                finish(f);
                f.offset = off;
                off += f.count;
                out.push_back(f);
            }
    return out;
}

static void decode(const Form& f, uint64_t idx, int* dig)
{
    for (int i = f.K - 1; i >= 0; i--) { dig[i] = (int)(idx % f.radix[i]); idx /= f.radix[i]; }
}

static const Form& form_of(const std::vector<Form>& fs, uint64_t rank)
{
    size_t lo = 0, hi = fs.size();
    while (hi - lo > 1) {
        const size_t mid = (lo + hi) / 2;
        if (fs[mid].offset <= rank) lo = mid; else hi = mid;
    }
    return fs[lo];
}

// A value is usable if finite and not subnormal: a subnormal (0 < |v| < DBL_MIN) has lost precision, e.g.
// exp(e - sinh(4)^2) = 5e-323 keeps 3 significant bits; a prefix with an unusable value is skipped as a whole.
// (--bench keeps subnormal values, as mitm_bench.cu does)
static bool g_subnormal_ok = false;
static inline bool usable(double v) { return std::isfinite(v) && (v == 0.0 || std::fabs(v) >= DBL_MIN || g_subnormal_ok); }

// Right sides: codes with index in [r0, r1) of form f; emit(value, rank) for every usable value.
template <class Emit>
static void enum_R(const Form& f, const Grammar& g, uint64_t r0, uint64_t r1, Emit&& emit)
{
    const int K = f.K;
    int dig[MAXK];
    double val[MAXK];
    uint64_t pr[MAXK];
    decode(f, r0, dig);
    int p = 0;
    for (;;) {
        int i = p;
        for (; i < K; i++) {
            const int d = dig[i];
            double r;
            if (f.ar[i] == 0) r = g.cval[d];
            else if (f.ar[i] == 1) r = un(g.uop[d], val[i - 1]);
            else r = bin(d, val[f.c1[i]], val[f.c2[i]]);
            if (!usable(r)) break;                              // skip every completion of this prefix
            val[i] = r;
            pr[i] = (i ? pr[i - 1] : 0) + (uint64_t)d * f.stride[i];
        }
        if (i == K) { emit(val[K - 1], f.offset + pr[K - 1]); i = K - 1; }
        for (int j = i + 1; j < K; j++) dig[j] = 0;
        while (i >= 0 && ++dig[i] == f.radix[i]) { dig[i] = 0; i--; }
        if (i < 0) break;
        if ((i ? pr[i - 1] : 0) + (uint64_t)dig[i] * f.stride[i] >= r1) break;
        p = i;
    }
}

// Left sides: all codes of form f, value and derivative at x = cext[nc]; emit(value, derivative, rank).
// want_der = false: values only (pair counts as mitm_bench). xonce: a node on the path of x with derivative 0
// makes every completion's derivative 0, so the prefix is skipped. kminT = kappa_min |T| > 0: a node y depending on
// x with |y| < kappa_min |T| |dy/dx| is hypersensitive to x (e.g. tan of exp(x^2) = 1.8e12, whose roots in x lie
// 1e-14 apart: a pseudo-random number), and so is every completion; the prefix is skipped.
template <class Emit>
static void enum_L(const Form& f, const Grammar& g, const double* cext, bool xonce, bool want_der, double kminT,
                   Emit&& emit)
{
    const int K = f.K, nc = g.nc;
    int dig[MAXK] = {0};
    double val[MAXK], der[MAXK];
    int p = 0;
    for (;;) {
        int i = p;
        for (; i < K; i++) {
            const int d = dig[i];
            double r, dr = 0.0;
            if (f.ar[i] == 0) {
                if (i == f.xpos || d == nc) { r = cext[nc]; dr = 1.0; } else r = cext[d];
            } else if (f.ar[i] == 1) {
                const double a = val[i - 1];
                r = un(g.uop[d], a);
                if (want_der && f.dual[i] && der[i - 1] != 0.0) dr = dun(g.uop[d], a, r) * der[i - 1];
            } else {
                const double t = val[f.c1[i]], s = val[f.c2[i]];
                r = bin(d, t, s);
                if (want_der && f.dual[i]) dr = dbin(d, t, s, r, der[f.c1[i]], der[f.c2[i]]);
            }
            if (!usable(r) || !usable(dr) || (xonce && want_der && f.dual[i] && dr == 0.0)) break;
            if (f.ar[i] != 0 && dr != 0.0 && std::fabs(r) < kminT * std::fabs(dr)) break;
            val[i] = r;
            der[i] = dr;
        }
        if (i == K) {
            uint64_t idx = 0;
            for (int j = 0; j < K; j++) idx += (uint64_t)dig[j] * f.stride[j];
            emit(val[K - 1], der[K - 1], f.offset + idx);
            i = K - 1;
        }
        for (int j = i + 1; j < K; j++) dig[j] = 0;
        while (i >= 0 && ++dig[i] == f.radix[i]) { dig[i] = 0; i--; }
        if (i < 0) break;
        p = i;
    }
}

// Value, derivative d/dx and a first-order running bound of the rounding error of one code at x (only for
// candidates). Per operation: arithmetic within 0.5 ulp, library functions within 1 ulp (GAMMA 4 ulp); constants
// rounded to double (integers exact); x itself is exact. A contribution with a zero input error is zero.
static void eval_full(const Form& f, const int* dig, const Grammar& g, double x, double& v, double& dv, double& err)
{
    const double u = DBL_EPSILON;
    double val[MAXK], der[MAXK], e[MAXK];
    auto prop = [](double partial, double ein) { return ein == 0.0 ? 0.0 : std::fabs(partial) * ein; };
    for (int i = 0; i < f.K; i++) {
        const int d = dig[i];
        double r, dr = 0.0, er;
        if (f.ar[i] == 0) {
            if (i == f.xpos || d == g.nc) { r = x; dr = 1.0; er = 0.0; }
            else { r = g.cval[d]; er = r == std::floor(r) ? 0.0 : 0.5 * u * std::fabs(r); }
        } else if (f.ar[i] == 1) {
            const double a = val[i - 1];
            const int op = g.uop[d];
            r = un(op, a);
            const double fa = dun(op, a, r);
            if (der[i - 1] != 0.0) dr = fa * der[i - 1];
            er = prop(fa, e[i - 1]) + (op == U_GAMMA ? 4 : op == U_INV || op == U_SQR || op == U_SQRT ? 0.5 : 1) * u * std::fabs(r);
        } else {
            const double t = val[f.c1[i]], s = val[f.c2[i]], et = e[f.c1[i]], es = e[f.c2[i]];
            r = bin(d, t, s);
            dr = dbin(d, t, s, r, der[f.c1[i]], der[f.c2[i]]);
            double pt, ps;                                     // partial derivatives by t and s
            switch (d) {
            case B_PLUS: pt = 1; ps = 1; break;
            case B_TIMES: pt = s; ps = t; break;
            case B_SUBTRACT: pt = 1; ps = -1; break;
            case B_DIVIDE: pt = 1.0 / s; ps = -r / s; break;
            default: pt = et == 0.0 ? 0.0 : s * std::pow(t, s - 1.0); ps = es == 0.0 ? 0.0 : r * std::log(t); break;
            }
            er = prop(pt, et) + prop(ps, es) + (d == B_POWER ? 1 : 0.5) * u * std::fabs(r);
        }
        val[i] = r;
        der[i] = dr;
        e[i] = er;
    }
    v = val[f.K - 1];
    dv = der[f.K - 1];
    err = e[f.K - 1];
}

static std::string rpn(const Form& f, uint64_t rank, const Grammar& g)
{
    int dig[MAXK];
    decode(f, rank - f.offset, dig);
    std::string s;
    for (int i = 0; i < f.K; i++) {
        if (i) s += ", ";
        if (f.ar[i] == 0) s += (i == f.xpos || dig[i] == g.nc) ? "x" : g.cname[dig[i]];
        else if (f.ar[i] == 1) s += UNAME[g.uop[dig[i]]];
        else s += BNAME[dig[i]];
    }
    return s;
}

// ------------------------------------------------------------------------------------------------ utilities

static double now() { return std::chrono::duration<double>(std::chrono::steady_clock::now().time_since_epoch()).count(); }

static double peak_gb()
{
#ifdef _WIN32
    PROCESS_MEMORY_COUNTERS c;
    GetProcessMemoryInfo(GetCurrentProcess(), &c, sizeof c);
    return c.PeakWorkingSetSize / 1073741824.0;
#else
    struct rusage u;
    getrusage(RUSAGE_SELF, &u);
    return u.ru_maxrss / 1048576.0;
#endif
}

static double cpu_seconds()
{
#ifdef _WIN32
    FILETIME c, e, k, u;
    GetProcessTimes(GetCurrentProcess(), &c, &e, &k, &u);
    auto s = [](FILETIME t) { return (((uint64_t)t.dwHighDateTime << 32) | t.dwLowDateTime) * 1e-7; };
    return s(k) + s(u);
#else
    struct rusage u;
    getrusage(RUSAGE_SELF, &u);
    return u.ru_utime.tv_sec + u.ru_stime.tv_sec + 1e-6 * (u.ru_utime.tv_usec + u.ru_stime.tv_usec);
#endif
}

// order-preserving map of doubles to unsigned integers (-0 must be normalized to +0 by the caller)
static inline uint64_t key_of(double v)
{
    uint64_t b;
    memcpy(&b, &v, 8);
    return (b >> 63) ? ~b : (b | 0x8000000000000000ULL);
}
static inline double val_of(uint64_t k)
{
    const uint64_t b = (k >> 63) ? (k & 0x7FFFFFFFFFFFFFFFULL) : ~k;
    double v;
    memcpy(&v, &b, 8);
    return v;
}

struct Pair { uint64_t key, idx; };

// LSD radix sort by key (stable), 11-bit digits, digits shared by all keys skipped; returns the sorted array
static Pair* radix_sort(Pair* a, Pair* b, size_t n)
{
    if (n < 64) {
        std::stable_sort(a, a + n, [](const Pair& x, const Pair& y) { return x.key < y.key; });
        return a;
    }
    const int BITS = 11, NB = 1 << BITS, PASSES = 6;
    std::vector<size_t> cnt((size_t)PASSES * NB, 0);
    for (size_t i = 0; i < n; i++)
        for (int p = 0; p < PASSES; p++) cnt[(size_t)p * NB + ((a[i].key >> (p * BITS)) & (NB - 1))]++;
    for (int p = 0; p < PASSES; p++) {
        size_t* c = &cnt[(size_t)p * NB];
        if (c[(a[0].key >> (p * BITS)) & (NB - 1)] == n) continue;
        size_t s = 0;
        for (int d = 0; d < NB; d++) { const size_t t = c[d]; c[d] = s; s += t; }
        for (size_t i = 0; i < n; i++) b[c[(a[i].key >> (p * BITS)) & (NB - 1)]++] = a[i];
        std::swap(a, b);
    }
    return a;
}

// first index i with R[i] >= x (n if none), galloping from the hint h
static inline size_t lower_from(const double* R, size_t n, size_t h, double x)
{
    if (n == 0) return 0;
    if (h >= n) h = n - 1;
    if (R[h] < x) {
        size_t lo = h, step = 1;                                // R[lo] < x
        for (;;) {
            size_t hi = lo + step;
            if (hi >= n) return std::lower_bound(R + lo + 1, R + n, x) - R;
            if (R[hi] >= x) return std::lower_bound(R + lo + 1, R + hi, x) - R;
            lo = hi;
            step <<= 1;
        }
    }
    size_t hi = h, step = 1;                                    // R[hi] >= x
    for (;;) {
        if (hi < step) return std::lower_bound(R, R + hi, x) - R;
        const size_t lo = hi - step;
        if (R[lo] < x) return std::lower_bound(R + lo + 1, R + hi, x) - R;
        hi = lo;
        step <<= 1;
    }
}

template <class F>
static void parallel_for(int nthreads, size_t n, F&& f)
{
    std::atomic<size_t> next{0};
    auto work = [&](int tid) {
        for (size_t i; (i = next.fetch_add(1)) < n;) f(tid, i);
    };
    if (nthreads <= 1) { work(0); return; }
    std::vector<std::thread> th;
    for (int t = 0; t < nthreads; t++) th.emplace_back(work, t);
    for (auto& t : th) t.join();
}

// ------------------------------------------------------------------------------------------------ search

struct Options {
    int kl = 5, kr = 6, threads = 1;
    bool common = false, anyx = false, list = false, bench = false;
    double tol_eps = 16, kappa_min = 1.0 / 32, kappa_max = -1, errcap = 1e-12, memcap_gb = 16, bench_T = 0, bench_tol = 0;
    size_t chunk = 1 << 20, maxwin = 1000;
};

struct RTable {
    std::vector<double> v;                                      // distinct values, ascending
    std::vector<uint32_t> r32;                                  // rank of the shortest code of each value
    std::vector<uint64_t> r64;
    bool wide = false;
    uint64_t rank(size_t i) const { return wide ? r64[i] : r32[i]; }
    // every B-th value: a small index (<= 16 MB, mostly in cache) searched first, then one block of v
    std::vector<double> top;
    size_t B = 16;
    void make_index()
    {
        while (v.size() / B > (1u << 21)) B *= 2;
        top.clear();
        for (size_t i = 0; i < v.size(); i += B) top.push_back(v[i]);
    }
    // block j with v[(j-1)B] < x <= v[jB], from a hint in block units
    size_t block(size_t hintb, double x) const { return lower_from(top.data(), top.size(), hintb, x); }
    size_t in_block(size_t j, double x) const
    {
        const size_t lo = j ? (j - 1) * B + 1 : 0, hi = std::min(v.size(), j * B);
        return std::lower_bound(v.data() + lo, v.data() + std::max(lo, hi), x) - v.data();
    }
    // first i with v[i] >= x (v.size() if none), searching from the previous answer
    size_t lower(size_t hint, double x) const
    {
        const size_t j = lower_from(top.data(), top.size(), hint / B, x);   // v[(j-1)B] < x <= v[jB]
        const size_t lo = j ? (j - 1) * B + 1 : 0, hi = std::min(v.size(), j * B);
        return std::lower_bound(v.data() + lo, v.data() + std::max(lo, hi), x) - v.data();
    }
};

struct Ctx {
    Options o;
    Grammar g;
    std::vector<Form> Rf, Lf;
    std::vector<size_t> Lbeg;                                   // Lf index range of length a: [Lbeg[a], Lbeg[a+1])
    std::vector<uint64_t> len_off;                              // len_off[k]: first rank of right sides of length k
    RTable R;
    int rlen(uint64_t rank) const
    {
        int k = 1;
        while (k < o.kr && rank >= len_off[k + 1]) k++;
        return k;
    }
};

static void build_R(Ctx& c)
{
    const int NT = std::max(1, c.o.threads), NBIN = 1 << 20, CACHE = 1 << 16;
    struct Unit { int f; uint64_t r0, r1; };
    std::vector<Unit> units;
    uint64_t total = 0;
    for (int fi = 0; fi < (int)c.Rf.size(); fi++) {
        for (uint64_t r = 0; r < c.Rf[fi].count; r += 1u << 22)
            units.push_back({fi, r, std::min(r + (1u << 22), c.Rf[fi].count)});
        total += c.Rf[fi].count;
    }
    c.R.wide = total > 0xFFFFFFFFULL;
    std::vector<std::vector<uint64_t>> cache(NT, std::vector<uint64_t>(CACHE));
    std::vector<uint64_t> nfinite(NT, 0);

    // every value goes through a small direct-mapped cache (reset per unit, so the result does not depend on the
    // threads): an exact repeat of a recent value is dropped at once; it has a code of lower rank, so the shortest
    // code of every value survives. The same survivors are produced in every pass.
    auto gen = [&](int tid, const Unit& u, auto&& keep) {
        uint64_t* ca = cache[tid].data();
        std::fill(ca, ca + CACHE, ~0ULL);
        uint64_t nf = 0;
        enum_R(c.Rf[u.f], c.g, u.r0, u.r1, [&](double v, uint64_t rank) {
            nf++;
            const uint64_t k = key_of(v + 0.0);
            uint64_t& slot = ca[(k * 0x9E3779B97F4A7C15ULL) >> 48];
            if (slot == k) return;
            slot = k;
            keep(k, rank);
        });
        nfinite[tid] += nf;
    };

    double t0 = now();
    std::vector<std::vector<uint32_t>> hist(NT, std::vector<uint32_t>(NBIN, 0));
    parallel_for(NT, units.size(), [&](int tid, size_t ui) {
        uint32_t* h = hist[tid].data();
        gen(tid, units[ui], [&](uint64_t k, uint64_t) { h[k >> 44]++; });
    });
    std::vector<uint64_t> H(NBIN, 0);
    uint64_t surv = 0, finite = 0;
    for (int t = 0; t < NT; t++) {
        for (int b = 0; b < NBIN; b++) H[b] += hist[t][b];
        finite += nfinite[t];
    }
    hist.clear();
    hist.shrink_to_fit();
    for (int b = 0; b < NBIN; b++) surv += H[b];
    const double t_count = now() - t0;

    // passes over consecutive value ranges (bins), each holding at most `budget` survivors
    const double cap = c.o.memcap_gb * 1073741824.0;
    const size_t rbytes = c.R.wide ? 8 : 4;
    const uint64_t budget = std::max<uint64_t>(1 << 20, (uint64_t)(cap / 4 / sizeof(Pair)));
    std::vector<std::pair<int, int>> passes;
    uint64_t maxpass = 0;
    for (int b = 0; b < NBIN;) {
        if (!H[b]) { b++; continue; }
        const int b0 = b;
        uint64_t n = 0;
        while (b < NBIN && (n == 0 || n + H[b] <= budget)) n += H[b++];
        passes.push_back({b0, b});
        maxpass = std::max(maxpass, n);
    }
    const double upper = surv * (8.0 + rbytes) + maxpass * (double)sizeof(Pair);
    fprintf(stderr, "right sides: %llu codes of length <= %d, %llu finite, %llu after the repeat cache; %zu pass(es) of "
            "<= %llu; memory upper bound %.2f GB (cap %.1f GB); counting %.2f s\n",
            (unsigned long long)total, c.o.kr, (unsigned long long)finite, (unsigned long long)surv, passes.size(),
            (unsigned long long)maxpass, upper / 1073741824.0, c.o.memcap_gb, t_count);
    const uint64_t max_entries = (uint64_t)std::max(0.0, (cap - maxpass * (double)sizeof(Pair)) / (8.0 + rbytes));
    if (max_entries < 1024) { fprintf(stderr, "memory cap too small\n"); exit(3); }
    const uint64_t reserve = std::min(surv, max_entries);
    c.R.v.reserve(reserve);
    if (c.R.wide) c.R.r64.reserve(reserve); else c.R.r32.reserve(reserve);

    std::vector<Pair> buf(maxpass);
    std::vector<std::atomic<uint64_t>> pos(NBIN);
    std::vector<uint64_t> base(NBIN + 1, 0), ndist(NBIN, 0);
    double t_gen = 0, t_sort = 0, t_app = 0;
    for (const auto& ps : passes) {
        const int b0 = ps.first, b1 = ps.second;
        uint64_t o = 0;
        for (int b = b0; b < b1; b++) { base[b] = o; pos[b].store(o); o += H[b]; }
        base[b1] = o;
        double t1 = now();
        parallel_for(NT, units.size(), [&](int tid, size_t ui) {
            gen(tid, units[ui], [&](uint64_t k, uint64_t rank) {
                const int b = (int)(k >> 44);
                if (b < b0 || b >= b1) return;
                buf[pos[b].fetch_add(1, std::memory_order_relaxed)] = {k, rank};
            });
        });
        double t2 = now();
        t_gen += t2 - t1;
        parallel_for(NT, (size_t)(b1 - b0), [&](int, size_t bi) {    // sort each bin by (value, rank), keep the first
            const int b = b0 + (int)bi;
            Pair* s = buf.data() + base[b];
            const size_t n = H[b];
            std::sort(s, s + n, [](const Pair& x, const Pair& y) { return x.key < y.key || (x.key == y.key && x.idx < y.idx); });
            size_t m = 0;
            for (size_t i = 0; i < n; i++)
                if (m == 0 || s[i].key != s[m - 1].key) s[m++] = s[i];
            ndist[b] = m;
        });
        double t3 = now();
        t_sort += t3 - t2;
        for (int b = b0; b < b1; b++) {
            const Pair* s = buf.data() + base[b];
            if (c.R.v.size() + ndist[b] > max_entries) {
                fprintf(stderr, "right-side table exceeds the memory cap (%.1f GB); use a smaller --kr\n", c.o.memcap_gb);
                exit(3);
            }
            for (uint64_t i = 0; i < ndist[b]; i++) {
                c.R.v.push_back(val_of(s[i].key));
                if (c.R.wide) c.R.r64.push_back(s[i].idx); else c.R.r32.push_back((uint32_t)s[i].idx);
            }
        }
        t_app += now() - t3;
    }
    c.R.make_index();
    fprintf(stderr, "right sides: %zu distinct values (%.1f%% of the finite), table %.2f GB; generate %.2f s + sort %.2f s + "
            "append %.2f s; total build %.2f s, peak memory %.2f GB\n",
            c.R.v.size(), 100.0 * c.R.v.size() / std::max<uint64_t>(1, finite),
            c.R.v.size() * (8.0 + rbytes) / 1073741824.0, t_gen, t_sort, t_app, now() - t0, peak_gb());
}

struct Match {
    int total = INT_MAX, la = 0;
    double err = INFINITY;
    uint64_t lrank = 0, rrank = 0;
};

struct Worker {
    const Ctx& c;
    std::vector<double> lv, ld;
    std::vector<uint64_t> lr;
    std::vector<Pair> s1, s2;
    std::vector<uint32_t> qi;
    std::vector<double> qlo;
    std::vector<size_t> qb;
    size_t m = 0, cap = 0;
    void prefetch_block(size_t j) const
    {
        const char* p = (const char*)(c.R.v.data() + (j ? (j - 1) * c.R.B : 0));
        PREFETCH(p);
        PREFETCH(p + 64);
    }
    double T = 0, absT = 1, tolT = 0, tol = 0;
    double cext[17];
    int a = 0;
    Match best, closest;
    uint64_t ncand = 0, nL = 0, nLd = 0, nskip_kappa = 0, nskip_win = 0, nrej_err = 0;
    double t_gen = 0, t_sort = 0, t_match = 0, t_ver = 0, t_in_flush = 0;
    uint64_t sum_L = 0, sum_Ld = 0, sum_cand = 0;
    std::string listing;
    const char* id = "";

    explicit Worker(const Ctx& ctx) : c(ctx)
    {
        cap = ctx.o.chunk;
        lv.resize(cap); ld.resize(cap); lr.resize(cap); s1.resize(cap); s2.resize(cap); qi.resize(cap); qlo.resize(cap); qb.resize(cap);
        tol = ctx.o.tol_eps * DBL_EPSILON;
        for (int i = 0; i < ctx.g.nc; i++) cext[i] = ctx.g.cval[i];
    }

    // Newton from T on L(x) = r; returns the root and, at T, the error bound of L and its derivative
    double newton(uint64_t lrank, double r, double& eL, double& dL) const
    {
        const Form& f = form_of(c.Lf, lrank);
        int dig[MAXK];
        decode(f, lrank - f.offset, dig);
        double x = T;
        for (int it = 0; it < 4; it++) {
            double v, d, e;
            eval_full(f, dig, c.g, x, v, d, e);
            if (it == 0) { eL = e; dL = d; }
            if (!std::isfinite(v) || !std::isfinite(d) || d == 0.0) return NAN;
            const double dx = (v - r) / d;
            if (dx == 0.0) break;
            x -= dx;
        }
        return x;
    }

    // rounding error bound of a right side
    double r_error(uint64_t rrank) const
    {
        const Form& f = form_of(c.Rf, rrank);
        int dig[MAXK];
        decode(f, rrank - f.offset, dig);
        double v, d, e;
        eval_full(f, dig, c.g, 0.0, v, d, e);
        return e;
    }

    void candidate(size_t j, size_t li)
    {
        ncand++;
        const uint64_t rr = c.R.rank(j);
        const int total = a + c.rlen(rr);
        if (!c.o.list && total > best.total) return;
        const double t0 = now();
        double eL = INFINITY, dL = 0;
        const double x = newton(lr[li], c.R.v[j], eL, dL);
        const double err = std::fabs(x - T) / absT;
        // the equation must determine x: rounding errors of both sides, mapped to x, within errcap
        const double ex = (eL + r_error(rr)) / (std::fabs(dL) * absT);
        t_ver += now() - t0;
        if (!(err <= tol)) return;
        if (!(ex <= c.o.errcap)) { nrej_err++; return; }
        if (c.o.list) {
            char b[96];
            snprintf(b, sizeof b, "\t%.5e\t%.2e\n", err, ex);
            listing += std::string("#MATCH\t") + id + "\t" + std::to_string(total) + "\t" +
                       rpn(form_of(c.Lf, lr[li]), lr[li], c.g) + "\t" + rpn(form_of(c.Rf, rr), rr, c.g) + b;
        }
        if (total < best.total || (total == best.total && err < best.err)) best = {total, a, err, lr[li], rr};
    }

    void nearmiss(size_t j, size_t li)
    {
        const double v = lv[li], d = ld[li];
        const double e = std::fabs(v - c.R.v[j]) / (std::fabs(d) * absT);
        if (!(e < closest.err)) return;
        const uint64_t rr = c.R.rank(j);
        closest = {a + c.rlen(rr), a, e, lr[li], rr};
    }

    void flush()
    {
        if (!m) return;
        const double t0 = now();
        for (size_t i = 0; i < m; i++) s1[i] = {key_of(lv[i] + 0.0), i};
        const Pair* s = radix_sort(s1.data(), s2.data(), m);
        const double t1 = now();
        const size_t n = c.R.v.size();
        uint64_t prev = ~0ULL;
        const double ver0 = t_ver;
        // pass 1: distinct left values inside the kappa range, with their windows, in sorted order
        size_t q = 0;
        for (size_t k = 0; k < m; k++) {
            if (s[k].key == prev) continue;                    // same value: the first (shortest) code is kept
            prev = s[k].key;
            nLd++;
            const size_t li = s[k].idx;
            const double v = lv[li], d = std::fabs(ld[li]);
            const double kap = std::fabs(v) / d / absT;
            if (!(kap >= c.o.kappa_min && kap <= c.o.kappa_max)) { nskip_kappa++; continue; }
            qi[q] = (uint32_t)li; qlo[q] = v - tolT * d; q++;
        }
        // pass 2: the block of every window start is located in the small index and prefetched PF entries ahead,
        // so the DRAM latency of the table overlaps
        const int PF = 16;
        size_t hb = 0;
        for (size_t k = 0; k < q && k < (size_t)PF; k++) { qb[k] = c.R.block(hb, qlo[k]); hb = qb[k]; prefetch_block(qb[k]); }
        for (size_t k = 0; k < q; k++) {
            if (k + PF < q) { qb[k + PF] = c.R.block(hb, qlo[k + PF]); hb = qb[k + PF]; prefetch_block(qb[k + PF]); }
            const size_t li = qi[k];
            const double v = lv[li], d = std::fabs(ld[li]), w = tolT * d;
            const size_t lo = c.R.in_block(qb[k], qlo[k]);
            const size_t hi = c.R.lower(lo, std::nextafter(v + w, INFINITY));
            if (hi - lo > c.o.maxwin) { nskip_win++; continue; }
            for (size_t j = lo; j < hi; j++) candidate(j, li);
            if (best.total == INT_MAX) {                       // closest pair, reported for a FAILURE
                if (lo > 0) nearmiss(lo - 1, li);
                if (hi < n) nearmiss(hi, li);
            }
        }
        const double t2 = now();
        t_sort += t1 - t0;
        t_match += (t2 - t1) - (t_ver - ver0);
        t_in_flush += t2 - t0;
        m = 0;
    }

    std::string run(const char* id_, double T_)
    {
        id = id_;
        T = T_;
        absT = T != 0.0 ? std::fabs(T) : 1.0;
        tolT = tol * absT;
        cext[c.g.nc] = T;
        best = Match();
        closest = Match();
        ncand = nL = nLd = 0;
        listing.clear();
        const double t0 = now(), f0 = t_in_flush;
        const bool xonce = !c.o.anyx;
        for (a = 1; a <= c.o.kl; a++) {
            if (!c.o.list && best.total <= a + 1) break;          // no shorter equation possible any more
            for (size_t fi = c.Lbeg[a]; fi < c.Lbeg[a + 1]; fi++)
                enum_L(c.Lf[fi], c.g, cext, xonce, true, T != 0.0 ? c.o.kappa_min * absT : 0.0, [&](double v, double d, uint64_t r) {
                    if (d == 0.0) return;
                    nL++;
                    lv[m] = v; ld[m] = d; lr[m] = r;
                    if (++m == cap) flush();
                });
            flush();
        }
        const double ms = (now() - t0) * 1e3;
        t_gen += (now() - t0) - (t_in_flush - f0);
        sum_L += nL; sum_Ld += nLd; sum_cand += ncand;
        const bool ok = best.total != INT_MAX;
        const Match& b = ok ? best : closest;
        char line[4096];
        if (b.total == INT_MAX)
            snprintf(line, sizeof line, "%s\tFAILURE\t0\t\t\t%.5e\t%llu\t%.1f\n", id, 1.0, (unsigned long long)ncand, ms);
        else
            snprintf(line, sizeof line, "%s\t%s\t%d\t%s\t%s\t%.5e\t%llu\t%.1f\n", id, ok ? "SUCCESS" : "FAILURE", b.total,
                     rpn(form_of(c.Lf, b.lrank), b.lrank, c.g).c_str(), rpn(form_of(c.Rf, b.rrank), b.rrank, c.g).c_str(),
                     b.err, (unsigned long long)ncand, ms);
        return listing + line;
    }
};

// mitm_bench.cu's count: L with x any number of times, both sides deduplicated by value, |L - R| <= tolrel |L|
static void bench(Ctx& c)
{
    double t0 = now();
    double cext[17];
    for (int i = 0; i < c.g.nc; i++) cext[i] = c.g.cval[i];
    cext[c.g.nc] = c.o.bench_T;
    std::vector<uint64_t> keys;
    for (const Form& f : c.Lf)
        enum_L(f, c.g, cext, false, false, 0.0, [&](double v, double, uint64_t) {
            if (v != 0.0) keys.push_back(key_of(v));
        });
    const size_t nfin = keys.size();
    std::sort(keys.begin(), keys.end());
    keys.erase(std::unique(keys.begin(), keys.end()), keys.end());
    double t1 = now();
    const double* Rv = c.R.v.data();
    const size_t n = c.R.v.size();
    size_t hint = 0;
    unsigned long long pairs = 0;
    for (uint64_t k : keys) {
        const double v = val_of(k), w = c.o.bench_tol * std::fabs(v);
        const size_t lo = c.R.lower(hint, v - w);
        hint = lo;
        size_t hi = lo;
        while (hi < n && Rv[hi] <= v + w) hi++;
        pairs += hi - lo;
    }
    fprintf(stderr, "bench: T = %.17g, tolrel %g: |L| = %zu finite non-zero, %zu distinct; |R| = %zu distinct (incl. 0); "
            "%llu pairs; left sides %.2f s, sweep %.2f s\n",
            c.o.bench_T, c.o.bench_tol, nfin, keys.size(), c.R.v.size(), pairs, t1 - t0, now() - t1);
    printf("%llu\n", pairs);
}

static int eval_mode(const Grammar& g, const char* code, double x)
{
    std::vector<double> st;
    std::string s(code);
    size_t p = 0;
    while (p < s.size()) {
        size_t q = s.find(',', p);
        if (q == std::string::npos) q = s.size();
        std::string t = s.substr(p, q - p);
        t.erase(0, t.find_first_not_of(' '));
        t.erase(t.find_last_not_of(' ') + 1);
        p = q + 1;
        bool done = false;
        if (t == "x") { st.push_back(x); done = true; }
        for (int i = 0; i < g.nc && !done; i++) if (t == g.cname[i]) { st.push_back(g.cval[i]); done = true; }
        for (int i = 0; i < 18 && !done; i++)
            if (t == UNAME[i]) { if (st.empty()) return 2; st.back() = un(i, st.back()); done = true; }
        for (int i = 0; i < 5 && !done; i++)
            if (t == BNAME[i]) {
                if (st.size() < 2) return 2;
                const double top = st.back();
                st.pop_back();
                st.back() = bin(i, top, st.back());
                done = true;
            }
        if (!done) { fprintf(stderr, "unknown token '%s'\n", t.c_str()); return 2; }
    }
    if (st.size() != 1) return 2;
    printf("%.17g\n", st[0]);
    return 0;
}

int main(int argc, char** argv)
{
    Ctx c;
    Options& o = c.o;
    const char* eval_code = nullptr;
    double eval_x = 0;
    for (int i = 1; i < argc; i++) {
        std::string a = argv[i];
        auto next = [&]() { if (i + 1 >= argc) { fprintf(stderr, "missing value for %s\n", a.c_str()); exit(2); } return argv[++i]; };
        if (a == "--kl") o.kl = atoi(next());
        else if (a == "--kr") o.kr = atoi(next());
        else if (a == "--common") o.common = true;
        else if (a == "--anyx") o.anyx = true;
        else if (a == "--list") o.list = true;
        else if (a == "--tol") o.tol_eps = atof(next());
        else if (a == "--kappa-min") o.kappa_min = atof(next());
        else if (a == "--kappa-max") o.kappa_max = atof(next());
        else if (a == "--errcap") o.errcap = atof(next());
        else if (a == "--maxwin") o.maxwin = (size_t)atof(next());
        else if (a == "--threads") o.threads = atoi(next());
        else if (a == "--memcap") o.memcap_gb = atof(next());
        else if (a == "--chunk") o.chunk = (size_t)atof(next());
        else if (a == "--bench") { o.bench = true; o.anyx = true; g_subnormal_ok = true; o.bench_T = atof(next()); o.bench_tol = atof(next()); }
        else if (a == "--eval") { eval_code = next(); eval_x = atof(next()); }
        else { fprintf(stderr, "unknown option %s (see the header of mitm_cr.cpp)\n", a.c_str()); return 2; }
    }
    c.g = o.common ? common_grammar() : calc4();
    if (o.kappa_max < 0) o.kappa_max = 2 * o.tol_eps;          // rounding L(T) alone moves x by up to eps kappa / 2
    if (eval_code) return eval_mode(c.g, eval_code, eval_x);
    if (o.kl < 1 || o.kl > MAXK || o.kr < 1 || o.kr > MAXK || o.chunk < 1) { fprintf(stderr, "bad lengths\n"); return 2; }
    const double T0 = now(), C0 = cpu_seconds();

    c.Rf = right_forms(c.g, o.kr);
    c.len_off.assign(o.kr + 2, 0);
    for (const Form& f : c.Rf) if (!c.len_off[f.K] && f.offset) c.len_off[f.K] = f.offset;
    c.len_off[o.kr + 1] = c.Rf.back().offset + c.Rf.back().count;
    c.Lf = left_forms(c.g, o.kl, o.anyx);
    c.Lbeg.assign(o.kl + 2, c.Lf.size());
    for (size_t i = c.Lf.size(); i-- > 0;) c.Lbeg[c.Lf[i].K] = i;
    for (int a = o.kl; a >= 1; a--) if (c.Lbeg[a] > c.Lbeg[a + 1]) c.Lbeg[a] = c.Lbeg[a + 1];
    const uint64_t nLcodes = c.Lf.back().offset + c.Lf.back().count;
    fprintf(stderr, "grammar %s (%d constants, %d functions, %d operators); left sides: x %s, length <= %d, %llu codes "
            "per target; tol %g eps, kappa %g..%g, errcap %g, maxwin %zu, %d thread(s)\n",
            o.common ? "common (RIES -S123456789pefrqslE+-*/^)" : "CALC4", c.g.nc, c.g.nu, c.g.nb,
            o.anyx ? "any number of times" : "exactly once", o.kl, (unsigned long long)nLcodes, o.tol_eps, o.kappa_min, o.kappa_max, o.errcap, o.maxwin, o.threads);

    build_R(c);
    const double t_R = now() - T0, cpu_R = cpu_seconds() - C0;
    if (o.bench) { bench(c); return 0; }

    std::vector<std::string> ids;
    std::vector<double> vals;
    char line[512], id[256];
    while (fgets(line, sizeof line, stdin)) {
        double v;
        if (sscanf(line, "%255s %lf", id, &v) == 2) { ids.push_back(id); vals.push_back(v); }
    }
    const int NT = std::max(1, o.threads);
    std::vector<Worker*> workers;
    for (int t = 0; t < NT; t++) workers.push_back(new Worker(c));
    std::vector<std::string> out(ids.size());
    std::vector<char> done(ids.size(), 0);
    size_t next_print = 0;
    std::mutex mu;
    const double t1 = now();
    parallel_for(NT, ids.size(), [&](int tid, size_t i) {
        std::string r = workers[tid]->run(ids[i].c_str(), vals[i]);
        std::lock_guard<std::mutex> lk(mu);
        out[i] = std::move(r);
        done[i] = 1;
        while (next_print < ids.size() && done[next_print]) {
            fputs(out[next_print].c_str(), stdout);
            out[next_print].clear();
            next_print++;
        }
        fflush(stdout);
    });
    const double t_T = now() - t1;
    double g = 0, s = 0, mt = 0, v = 0;
    uint64_t nl = 0, nld = 0, nc = 0, sk = 0, sw = 0, re = 0;
    for (Worker* w : workers) {
        g += w->t_gen; s += w->t_sort; mt += w->t_match; v += w->t_ver; nl += w->sum_L; nld += w->sum_Ld; nc += w->sum_cand;
        sk += w->nskip_kappa; sw += w->nskip_win; re += w->nrej_err;
    }
    fprintf(stderr, "targets: %zu in %.2f s wall (%.1f ms each); summed over threads: left sides %.2f s, sort %.2f s, "
            "match %.2f s, verify %.2f s; %llu left values (%llu distinct per chunk; skipped: %llu by kappa, %llu by "
            "window), %llu candidates (%llu rejected by errcap)\n",
            ids.size(), t_T, ids.empty() ? 0.0 : 1e3 * t_T / ids.size(), g, s, mt, v, (unsigned long long)nl,
            (unsigned long long)nld, (unsigned long long)sk, (unsigned long long)sw, (unsigned long long)nc,
            (unsigned long long)re);
    fprintf(stderr, "total: %.2f s wall (right sides %.2f s), CPU %.2f s (right sides %.2f s), peak memory %.2f GB\n",
            now() - T0, t_R, cpu_seconds() - C0, cpu_R, peak_gb());
    for (Worker* w : workers) delete w;
    return 0;
}
