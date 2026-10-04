// mitm_cr.cpp - meet-in-the-middle constant recognition on the CPU (Phase 1 of the RIES speed-up)
//
// Author: Andrzej Odrzywolek
// Date: October 3, 2026
// Code assist: Claude Opus 5.5
//
// Finds equations L(x) = R that hold at a target value T. L is a postfix code containing x (by default exactly
// once), R a code without x, both over a set of calculator buttons: by default CALC4 (C/CALC4.h: 13 constants,
// 18 functions, 5 operators), with --common the symbols CALC4 shares with RIES's defaults (1..9, pi, e, phi; ln,
// exp, 1/x, sqrt, x^2; + * - / ^), or any set given by name (--consts, --funcs, --ops; also ZERO, the extra
// constants GLAISHER, CATALAN, KHINCHIN, EULERGAMMA, integers such as 10 or 29, MINUS, LOGARITHM). As RIES, it
// meets in the middle: instead of evaluating every formula of length |L| + |R|, it evaluates the two halves
// separately and matches sorted values. Unlike RIES:
//   * codes are enumerated without dead ends: valid postfix shapes, then every button assignment by an odometer
//     whose last position turns fastest; only the positions that changed are evaluated again (the value of every
//     node is kept per position: no stack, no undo); a prefix with an unusable value is skipped as a whole
//   * the right sides do not depend on the target: they are built once, deduplicated by value (the shortest code
//     kept for every double), sorted, and kept as one table per length; all targets of a batch reuse them
//   * left sides are evaluated per target together with their derivative d/dx (dual numbers), sorted and
//     deduplicated in chunks; each chunk is matched against the tables in one sweep: a small index of every
//     B-th value (mostly in cache) is searched by galloping from the previous position, and the block of the
//     largest table is prefetched 16 left values ahead, so the DRAM latency of the lookups overlaps
//
// Matching. A pair (L, R) is a candidate if the Newton root x* = T - (L(T) - R)/L'(T) satisfies
// |x* - T| <= tol |T|, i.e. |L(T) - R| <= tol |T| |L'(T)|. tol is 16 DBL_EPSILON by default (exact targets, as the
// Constant Recognition engine) or larger for a target with an uncertainty (--tolrel). For every left side the
// right-side tables are searched by increasing length, closest values first, so the first accepted pair of a left
// side is its shortest and most accurate equation. A candidate is refined by Newton steps on L(x) = R from T and
// accepted if the root stays within tol |T|. Guards against equations that hold at T without saying anything
// about T (not in the plan; found necessary on the first tests, see PHASE1_RESULTS.md):
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
//   * sin, cos and tan on the path of x take arguments up to periodic_max = 32 (about 10 pi) in magnitude:
//     beyond, the equation fixes x only modulo the period (sin(pi x / 4) = 1 for every integer x = 2 mod 8)
//   * at most maxtry right sides per left side and length are tried, closest first (a guard of the running time)
//   * running error bounds of both sides at T (first order, per operation 0.5-4 ulp), divided by |L'(T)| |T|,
//     must be <= max(errcap, tol): the equation, evaluated in double precision, must determine x at all.
// Per target, the accepted equation with the smallest total length |L| + |R| is reported (ties: the smallest
// error), as Constant Recognition reports the shortest formula. Left sides are processed by increasing length,
// and the search stops as soon as no shorter equation is possible. Besides, the closest pair of every total length
// is kept (the best approximations, shown by the web page).
//
// Output, one tab-separated line per target (statistics and timings go to stderr):
//   id  SUCCESS|FAILURE  total_length  LHS_RPN  RHS_RPN  rel_err  candidates  ms
// RPN in Constant Recognition's button names, x for the unknown, with the engine's operand order (C/CALC4.h):
// "a, b, SUBTRACT" is b - a, "a, b, POWER" is b^a, "a, b, LOGARITHM" is log_b(a). For a FAILURE the closest pair
// found is shown. rel_err is |x - T| / |T| for the refined root x. candidates = pairs inside the value window.
//
// Build: icx /O3 /fp:precise /std:c++17 /EHsc mitm_cr.cpp   (or cl /O2 ..., g++ -O3 -std=c++17 -pthread ...)
//        IEEE semantics are required (non-finite values are tested): never build with fast-math.
//        WebAssembly: mitm_wasm.cpp includes this file with MITM_LIBRARY defined (no main), see build_mitm_wasm.bat.
// Usage: mitm_cr [--kl 5] [--kr 6] [--common] [--consts LIST --funcs LIST --ops LIST] [--anyx] [--tol 16]
//                [--tolrel r] [--kappa-min 0.03125] [--kappa-max 2*tol] [--errcap 1e-12] [--maxtry 32] [--periodic-max 32]
//                [--threads 1] [--memcap 16] [--chunk 1048576] [--list] < targets
//                (targets: lines "id value"; tol in DBL_EPSILON, tolrel relative; --list prints every accepted
//                equation as #MATCH; LIST = comma-separated button names, e.g. --funcs LOG,EXP,SQRT)
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

// MITM_HD: functions shared with the GPU kernels (gpu/mitm_cuda.cu includes this file); empty for other compilers
#ifdef __CUDACC__
#define MITM_HD __host__ __device__
#else
#define MITM_HD
#endif

static const int MAXK = 12;
static bool g_verbose = true;                                    // statistics on stderr (off in the library)

// ------------------------------------------------------------------------------------------------ grammar

// SINPI, COSPI, TANPI, ROOT, ATAN2: RIES's symbols S, C, T, v, A (not calculator buttons), with RIES's rules:
// sin(pi a), cos(pi a), tan(pi a) only for |a| <= 1; "a, b, ROOT" = the b-th root of a (RIES "a b v"), a negative
// a only for the cube root; "a, b, ATAN2" = atan2(a, b) (RIES "a b A")
enum { U_LOG, U_EXP, U_INV, U_GAMMA, U_SQRT, U_SQR, U_SIN, U_ASIN, U_COS, U_ACOS, U_TAN, U_ATAN,
       U_SINH, U_ASINH, U_COSH, U_ACOSH, U_TANH, U_ATANH, U_MINUS, U_SINPI, U_COSPI, U_TANPI, U_COUNT };
static const char* UNAME[U_COUNT] = {"LOG", "EXP", "INV", "GAMMA", "SQRT", "SQR", "SIN", "ARCSIN", "COS", "ARCCOS",
                                     "TAN", "ARCTAN", "SINH", "ARCSINH", "COSH", "ARCCOSH", "TANH", "ARCTANH",
                                     "MINUS", "SINPI", "COSPI", "TANPI"};
