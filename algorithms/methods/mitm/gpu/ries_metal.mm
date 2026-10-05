// ries_metal.mm - the meet-in-the-middle search with a RIES-like command line, on an Apple GPU (Metal)
//
// Author: Andrzej Odrzywolek
// Date: October 4, 2026
// Code assist: Claude Opus 5.5
//
// Example: ries_metal 2.5063141592653589 -l4
// Options and output: see ries_front.h (--vram GB: cap of the GPU buffers, default 60 % of the GPU's recommended
// working set). The search is mitm_metal's (mitm_metal.mm), for one target, keeping the closest equation of every
// size for the listing; every decision is taken in double precision on the host.
// Build: make ries_metal; never with fast math.

#define MITM_METAL_LIBRARY
#include "mitm_metal.mm"
#include "ries_front.h"

int main(int argc, char** argv)
{
    RiesArgs A;
    const std::string perr = ries_parse(argc, argv, A);
    if (perr == "help") { printf(RIES_HELP, "ries_metal"); return 0; }
    if (!perr.empty()) { fprintf(stderr, "%s\n", perr.c_str()); fprintf(stderr, RIES_HELP, "ries_metal"); return 2; }
    const double T0 = now();
    g_verbose = false;
    Ctx c;
    Options& o = c.o;
    const std::string berr = ries_buttons(A, CALC4_CONSTS, CALC4_FUNCS, CALC4_OPS, COMMON_CONSTS, COMMON_FUNCS,
                                          o.consts, o.funcs, o.ops);
    if (!berr.empty()) { fprintf(stderr, "%s\n", berr.c_str()); return 2; }
    const std::string gerr = make_grammar(c.g, o.consts, o.funcs, o.ops);
    if (!gerr.empty()) { fprintf(stderr, "buttons: %s\n", gerr.c_str()); return 2; }
    if (c.g.nc > 63 || c.g.nu > 32 || c.g.nb > 8) { fprintf(stderr, "too many buttons for the GPU tables\n"); return 2; }
    o.anyx = !A.once;
    o.tol_eps = A.tol_eps;
    o.tolrel = A.tolrel;
    o.kappa_max = 2 * (o.tolrel > 0 ? o.tolrel / DBL_EPSILON : o.tol_eps);
    o.threads = A.threads;

    double cl[10] = {0}, cr[10] = {0};
    for (int k = 1; k <= 9; k++) {
        if (k <= 8) { const auto fs = left_forms(c.g, k, o.anyx); cl[k] = fs.empty() ? 0.0 : (double)(fs.back().offset + fs.back().count); }
        const auto fs = right_forms(c.g, k);
        cr[k] = fs.empty() ? 0.0 : (double)(fs.back().offset + fs.back().count);
    }
    const LevelChoice lc = ries_level(A.level, [&](int k) { return cl[k]; }, [&](int k) { return cr[k]; }, 2e10, 4.29e9, A.calc || A.common);
    o.kl = A.kl > 0 ? A.kl : lc.kl;
    o.kr = A.kr > 0 ? A.kr : lc.kr;
    if (o.kl < 1 || o.kr < 1 || o.kl > MAXK || o.kr > MAXK) { fprintf(stderr, "no search fits these buttons\n"); return 2; }

    setup_right(c);
    setup_left(c);
    Timers tm;
    Gpu G;
    if (!gpu_setup(c, G, A.vram, tm, T0, false)) return 4;
    if (!build_R_metal(c, G, tm)) { fprintf(stderr, "%s\n", c.stats.error.c_str()); return 3; }
    MetalSearch S;
    S.all_apx = true;
    SearchStats ss;
    std::vector<TargetResult> results;
    if (!metal_search(c, G, {std::string("x")}, {A.T}, S, tm, ss, results)) return 5;
    ries_print(c, A, results[0], lc, ss.sum_distinct, G.nvalues, now() - T0, "GPU, " + G.name + ", Metal");
    return 0;
}
