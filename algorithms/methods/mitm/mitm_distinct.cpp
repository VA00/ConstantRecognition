// mitm_distinct.cpp - meet-in-the-middle constant recognition built from distinct values
//
// Author: Andrzej Odrzywolek
// Date: October 31, 2026
// Code assist: Claude Opus 5.5
//
// The search of mitm_cr.cpp (equations L(x) = R that hold at a target T, x exactly once in L), with the same
// buttons, operand order, tolerance, guards, Newton refinement, approximations and output, but with the two sides
// made in another way. mitm_cr enumerates every code and merges codes of equal value only at the end. With few
// buttons almost every code repeats a value: of the codes of length <= 15 over e, pi, SQR, +, *, ^ only 2% have a
// value of their own, and a duplicate of a short length reappears inside every longer code made from it (e*e = e^2,
// then e*e + pi, (e*e)^pi, ...). Here every value of length k is made only from the distinct values of shorter
// lengths (dynamic programming over values; in program synthesis, observational equivalence):
//   * right sides: R_1 = the constants; R_k = f(a) for a in R_(k-1), and a o b for a in R_i, b in R_j, i + j = k - 1,
//     for every function f and operator o (+ and * once per pair: they commute exactly in floating point too). A
//     value already in a shorter table is dropped and equal values are merged, the first one made is kept. The
//     tables hold the same values as mitm_cr's (e, pi, SQR, +, *, ^: 853627, 2918863, 9948131 values at |R| <= 12,
//     13, 14), made with about 2 operations per value instead of one evaluation per code (49 per value at 14).
//   * left sides: x wrapped in operations whose other operand is a constant, so L_1 = {x}, and L_k = f(l) for l in
//     L_(k-1), l o r and r o l for l in L_i, r in R_j, i + j = k - 1. A left value is the pair (L(T), L'(T)), all
//     that the matching uses; pairs equal to the last bit are merged. mitm_cr's guards on the path of x (derivative
//     0, subnormal values, kappa_min, periodic functions of x beyond periodic_max) apply to every pair made: it is a
//     node on the path of x of every left side made from it.
//   * every value keeps its recipe (button and operands, 12 bytes); a code is written out only when an equation is
//     verified or reported.
// The matching is mitm_cr's: per left value, the tables by increasing length, closest values first, Newton steps
// and error bounds for the candidates, and the closest pair of every total length as its approximation (with
// mitm_cr's noise check). One difference: mitm_cr merges left sides of equal value within a chunk of its
// enumeration (whatever their derivatives), here only pairs of equal value and derivative are merged.
//
// Memory. The right tables are kept up to max(|R|, |L| - 2) (a left side holds constants of up to |L| - 2
// symbols); each level is made in passes over value ranges within the memory cap, as mitm_cr makes its tables.
// Left levels are kept per target as far as the memory cap allows, up to |L| - 1; the longer left sides are made on
// the fly from the kept levels, merged within chunks and matched at once, as mitm_cr makes all of its left sides.
// Kept values cost 24 bytes on the right and 28 on the left (mitm_cr's table: 12 per value).
//
// x exactly once only (no --any-x). Output and options as mitm_cr.cpp: one line per target on stdout, statistics on
// stderr. Sides of up to 30 symbols.
//
// Build: icx /O3 /fp:precise /std:c++17 /EHsc mitm_distinct.cpp   (or g++ -O3 -std=c++17 -pthread ..., cl /O2 ...)
//        build_mitm.bat builds it next to mitm_cr.exe; never with fast-math. WebAssembly: mitm_wasm.cpp includes
//        this file (both engines in one module).
// Usage: mitm_distinct [--kl 5] [--kr 6] [--common] [--consts LIST --funcs LIST --ops LIST] [--tol 16] [--tolrel r]
//                      [--kappa-min 0.03125] [--kappa-max 2*tol] [--errcap 1e-12] [--maxtry 32] [--periodic-max 32]
//                      [--threads 1] [--memcap 16] [--chunk 1048576] [--list] < targets

#ifndef MITM_LIBRARY
#define MITM_LIBRARY
#define MITM_DISTINCT_MAIN
#endif
#include "mitm_cr.cpp"

