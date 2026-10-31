// mitm_wasm.cpp - the meet-in-the-middle search (mitm_cr.cpp) as a WebAssembly library for the web page
//
// Author: Andrzej Odrzywolek
// Date: October 4, 2026
// Code assist: Claude Opus 5.5
//
// Used by calculator_frontend/public/wasm/mitm_worker.js (page app/mitm). The right-side tables are built once
// per button set and right-side length (mitm_build) and stay in the module's memory, so every later search
// (mitm_search) costs only its left sides: about a millisecond at |L| <= 4, 20 ms at |L| <= 5.
// Two engines with the same answers: mitm_cr.cpp enumerates every code (mitm_build, mitm_search); mitm_distinct.cpp
// builds every length from the distinct values of shorter lengths (mitm_distinct_build, mitm_distinct_search), far
// faster when few buttons make most codes repeat a value, with about twice the memory per value. Building one
// engine's table frees the other's. All functions return a malloc()ed JSON string; the caller frees it
// (Module._free).
//
// Build: build_mitm_wasm.bat (Windows) or the em++ line in it; writes calculator_frontend/public/wasm/mitm.js and
// mitm.wasm (build artifacts, not in git).

#define MITM_LIBRARY
#include "mitm_distinct.cpp"                                    // includes mitm_cr.cpp
#include <emscripten/emscripten.h>

static Ctx* G = nullptr;
static Worker* W = nullptr;
static distinct::Ctx* DG = nullptr;
static distinct::Worker* DW = nullptr;

static void free_codes() { delete W; W = nullptr; delete G; G = nullptr; }
static void free_distinct() { delete DW; DW = nullptr; delete DG; DG = nullptr; }

static char* to_c(const std::string& s)
{
    char* p = (char*)malloc(s.size() + 1);
    memcpy(p, s.c_str(), s.size() + 1);
    return p;
}

static std::string num(double v)
{
    if (!std::isfinite(v)) return "null";
    char b[40];
    snprintf(b, sizeof b, "%.17g", v);
    return b;
}

static std::string match_json(const Ctx& c, const Match& m)
{
    if (m.total == INT_MAX) return "null";
    return "{\"total\":" + std::to_string(m.total) + ",\"a\":" + std::to_string(m.la) + ",\"b\":" + std::to_string(m.lb) +
           ",\"lhs\":\"" + rpn(form_of(c.Lf, m.lrank), m.lrank, c.g) + "\",\"rhs\":\"" +
           rpn(form_of(c.Rf, m.rrank), m.rrank, c.g) + "\",\"err\":" + num(m.err) + ",\"x\":" + num(m.x) + "}";
}

