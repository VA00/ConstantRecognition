// ries_cpu.cpp - the meet-in-the-middle search with a RIES-like command line, on the CPU
//
// Author: Andrzej Odrzywolek
// Date: October 4, 2026
// Code assist: Claude Opus 5.5
//
// Example: ries_cpu 2.5063141592653589 -l4
// Options and output: see ries_front.h. The right-side table (the part that takes long for one constant) is built
// on all cores (--threads N to change); the search for the one target then runs on one core.
// Build: build_mitm_gpu.bat ries (icx /O3 /fp:precise), or make ries; never with fast math.

#define MITM_LIBRARY
#include "../mitm_cr.cpp"
#include "ries_front.h"

int main(int argc, char** argv)
{
    RiesArgs A;
    const std::string perr = ries_parse(argc, argv, A);
    if (perr == "help") { printf(RIES_HELP, "ries_cpu"); return 0; }
    if (!perr.empty()) { fprintf(stderr, "%s\n", perr.c_str()); fprintf(stderr, RIES_HELP, "ries_cpu"); return 2; }
    const double T0 = now();
    g_verbose = false;
    Ctx c;
    Options& o = c.o;
    const std::string berr = ries_buttons(A, CALC4_CONSTS, CALC4_FUNCS, CALC4_OPS, COMMON_CONSTS, COMMON_FUNCS,
                                          o.consts, o.funcs, o.ops);
    if (!berr.empty()) { fprintf(stderr, "%s\n", berr.c_str()); return 2; }
    const std::string gerr = make_grammar(c.g, o.consts, o.funcs, o.ops);
    if (!gerr.empty()) { fprintf(stderr, "buttons: %s\n", gerr.c_str()); return 2; }
    o.anyx = !A.once;
    o.tol_eps = A.tol_eps;
    o.tolrel = A.tolrel;
    o.kappa_max = 2 * (o.tolrel > 0 ? o.tolrel / DBL_EPSILON : o.tol_eps);
    o.threads = A.threads > 0 ? A.threads : std::max(1u, std::thread::hardware_concurrency());

    double cl[10] = {0}, cr[10] = {0};
    for (int k = 1; k <= 9; k++) {
        if (k <= 8) { const auto fs = left_forms(c.g, k, o.anyx); cl[k] = fs.empty() ? 0.0 : (double)(fs.back().offset + fs.back().count); }
        const auto fs = right_forms(c.g, k);
        cr[k] = fs.empty() ? 0.0 : (double)(fs.back().offset + fs.back().count);
    }
    const LevelChoice lc = ries_level(A.level, [&](int k) { return cl[k]; }, [&](int k) { return cr[k]; }, 2e9, 4.29e9, A.calc || A.common);
    o.kl = A.kl > 0 ? A.kl : lc.kl;
    o.kr = A.kr > 0 ? A.kr : lc.kr;
    if (o.kl < 1 || o.kr < 1 || o.kl > MAXK || o.kr > MAXK) { fprintf(stderr, "no search fits these buttons\n"); return 2; }

    setup_right(c);
    setup_left(c);
    if (!build_R(c)) { fprintf(stderr, "%s (memory cap %.0f GB)\n", c.stats.error.c_str(), o.memcap_gb); return 3; }
    Worker w(c);
    const TargetResult& res = w.run("x", A.T);
    uint64_t nL = 0, nR = 0;
    for (uint64_t n : res.nL) nL += n;
    for (const RTable& t : c.Rb) nR += t.v.size();
    char where[96];
    snprintf(where, sizeof where, "CPU, table on %d threads", o.threads);
    ries_print(c, A, res, lc, nL, nR, now() - T0, where);
    return 0;
}