namespace distinct {

static const int KMAX = 30;                                     // longest side
static const int MAXEXT = 6;                                    // left lengths made on the fly above the kept levels
static const double GB = 1073741824.0;

// How a value was made. Right sides: N_CONST (op: the constant), N_UNARY (op: the function; operand 1), N_BINARY
// (op: the operator; operand 1 = the top t, operand 2 = the second s, code "s, t, op"). Left sides: N_X; N_LUNARY
// (operand 1: a left value); N_LTOP and N_LSECOND: operand 1 = a left value, operand 2 = a right value, the left
// one being the top (code "r, l, op") or the second operand (code "l, r, op"). Operands: (length, index).
enum : uint8_t { N_CONST, N_UNARY, N_BINARY, N_X, N_LUNARY, N_LTOP, N_LSECOND };
struct Node {
    uint8_t kind, op, l1, l2;
    uint32_t i1, i2;
};

// Values of one length, ascending (left levels: by value, then by derivative). d: left levels, the derivative;
// e: right levels, the rounding-error bound of the code kept
struct Level {
    std::vector<double> v, d;
    std::vector<float> e;
    std::vector<Node> n;
    size_t size() const { return v.size(); }
    double bytes() const { return v.size() * (8.0 + sizeof(Node)) + d.size() * 8.0 + e.size() * 4.0; }
};

// First-order rounding-error bounds of one operation from its inputs' bounds (mitm_cr's eval_full; used to choose
// which code of a value is kept, so the partial derivative of ^ by its base is taken without a second pow)
static inline double bound_unary(int op, double a, double r, double ea)
{
    const double u = DBL_EPSILON, fa = dun(op, a, r);
    const double w = op == U_GAMMA ? 4 : op == U_MINUS ? 0 : op == U_INV || op == U_SQR || op == U_SQRT ? 0.5 : 1;
    double er = (ea == 0.0 ? 0.0 : std::fabs(fa) * ea) + w * u * std::fabs(r);
    if (op == U_SINPI || op == U_COSPI || op == U_TANPI) er += u * std::fabs(a * fa);
    return std::isfinite(er) ? er : INFINITY;
}
static inline double bound_binary(int op, double t, double s, double r, double et, double es)
{
    const double u = DBL_EPSILON;
    double pt, ps;
    switch (op) {
    case B_PLUS: pt = 1; ps = 1; break;
    case B_TIMES: pt = s; ps = t; break;
    case B_SUBTRACT: pt = 1; ps = -1; break;
    case B_DIVIDE: pt = 1.0 / s; ps = -r / s; break;
    case B_POWER: pt = et == 0.0 ? 0.0 : s * r / t; ps = es == 0.0 ? 0.0 : r * std::log(t); break;
    case B_ROOT: pt = et == 0.0 ? 0.0 : -r * std::log(std::fabs(s)) / (t * t); ps = es == 0.0 ? 0.0 : r / (s * t); break;
    case B_ATAN2: {
        const double at = std::fabs(t), as = std::fabs(s), m = at > as ? at : as, tm = t / m, sm = s / m;
        pt = -sm / (m * (tm * tm + sm * sm));
        ps = tm / (m * (tm * tm + sm * sm));
        break;
    }
    default: pt = et == 0.0 ? 0.0 : -r / (t * std::log(t)); ps = es == 0.0 ? 0.0 : 1.0 / (s * std::log(t)); break;
    }
    const double er = (et == 0.0 ? 0.0 : std::fabs(pt) * et) + (es == 0.0 ? 0.0 : std::fabs(ps) * es) +
                      (op == B_LOGARITHM || op == B_ROOT ? 2 : op == B_POWER || op == B_ATAN2 ? 1 : 0.5) * u * std::fabs(r);
    return std::isfinite(er) ? er : INFINITY;
}

struct Tok { int8_t ar; int16_t dig; };                          // a symbol: arity and button index (constant nc: x)

static inline bool commutes(int op) { return op == B_PLUS || op == B_TIMES; }

// a node on the path of x: usable, with a usable nonzero derivative, and not hypersensitive (kappa_min)
static inline bool left_ok(double r, double dr, double kminT)
{
    return usable(r) && usable(dr) && dr != 0.0 && !(std::fabs(r) < kminT * std::fabs(dr));
}

// Per right level: every B-th value, a small index searched first (mostly in cache), then one block of the level
// (mitm_cr's RTable)
struct Index {
    std::vector<double> top;
    size_t B = 16;
    void make(const std::vector<double>& v)
    {
        B = 16;
        while (v.size() / B > (1u << 21)) B *= 2;
        top.clear();
        for (size_t i = 0; i < v.size(); i += B) top.push_back(v[i]);
    }
    // block j with v[(j-1)B] < x <= v[jB], from a hint in block units
    size_t block(size_t hintb, double x) const { return lower_from(top.data(), top.size(), hintb, x); }
    size_t in_block(const std::vector<double>& v, size_t j, double x) const
    {
        const size_t lo = j ? (j - 1) * B + 1 : 0, hi = std::min(v.size(), j * B);
        return std::lower_bound(v.data() + lo, v.data() + std::max(lo, hi), x) - v.data();
    }
    // first i with v[i] >= x (v.size() if none), searching from the previous answer
    size_t lower(const std::vector<double>& v, size_t hint, double x) const { return v.empty() ? 0 : in_block(v, block(hint / B, x), x); }
};

struct Ctx {
    Options o;
    Grammar g;
    std::vector<Level> R;                                       // R[k], k = 1..built
    std::vector<Index> idx;                                     // idx[k]: index of R[k]
    int built = 0;
    uint64_t candidates = 0;                                    // right values made, before merging
    int passes = 0;
    double seconds = 0;
    std::string error;
    double bytes() const { double s = 0; for (const Level& l : R) s += l.bytes(); return s; }
};

// ------------------------------------------------------------------------------------------------ codes

static void right_code(const Ctx& c, int k, uint32_t i, std::vector<Tok>& out)
{
    const Node& n = c.R[k].n[i];
    if (n.kind == N_CONST) out.push_back({0, n.op});
    else if (n.kind == N_UNARY) { right_code(c, n.l1, n.i1, out); out.push_back({1, n.op}); }
    else { right_code(c, n.l2, n.i2, out); right_code(c, n.l1, n.i1, out); out.push_back({2, n.op}); }
}

static void left_code(const Ctx& c, const std::vector<Level>& L, int k, uint32_t i, std::vector<Tok>& out)
{
    const Node& n = L[k].n[i];
    if (n.kind == N_X) out.push_back({0, (int16_t)c.g.nc});
    else if (n.kind == N_LUNARY) { left_code(c, L, n.l1, n.i1, out); out.push_back({1, n.op}); }
    else if (n.kind == N_LSECOND) { left_code(c, L, n.l1, n.i1, out); right_code(c, n.l2, n.i2, out); out.push_back({2, n.op}); }
    else { right_code(c, n.l2, n.i2, out); left_code(c, L, n.l1, n.i1, out); out.push_back({2, n.op}); }
}

static std::string rpn_of(const std::vector<Tok>& code, const Grammar& g)
{
    std::string s;
    for (size_t i = 0; i < code.size(); i++) {
        if (i) s += ", ";
        const Tok t = code[i];
        if (t.ar == 0) s += t.dig == g.nc ? std::string("x") : g.cname[t.dig];
        else if (t.ar == 1) s += UNAME[g.uop[t.dig]];
        else s += BNAME[g.bop[t.dig]];
    }
    return s;
}

// mitm_cr's eval_full on a postfix code of any length: value, derivative d/dx and the running error bound at x
static void eval_code(const std::vector<Tok>& code, const Grammar& g, double x, double& v, double& dv, double& err)
{
    const double u = DBL_EPSILON;
    struct E { double v, d, e; };
    E st[2 * KMAX + 2];
    int sp = 0;
    auto prop = [](double partial, double ein) { return ein == 0.0 ? 0.0 : std::fabs(partial) * ein; };
    for (const Tok& t : code) {
        if (t.ar == 0) {
            if (t.dig == g.nc) st[sp++] = {x, 1.0, 0.0};
            else { const double r = g.cval[t.dig]; st[sp++] = {r, 0.0, r == std::floor(r) ? 0.0 : 0.5 * u * std::fabs(r)}; }
        } else if (t.ar == 1) {
            const E a = st[--sp];
            const int op = g.uop[t.dig];
            const double r = un(op, a.v), fa = dun(op, a.v, r);
            const double w = op == U_GAMMA ? 4 : op == U_MINUS ? 0 : op == U_INV || op == U_SQR || op == U_SQRT ? 0.5 : 1;
            double er = prop(fa, a.e) + w * u * std::fabs(r);
            if (op == U_SINPI || op == U_COSPI || op == U_TANPI) er += u * std::fabs(a.v * fa);
            st[sp++] = {r, a.d != 0.0 ? fa * a.d : 0.0, er};
        } else {
            const E tt = st[--sp], ss = st[--sp];
            const int op = g.bop[t.dig];
            const double tv = tt.v, sv = ss.v, et = tt.e, es = ss.e;
            const double r = bin(op, tv, sv), dr = dbin(op, tv, sv, r, tt.d, ss.d);
            double pt, ps;
            switch (op) {
            case B_PLUS: pt = 1; ps = 1; break;
            case B_TIMES: pt = sv; ps = tv; break;
            case B_SUBTRACT: pt = 1; ps = -1; break;
            case B_DIVIDE: pt = 1.0 / sv; ps = -r / sv; break;
            case B_POWER: pt = et == 0.0 ? 0.0 : sv * std::pow(tv, sv - 1.0); ps = es == 0.0 ? 0.0 : r * std::log(tv); break;
            case B_ROOT: pt = et == 0.0 ? 0.0 : -r * std::log(std::fabs(sv)) / (tv * tv); ps = es == 0.0 ? 0.0 : r / (sv * tv); break;
            case B_ATAN2: {
                const double at = std::fabs(tv), as = std::fabs(sv), m = at > as ? at : as, tm = tv / m, sm = sv / m;
                pt = -sm / (m * (tm * tm + sm * sm));
                ps = tm / (m * (tm * tm + sm * sm));
                break;
            }
            default: pt = et == 0.0 ? 0.0 : -r / (tv * std::log(tv)); ps = es == 0.0 ? 0.0 : 1.0 / (sv * std::log(tv)); break;
            }
            const double er = prop(pt, et) + prop(ps, es) +
                              (op == B_LOGARITHM || op == B_ROOT ? 2 : op == B_POWER || op == B_ATAN2 ? 1 : 0.5) * u * std::fabs(r);
            st[sp++] = {r, dr, er};
        }
    }
    v = st[0].v;
    dv = st[0].d;
    err = st[0].e;
}

// ------------------------------------------------------------------------------------------------ making levels

// Every right value of length k made from the shorter levels, in a fixed order: emit(value, error bound, node)
template <class Emit>
static void gen_right(const Ctx& c, int k, Emit&& emit)
{
    const Grammar& g = c.g;
    if (k == 1) {
        for (int i = 0; i < g.nc; i++)
            if (usable(g.cval[i])) {
                const double r = g.cval[i];
                emit(r, r == std::floor(r) ? 0.0 : 0.5 * DBL_EPSILON * std::fabs(r), Node{N_CONST, (uint8_t)i, 0, 0, 0, 0});
            }
        return;
    }
    const Level& P = c.R[k - 1];
    for (int f = 0; f < g.nu; f++) {
        const int op = g.uop[f];
        for (size_t a = 0; a < P.size(); a++) {
            const double r = un(op, P.v[a]);
            if (usable(r)) emit(r, bound_unary(op, P.v[a], r, P.e[a]), Node{N_UNARY, (uint8_t)f, (uint8_t)(k - 1), 0, (uint32_t)a, 0});
        }
    }
    for (int ob = 0; ob < g.nb; ob++) {
        const int op = g.bop[ob];
        const bool comm = commutes(op);
        for (int i = 1; i <= k - 2; i++) {                      // top operand of length i, second of length j
            const int j = k - 1 - i;
            if (comm && i > j) continue;
            const Level& A = c.R[i];
            const Level& B = c.R[j];
            for (size_t ia = 0; ia < A.size(); ia++) {
                const double t = A.v[ia], et = A.e[ia];
                for (size_t jb = comm && i == j ? ia : 0; jb < B.size(); jb++) {
                    const double r = bin(op, t, B.v[jb]);
                    if (usable(r))
                        emit(r, bound_binary(op, t, B.v[jb], r, et, B.e[jb]),
                             Node{N_BINARY, (uint8_t)ob, (uint8_t)i, (uint8_t)j, (uint32_t)ia, (uint32_t)jb});
                }
            }
        }
    }
}

// The left values made from the left value (l, dl) by one operation: emit(value, derivative, kind, op, rl, ri, len)
// for the new length len = la + 1 (a function) or la + j + 1 (an operator with a right value of length j), if
// lo <= len <= hi. mitm_cr's guards: periodic functions of x only for |argument| <= periodic_max, and left_ok.
template <class Emit>
static void one_step(const Ctx& c, double l, double dl, int la, int lo, int hi, double kminT, Emit&& emit)
{
    const Grammar& g = c.g;
    const double pmax = c.o.periodic_max;
    if (la + 1 >= lo && la + 1 <= hi)
        for (int f = 0; f < g.nu; f++) {
            const int op = g.uop[f];
            if (pmax > 0 && periodic(op) && std::fabs(l) > pmax) continue;
            const double r = un(op, l), dr = dun(op, l, r) * dl;
            if (left_ok(r, dr, kminT)) emit(r, dr, N_LUNARY, f, 0, 0u, la + 1);
        }
    for (int j = std::max(1, lo - la - 1); la + j + 1 <= hi; j++) {
        const Level& B = c.R[j];
        for (int ob = 0; ob < g.nb; ob++) {
            const int op = g.bop[ob];
            const bool comm = commutes(op);
            for (size_t jb = 0; jb < B.size(); jb++) {
                const double rv = B.v[jb];
                double r = bin(op, rv, l), dr = dbin(op, rv, l, r, 0.0, dl);           // "l, r, op"
                if (left_ok(r, dr, kminT)) emit(r, dr, N_LSECOND, ob, j, (uint32_t)jb, la + j + 1);
                if (comm) continue;
                r = bin(op, l, rv);                                                    // "r, l, op"
                dr = dbin(op, l, rv, r, dl, 0.0);
                if (left_ok(r, dr, kminT)) emit(r, dr, N_LTOP, ob, j, (uint32_t)jb, la + j + 1);
            }
        }
    }
}

// Every left value of length k >= 2 made from the kept left levels L[1..k-1]: emit(value, derivative, node)
template <class Emit>
static void gen_left(const Ctx& c, const std::vector<Level>& L, int k, double kminT, Emit&& emit)
{
    for (int i = 1; i <= k - 1; i++) {
        const Level& A = L[i];
        for (size_t ia = 0; ia < A.size(); ia++)
            one_step(c, A.v[ia], A.d[ia], i, k, k, kminT, [&](double r, double dr, uint8_t kind, int op, int rl, uint32_t ri, int) {
                emit(r, dr, Node{kind, (uint8_t)op, (uint8_t)i, (uint8_t)rl, (uint32_t)ia, ri});
            });
    }
}

// (value, derivative) keys in lexicographic order; right levels: derivative key 0
static inline bool key_less(uint64_t av, uint64_t ad, uint64_t bv, uint64_t bd) { return av < bv || (av == bv && ad < bd); }

// One level from its candidates (gen(emit) makes them all, in a fixed order; emit(value, second, node)). Passes over
// consecutive ranges of the value (bins of the order-preserving key), each within the room: the candidates of a pass
// are sorted stably by (value, second), equal ones merged, and those present in a shorter level (shorter[1..k-1])
// dropped. Left levels: second = the derivative, pairs of equal value and derivative merged (the first made kept).
// Right levels: second = the error bound, equal values merged, the code with the smallest bound kept (mitm_cr keeps
// the first code of its enumeration, whatever its rounding errors, and the verification of a pair depends on that
// choice). Returns false, with error set, if the level does not fit in `room` bytes.
template <class Gen>
static bool make_level(Gen&& gen, bool left, const std::vector<Level>& shorter, int k, double room, size_t min_pass,
                       Level& out, uint64_t& ncand, int& npasses, std::string& error)
{
    const int NBIN = 1 << 20;
    uint64_t total = 0;
    gen([&](double, double, const Node&) { total++; });
    ncand += total;
    out = Level();
    if (total == 0) return true;
    const double per = 2.0 * sizeof(Pair) + sizeof(Node) + 16.0;                  // pass buffer per candidate
    const double kept = left ? 28.0 : 24.0;                                       // per value kept
    const uint64_t budget = (uint64_t)std::max((double)min_pass, room / 3 / per);
    std::vector<std::pair<int, int>> passes;
    uint64_t maxpass = 0;
    if (total <= budget) {                                      // one pass (no histogram)
        passes.push_back({0, NBIN});
        maxpass = total;
    } else {
        std::vector<uint64_t> H(NBIN, 0);
        gen([&](double v, double, const Node&) { H[key_of(v + 0.0) >> 44]++; });
        for (int b = 0; b < NBIN;) {
            if (!H[b]) { b++; continue; }
            const int b0 = b;
            uint64_t n = 0;
            while (b < NBIN && (n == 0 || n + H[b] <= budget)) n += H[b++];
            passes.push_back({b0, b});
            maxpass = std::max(maxpass, n);
        }
    }
    npasses += (int)passes.size();
    if (maxpass * per > room) { error = "exceeds the memory cap"; return false; }
    std::vector<Pair> s1(maxpass), s2(maxpass);
    std::vector<Node> nb(maxpass);
    std::vector<uint64_t> vk(maxpass), dk(maxpass);
    std::vector<Level> parts;
    uint64_t nkept = 0;
    std::vector<size_t> pos(k, 0);
    for (const auto& ps : passes) {
        const int b0 = ps.first, b1 = ps.second;
        size_t m = 0;
        gen([&](double v, double d, const Node& nd) {
            const uint64_t key = key_of(v + 0.0);
            const int b = (int)(key >> 44);
            if (b < b0 || b >= b1) return;
            nb[m] = nd;
            vk[m] = key;
            dk[m] = key_of(d + 0.0);
            m++;
        });
        // by the second key, then stably by value: (value, second) order, ties in the order made
        for (size_t i = 0; i < m; i++) s1[i] = {dk[i], i};
        const Pair* t = radix_sort(s1.data(), s2.data(), m);
        Pair* u = t == s1.data() ? s2.data() : s1.data();
        for (size_t i = 0; i < m; i++) u[i] = {vk[t[i].idx], t[i].idx};
        Pair* w = u == s1.data() ? s2.data() : s1.data();
        const Pair* s = radix_sort(u, w, m);
        // the shorter levels from the first value of the pass on
        if (m) {
            const double v0 = val_of(vk[s[0].idx]);
            for (int j = 1; j < k; j++) pos[j] = std::lower_bound(shorter[j].v.begin(), shorter[j].v.end(), v0) - shorter[j].v.begin();
        }
        // the candidates kept (positions in the pass), then the part at its exact size
        std::vector<uint32_t> keep;
        keep.reserve(m);
        uint64_t pv = ~0ULL, pd = ~0ULL;
        for (size_t i = 0; i < m; i++) {
            const size_t q = s[i].idx;
            const uint64_t kv = vk[q], kd = left ? dk[q] : 0;      // right levels: merged by value only
            if (i > 0 && kv == pv && kd == pd) continue;        // equal: the first made is kept
            pv = kv;
            pd = kd;
            bool seen = false;
            for (int j = 1; j < k && !seen; j++) {
                const Level& S = shorter[j];
                size_t& p = pos[j];
                while (p < S.size() && key_less(key_of(S.v[p] + 0.0), left ? key_of(S.d[p] + 0.0) : 0, kv, kd)) p++;
                seen = p < S.size() && key_of(S.v[p] + 0.0) == kv && (!left || key_of(S.d[p] + 0.0) == kd);
            }
            if (!seen) keep.push_back((uint32_t)q);
        }
        nkept += keep.size();
        // memory: one pass holds its part only; several hold their parts and, at the end, the level joined from them
        if (maxpass * per + 4.0 * m + (passes.size() == 1 ? 1.0 : 2.0) * nkept * kept > room) {
            error = "exceeds the memory cap";
            return false;
        }
        Level part;
        part.v.resize(keep.size());
        part.n.resize(keep.size());
        if (left) part.d.resize(keep.size()); else part.e.resize(keep.size());
        for (size_t j = 0; j < keep.size(); j++) {
            const uint32_t q = keep[j];
            part.v[j] = val_of(vk[q]);
            if (left) part.d[j] = val_of(dk[q]);
            else part.e[j] = (float)std::min(val_of(dk[q]), 3.0e38);
            part.n[j] = nb[q];
        }
        parts.push_back(std::move(part));
    }
    std::vector<Pair>().swap(s1);
    std::vector<Pair>().swap(s2);
    std::vector<Node>().swap(nb);
    std::vector<uint64_t>().swap(vk);
    std::vector<uint64_t>().swap(dk);
    if (nkept > 0xFFFFFFFFULL) { error = "more than 2^32 values of one length"; return false; }
    if (parts.size() == 1) { out = std::move(parts[0]); return true; }
    out.v.reserve(nkept);
    out.n.reserve(nkept);
    if (left) out.d.reserve(nkept); else out.e.reserve(nkept);
    for (Level& p : parts) {
        out.v.insert(out.v.end(), p.v.begin(), p.v.end());
        out.n.insert(out.n.end(), p.n.begin(), p.n.end());
        if (left) out.d.insert(out.d.end(), p.d.begin(), p.d.end());
        else out.e.insert(out.e.end(), p.e.begin(), p.e.end());
        p = Level();
    }
    return true;
}

// The right levels up to length K (those already made are kept)
static bool build_right(Ctx& c, int K)
{
    if (K <= c.built) return true;
    const double t0 = now();
    if ((int)c.R.size() < K + 1) c.R.resize(K + 1);
    const double cap = c.o.memcap_gb * GB;
    for (int k = c.built + 1; k <= K; k++) {
        Level out;
        std::string err;
        const bool ok = make_level([&](auto&& emit) { gen_right(c, k, emit); }, false, c.R, k, cap - c.bytes(),
                                   c.o.chunk, out, c.candidates, c.passes, err);
        if (!ok) {
            c.error = "right-side table " + err + "; use a smaller right-side length";
            return false;
        }
        c.R[k] = std::move(out);
        c.built = k;
    }
    c.idx.resize(c.built + 1);
    for (int k = 1; k <= c.built; k++) c.idx[k].make(c.R[k].v);
    c.seconds += now() - t0;
    return true;
}

// ------------------------------------------------------------------------------------------------ search

// An equation found, with its codes
struct Eq {
    Match m;
    std::vector<Tok> lhs, rhs;
};

struct Result {
    Eq best;                                                    // shortest accepted equation (total INT_MAX: none)
    std::vector<Eq> approx;                                     // approx[n]: closest pair of total length n
    std::vector<Eq> matches;                                    // accepted equations (list mode or list_cap)
    std::vector<uint64_t> nL;                                   // nL[a]: distinct left values of length a tested
    uint64_t candidates = 0;
    int kept = 0;                                               // left levels kept (longer ones made on the fly)
    uint64_t made = 0;                                          // left values made, before merging
    double gb = 0;                                              // memory of the kept left levels
    double ms = 0;
};

// A left value above the kept levels: a kept value (bl, bi), then ne operations
struct Ext { uint8_t kind, op, rl, pad; uint32_t ri; };
struct Entry {
    double v, d;
    uint8_t a, bl, ne, pad;
    uint32_t bi;
    Ext x[MAXEXT];
};

struct Worker {
    const Ctx& c;
    double room;                                                // bytes for this worker's left levels
    std::vector<Level> L;
    Result res;
    std::vector<size_t> hint;
    double T = 0, absT = 1, tol = 0, tolT = 0, errcap = 0, kminT = 0;
    int KL = 0, KR = 0;
    uint64_t nskip_kappa = 0, nskip_try = 0, nrej_err = 0, sum_L = 0, sum_Ld = 0, sum_cand = 0;
    double t_left = 0, t_match = 0;
    std::string listing;
    const char* id = "";
    std::vector<Entry> chunk;
    std::vector<Pair> s1, s2;