extern "C" {

// Right-side tables of length 1..KR for the buttons (comma-separated names, see make_grammar). Returns
// {"ok":1,"sizes":[n_1..n_KR],"codes","finite","distinct","passes","seconds","gb"} or {"ok":0,"error":"..."}.
EMSCRIPTEN_KEEPALIVE char* mitm_build(const char* consts, const char* funcs, const char* ops, int KR, double memcap_gb)
{
    g_verbose = false;
    free_distinct();
    free_codes();
    G = new Ctx();
    Ctx& c = *G;
    c.o.kr = KR;
    c.o.kl = 0;
    c.o.memcap_gb = memcap_gb > 0 ? memcap_gb : 2.0;
    c.o.chunk = 1 << 18;
    const std::string err = make_grammar(c.g, consts, funcs, ops);
    if (!err.empty() || KR < 1 || KR > MAXK) {
        delete G;
        G = nullptr;
        return to_c("{\"ok\":0,\"error\":\"" + (err.empty() ? "right-side length must be 1.." + std::to_string(MAXK) : err) + "\"}");
    }
    setup_right(c);
    if (!build_R(c)) {
        const std::string e = c.stats.error;
        delete G;
        G = nullptr;
        return to_c("{\"ok\":0,\"error\":\"" + e + "\"}");
    }
    std::string sizes;
    for (int b = 1; b <= KR; b++) sizes += (b > 1 ? "," : "") + std::to_string(c.Rb[b].v.size());
    const BuildStats& s = c.stats;
    return to_c("{\"ok\":1,\"sizes\":[" + sizes + "],\"codes\":" + std::to_string(s.codes) + ",\"finite\":" +
                std::to_string(s.finite) + ",\"distinct\":" + std::to_string(s.distinct) + ",\"passes\":" +
                std::to_string(s.passes) + ",\"seconds\":" + num(s.seconds) + ",\"gb\":" + num(s.gb) + "}");
}

// One target T with relative tolerance tolrel (<= 0: 16 DBL_EPSILON; at least DBL_EPSILON), left sides of length
// <= KL, x exactly once (any_x = 0) or any number of times; listCap accepted equations are returned besides the
// shortest. Returns
// {"ok":1,"status":"SUCCESS"|"FAILURE","tol","ms","candidates","best":{...}|null,"approx":[...],"matches":[...],
// "nL":[...]}; an equation is {"total","a","b","lhs","rhs","err","x"} with RPN in the engine's button names
// and x its root next to the target (null if Newton did not converge).
EMSCRIPTEN_KEEPALIVE char* mitm_search(double T, double tolrel, int KL, int any_x, int listCap)
{
    if (!G) return to_c("{\"ok\":0,\"error\":\"no right-side table: call mitm_build first\"}");
    Ctx& c = *G;
    if (KL < 1 || KL > MAXK) return to_c("{\"ok\":0,\"error\":\"left-side length must be 1.." + std::to_string(MAXK) + "\"}");
    if (KL != c.o.kl || (any_x != 0) != c.o.any_x) {
        c.o.kl = KL;
        c.o.any_x = any_x != 0;
        setup_left(c);
    }
    c.o.tolrel = tolrel > 0 ? std::max(tolrel, DBL_EPSILON) : 16 * DBL_EPSILON;
    c.o.kappa_max = 2 * c.o.tolrel / DBL_EPSILON;                // rounding L(T) alone moves x by up to eps kappa / 2
    c.o.list_cap = listCap > 0 ? (size_t)listCap : 0;
    if (!W) W = new Worker(c);
    TargetResult& r = W->run("web", T);
    std::string approx, matches, nL;
    for (const Match& m : r.approx)
        if (m.total != INT_MAX) approx += (approx.empty() ? "" : ",") + match_json(c, m);
    for (const Match& m : r.matches) matches += (matches.empty() ? "" : ",") + match_json(c, m);
    for (int a = 1; a <= KL; a++) nL += (a > 1 ? "," : "") + std::to_string(r.nL[a]);
    return to_c(std::string("{\"ok\":1,\"status\":\"") + (r.best.total != INT_MAX ? "SUCCESS" : "FAILURE") +
                "\",\"tol\":" + num(c.o.tolrel) + ",\"ms\":" + num(r.ms) + ",\"candidates\":" +
                std::to_string(r.candidates) + ",\"best\":" + match_json(c, r.best) + ",\"approx\":[" + approx +
                "],\"matches\":[" + matches + "],\"nL\":[" + nL + "]}");
}

}

// ------------------------------------------------------------------------------------------------ distinct values

static std::string eq_json(const distinct::Ctx& c, const distinct::Eq& q)
{
    if (q.m.total == INT_MAX) return "null";
    return "{\"total\":" + std::to_string(q.m.total) + ",\"a\":" + std::to_string(q.m.la) + ",\"b\":" + std::to_string(q.m.lb) +
           ",\"lhs\":\"" + distinct::rpn_of(q.lhs, c.g) + "\",\"rhs\":\"" + distinct::rpn_of(q.rhs, c.g) + "\",\"err\":" +
           num(q.m.err) + ",\"x\":" + num(q.m.x) + "}";
}

