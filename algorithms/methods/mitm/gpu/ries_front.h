// ries_front.h - a RIES-like command line for the meet-in-the-middle search (ries_cpu.cpp, ries_gpu.cu)
//
// Author: Andrzej Odrzywolek
// Date: October 4, 2026
// Code assist: Claude Opus 5.5
//
// Usage:  ries_cpu T [-lN] [-Ssss] [-Nsss] [options]      (ries_gpu: the same)
//   T       the target value, anywhere among the options (as in RIES)
//   -lN     search level, as in RIES (default 2; fractional and negative allowed). Level N picks the longest left
//           side and right side (in symbols) whose number of equations, distinct left values times distinct right
//           values, is closest to what RIES tests at -lN, from RIES's own counts on this machine (zeta(3): -l2
//           1.2e10, -l3 1.5e11, -l4 1.8e12, -l5 2.1e13, -l6 2.7e14, -l7 9.6e14). With RIES's symbols: -l2 5/5,
//           -l3 6/5, -l4 6/6, -l5 7/6, -l6 and -l7 7/7, -l8 8/7 symbols (left/right).
//   -Ssss   only these symbols, -Nsss  not these symbols, in RIES's letters. Default: RIES's default symbol set,
//           1-9, p (pi), e, f (phi); n (negative), r (1/x), s (x^2), q (sqrt), l (ln), E (e^x), S C T (sinpi,
//           cospi, tanpi: sin(pi x) etc., arguments |x| <= 1 as in RIES); + - * / ^, v (A"/B = A-th root of B),
//           L (log_A(B)), A (atan2). RIES's W (Lambert W) does not exist here.
// Options of this program (not RIES's):
//   --calc        the calculator's buttons instead of RIES's symbols: pi, e, -1, phi, 1-9; ln, e^x, 1/x, Gamma,
//                 sqrt, x^2, sin, cos, tan, sinh, cosh, tanh and their inverses; + - * / ^ (-S/-N then pick from
//                 the letters above where the symbol is a calculator button)
//   --once        x appears exactly once (explicit formulas); default: any number of times, as in RIES
//   --kl K --kr K the longest left and right side directly (instead of -l)
//   --tol E       "exact" means the root within E * 2.2e-16 relative (default 16); --tolrel R: within R relative
//   --threads N   (ries_cpu) threads for the right-side table, default all; --vram GB (ries_gpu) device memory cap
//   --consts, --funcs, --ops LIST   the buttons by name, as mitm_cr (e.g. --funcs LOG,EXP,SQRT)
// Output: as RIES, the equations that come ever closer to T, by increasing size {total number of symbols}, up to the
// first one that holds within the tolerance ('exact' match), in RIES's notation. Sizes count symbols: x = 1, 2 x = 3
// (x, 2, *); RIES's {complexity} weighs its symbols instead.

#ifndef RIES_FRONT_H
#define RIES_FRONT_H

#include <string>
#include <vector>
#include <cmath>
#include <cstdio>
#include <cstdlib>

struct RiesArgs {
    std::string target_text;
    double T = NAN;
    double level = 2;
    int kl = 0, kr = 0;                                        // 0: from the level
    bool once = false;
    std::string S, N;                                          // RIES's -S, -N
    std::string consts, funcs, ops;                            // by name (override)
    bool calc = false, common = false;
    double tol_eps = 16, tolrel = 0, vram = 0;
    int threads = 0;
};

// RIES's default symbol set as buttons
static const char* RIES_CONSTS = "ONE,TWO,THREE,FOUR,FIVE,SIX,SEVEN,EIGHT,NINE,PI,EULER,GOLDENRATIO";
static const char* RIES_FUNCS = "MINUS,INV,SQR,SQRT,LOG,EXP,SINPI,COSPI,TANPI";
static const char* RIES_OPS = "PLUS,SUBTRACT,TIMES,DIVIDE,POWER,ROOT,LOGARITHM,ATAN2";

static const char* RIES_HELP =
    "usage: %s T [-lN] [-Ssss] [-Nsss] [--once] [--calc] [--kl K --kr K] [--tol E] [--threads N | --vram GB]\n"
    "  T     target value;  -lN  search level as in RIES (default 2, about 11 times more equations per level)\n"
    "  -S/-N only / not these symbols, RIES's letters: 1-9 p e f n r s q l E S C T + - * / ^ v L A\n"
    "        (default: all of them, RIES's default set)\n"
    "  --once  x exactly once (default: any number of times, as RIES); --kl/--kr: left/right side lengths\n"
    "  --calc  the calculator's buttons (Gamma, sin, cos, sinh, ... and inverses) instead of RIES's symbols\n"
    "  see the header of ries_front.h for the rest\n";