    Worker(const Ctx& ctx, double room_bytes) : c(ctx), room(room_bytes) {}

    void entry_code(const Entry& e, std::vector<Tok>& out) const
    {
        out.clear();
        left_code(c, L, e.bl, e.bi, out);
        for (int q = 0; q < e.ne; q++) {
            const Ext& x = e.x[q];
            if (x.kind == N_LUNARY) out.push_back({1, x.op});
            else if (x.kind == N_LSECOND) { right_code(c, x.rl, x.ri, out); out.push_back({2, x.op}); }
            else {
                std::vector<Tok> r;
                right_code(c, x.rl, x.ri, r);
                r.insert(r.end(), out.begin(), out.end());
                r.push_back({2, x.op});
                out.swap(r);
            }
        }
    }

    // Newton from T on L(x) = r (4 steps); the root, and at T the error bound of L and its derivative
    double newton(const std::vector<Tok>& lc, double r, double& eL, double& dL) const
    {
        double x = T;
        for (int it = 0; it < 4; it++) {
            double v, d, e;
            eval_code(lc, c.g, x, v, d, e);
            if (it == 0) { eL = e; dL = d; }
            if (!std::isfinite(v) || !std::isfinite(d) || d == 0.0) return NAN;
            const double dx = (v - r) / d;
            if (dx == 0.0) break;
            x -= dx;
        }
        return x;
    }