enum { B_PLUS, B_TIMES, B_SUBTRACT, B_DIVIDE, B_POWER, B_LOGARITHM, B_ROOT, B_ATAN2, B_COUNT };
static const char* BNAME[B_COUNT] = {"PLUS", "TIMES", "SUBTRACT", "DIVIDE", "POWER", "LOGARITHM", "ROOT", "ATAN2"};

struct Grammar {
    int nc = 0, nu = 0, nb = 0;
    std::vector<double> cval;                                    // constants (x is not among them)
    std::vector<std::string> cname;
    std::vector<int> uop, bop;                                   // operation codes of the function and operator buttons
};

// Constant buttons by name (C/CALC4.h, C/extra_constants.h); a decimal integer is a numeric literal
static bool constant_value(const std::string& name, double& v)
{
    struct { const char* name; double value; } table[] = {
        {"PI", M_PI}, {"EULER", M_E}, {"NEG", -1.0}, {"GOLDENRATIO", 1.61803398874989484820458683436563812},
        {"ZERO", 0.0}, {"ONE", 1}, {"TWO", 2}, {"THREE", 3}, {"FOUR", 4}, {"FIVE", 5}, {"SIX", 6}, {"SEVEN", 7},
        {"EIGHT", 8}, {"NINE", 9},
        {"GLAISHER", 1.28242712910062263687534256886979172776768892732500},
        {"CATALAN", 0.91596559417721901505460351493238411077414937428167},
        {"KHINCHIN", 2.68545200106530644530971483548179569382038229399446},
        {"EULERGAMMA", 0.57721566490153286060651209008240243104215933593992}};
    for (const auto& t : table)
        if (name == t.name) { v = t.value; return true; }
    if (!name.empty() && name.find_first_not_of("0123456789") == std::string::npos && name.size() <= 9) {
        v = (double)strtol(name.c_str(), nullptr, 10);
        return true;
    }
    return false;
}

static std::vector<std::string> split_names(const std::string& s)
{
    std::vector<std::string> out;
    size_t p = 0;
    while (p <= s.size()) {
        size_t q = s.find(',', p);
        if (q == std::string::npos) q = s.size();
        std::string t = s.substr(p, q - p);
        t.erase(0, t.find_first_not_of(' '));
        t.erase(t.find_last_not_of(' ') + 1);
        if (!t.empty()) out.push_back(t);
        p = q + 1;
    }
    return out;
}

// Buttons from comma-separated names; returns an error message, or "" on success
static std::string make_grammar(Grammar& g, const std::string& consts, const std::string& funcs, const std::string& ops)
{
    g = Grammar();
    for (const std::string& n : split_names(consts)) {
        double v;
        if (!constant_value(n, v)) return "unknown constant " + n;
        g.cval.push_back(v);
        g.cname.push_back(n);
    }
    for (const std::string& n : split_names(funcs)) {
        int op = -1;
        for (int i = 0; i < U_COUNT; i++) if (n == UNAME[i]) op = i;
        if (op < 0) return "unknown function " + n;
        g.uop.push_back(op);
    }
    for (const std::string& n : split_names(ops)) {
        int op = -1;
        for (int i = 0; i < B_COUNT; i++) if (n == BNAME[i]) op = i;
        if (op < 0) return "unknown operator " + n;
        g.bop.push_back(op);
    }
    g.nc = (int)g.cval.size();
    g.nu = (int)g.uop.size();
    g.nb = (int)g.bop.size();
    if (g.nc == 0) return "no constant";
    return "";
}

static const char* CALC4_CONSTS = "PI,EULER,NEG,GOLDENRATIO,ONE,TWO,THREE,FOUR,FIVE,SIX,SEVEN,EIGHT,NINE";
static const char* CALC4_FUNCS = "LOG,EXP,INV,GAMMA,SQRT,SQR,SIN,ARCSIN,COS,ARCCOS,TAN,ARCTAN,SINH,ARCSINH,COSH,"
                                 "ARCCOSH,TANH,ARCTANH";
static const char* CALC4_OPS = "PLUS,TIMES,SUBTRACT,DIVIDE,POWER";
static const char* COMMON_CONSTS = "PI,EULER,GOLDENRATIO,ONE,TWO,THREE,FOUR,FIVE,SIX,SEVEN,EIGHT,NINE";
static const char* COMMON_FUNCS = "LOG,EXP,INV,SQRT,SQR";

MITM_HD static double digamma(double x)
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

MITM_HD static inline double un(int op, double a)
{
    switch (op) {
    case U_LOG: return std::log(a);    case U_EXP: return std::exp(a);     case U_INV: return 1.0 / a;
    case U_GAMMA: return std::tgamma(a); case U_SQRT: return std::sqrt(a); case U_SQR: return a * a;
    case U_SIN: return std::sin(a);    case U_ASIN: return std::asin(a);   case U_COS: return std::cos(a);
    case U_ACOS: return std::acos(a);  case U_TAN: return std::tan(a);     case U_ATAN: return std::atan(a);
    case U_SINH: return std::sinh(a);  case U_ASINH: return std::asinh(a); case U_COSH: return std::cosh(a);
    case U_ACOSH: return std::acosh(a); case U_TANH: return std::tanh(a);  case U_ATANH: return std::atanh(a);
    case U_SINPI: return std::fabs(a) <= 1.0 ? std::sin(M_PI * a) : NAN;  // RIES: arguments |a| <= 1 only
    case U_COSPI: return std::fabs(a) <= 1.0 ? std::cos(M_PI * a) : NAN;
    case U_TANPI: return std::fabs(a) <= 1.0 ? std::tan(M_PI * a) : NAN;
    default: return -a;                                                    // U_MINUS
    }
}