// returns "" or an error message
static std::string ries_parse(int argc, char** argv, RiesArgs& A)
{
    for (int i = 1; i < argc; i++) {
        std::string a = argv[i];
        auto value = [&](size_t skip) -> std::string {         // "-l6" or "-l 6"
            if (a.size() > skip) return a.substr(skip);
            if (i + 1 < argc) return argv[++i];
            return "";
        };
        if (a == "-h" || a == "--help") return "help";
        if (a.rfind("--", 0) == 0) {
            auto next = [&]() -> std::string { return i + 1 < argc ? argv[++i] : ""; };
            if (a == "--once") A.once = true;
            else if (a == "--anyx") A.once = false;
            else if (a == "--kl") A.kl = atoi(next().c_str());
            else if (a == "--kr") A.kr = atoi(next().c_str());
            else if (a == "--tol") A.tol_eps = atof(next().c_str());
            else if (a == "--tolrel") A.tolrel = atof(next().c_str());
            else if (a == "--threads") A.threads = atoi(next().c_str());
            else if (a == "--vram") A.vram = atof(next().c_str());
            else if (a == "--consts") A.consts = next();
            else if (a == "--funcs") A.funcs = next();
            else if (a == "--ops") A.ops = next();
            else if (a == "--common") A.common = true;
            else if (a == "--calc") A.calc = true;
            else return "unknown option " + a;
            continue;
        }
        if (a.size() >= 2 && a[0] == '-' && (a[1] < '0' || a[1] > '9') && a[1] != '.') {
            const char o = a[1];
            if (o == 'l') {
                const std::string v = value(2);
                char* end = nullptr;
                A.level = strtod(v.c_str(), &end);
                if (v.empty() || *end) return "-l needs a number, e.g. -l6";
            } else if (o == 'S') A.S = value(2);
            else if (o == 'N') A.N = value(2);
            else return std::string("RIES option ") + a + " is not supported (supported: T, -lN, -S, -N; see --help)";
            continue;
        }
        char* end = nullptr;
        const double v = strtod(a.c_str(), &end);
        if (*end || a.empty()) return "not a number or an option: " + a;
        if (!std::isnan(A.T)) return "two target values: " + A.target_text + " and " + a;
        A.T = v;
        A.target_text = a;
    }
    if (std::isnan(A.T)) return "no target value";
    return "";
}

// RIES's symbol letters -> button names; "" for letters that do not exist here
static const char* ries_letter(char ch, int& kind)               // kind 0 constant, 1 function, 2 operator
{
    static const char* digits[] = {"ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT", "NINE"};
    if (ch >= '1' && ch <= '9') { kind = 0; return digits[ch - '1']; }
    switch (ch) {
    case 'p': kind = 0; return "PI";
    case 'e': kind = 0; return "EULER";
    case 'f': kind = 0; return "GOLDENRATIO";
    case 'n': kind = 1; return "MINUS";
    case 'r': kind = 1; return "INV";
    case 's': kind = 1; return "SQR";
    case 'q': kind = 1; return "SQRT";
    case 'l': kind = 1; return "LOG";
    case 'E': kind = 1; return "EXP";
    case 'S': kind = 1; return "SINPI";
    case 'C': kind = 1; return "COSPI";
    case 'T': kind = 1; return "TANPI";
    case '+': kind = 2; return "PLUS";
    case '-': kind = 2; return "SUBTRACT";
    case '*': kind = 2; return "TIMES";
    case '/': kind = 2; return "DIVIDE";
    case '^': kind = 2; return "POWER";
    case 'L': kind = 2; return "LOGARITHM";
    case 'v': kind = 2; return "ROOT";
    case 'A': kind = 2; return "ATAN2";
    default: return "";
    }
}

static std::vector<std::string> ries_split(const std::string& s)
{
    std::vector<std::string> out;
    size_t p = 0;
    while (p <= s.size()) {
        size_t q = s.find(',', p);
        if (q == std::string::npos) q = s.size();
        if (q > p) out.push_back(s.substr(p, q - p));
        p = q + 1;
    }
    return out;
}

static std::string ries_join(const std::vector<std::string>& v)
{
    std::string s;
    for (const std::string& x : v) s += (s.empty() ? "" : ",") + x;
    return s;
}