    // the root of L(x) = r by Newton steps from T, for an approximation (mitm_cr's newton_root)
    bool newton_root(const std::vector<Tok>& lc, double r, double& x) const
    {
        x = T;
        for (int it = 0; it < 64; it++) {
            double v, d, e;
            eval_code(lc, c.g, x, v, d, e);
            if (!std::isfinite(v) || !std::isfinite(d) || d == 0.0) return false;
            const double dx = (v - r) / d;
            if (!std::isfinite(dx)) return false;
            x -= dx;
            if (!std::isfinite(x)) return false;
            if (std::fabs(dx) <= 1e-14 * std::fabs(x) || dx == 0.0) return true;
        }
        return false;
    }

    double code_error(const std::vector<Tok>& code, double x = 0.0) const
    {
        double v, d, e;
        eval_code(code, c.g, x, v, d, e);
        return e;
    }

    void keep_match(const Eq& q)
    {
        if (c.o.list_cap == 0) return;
        res.matches.push_back(q);
        if (res.matches.size() > 2 * c.o.list_cap + 64) {
            std::sort(res.matches.begin(), res.matches.end(), [](const Eq& x, const Eq& y) { return x.m.better(y.m); });
            res.matches.resize(c.o.list_cap);
        }
    }

    // a candidate pair: the left value (v, d) of length a, right side j of length b; true if accepted
    template <class Code>
    bool candidate(const Level& R, size_t j, int b, double v, double d, int a, Code&& lcode)
    {
        (void)v; (void)d;
        res.candidates++;
        const int total = a + b;
        if (!c.o.list && total > res.best.m.total) return false;
        std::vector<Tok> lc, rc;
        lcode(lc);
        right_code(c, b, (uint32_t)j, rc);
        double eL = INFINITY, dL = 0;
        const double x = newton(lc, R.v[j], eL, dL);
        const double err = std::fabs(x - T) / absT;
        const double ex = (eL + code_error(rc)) / std::fabs(dL) / absT;   // in this order: |L'| |T| can overflow
        if (!(err <= tol)) return false;
        if (!(ex <= errcap)) { nrej_err++; return false; }
        Eq q;
        q.m.total = total; q.m.la = a; q.m.lb = b; q.m.err = err; q.m.accepted = true; q.m.x = x;
        q.lhs = lc;
        q.rhs = rc;
        if (c.o.list) {
            char buf[96];
            snprintf(buf, sizeof buf, "\t%.5e\t%.2e\n", err, ex);
            listing += std::string("#MATCH\t") + id + "\t" + std::to_string(total) + "\t" + rpn_of(lc, c.g) + "\t" +
                       rpn_of(rc, c.g) + buf;
        }
        keep_match(q);
        if (q.m.better(res.best.m)) res.best = q;
        if (res.approx[total].m.err >= err) res.approx[total] = q;
        return true;
    }