// f'(a), given r = f(a)
MITM_HD static inline double dun(int op, double a, double r)
{
    switch (op) {
    case U_LOG: return 1.0 / a;               case U_EXP: return r;                 case U_INV: return -r * r;
    case U_GAMMA: return r * digamma(a);      case U_SQRT: return 0.5 / r;          case U_SQR: return 2.0 * a;
    case U_SIN: return std::cos(a);           case U_ASIN: return 1.0 / std::sqrt((1.0 - a) * (1.0 + a));
    case U_COS: return -std::sin(a);          case U_ACOS: return -1.0 / std::sqrt((1.0 - a) * (1.0 + a));
    case U_TAN: return 1.0 + r * r;           case U_ATAN: return 1.0 / (1.0 + a * a);
    case U_SINH: return std::cosh(a);         case U_ASINH: return 1.0 / std::sqrt(a * a + 1.0);
    case U_COSH: return std::sinh(a);         case U_ACOSH: return 1.0 / (std::sqrt(a - 1.0) * std::sqrt(a + 1.0));
    case U_TANH: return 1.0 - r * r;          case U_ATANH: return 1.0 / ((1.0 - a) * (1.0 + a));
    case U_SINPI: return M_PI * std::cos(M_PI * a);
    case U_COSPI: return -M_PI * std::sin(M_PI * a);
    case U_TANPI: return M_PI * (1.0 + r * r);
    default: return -1.0;                                                  // U_MINUS
    }
}

// the engine's order: t = top of the stack (pushed last), s = second; "a, b, SUBTRACT" = b - a,
// "a, b, LOGARITHM" = log_b(a) = ln a / ln b
MITM_HD static inline double bin(int op, double t, double s)
{
    switch (op) {
    case B_PLUS: return t + s; case B_TIMES: return t * s; case B_SUBTRACT: return t - s;
    case B_DIVIDE: return t / s; case B_POWER: return std::pow(t, s);
    case B_ROOT:                                                           // the t-th root of s, as RIES's "s t v"
        if (t == 0.0) return NAN;
        if (s < 0.0) return t == 3.0 ? -std::pow(-s, 1.0 / 3.0) : NAN;
        return std::pow(s, 1.0 / t);
    case B_ATAN2: return std::atan2(s, t);                                 // RIES's "s t A" = atan2(s, t)
    default: return std::log(s) / std::log(t);                             // B_LOGARITHM
    }
}