// the button lists: RIES's default set (or the calculator's with --calc, or the common subset with --common), then
// -S / -N, then the names given directly; returns "" or an error message
static std::string ries_buttons(const RiesArgs& A, const char* calc_consts, const char* calc_funcs, const char* calc_ops,
                                const char* common_consts, const char* common_funcs, std::string& consts,
                                std::string& funcs, std::string& ops)
{
    consts = A.common ? common_consts : A.calc ? calc_consts : RIES_CONSTS;
    funcs = A.common ? common_funcs : A.calc ? calc_funcs : RIES_FUNCS;
    ops = A.common || A.calc ? calc_ops : RIES_OPS;
    if (!A.S.empty()) {
        std::vector<std::string> v[3];
        for (char ch : A.S) {
            int kind = 0;
            const std::string n = ries_letter(ch, kind);
            if (n.empty()) return std::string("symbol '") + ch + "' of RIES does not exist here (see --help)";
            v[kind].push_back(n);
        }
        consts = ries_join(v[0]);
        funcs = ries_join(v[1]);
        ops = ries_join(v[2]);
    }
    for (char ch : A.N) {
        int kind = 0;
        const std::string n = ries_letter(ch, kind);
        if (n.empty()) return std::string("symbol '") + ch + "' of RIES does not exist here (see --help)";
        std::string* lists[3] = {&consts, &funcs, &ops};
        std::vector<std::string> v = ries_split(*lists[kind]), w;
        for (const std::string& x : v) if (x != n) w.push_back(x);
        *lists[kind] = ries_join(w);
    }
    if (!A.consts.empty()) consts = A.consts;
    if (!A.funcs.empty()) funcs = A.funcs;
    if (!A.ops.empty()) ops = A.ops;
    return "";
}

// log10 of the number of equations RIES tests at level N ("Total equations tested"): -l0 from its manual, -l1 at
// pi, -l2 to -l7 measured at zeta(3) on the Windows machine; linear in between, 1.09 per level beyond
static double ries_equations_log10(double level)
{
    static const double t[8] = {7.95, 8.96, 10.08, 11.18, 12.26, 13.32, 14.43, 14.98};
    if (level <= 0) return t[0] + 1.05 * level;
    if (level >= 7) return t[7] + 1.09 * (level - 7);
    const int i = (int)level;
    return t[i] + (t[i + 1] - t[i]) * (level - i);
}

// The level: (kl, kr) with |kl - kr| <= 1 whose estimated number of equations (distinct left values times distinct
// right values) is closest to RIES's at that level (ries_equations_log10). Distinct values are estimated from the
// numbers of codes with the fractions measured at zeta(3) (for RIES's symbols; for the calculator buttons with calc).
struct LevelChoice {
    int kl = 0, kr = 0;
    double est = 0, target = 0;
    bool capped = false;                                       // the level is beyond the largest feasible search
};

template <class CountL, class CountR>
static LevelChoice ries_level(double level, CountL codesL, CountR codesR, double max_codesL, double max_codesR, bool calc)
{
    // distinct values / codes per length, measured at zeta(3): RIES's symbol set, or the calculator buttons (calc)
    static const double rL[10] = {1, 1, 0.70, 0.68, 0.40, 0.29, 0.18, 0.12, 0.08, 0.05};
    static const double rR[10] = {1, 1, 0.64, 0.42, 0.27, 0.18, 0.12, 0.077, 0.05, 0.033};
    static const double cL[10] = {1, 1, 0.84, 0.71, 0.55, 0.41, 0.30, 0.25, 0.21, 0.18};
    static const double cR[10] = {1, 1, 0.76, 0.54, 0.43, 0.33, 0.25, 0.19, 0.15, 0.12};
    const double* fL = calc ? cL : rL;
    const double* fR = calc ? cR : rR;
    struct Cand { int kl, kr; double est, cr, d; };
    std::vector<Cand> cs;
    const double target = ries_equations_log10(level);
    for (int kl = 1; kl <= 8; kl++)
        for (int kr = std::max(1, kl - 1); kr <= std::min(9, kl + 1); kr++) {
            const double cl = codesL(kl), cr = codesR(kr);
            if (cl > max_codesL || cr > max_codesR) continue;
            const double est = cl * fL[kl] * cr * fR[kr];
            cs.push_back({kl, kr, est, cr, std::fabs(std::log10(est) - target)});
        }
    LevelChoice lc;
    lc.target = target;
    if (cs.empty()) return lc;
    double dmin = INFINITY, emax = 0;
    for (const Cand& x : cs) { dmin = std::min(dmin, x.d); emax = std::max(emax, x.est); }
    const Cand* pick = nullptr;
    if (std::log10(emax) < target - 0.5) {                     // beyond the largest feasible search: run that one
        for (const Cand& x : cs) if (x.est == emax) pick = &x;
        lc.capped = true;
    } else
        for (const Cand& x : cs)                               // the closest; near ties: the smaller right-side table
            if (x.d <= dmin + 0.1 && (!pick || x.cr < pick->cr)) pick = &x;
    lc.kl = pick->kl; lc.kr = pick->kr; lc.est = pick->est;
    return lc;
}