    // all right sides of length b for the left value (v, d) (position p = first value >= v): the closest pair is kept
    // as the approximation of its total length; inside the window, candidates are tried closest first
    template <class Code>
    bool match_length(const Level& R, size_t p, int b, double v, double dd, int a, Code&& lcode)
    {
        const double d = std::fabs(dd), w = tolT * d;
        const size_t n = R.size();
        const double dl = p > 0 ? v - R.v[p - 1] : INFINITY, dr = p < n ? R.v[p] - v : INFINITY;
        const double dmin = std::min(dl, dr);
        if (!(dmin < INFINITY)) return false;
        if (dmin > w) {
            Eq& ap = res.approx[a + b];
            const double e = dmin / d / absT;
            if (e < ap.m.err) {
                // kept only if its own rounding errors, mapped to x, are well below its distance from the target
                const size_t jj = dl <= dr ? p - 1 : p;
                std::vector<Tok> lc, rc;
                lcode(lc);
                right_code(c, b, (uint32_t)jj, rc);
                double v0, d0, eL;
                eval_code(lc, c.g, T, v0, d0, eL);
                if ((eL + code_error(rc)) / std::fabs(d0) / absT <= 0.25 * e) {
                    ap.m.total = a + b; ap.m.la = a; ap.m.lb = b; ap.m.err = e; ap.m.accepted = false; ap.m.x = NAN;
                    ap.lhs = lc;
                    ap.rhs = rc;
                }
            }
            return false;
        }
        size_t l = p, r = p, tries = 0;
        while (tries < c.o.maxtry) {
            const bool hl = l > 0 && v - R.v[l - 1] <= w, hr = r < n && R.v[r] - v <= w;
            if (!hl && !hr) return false;
            const size_t j = hl && (!hr || v - R.v[l - 1] <= R.v[r] - v) ? --l : r++;
            tries++;
            if (candidate(R, j, b, v, dd, a, lcode) && !c.o.list) return true;
        }
        nskip_try++;
        return false;
    }