MITM_HD static inline double dbin(int op, double t, double s, double r, double dt, double ds)
{
    switch (op) {
    case B_PLUS: return dt + ds;
    case B_TIMES: return dt * s + t * ds;
    case B_SUBTRACT: return dt - ds;
    case B_DIVIDE: return (dt - r * ds) / s;
    case B_POWER:                                              // r = t^s
        if (ds == 0.0) return dt == 0.0 ? 0.0 : s * std::pow(t, s - 1.0) * dt;
        if (dt == 0.0) return r * std::log(t) * ds;
        return r * (ds * std::log(t) + s * dt / t);
    case B_ROOT:                                               // r = s^(1/t)
        return (ds == 0.0 ? 0.0 : r * ds / (s * t)) - (dt == 0.0 ? 0.0 : r * std::log(s) * dt / (t * t));
    case B_ATAN2:                                              // r = atan2(s, t)
        return (t * ds - s * dt) / (t * t + s * s);
    default: {                                                 // r = ln s / ln t
        const double lt = std::log(t);
        return ((ds == 0.0 ? 0.0 : ds / s) - (dt == 0.0 ? 0.0 : r * dt / t)) / lt;
    }
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

// a shape is usable if every position has at least one button (no functions: no unary positions, etc.)
static bool usable_shape(const Form& f, const Grammar& g)
{
    for (int i = 0; i < f.K; i++)
        if ((f.ar[i] == 1 && g.nu == 0) || (f.ar[i] == 2 && g.nb == 0)) return false;
    return true;
}

static std::vector<Form> right_forms(const Grammar& g, int KR)
{
    std::vector<Form> out;
    uint64_t off = 0;
    for (int K = 1; K <= KR; K++)
        for (Form f : shapes(K)) {
            if (!usable_shape(f, g)) continue;
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
        for (const Form& s : shapes(K)) {
            if (!usable_shape(s, g)) continue;
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
        }
    return out;
}

MITM_HD static void decode(const Form& f, uint64_t idx, int* dig)
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
    const double* cval = g.cval.data();
    const int* uop = g.uop.data();
    const int* bop = g.bop.data();
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
            if (f.ar[i] == 0) r = cval[d];
            else if (f.ar[i] == 1) r = un(uop[d], val[i - 1]);
            else r = bin(bop[d], val[f.c1[i]], val[f.c2[i]]);
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
// 1e-14 apart: a pseudo-random number), and so is every completion; the prefix is skipped. pmax > 0: sin, cos, tan
// of an argument that depends on x and exceeds pmax in magnitude are skipped too: they hold x only modulo their
// period (sin(pi x / 4) = 1 for every integer x = 2 mod 8, e.g. 299792458).
MITM_HD static inline bool periodic(int op) { return op == U_SIN || op == U_COS || op == U_TAN; }

template <class Emit>
static void enum_L(const Form& f, const Grammar& g, const double* cext, bool xonce, bool want_der, double kminT,
                   double pmax, Emit&& emit)
{
    const int K = f.K, nc = g.nc;
    const int* uop = g.uop.data();
    const int* bop = g.bop.data();
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
                if (pmax > 0 && periodic(uop[d]) && der[i - 1] != 0.0 && std::fabs(a) > pmax) break;
                r = un(uop[d], a);
                if (want_der && f.dual[i] && der[i - 1] != 0.0) dr = dun(uop[d], a, r) * der[i - 1];
            } else {
                const double t = val[f.c1[i]], s = val[f.c2[i]];
                r = bin(bop[d], t, s);
                if (want_der && f.dual[i]) dr = dbin(bop[d], t, s, r, der[f.c1[i]], der[f.c2[i]]);
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
// candidates). Per operation: arithmetic within 0.5 ulp, library functions within 1 ulp (GAMMA 4 ulp, LOGARITHM
// 2 ulp); constants rounded to double (integers exact); x itself is exact. A contribution with a zero input error
// is zero. G: Grammar, or the GPU's copy of the buttons (members cval, uop, bop, nc).
template <class G>
MITM_HD static void eval_full(const Form& f, const int* dig, const G& g, double x, double& v, double& dv, double& err)
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
            const double w = op == U_GAMMA ? 4 : op == U_MINUS ? 0 : op == U_INV || op == U_SQR || op == U_SQRT ? 0.5 : 1;
            er = prop(fa, e[i - 1]) + w * u * std::fabs(r);
            if (op == U_SINPI || op == U_COSPI || op == U_TANPI) er += u * std::fabs(a * fa);   // rounding of pi a
        } else {
            const int op = g.bop[d];
            const double t = val[f.c1[i]], s = val[f.c2[i]], et = e[f.c1[i]], es = e[f.c2[i]];
            r = bin(op, t, s);
            dr = dbin(op, t, s, r, der[f.c1[i]], der[f.c2[i]]);
            double pt, ps;                                     // partial derivatives by t and s
            switch (op) {
            case B_PLUS: pt = 1; ps = 1; break;
            case B_TIMES: pt = s; ps = t; break;
            case B_SUBTRACT: pt = 1; ps = -1; break;
            case B_DIVIDE: pt = 1.0 / s; ps = -r / s; break;
            case B_POWER: pt = et == 0.0 ? 0.0 : s * std::pow(t, s - 1.0); ps = es == 0.0 ? 0.0 : r * std::log(t); break;
            case B_ROOT: pt = et == 0.0 ? 0.0 : -r * std::log(std::fabs(s)) / (t * t); ps = es == 0.0 ? 0.0 : r / (s * t); break;
            case B_ATAN2: pt = -s / (t * t + s * s); ps = t / (t * t + s * s); break;
            default: pt = et == 0.0 ? 0.0 : -r / (t * std::log(t)); ps = es == 0.0 ? 0.0 : 1.0 / (s * std::log(t)); break;
            }
            er = prop(pt, et) + prop(ps, es) +
                 (op == B_LOGARITHM || op == B_ROOT ? 2 : op == B_POWER || op == B_ATAN2 ? 1 : 0.5) * u * std::fabs(r);
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
        if (f.ar[i] == 0) s += (i == f.xpos || dig[i] == g.nc) ? std::string("x") : g.cname[dig[i]];
        else if (f.ar[i] == 1) s += UNAME[g.uop[dig[i]]];
        else s += BNAME[g.bop[dig[i]]];
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
#elif defined(__EMSCRIPTEN__)
    return 0.0;
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
#elif defined(__EMSCRIPTEN__)
    return now();
#else
    struct rusage u;
    getrusage(RUSAGE_SELF, &u);
    return u.ru_utime.tv_sec + u.ru_stime.tv_sec + 1e-6 * (u.ru_utime.tv_usec + u.ru_stime.tv_usec);
#endif
}

// order-preserving map of doubles to unsigned integers (-0 must be normalized to +0 by the caller)
MITM_HD static inline uint64_t key_of(double v)
{
    uint64_t b;
    memcpy(&b, &v, 8);
    return (b >> 63) ? ~b : (b | 0x8000000000000000ULL);
}
MITM_HD static inline double val_of(uint64_t k)
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
    bool anyx = false, list = false, bench = false;
    double tol_eps = 16, tolrel = 0, kappa_min = 1.0 / 32, kappa_max = -1, errcap = 1e-12, memcap_gb = 16;
    double periodic_max = 32;                                   // sin, cos, tan on the path of x: |argument| <= 32
    double bench_T = 0, bench_tol = 0;
    size_t chunk = 1 << 20, maxtry = 32, list_cap = 0;     // list_cap: accepted equations kept per target (library)
    std::string consts = CALC4_CONSTS, funcs = CALC4_FUNCS, ops = CALC4_OPS;
};

// Right sides of one length: distinct values, ascending, with the rank of the shortest code of each value
struct RTable {
    std::vector<double> v;
    std::vector<uint32_t> r32;
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
        if (v.empty()) return 0;
        return in_block(lower_from(top.data(), top.size(), hint / B, x), x);
    }
    double gb() const { return v.size() * (8.0 + (wide ? 8 : 4)) / 1073741824.0; }
};

struct BuildStats {
    uint64_t codes = 0, finite = 0, survivors = 0, distinct = 0;
    int passes = 0;
    double seconds = 0, gb = 0;
    std::string error;
};

struct Ctx {
    Options o;
    Grammar g;
    std::vector<Form> Rf, Lf;
    std::vector<size_t> Lbeg;                                   // Lf index range of length a: [Lbeg[a], Lbeg[a+1])
    std::vector<uint64_t> len_off;                              // len_off[k]: first rank of right sides of length k
    std::vector<RTable> Rb;                                     // Rb[b]: right sides of length b, b = 1..kr
    BuildStats stats;
    int rlen(uint64_t rank) const
    {
        int k = 1;
        while (k < o.kr && rank >= len_off[k + 1]) k++;
        return k;
    }
};

static void setup_right(Ctx& c)
{
    c.Rf = right_forms(c.g, c.o.kr);
    c.len_off.assign(c.o.kr + 2, 0);
    for (int k = c.o.kr + 1; k >= 1; k--) c.len_off[k] = c.Rf.empty() ? 0 : c.Rf.back().offset + c.Rf.back().count;
    for (size_t i = c.Rf.size(); i-- > 0;) c.len_off[c.Rf[i].K] = c.Rf[i].offset;
    for (int k = c.o.kr; k >= 1; k--) c.len_off[k] = std::min(c.len_off[k], c.len_off[k + 1]);
}

static void setup_left(Ctx& c)
{
    c.Lf = left_forms(c.g, c.o.kl, c.o.anyx);
    c.Lbeg.assign(c.o.kl + 2, c.Lf.size());
    for (size_t i = c.Lf.size(); i-- > 0;) c.Lbeg[c.Lf[i].K] = i;
    for (int a = c.o.kl; a >= 1; a--) if (c.Lbeg[a] > c.Lbeg[a + 1]) c.Lbeg[a] = c.Lbeg[a + 1];
}

// The right-side tables. Every value goes through a small direct-mapped cache (reset per unit of work, so the
// result does not depend on the threads): an exact repeat of a recent value is dropped at once; it has a code of
// lower rank, so the shortest code of every value survives. The survivors are counted per value bin first; then
// passes over consecutive value ranges (as many as the memory budget needs) regenerate all codes, keep one range,
// sort it by (value, rank), keep the first code of every value and append it to the table of its length.
static bool build_R(Ctx& c)
{
    BuildStats& st = c.stats;
    st = BuildStats();
    const int NT = std::max(1, c.o.threads), NBIN = 1 << 20, CACHE = 1 << 16;
    struct Unit { int f; uint64_t r0, r1; };
    std::vector<Unit> units;
    uint64_t total = 0;
    for (int fi = 0; fi < (int)c.Rf.size(); fi++) {
        for (uint64_t r = 0; r < c.Rf[fi].count; r += 1u << 22)
            units.push_back({fi, r, std::min(r + (1u << 22), c.Rf[fi].count)});
        total += c.Rf[fi].count;
    }
    const bool wide = total > 0xFFFFFFFFULL;
    c.Rb.assign(c.o.kr + 1, RTable());
    for (RTable& t : c.Rb) t.wide = wide;
    st.codes = total;
    std::vector<std::vector<uint64_t>> cache(NT, std::vector<uint64_t>(CACHE));
    std::vector<uint64_t> nfinite(NT, 0);

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

    const double t0 = now();
    std::vector<std::vector<uint32_t>> hist(NT, std::vector<uint32_t>(NBIN, 0));
    std::vector<std::vector<uint64_t>> hlen(NT, std::vector<uint64_t>(c.o.kr + 1, 0));
    parallel_for(NT, units.size(), [&](int tid, size_t ui) {
        uint32_t* h = hist[tid].data();
        uint64_t& hl = hlen[tid][c.Rf[units[ui].f].K];
        gen(tid, units[ui], [&](uint64_t k, uint64_t) { h[k >> 44]++; hl++; });
    });
    std::vector<uint64_t> H(NBIN, 0), survlen(c.o.kr + 1, 0);
    for (int t = 0; t < NT; t++) {
        for (int b = 0; b < NBIN; b++) H[b] += hist[t][b];
        for (int k = 0; k <= c.o.kr; k++) survlen[k] += hlen[t][k];
        st.finite += nfinite[t];
    }
    hist.clear();
    hist.shrink_to_fit();
    for (int b = 0; b < NBIN; b++) st.survivors += H[b];
    const double t_count = now() - t0;

    // passes over consecutive value ranges (bins), each holding at most `budget` survivors
    const double cap = c.o.memcap_gb * 1073741824.0;
    const size_t rbytes = wide ? 8 : 4;
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
    st.passes = (int)passes.size();
    const double upper = st.survivors * (8.0 + rbytes) + maxpass * (double)sizeof(Pair);
    if (g_verbose)
        fprintf(stderr, "right sides: %llu codes of length <= %d, %llu finite, %llu after the repeat cache; %zu pass(es) of "
                "<= %llu; memory upper bound %.2f GB (cap %.1f GB); counting %.2f s\n",
                (unsigned long long)total, c.o.kr, (unsigned long long)st.finite, (unsigned long long)st.survivors,
                passes.size(), (unsigned long long)maxpass, upper / 1073741824.0, c.o.memcap_gb, t_count);
    const uint64_t max_entries = (uint64_t)std::max(0.0, (cap - maxpass * (double)sizeof(Pair)) / (8.0 + rbytes));
    if (max_entries < 1024 || st.survivors > 4 * max_entries) {
        st.error = "right-side table exceeds the memory cap; use a smaller right-side length";
        return false;
    }
    for (int k = 1; k <= c.o.kr; k++) {                          // survivors of a length bound its distinct values
        const uint64_t r = std::min(survlen[k], max_entries);
        c.Rb[k].v.reserve(r);
        if (wide) c.Rb[k].r64.reserve(r); else c.Rb[k].r32.reserve(r);
    }

    std::vector<Pair> buf(maxpass);
    std::vector<std::atomic<uint64_t>> pos(NBIN);
    std::vector<uint64_t> base(NBIN + 1, 0), ndist(NBIN, 0);
    double t_gen = 0, t_sort = 0, t_app = 0;
    for (const auto& ps : passes) {
        const int b0 = ps.first, b1 = ps.second;
        uint64_t o = 0;
        for (int b = b0; b < b1; b++) { base[b] = o; pos[b].store(o); o += H[b]; }
        base[b1] = o;
        const double t1 = now();
        parallel_for(NT, units.size(), [&](int tid, size_t ui) {
            gen(tid, units[ui], [&](uint64_t k, uint64_t rank) {
                const int b = (int)(k >> 44);
                if (b < b0 || b >= b1) return;
                buf[pos[b].fetch_add(1, std::memory_order_relaxed)] = {k, rank};
            });
        });
        const double t2 = now();
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
        const double t3 = now();
        t_sort += t3 - t2;
        for (int b = b0; b < b1; b++) {
            const Pair* s = buf.data() + base[b];
            if (st.distinct + ndist[b] > max_entries) {
                st.error = "right-side table exceeds the memory cap; use a smaller right-side length";
                return false;
            }
            st.distinct += ndist[b];
            for (uint64_t i = 0; i < ndist[b]; i++) {
                RTable& t = c.Rb[c.rlen(s[i].idx)];
                t.v.push_back(val_of(s[i].key));
                if (wide) t.r64.push_back(s[i].idx); else t.r32.push_back((uint32_t)s[i].idx);
            }
        }
        t_app += now() - t3;
    }
    for (RTable& t : c.Rb) { t.make_index(); st.gb += t.gb(); }
    st.seconds = now() - t0;
    if (g_verbose)
        fprintf(stderr, "right sides: %llu distinct values (%.1f%% of the finite), table %.2f GB; generate %.2f s + sort %.2f s + "
                "append %.2f s; total build %.2f s, peak memory %.2f GB\n",
                (unsigned long long)st.distinct, 100.0 * st.distinct / std::max<uint64_t>(1, st.finite), st.gb, t_gen,
                t_sort, t_app, st.seconds, peak_gb());
    return true;
}

struct Match {
    int total = INT_MAX, la = 0, lb = 0;
    bool accepted = false;                                      // an accepted equation (else an approximation)
    double err = INFINITY;
    double x = NAN;                                             // the root of the equation (NAN: not computed)
    uint64_t lrank = 0, rrank = 0;
    bool better(const Match& m) const { return total < m.total || (total == m.total && err < m.err); }
};

// What the search found for one target
struct TargetResult {
    Match best;                                                 // shortest accepted equation (total == INT_MAX: none)
    std::vector<Match> approx;                                  // approx[n]: closest pair of total length n (any)
    std::vector<Match> matches;                                 // accepted equations (list mode or list_cap)
    std::vector<uint64_t> nL;                                   // nL[a]: distinct left values of length a tested
    uint64_t candidates = 0;
    double ms = 0;
};

struct Worker {
    const Ctx& c;
    std::vector<double> lv, ld;
    std::vector<uint64_t> lr;
    std::vector<Pair> s1, s2;
    std::vector<uint32_t> qi;
    std::vector<double> qlo;
    std::vector<size_t> qb;
    std::vector<size_t> hint;                                   // per right-side length: last position found
    size_t m = 0, cap = 0;
    double T = 0, absT = 1, tolT = 0, tol = 0, errcap = 0;
    double cext[64];
    int a = 0;
    TargetResult res;
    uint64_t nskip_kappa = 0, nskip_try = 0, nrej_err = 0;
    double t_gen = 0, t_sort = 0, t_match = 0, t_ver = 0, t_in_flush = 0;
    uint64_t sum_L = 0, sum_Ld = 0, sum_cand = 0;
    std::string listing;
    const char* id = "";

    explicit Worker(const Ctx& ctx) : c(ctx)
    {
        cap = ctx.o.chunk;
        lv.resize(cap); ld.resize(cap); lr.resize(cap); s1.resize(cap); s2.resize(cap);
        qi.resize(cap); qlo.resize(cap); qb.resize(cap);
        for (int i = 0; i < ctx.g.nc && i < 63; i++) cext[i] = ctx.g.cval[i];
    }

    void prefetch_block(const RTable& R, size_t j) const
    {
        if (R.v.empty()) return;
        const char* p = (const char*)(R.v.data() + std::min(R.v.size() - 1, j ? (j - 1) * R.B : 0));
        PREFETCH(p);
        PREFETCH(p + 64);
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

    // value of a right side
    double r_value(uint64_t rrank) const
    {
        const Form& f = form_of(c.Rf, rrank);
        int dig[MAXK];
        decode(f, rrank - f.offset, dig);
        double v, d, e;
        eval_full(f, dig, c.g, 0.0, v, d, e);
        return v;
    }

    // The root of L(x) = r reached by Newton steps from T, for an approximation (its root may be far from T: x^2 = 9
    // at T = 3e8 has the root 3, a relative error of 1, while one step from T suggests 0.5); false if Newton does
    // not converge within 64 steps
    bool newton_root(uint64_t lrank, double r, double& x) const
    {
        const Form& f = form_of(c.Lf, lrank);
        int dig[MAXK];
        decode(f, lrank - f.offset, dig);
        x = T;
        for (int it = 0; it < 64; it++) {
            double v, d, e;
            eval_full(f, dig, c.g, x, v, d, e);
            if (!std::isfinite(v) || !std::isfinite(d) || d == 0.0) return false;
            const double dx = (v - r) / d;
            if (!std::isfinite(dx)) return false;
            x -= dx;
            if (!std::isfinite(x)) return false;
            if (std::fabs(dx) <= 1e-14 * std::fabs(x) || dx == 0.0) return true;
        }
        return false;
    }

    void keep_match(const Match& mt)
    {
        if (c.o.list_cap == 0) return;
        res.matches.push_back(mt);
        if (res.matches.size() > 2 * c.o.list_cap + 64) {
            std::sort(res.matches.begin(), res.matches.end(), [](const Match& x, const Match& y) { return x.better(y); });
            res.matches.resize(c.o.list_cap);
        }
    }

    // a candidate pair: left value li, right side j of the table of length b; true if accepted
    bool candidate(const RTable& R, size_t j, size_t li, int b)
    {
        res.candidates++;
        const int total = a + b;
        if (!c.o.list && total > res.best.total) return false;
        const uint64_t rr = R.rank(j);
        const double t0 = now();
        double eL = INFINITY, dL = 0;
        const double x = newton(lr[li], R.v[j], eL, dL);
        const double err = std::fabs(x - T) / absT;
        // the equation must determine x: rounding errors of both sides, mapped to x, within errcap
        const double ex = (eL + r_error(rr)) / std::fabs(dL) / absT;   // in this order: |L'| |T| can overflow
        t_ver += now() - t0;
        if (!(err <= tol)) return false;
        if (!(ex <= errcap)) { nrej_err++; return false; }
        Match mt;
        mt.total = total; mt.la = a; mt.lb = b; mt.err = err; mt.lrank = lr[li]; mt.rrank = rr; mt.accepted = true; mt.x = x;
        if (c.o.list) {
            char buf[96];
            snprintf(buf, sizeof buf, "\t%.5e\t%.2e\n", err, ex);
            listing += std::string("#MATCH\t") + id + "\t" + std::to_string(total) + "\t" +
                       rpn(form_of(c.Lf, lr[li]), lr[li], c.g) + "\t" + rpn(form_of(c.Rf, rr), rr, c.g) + buf;
        }
        keep_match(mt);
        if (mt.better(res.best)) res.best = mt;
        if (res.approx[total].err >= err) res.approx[total] = mt;
        return true;
    }

    // all right sides of length b for the left value li (position p = first value >= v): the closest pair is
    // kept as the approximation of its total length; inside the window, candidates are tried closest first
    bool match_length(const RTable& R, size_t p, size_t li, int b)
    {
        const double v = lv[li], d = std::fabs(ld[li]), w = tolT * d;
        const size_t n = R.v.size();
        const double dl = p > 0 ? v - R.v[p - 1] : INFINITY, dr = p < n ? R.v[p] - v : INFINITY;
        const double dmin = std::min(dl, dr);
        if (!(dmin < INFINITY)) return false;
        if (dmin > w) {                                         // no candidate: the closest pair is an approximation
            Match& ap = res.approx[a + b];
            const double e = dmin / d / absT;                  // in this order: d |T| can overflow
            if (e < ap.err) {
                // kept only if its own rounding errors, mapped to x, are well below its distance from the target:
                // cosh(ln(sin pi)) is noise (sin pi = 1.2e-16 in double), not an approximation
                const uint64_t rr = R.rank(dl <= dr ? p - 1 : p);
                const Form& f = form_of(c.Lf, lr[li]);
                int dig[MAXK];
                decode(f, lr[li] - f.offset, dig);
                double v0, d0, eL;
                eval_full(f, dig, c.g, T, v0, d0, eL);
                if ((eL + r_error(rr)) / std::fabs(d0) / absT <= 0.25 * e) {
                    ap.total = a + b; ap.la = a; ap.lb = b; ap.err = e; ap.lrank = lr[li]; ap.rrank = rr; ap.accepted = false;
                }
            }
            return false;
        }
        size_t l = p, r = p, tries = 0;                          // next candidates: l - 1 (below), r (above)
        while (tries < c.o.maxtry) {
            const bool hl = l > 0 && v - R.v[l - 1] <= w, hr = r < n && R.v[r] - v <= w;
            if (!hl && !hr) return false;
            const size_t j = hl && (!hr || v - R.v[l - 1] <= R.v[r] - v) ? --l : r++;
            tries++;
            if (candidate(R, j, li, b) && !c.o.list) return true;
        }
        nskip_try++;
        return false;
    }

    void flush()
    {
        if (!m) return;
        const double t0 = now();
        for (size_t i = 0; i < m; i++) s1[i] = {key_of(lv[i] + 0.0), i};
        const Pair* s = radix_sort(s1.data(), s2.data(), m);
        const double t1 = now();
        uint64_t prev = ~0ULL;
        const double ver0 = t_ver;
        // pass 1: distinct left values inside the kappa range, in sorted order
        size_t q = 0;
        for (size_t k = 0; k < m; k++) {
            const size_t li = s[k].idx;
            const double v = lv[li], d = std::fabs(ld[li]);
            // kappa = |L| / (|L'| |T|): above kappa_max the rounding of L(T) alone moves the root by more than tol;
            // below kappa_min L is so steep (or so close to 0) that R is needed only to relative precision
            // tol / kappa, and chance matches abound. Tested before the duplicates are dropped: a code outside
            // the range must not hide another code of the same value (at the Dottie number x (1/x) = 1.0, flat,
            // hid x / cos x = 1.0)
            const double kap = std::fabs(v) / d / absT;
            if (!(kap >= c.o.kappa_min && kap <= c.o.kappa_max)) { nskip_kappa++; continue; }
            if (s[k].key == prev) continue;                    // same value: the first (shortest) code is kept
            prev = s[k].key;
            res.nL[a]++;
            qi[q] = (uint32_t)li; qlo[q] = v; q++;
        }
        // pass 2: per left value, the tables by increasing length; the block of the largest table is located in its
        // small index and prefetched PF entries ahead, so the DRAM latency overlaps
        const int PF = 16, KR = c.o.kr;
        const RTable& RL = c.Rb[KR];
        size_t hb = 0;
        for (size_t k = 0; k < q && k < (size_t)PF; k++) { qb[k] = RL.block(hb, qlo[k]); hb = qb[k]; prefetch_block(RL, qb[k]); }
        for (size_t k = 0; k < q; k++) {
            if (k + PF < q) { qb[k + PF] = RL.block(hb, qlo[k + PF]); hb = qb[k + PF]; prefetch_block(RL, qb[k + PF]); }
            const size_t li = qi[k];
            const double v = lv[li];
            int bmax = KR;
            if (!c.o.list && res.best.total != INT_MAX) bmax = std::min(bmax, res.best.total - a);   // ties: smaller error
            for (int b = 1; b <= bmax; b++) {
                const RTable& R = c.Rb[b];
                if (R.v.empty()) continue;
                const size_t p = b == KR ? R.in_block(qb[k], v) : R.lower(hint[b], v);
                hint[b] = p;
                if (match_length(R, p, li, b)) break;           // longer right sides only give longer equations
            }
        }
        const double t2 = now();
        t_sort += t1 - t0;
        t_match += (t2 - t1) - (t_ver - ver0);
        t_in_flush += t2 - t0;
        m = 0;
    }

    TargetResult& run(const char* id_, double T_)
    {
        id = id_;
        T = T_;
        absT = T != 0.0 ? std::fabs(T) : 1.0;
        tol = c.o.tolrel > 0 ? c.o.tolrel : c.o.tol_eps * DBL_EPSILON;
        tolT = tol * absT;
        errcap = std::max(c.o.errcap, tol);
        cext[c.g.nc] = T;
        res = TargetResult();
        res.approx.assign(c.o.kl + c.o.kr + 1, Match());
        res.nL.assign(c.o.kl + 1, 0);
        hint.assign(c.o.kr + 1, 0);
        listing.clear();
        const double t0 = now(), f0 = t_in_flush;
        const bool xonce = !c.o.anyx;
        for (a = 1; a <= c.o.kl; a++) {
            if (!c.o.list && res.best.total <= a + 1) break;      // no shorter equation possible any more
            for (size_t fi = c.Lbeg[a]; fi < c.Lbeg[a + 1]; fi++)
                enum_L(c.Lf[fi], c.g, cext, xonce, true, T != 0.0 ? c.o.kappa_min * absT : 0.0, c.o.periodic_max,
                       [&](double v, double d, uint64_t r) {
                    if (d == 0.0) return;
                    sum_L++;
                    lv[m] = v; ld[m] = d; lr[m] = r;
                    if (++m == cap) flush();
                });
            flush();
        }
        // approximations: the true distance of their root from T (the one-step estimate holds only near the root)
        for (Match& ap : res.approx) {
            if (ap.total == INT_MAX || ap.accepted) continue;
            double x;
            if (newton_root(ap.lrank, r_value(ap.rrank), x)) { ap.err = std::fabs(x - T) / absT; ap.x = x; }
            else ap = Match();
        }
        res.ms = (now() - t0) * 1e3;
        t_gen += (now() - t0) - (t_in_flush - f0);
        for (uint64_t x : res.nL) sum_Ld += x;
        sum_cand += res.candidates;
        if (c.o.list_cap > 0) {
            std::sort(res.matches.begin(), res.matches.end(), [](const Match& x, const Match& y) { return x.better(y); });
            if (res.matches.size() > c.o.list_cap) res.matches.resize(c.o.list_cap);
        }
        return res;
    }

    // the closest pair over all lengths (reported for a FAILURE)
    Match closest() const
    {
        Match b;
        for (const Match& x : res.approx)
            if (x.total != INT_MAX && x.err < b.err) b = x;
        return b;
    }

    std::string line()
    {
        const bool ok = res.best.total != INT_MAX;
        const Match b = ok ? res.best : closest();
        char out[4096];
        if (b.total == INT_MAX)
            snprintf(out, sizeof out, "%s\tFAILURE\t0\t\t\t%.5e\t%llu\t%.1f\n", id, 1.0, (unsigned long long)res.candidates, res.ms);
        else
            snprintf(out, sizeof out, "%s\t%s\t%d\t%s\t%s\t%.5e\t%llu\t%.1f\n", id, ok ? "SUCCESS" : "FAILURE", b.total,
                     rpn(form_of(c.Lf, b.lrank), b.lrank, c.g).c_str(), rpn(form_of(c.Rf, b.rrank), b.rrank, c.g).c_str(),
                     b.err, (unsigned long long)res.candidates, res.ms);
        return listing + out;
    }
};

// mitm_bench.cu's count: L with x any number of times, both sides deduplicated by value, |L - R| <= tolrel |L|
static void bench(Ctx& c)
{
    double t0 = now();
    double cext[64];
    for (int i = 0; i < c.g.nc; i++) cext[i] = c.g.cval[i];
    cext[c.g.nc] = c.o.bench_T;
    std::vector<uint64_t> keys;
    for (const Form& f : c.Lf)
        enum_L(f, c.g, cext, false, false, 0.0, 0.0, [&](double v, double, uint64_t) {
            if (v != 0.0) keys.push_back(key_of(v));
        });
    const size_t nfin = keys.size();
    std::sort(keys.begin(), keys.end());
    keys.erase(std::unique(keys.begin(), keys.end()), keys.end());
    double t1 = now();
    unsigned long long pairs = 0;
    size_t nR = 0;
    for (int b = 1; b <= c.o.kr; b++) {
        const RTable& R = c.Rb[b];
        const double* Rv = R.v.data();
        const size_t n = R.v.size();
        nR += n;
        size_t hint = 0;
        for (uint64_t k : keys) {
            const double v = val_of(k), w = c.o.bench_tol * std::fabs(v);
            const size_t lo = R.lower(hint, v - w);
            hint = lo;
            size_t hi = lo;
            while (hi < n && Rv[hi] <= v + w) hi++;
            pairs += hi - lo;
        }
    }
    fprintf(stderr, "bench: T = %.17g, tolrel %g: |L| = %zu finite non-zero, %zu distinct; |R| = %zu distinct (incl. 0); "
            "%llu pairs; left sides %.2f s, sweep %.2f s\n",
            c.o.bench_T, c.o.bench_tol, nfin, keys.size(), nR, pairs, t1 - t0, now() - t1);
    printf("%llu\n", pairs);
}

static int eval_mode(const Grammar& g, const char* code, double x)
{
    std::vector<double> st;
    for (const std::string& t : split_names(code)) {
        bool done = false;
        double v;
        if (t == "x") { st.push_back(x); done = true; }
        else if (constant_value(t, v)) { st.push_back(v); done = true; }
        for (int i = 0; i < U_COUNT && !done; i++)
            if (t == UNAME[i]) { if (st.empty()) return 2; st.back() = un(i, st.back()); done = true; }
        for (int i = 0; i < B_COUNT && !done; i++)
            if (t == BNAME[i]) {
                if (st.size() < 2) return 2;
                const double top = st.back();
                st.pop_back();
                st.back() = bin(i, top, st.back());
                done = true;
            }
        if (!done) { fprintf(stderr, "unknown token '%s'\n", t.c_str()); return 2; }
    }
    (void)g;
    if (st.size() != 1) return 2;
    printf("%.17g\n", st[0]);
    return 0;
}

#ifndef MITM_LIBRARY
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
        else if (a == "--common") { o.consts = COMMON_CONSTS; o.funcs = COMMON_FUNCS; o.ops = CALC4_OPS; }
        else if (a == "--consts") o.consts = next();
        else if (a == "--funcs") o.funcs = next();
        else if (a == "--ops") o.ops = next();
        else if (a == "--anyx") o.anyx = true;
        else if (a == "--list") o.list = true;
        else if (a == "--tol") o.tol_eps = atof(next());
        else if (a == "--tolrel") o.tolrel = atof(next());
        else if (a == "--kappa-min") o.kappa_min = atof(next());
        else if (a == "--kappa-max") o.kappa_max = atof(next());
        else if (a == "--errcap") o.errcap = atof(next());
        else if (a == "--maxtry") o.maxtry = (size_t)atof(next());
        else if (a == "--periodic-max") o.periodic_max = atof(next());
        else if (a == "--threads") o.threads = atoi(next());
        else if (a == "--memcap") o.memcap_gb = atof(next());
        else if (a == "--chunk") o.chunk = (size_t)atof(next());
        else if (a == "--bench") { o.bench = true; o.anyx = true; g_subnormal_ok = true; o.bench_T = atof(next()); o.bench_tol = atof(next()); }
        else if (a == "--eval") { eval_code = next(); eval_x = atof(next()); }
        else { fprintf(stderr, "unknown option %s (see the header of mitm_cr.cpp)\n", a.c_str()); return 2; }
    }
    const std::string gerr = make_grammar(c.g, o.consts, o.funcs, o.ops);
    if (!gerr.empty()) { fprintf(stderr, "buttons: %s\n", gerr.c_str()); return 2; }
    if (eval_code) return eval_mode(c.g, eval_code, eval_x);
    if (o.kappa_max < 0) o.kappa_max = 2 * (o.tolrel > 0 ? o.tolrel / DBL_EPSILON : o.tol_eps);   // rounding L(T) alone moves x by up to eps kappa / 2
    if (o.kl < 1 || o.kl > MAXK || o.kr < 1 || o.kr > MAXK || o.chunk < 1) { fprintf(stderr, "bad lengths\n"); return 2; }
    const double T0 = now(), C0 = cpu_seconds();

    setup_right(c);
    setup_left(c);
    const uint64_t nLcodes = c.Lf.empty() ? 0 : c.Lf.back().offset + c.Lf.back().count;
    fprintf(stderr, "grammar: %d constants, %d functions, %d operators; left sides: x %s, length <= %d, %llu codes "
            "per target; tol %g, kappa %g..%g, errcap %g, maxtry %zu, %d thread(s)\n",
            c.g.nc, c.g.nu, c.g.nb, o.anyx ? "any number of times" : "exactly once", o.kl, (unsigned long long)nLcodes,
            o.tolrel > 0 ? o.tolrel : o.tol_eps * DBL_EPSILON, o.kappa_min, o.kappa_max, o.errcap, o.maxtry, o.threads);

    if (!build_R(c)) { fprintf(stderr, "%s (cap %.1f GB)\n", c.stats.error.c_str(), o.memcap_gb); return 3; }
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
        workers[tid]->run(ids[i].c_str(), vals[i]);
        std::string r = workers[tid]->line();
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
        sk += w->nskip_kappa; sw += w->nskip_try; re += w->nrej_err;
    }
    fprintf(stderr, "targets: %zu in %.2f s wall (%.1f ms each); summed over threads: left sides %.2f s, sort %.2f s, "
            "match %.2f s, verify %.2f s; %llu left values (%llu distinct per chunk; skipped: %llu by kappa; maxtry reached %llu "
            "times), %llu candidates (%llu rejected by errcap)\n",
            ids.size(), t_T, ids.empty() ? 0.0 : 1e3 * t_T / ids.size(), g, s, mt, v, (unsigned long long)nl,
            (unsigned long long)nld, (unsigned long long)sk, (unsigned long long)sw, (unsigned long long)nc,
            (unsigned long long)re);
    fprintf(stderr, "total: %.2f s wall (right sides %.2f s), CPU %.2f s (right sides %.2f s), peak memory %.2f GB\n",
            now() - T0, t_R, cpu_seconds() - C0, cpu_R, peak_gb());
    for (Worker* w : workers) delete w;
    return 0;
}
#endif