// ------------------------------------------------------------------------------------------------ formulas

struct InfixPart {
    std::string s;
    int prec;                                                  // 1 sum, 2 product, 3 negative, 4 power, 5 atom
};

static std::string ries_wrap(const InfixPart& e, int need) { return e.prec >= need ? e.s : "(" + e.s + ")"; }

static std::string ries_const_name(const std::string& n)
{
    struct { const char* n; const char* s; } t[] = {{"PI", "pi"}, {"EULER", "e"}, {"NEG", "-1"}, {"GOLDENRATIO", "phi"},
        {"ZERO", "0"}, {"ONE", "1"}, {"TWO", "2"}, {"THREE", "3"}, {"FOUR", "4"}, {"FIVE", "5"}, {"SIX", "6"},
        {"SEVEN", "7"}, {"EIGHT", "8"}, {"NINE", "9"}, {"GLAISHER", "A"}, {"CATALAN", "G"}, {"KHINCHIN", "K0"},
        {"EULERGAMMA", "euler_gamma"}};
    for (auto& x : t) if (n == x.n) return x.s;
    return n;                                                  // integers given by value
}

// A code (form f, digits dig) in infix notation; the engine's operand order: t = top of the stack (pushed last)
static std::string ries_infix(const Form& f, const int* dig, const Grammar& g)
{
    static const char* fn[U_COUNT] = {"ln", "", "", "Gamma", "sqrt", "", "sin", "asin", "cos", "acos", "tan", "atan",
                                      "sinh", "asinh", "cosh", "acosh", "tanh", "atanh", "", "sinpi", "cospi", "tanpi"};
    std::vector<InfixPart> E(f.K);
    for (int i = 0; i < f.K; i++) {
        const int d = dig[i];
        if (f.ar[i] == 0) {
            if (i == f.xpos || d == g.nc) E[i] = {"x", 5};
            else {
                const std::string s = ries_const_name(g.cname[d]);
                E[i] = {s, s[0] == '-' ? 3 : 5};
            }
        } else if (f.ar[i] == 1) {
            const InfixPart& a = E[f.c1[i]];
            const int op = g.uop[d];
            switch (op) {
            case U_EXP: E[i] = {"e^" + ries_wrap(a, 5), 4}; break;
            case U_INV: E[i] = {"1/" + ries_wrap(a, 4), 2}; break;
            case U_SQR: E[i] = {ries_wrap(a, 5) + "^2", 4}; break;
            case U_MINUS: E[i] = {"-" + ries_wrap(a, 4), 3}; break;
            default: E[i] = {std::string(fn[op]) + "(" + a.s + ")", 5}; break;
            }
        } else {
            const InfixPart& t = E[f.c1[i]];
            const InfixPart& s = E[f.c2[i]];
            auto right = [&](int need) { return s.prec == 3 || s.prec < need ? "(" + s.s + ")" : s.s; };
            // RIES's notation: a b (product), A"/B (A-th root of B), atan2(a,b), log_A(B)
            switch (g.bop[d]) {
            case B_PLUS: E[i] = {s.s + "+" + (t.prec == 3 ? "(" + t.s + ")" : t.s), 1}; break;   // s + t
            case B_SUBTRACT: E[i] = {t.s + "-" + right(2), 1}; break;
            case B_TIMES: E[i] = {ries_wrap(t, 2) + " " + right(2), 2}; break;
            case B_DIVIDE: E[i] = {ries_wrap(t, 2) + "/" + right(4), 2}; break;
            case B_POWER: E[i] = {ries_wrap(t, 5) + "^" + right(5), 4}; break;
            case B_ROOT: E[i] = {ries_wrap(t, 5) + "\"/" + ries_wrap(s, 5), 4}; break;  // the t-th root of s
            case B_ATAN2: E[i] = {"atan2(" + s.s + "," + t.s + ")", 5}; break;
            default: {                                         // log_t(s); the base in parentheses unless a name or number
                const bool plain = t.s.find_first_of("()+-*/^ \"") == std::string::npos;
                E[i] = {"log_" + (plain ? t.s : "(" + t.s + ")") + "(" + s.s + ")", 5};
                break;
            }
            }
        }
    }
    return E[f.K - 1].s;
}

static std::string ries_side(const std::vector<Form>& fs, uint64_t rank, const Grammar& g)
{
    const Form& f = form_of(fs, rank);
    int dig[MAXK];
    decode(f, rank - f.offset, dig);
    return ries_infix(f, dig, g);
}