    // one left value: the kappa range, then the tables by increasing length (blk: its block in the largest table)
    template <class Code>
    void match_value(double v, double d, int a, size_t blk, Code&& lcode)
    {
        const double kap = std::fabs(v) / std::fabs(d) / absT;
        if (!(kap >= c.o.kappa_min && kap <= c.o.kappa_max)) { nskip_kappa++; return; }
        res.nL[a]++;
        int bmax = KR;
        if (!c.o.list && res.best.m.total != INT_MAX) bmax = std::min(bmax, res.best.m.total - a);   // ties: smaller error
        for (int b = 1; b <= bmax; b++) {
            const Level& R = c.R[b];
            if (R.v.empty()) continue;
            const size_t p = b == KR ? c.idx[KR].in_block(R.v, blk, v) : lower_from(R.v.data(), R.size(), hint[b], v);
            hint[b] = p;
            if (match_length(R, p, b, v, d, a, lcode)) break;   // longer right sides only give longer equations
        }
    }

    // A batch of left values in ascending order, q[0..n): the block of the largest table is located in its index
    // and prefetched PF values ahead, so the memory latency overlaps (mitm_cr's flush)
    struct Q { double v, d; uint32_t ref; uint8_t a; };
    std::vector<Q> q;
    std::vector<size_t> qb;

    void prefetch(const Level& R, const Index& I, size_t j) const
    {
        if (R.v.empty()) return;
        const char* p = (const char*)(R.v.data() + std::min(R.v.size() - 1, j ? (j - 1) * I.B : 0));
        PREFETCH(p);
        PREFETCH(p + 64);
    }

    template <class Code>
    void match_batch(size_t n, Code&& code_of)
    {
        const int PF = 16;
        const Level& RL = c.R[KR];
        const Index& IL = c.idx[KR];
        if (qb.size() < n) qb.resize(n);
        size_t hb = 0;
        auto locate = [&](size_t k) { qb[k] = IL.block(hb, q[k].v); hb = qb[k]; prefetch(RL, IL, qb[k]); };
        for (size_t k = 0; k < n && k < (size_t)PF; k++) locate(k);
        for (size_t k = 0; k < n; k++) {
            if (k + PF < n) locate(k + PF);
            const Q& e = q[k];
            if (!c.o.list && res.best.m.total < e.a + 1) continue;     // not even a tie possible
            match_value(e.v, e.d, e.a, qb[k], [&](std::vector<Tok>& out) { code_of(e, out); });
        }
    }

    // the left values above the kept levels, a chunk at a time: sorted by value, merged (equal value and
    // derivative), matched
    void flush()
    {
        const size_t m = chunk.size();
        if (!m) return;
        const double t0 = now();
        if (s1.size() < m) { s1.resize(m); s2.resize(m); }
        for (size_t i = 0; i < m; i++) s1[i] = {key_of(chunk[i].v + 0.0), i};
        const Pair* s = radix_sort(s1.data(), s2.data(), m);
        q.clear();
        for (size_t i = 0; i < m;) {
            size_t j = i + 1;
            while (j < m && s[j].key == s[i].key) j++;
            // a run of equal values: one per derivative (the first made)
            for (size_t r = i; r < j; r++) {
                const Entry& e = chunk[s[r].idx];
                bool dup = false;
                for (size_t t = i; t < r && !dup; t++) dup = chunk[s[t].idx].d == e.d || (chunk[s[t].idx].d + 0.0 == 0.0 && e.d + 0.0 == 0.0);
                if (!dup) q.push_back({e.v, e.d, (uint32_t)s[r].idx, e.a});
            }
            i = j;
        }
        match_batch(q.size(), [&](const Q& e, std::vector<Tok>& out) { entry_code(chunk[e.ref], out); });
        chunk.clear();
        t_match += now() - t0;
    }