extern "C" {

// The right-side levels 1..KR from distinct values (mitm_distinct.cpp). Returns {"ok":1,"sizes":[n_1..n_KR],
// "distinct","candidates","passes","seconds","gb"} or {"ok":0,"error":"..."}.
EMSCRIPTEN_KEEPALIVE char* mitm_distinct_build(const char* consts, const char* funcs, const char* ops, int KR, double memcap_gb)
{
    free_codes();
    free_distinct();
    DG = new distinct::Ctx();
    distinct::Ctx& c = *DG;
    c.o.kr = KR;
    c.o.kl = 0;
    c.o.memcap_gb = memcap_gb > 0 ? memcap_gb : 1.5;
    c.o.chunk = 1 << 18;
    const std::string err = make_grammar(c.g, consts, funcs, ops);
    if (!err.empty() || KR < 1 || KR > distinct::KMAX) {
        free_distinct();
        return to_c("{\"ok\":0,\"error\":\"" + (err.empty() ? "right-side length must be 1.." + std::to_string(distinct::KMAX) : err) + "\"}");
    }
    if (!distinct::build_right(c, KR)) {
        const std::string e = c.error;
        free_distinct();
        return to_c("{\"ok\":0,\"error\":\"" + e + "\"}");
    }
    std::string sizes;
    uint64_t total = 0;
    for (int b = 1; b <= KR; b++) { sizes += (b > 1 ? "," : "") + std::to_string(c.R[b].size()); total += c.R[b].size(); }
    return to_c("{\"ok\":1,\"sizes\":[" + sizes + "],\"distinct\":" + std::to_string(total) + ",\"candidates\":" +
                std::to_string(c.candidates) + ",\"passes\":" + std::to_string(c.passes) + ",\"seconds\":" + num(c.seconds) +
                ",\"gb\":" + num(c.bytes() / distinct::GB) + "}");
}

// One target with the table of mitm_distinct_build, left sides of length <= KL (x exactly once); the right levels
// up to KL - 2 are added if needed (the constants of left sides) and kept. Returns the JSON of mitm_search, plus
// "kept" (left levels kept; the longer left sides made on the fly), "complete" (false: the memory cap stopped the
// left sides short of KL), "made" (left values made), "gb" (left levels) and "rightGB" (all right levels).
EMSCRIPTEN_KEEPALIVE char* mitm_distinct_search(double T, double tolrel, int KL, int listCap)
{
    if (!DG) return to_c("{\"ok\":0,\"error\":\"no right-side table: call mitm_distinct_build first\"}");
    distinct::Ctx& c = *DG;
    if (KL < 1 || KL > distinct::KMAX) return to_c("{\"ok\":0,\"error\":\"left-side length must be 1.." + std::to_string(distinct::KMAX) + "\"}");
    if (!distinct::build_right(c, std::max(c.o.kr, KL - 2))) {
        const std::string e = c.error;
        return to_c("{\"ok\":0,\"error\":\"constants of the left sides: " + e + "\"}");
    }
    c.o.tolrel = tolrel > 0 ? std::max(tolrel, DBL_EPSILON) : 16 * DBL_EPSILON;
    c.o.kappa_max = 2 * c.o.tolrel / DBL_EPSILON;                // rounding L(T) alone moves x by up to eps kappa / 2
    c.o.list_cap = listCap > 0 ? (size_t)listCap : 0;
    const double room = std::max(0.05 * distinct::GB, c.o.memcap_gb * distinct::GB - c.bytes());
    if (!DW) DW = new distinct::Worker(c, room);
    DW->room = room;
    distinct::Result& r = DW->run("web", T, KL, c.o.kr);
    std::string approx, matches, nL;
    for (const distinct::Eq& q : r.approx)
        if (q.m.total != INT_MAX) approx += (approx.empty() ? "" : ",") + eq_json(c, q);
    for (const distinct::Eq& q : r.matches) matches += (matches.empty() ? "" : ",") + eq_json(c, q);
    for (int a = 1; a <= KL; a++) nL += (a > 1 ? "," : "") + std::to_string(r.nL[a]);
    return to_c(std::string("{\"ok\":1,\"status\":\"") + (r.best.m.total != INT_MAX ? "SUCCESS" : "FAILURE") +
                "\",\"tol\":" + num(c.o.tolrel) + ",\"ms\":" + num(r.ms) + ",\"candidates\":" +
                std::to_string(r.candidates) + ",\"best\":" + eq_json(c, r.best) + ",\"approx\":[" + approx +
                "],\"matches\":[" + matches + "],\"nL\":[" + nL + "],\"kept\":" + std::to_string(std::abs(r.kept)) +
                ",\"complete\":" + (r.kept < 0 ? "false" : "true") + ",\"made\":" + std::to_string(r.made) +
                ",\"gb\":" + num(r.gb) + ",\"rightGB\":" + num(c.bytes() / distinct::GB) + "}");
}

}