// The listing: the equations that come ever closer to T, by increasing size, up to the first 'exact' one
static void ries_print(const Ctx& c, const RiesArgs& A, const TargetResult& res, const LevelChoice& lc,
                       uint64_t nL, uint64_t nR, double seconds, const std::string& where)
{
    printf("\n   Your target value: T = %-24s (%s)\n\n", A.target_text.c_str(), where.c_str());
    const double T = A.T;
    double closest = INFINITY;
    bool exact = false;
    std::string shown;                                         // the printed equations, for the legend
    struct Line { std::string L, R, how; int n; };
    std::vector<Line> lines;
    const int last = (int)res.approx.size() - 1;
    for (int n = 1; n <= last; n++) {
        const bool is_best = res.best.total == n;
        const Match& m = is_best ? res.best : res.approx[n];
        if (m.total == INT_MAX || std::isnan(m.x)) continue;
        const double d = m.x - T;
        if (!is_best && !(std::fabs(d) < closest)) continue;
        closest = std::min(closest, std::fabs(d));
        Line ln;
        ln.L = ries_side(c.Lf, m.lrank, c.g);
        ln.R = ries_side(c.Rf, m.rrank, c.g);
        char how[64];
        if (is_best) snprintf(how, sizeof how, "('exact' match)");
        else snprintf(how, sizeof how, "for x = T %c %.6g", d < 0 ? '-' : '+', std::fabs(d));
        ln.how = how;
        ln.n = n;
        lines.push_back(ln);
        shown += ln.L + " " + ln.R + " ";
        if (is_best) { exact = true; break; }
    }
    size_t wl = 23, wr = 25, wh = 24;                          // RIES's columns, wider where needed
    for (const Line& ln : lines) { wl = std::max(wl, ln.L.size()); wr = std::max(wr, ln.R.size()); wh = std::max(wh, ln.how.size()); }
    for (const Line& ln : lines)
        printf("%*s = %-*s %-*s {%d}\n", (int)wl, ln.L.c_str(), (int)wr, ln.R.c_str(), (int)wh, ln.how.c_str(), ln.n);
    if (!exact) printf("%*s(for more results, use the option '-l%g')\n", (int)wl, "", std::floor(A.level) + 1);
    if (exact)
        printf("\n  NOTE: 'exact' means: the root agrees with T to %.2g relative, about the precision of a double; it may\n"
               "  be a coincidence, the more likely the deeper the search. Check it at higher precision.\n",
               c.o.tolrel > 0 ? c.o.tolrel : c.o.tol_eps * DBL_EPSILON);
    if (lc.capped)
        printf("\n  NOTE: -l%g is beyond the largest search that fits (left %d, right %d symbols); that one was run.\n",
               A.level, c.o.kl, c.o.kr);
    printf("\n  {n} = number of symbols (2 x: three); x may appear %s\n",
           c.o.anyx ? "any number of times" : "only once");
    std::vector<std::string> legend;
    if (shown.find("phi") != std::string::npos) legend.push_back("phi = the golden ratio, (1+sqrt(5))/2");
    if (shown.find("Gamma") != std::string::npos) legend.push_back("Gamma(x) = the gamma function");
    if (shown.find("log_") != std::string::npos) legend.push_back("log_A(B) = logarithm to base A of B");
    if (shown.find("pi(") != std::string::npos) legend.push_back("sinpi(X) = sin(pi X), also cospi, tanpi");
    if (shown.find("\"/") != std::string::npos) legend.push_back("A\"/B = Ath root of B");
    if (shown.find("atan2") != std::string::npos) legend.push_back("atan2(s,c) = angle of the point (c,s)");
    for (size_t i = 0; i < legend.size(); i += 2)              // two per line, as RIES
        printf("  %-44s%s\n", legend[i].c_str(), i + 1 < legend.size() ? legend[i + 1].c_str() : "");
    const double eq = (double)nL * (double)nR;
    printf("\n                     --left--   --right--\n");
    printf("     max length:   %9d   %9d\n", c.o.kl, c.o.kr);
    printf("         values:   %9llu   %9llu      Time: %.3f s\n", (unsigned long long)nL, (unsigned long long)nR, seconds);
    printf("\n        Total equations tested: %.0f (%.3e); RIES -l%g tests about %.1e\n", eq, eq, A.level,
           std::pow(10.0, lc.target));
    if (eq > 1e14)
        printf("        (beyond about 1e13-1e14 equations, double precision cannot tell exact identities from chance)\n");
}

#endif