    // left values of lengths S+1..KL from the kept levels: a kept value of length i <= S, a first operation that
    // leads above S, then any further ones up to KL (each value made once per kept value and chain of operations)
    void extend(Entry& e, int len, int S)
    {
        one_step(c, e.v, e.d, len, S + 1, KL, kminT, [&](double r, double dr, uint8_t kind, int op, int rl, uint32_t ri, int nl) {
            Entry f = e;
            f.v = r;
            f.d = dr;
            f.a = (uint8_t)nl;
            f.x[f.ne++] = Ext{kind, (uint8_t)op, (uint8_t)rl, 0, ri};
            sum_L++;
            res.made++;
            chunk.push_back(f);
            if (chunk.size() >= c.o.chunk) flush();
            if (nl < KL) extend(f, nl, S);
        });
    }

    Result& run(const char* id_, double T_, int KL_, int KR_)
    {
        id = id_;
        T = T_;
        KL = KL_;
        KR = KR_;
        absT = T != 0.0 ? std::fabs(T) : 1.0;
        tol = c.o.tolrel > 0 ? c.o.tolrel : c.o.tol_eps * DBL_EPSILON;
        tolT = tol * absT;
        errcap = std::max(c.o.errcap, tol);
        kminT = T != 0.0 ? c.o.kappa_min * absT : 0.0;
        res = Result();
        res.approx.assign(KL + KR + 1, Eq());
        res.nL.assign(KL + 1, 0);
        hint.assign(KR + 1, 0);
        listing.clear();
        const double t0 = now();
        L.assign(KL + 1, Level());
        L[1].v = {T};
        L[1].d = {1.0};
        L[1].n = {Node{N_X, 0, 0, 0, 0, 0}};
        double used = L[1].bytes();
        int S = 1;
        bool stop = false;
        for (int a = 1; a <= KL && !stop; a++) {
            if (!c.o.list && res.best.m.total <= a + 1) { stop = true; break; }   // no shorter equation possible
            if (a > 1) {
                if (a == KL) break;                             // the longest left sides are made on the fly
                Level out;
                std::string err;
                uint64_t made = 0;
                int np = 0;
                const double tl = now();
                const bool ok = make_level([&](auto&& emit) { gen_left(c, L, a, kminT, emit); }, true, L, a, room - used,
                                           c.o.chunk, out, made, np, err);
                t_left += now() - tl;
                res.made += made;
                if (!ok) break;                                 // not kept: made on the fly from the shorter levels
                L[a] = std::move(out);
                used += L[a].bytes();
                S = a;
            }
            const Level& A = L[a];
            const double tm = now();
            for (size_t i0 = 0; i0 < A.size(); i0 += c.o.chunk) {
                const size_t i1 = std::min(A.size(), i0 + c.o.chunk);
                q.clear();
                for (size_t i = i0; i < i1; i++) q.push_back({A.v[i], A.d[i], (uint32_t)i, (uint8_t)a});
                match_batch(q.size(), [&](const Q& e, std::vector<Tok>& out) { out.clear(); left_code(c, L, e.a, e.ref, out); });
            }
            t_match += now() - tm;
        }
        res.kept = S;
        res.gb = used / GB;
        if (!stop && S < KL && (c.o.list || res.best.m.total > S + 2)) {
            if (KL - S > MAXEXT) {
                if (c.o.list || res.best.m.total == INT_MAX) res.kept = -S;   // too long for the memory cap: not searched
            } else {
                chunk.reserve(std::min<size_t>(c.o.chunk, 1 << 22));
                for (int i = 1; i <= S; i++)
                    for (size_t idx = 0; idx < L[i].size(); idx++) {
                        Entry e;
                        e.v = L[i].v[idx];
                        e.d = L[i].d[idx];
                        e.a = (uint8_t)i;
                        e.bl = (uint8_t)i;
                        e.bi = (uint32_t)idx;
                        e.ne = 0;
                        e.pad = 0;
                        extend(e, i, S);
                    }
                flush();
                std::vector<Entry>().swap(chunk);
            }
        }
        // approximations: the true distance of their root from T (the one-step estimate holds only near the root)
        for (Eq& ap : res.approx) {
            if (ap.m.total == INT_MAX || ap.m.accepted) continue;
            double x;
            double rv, rd, re;
            eval_code(ap.rhs, c.g, 0.0, rv, rd, re);
            if (newton_root(ap.lhs, rv, x)) { ap.m.err = std::fabs(x - T) / absT; ap.m.x = x; }
            else ap = Eq();
        }
        if (c.o.list_cap > 0) {
            std::sort(res.matches.begin(), res.matches.end(), [](const Eq& x, const Eq& y) { return x.m.better(y.m); });
            if (res.matches.size() > c.o.list_cap) res.matches.resize(c.o.list_cap);
        }
        for (uint64_t x : res.nL) sum_Ld += x;
        sum_cand += res.candidates;
        L = std::vector<Level>();                               // the memory goes back for the next target
        res.ms = (now() - t0) * 1e3;
        return res;
    }

    const Eq* closest() const
    {
        const Eq* b = nullptr;
        for (const Eq& x : res.approx)
            if (x.m.total != INT_MAX && (!b || x.m.err < b->m.err)) b = &x;
        return b;
    }

    std::string line() const
    {
        const bool ok = res.best.m.total != INT_MAX;
        const Eq* b = ok ? &res.best : closest();
        char out[8192];
        if (!b)
            snprintf(out, sizeof out, "%s\tFAILURE\t0\t\t\t%.5e\t%llu\t%.1f\n", id, 1.0, (unsigned long long)res.candidates, res.ms);
        else
            snprintf(out, sizeof out, "%s\t%s\t%d\t%s\t%s\t%.5e\t%llu\t%.1f\n", id, ok ? "SUCCESS" : "FAILURE", b->m.total,
                     rpn_of(b->lhs, c.g).c_str(), rpn_of(b->rhs, c.g).c_str(), b->m.err, (unsigned long long)res.candidates,
                     res.ms);
        return listing + out;
    }
};

} // namespace distinct

#ifdef MITM_DISTINCT_MAIN
int main(int argc, char** argv)
{
    using distinct::KMAX;
    using distinct::GB;
    distinct::Ctx c;
    Options& o = c.o;
    for (int i = 1; i < argc; i++) {
        std::string a = argv[i];
        auto next = [&]() { if (i + 1 >= argc) { fprintf(stderr, "missing value for %s\n", a.c_str()); exit(2); } return argv[++i]; };
        if (a == "--kl") o.kl = atoi(next());
        else if (a == "--kr") o.kr = atoi(next());
        else if (a == "--common") { o.consts = COMMON_CONSTS; o.funcs = COMMON_FUNCS; o.ops = CALC4_OPS; }
        else if (a == "--consts") o.consts = next();
        else if (a == "--funcs") o.funcs = next();
        else if (a == "--ops") o.ops = next();
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
        else if (a == "--any-x" || a == "--anyx") { fprintf(stderr, "mitm_distinct: x exactly once only (use mitm_cr for --any-x)\n"); return 2; }
        else { fprintf(stderr, "unknown option %s (see the header of mitm_distinct.cpp)\n", a.c_str()); return 2; }
    }
    const std::string gerr = make_grammar(c.g, o.consts, o.funcs, o.ops);
    if (!gerr.empty()) { fprintf(stderr, "buttons: %s\n", gerr.c_str()); return 2; }
    if (o.kappa_max < 0) o.kappa_max = 2 * (o.tolrel > 0 ? o.tolrel / DBL_EPSILON : o.tol_eps);
    if (o.kl < 1 || o.kl > KMAX || o.kr < 1 || o.kr > KMAX || o.chunk < 1) { fprintf(stderr, "bad lengths (1..%d)\n", KMAX); return 2; }
    const double T0 = now(), C0 = cpu_seconds();
    fprintf(stderr, "grammar: %d constants, %d functions, %d operators; left sides: x exactly once, length <= %d; right "
            "sides: length <= %d (kept up to %d for the constants of left sides); tol %g, kappa %g..%g, errcap %g, maxtry %zu, "
            "%d thread(s)\n", c.g.nc, c.g.nu, c.g.nb, o.kl, o.kr, std::max(o.kr, o.kl - 2),
            o.tolrel > 0 ? o.tolrel : o.tol_eps * DBL_EPSILON, o.kappa_min, o.kappa_max, o.errcap, o.maxtry, o.threads);
    if (!distinct::build_right(c, std::max(o.kr, o.kl - 2))) { fprintf(stderr, "%s (cap %.1f GB)\n", c.error.c_str(), o.memcap_gb); return 3; }
    uint64_t nR = 0;
    std::string sizes;
    for (int k = 1; k <= c.built; k++) { if (k <= o.kr) nR += c.R[k].size(); sizes += (k > 1 ? " " : "") + std::to_string(c.R[k].size()); }
    fprintf(stderr, "right sides: %llu distinct values of length <= %d (per length: %s), made from %llu values in %d pass(es); "
            "tables %.2f GB; build %.2f s, peak memory %.2f GB\n", (unsigned long long)nR, o.kr, sizes.c_str(),
            (unsigned long long)c.candidates, c.passes, c.bytes() / GB, c.seconds, peak_gb());
    const double t_R = now() - T0, cpu_R = cpu_seconds() - C0;

    std::vector<std::string> ids;
    std::vector<double> vals;
    char line[512], id[256];
    while (fgets(line, sizeof line, stdin)) {
        double v;
        if (sscanf(line, "%255s %lf", id, &v) == 2) { ids.push_back(id); vals.push_back(v); }
    }
    const int NT = std::max(1, o.threads);
    const double room = std::max(0.25 * GB, (o.memcap_gb * GB - c.bytes()) / NT);
    std::vector<distinct::Worker*> workers;
    for (int t = 0; t < NT; t++) workers.push_back(new distinct::Worker(c, room));
    std::vector<std::string> out(ids.size());
    std::vector<char> done(ids.size(), 0);
    std::vector<int> kept(ids.size(), 0);
    size_t next_print = 0;
    std::mutex mu;
    const double t1 = now();
    parallel_for(NT, ids.size(), [&](int tid, size_t i) {
        workers[tid]->run(ids[i].c_str(), vals[i], o.kl, o.kr);
        std::string r = workers[tid]->line();
        std::lock_guard<std::mutex> lk(mu);
        kept[i] = workers[tid]->res.kept;
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
    double tl = 0, tm = 0;
    uint64_t nl = 0, nld = 0, nc = 0, sk = 0, sw = 0, re = 0;
    int kmin = KMAX, kmax = 0, nshort = 0;
    for (distinct::Worker* w : workers) {
        tl += w->t_left; tm += w->t_match; nl += w->sum_L; nld += w->sum_Ld; nc += w->sum_cand;
        sk += w->nskip_kappa; sw += w->nskip_try; re += w->nrej_err;
    }
    for (int k : kept) { if (k < 0) nshort++; kmin = std::min(kmin, std::abs(k)); kmax = std::max(kmax, std::abs(k)); }
    fprintf(stderr, "targets: %zu in %.2f s wall (%.1f ms each); summed over threads: left levels %.2f s, matching %.2f s; "
            "left levels kept up to length %d..%d (memory per thread %.2f GB)%s; %llu left values made on the fly, %llu "
            "distinct left values tested (skipped: %llu by kappa; maxtry reached %llu times), %llu candidates (%llu rejected "
            "by errcap)\n", ids.size(), t_T, ids.empty() ? 0.0 : 1e3 * t_T / ids.size(), tl, tm, ids.empty() ? 0 : kmin,
            kmax, room / GB, nshort ? (", " + std::to_string(nshort) + " target(s) not searched to the full left length: "
            "memory cap").c_str() : "", (unsigned long long)nl, (unsigned long long)nld, (unsigned long long)sk,
            (unsigned long long)sw, (unsigned long long)nc, (unsigned long long)re);
    fprintf(stderr, "total: %.2f s wall (right sides %.2f s), CPU %.2f s (right sides %.2f s), peak memory %.2f GB\n",
            now() - T0, t_R, cpu_seconds() - C0, cpu_R, peak_gb());
    for (distinct::Worker* w : workers) delete w;
    return 0;
}
#endif
