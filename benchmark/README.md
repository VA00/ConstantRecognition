# Constant recognition benchmark

| Directory | Contents |
|---|---|
| `data/v0/` | the benchmark: `constants_v0.tsv` (generated, the file to use), `constants_v0_sources.tsv` (the file to edit), and a README with the columns, sources, ground truth and errata |
| `build/` | scripts that import the sources into `constants_v0_sources.tsv`, build `constants_v0.tsv` from it and check it |
| `run/` | scripts that run a recognition tool over `constants_v0.tsv`, and `compare_results_v0.py` |
| `results/` | result files of the runs done so far, and `SURVEY_2026-10-01.md`, the first full survey (versions, settings, machine) |

All scripts find the data and the results relative to their own location, so they can be run from any
directory.

## Comparison runs

Comparison runs, each writing `results/v0_<tool>.tsv` with the same verdicts (exact: the answer agrees
with the value to >= 30 digits; wrong: presented as exact but failing beyond double precision; not found),
all with the same input, the nearest double: `run/run_benchmark_v0.py` (Constant Recognition, the C engine, CALC4, up to a given K),
`run/run_nsimplify_v0.py` (sympy), `run/run_maple_identify_v0.py` (Maple), `run/run_wolframalpha_v0.py` (Wolfram|Alpha
from Mathematica), `run/run_askconstants_v0.py` (AskConstants 5.0 by D. R. Stoutemyer, MIT license: Propose
with lookup tables of 14.7 million expressions and 5.2 million inverse functions, integer relations, and
a margin test), `run/run_cuda_v0.py` (Constant Recognition's search on the GPU: `algorithms/methods/gpu_cuda/constant_gpu_benchmark.cu`,
the same CALC4 buttons and success test, every formula evaluated in FP32 and the candidates within
64 FLT_EPSILON verified in FP64 on the CPU; build with `algorithms/methods/gpu_cuda/build_benchmark.bat`), `run/run_ries_v0.py`
(RIES by R. Munafo, GPL, 2026 May 06 version: a bidirectional search for equations LHS(x) = RHS with its
default symbols; its claimed match, an equation marked exact or the best one when it stops early, is
solved for x with 80 digits). `run/compare_results_v0.py` puts them side by side; `results/SURVEY_2026-10-01.md`
records the first full survey (with versions and the machine; its LaTeX and PDF are made from it with
pandoc, see below). On the 1348 constants with >= 17 digits:

| tool | exact | wrong answers presented as exact | not found | time |
|---|---|---|---|---|
| Constant Recognition K <= 5 / 6 / 7 | 317 / 376 / 417 | 1 / 4 / 6 | 1029 / 968 / 925 | 15 s / 2.5 min / 65 min on 11-12 cores |
| Constant Recognition on GPU, K <= 7 / 8 | 417 / 447 | 6 / 7 | 925 / 893 | 70 s / 35 min on an RTX 5080 |
| nsimplify | 212 | 1136 | 0 | 20 s |
| Maple identify | 332 | 6 | 1010 | 68 s |
| Wolfram\|Alpha | 411 (and 231 agreeing to the ~20 digits it shows, without an expression) | 691 | 15 | 1 h of queries |
| AskConstants | 993 | 13 | 342 | 4.8 h of searches, about 1 h on 5-6 kernels |
| RIES -l2 / -l4 / -l5 | 497 / 535 / 548 | 6 / 9 / 12 | 841 / 801 / 784 | 22 s / 9.5 min / 50 min on 12 cores |

The union of all tools is 1007: nearly everything the others recognize, AskConstants does too, except
mostly what RIES finds as roots of equations no explicit formula reaches (x e^(1/x) = 2e for a binary
search tree constant, log_(2-x) x = -1/6 for the hexanacci constant, x/(3 + ln x) = 1/e); 341 constants
are recognized by no tool. Most wrong answers of Constant Recognition, Maple and AskConstants are the same traps: Ramanujan's
pi approximation, the decimal selvage numbers, nu = 1 + 1.2e-12, a 50000-term partial sum of pi/2.
Wolfram|Alpha proposes closed forms only for numbers written without an exponent (0.0000807, not
8.07e-5), so the queries are positional decimals.

The GPU search finds exactly the same 417 constants at K <= 7 as Constant Recognition on the CPU, 55
times faster in wall time (600 times in CPU time), which makes K <= 8 (68.6 billion formulas, about 2 s
per constant) affordable: 447 exact. Its FP64 check is the same 16 eps test, so it shares the false
negatives of cancellation: at K <= 8, 4 (pi^2 - 9) - 3 for the quadtree leaf proportion constant is
rejected with 23 eps. The GPU, which verifies all candidates of a length and keeps the best, accepts
ln Gamma(cosh ln 2) for ln Gamma(5/4) at K = 5 with 2 eps.

On the CPU, ln Gamma(5/4) = `FOUR, FIVE, DIVIDE, GAMMA, LOG` is rejected at K = 5 with 21 eps, and
the cause is not cancellation but the math library. The WASM build's `tgamma` (musl) is 3.8 ulp off at
1.25 (and up to 6.4 ulp at arguments in (-6, 6)). The logarithm of Gamma(5/4) = 0.906, a value near 1,
amplifies that relative error by 1/|ln 0.906| = 10, which gives 21 eps. The same engine built natively with MSVC, icx or gcc, whose `tgamma`
is within 0.25 ulp at 1.25, accepts the formula at K = 5 with 2 eps. Recognition therefore depends on the accuracy of the
libm as well as on the search: Intel's libm is within 0.53 ulp for all CALC4 functions, while the Windows UCRT
(used by MSVC and by MinGW gcc) and musl reach 1-1.5 ulp for the hyperbolic functions, and 3.4 and 6.4 ulp for Gamma. Native builds are not much
faster, because the search time goes into the libm calls: the full K <= 6 run takes 153 s in WASM,
177 s with MSVC 17.7 `/O2`, 139 s with icx 2025.3 `/O3` and 130 s with gcc 16.1 (MSYS2 UCRT64) `-O3` (12 jobs,
2026-10-02), with the same verdicts (376 exact).

RIES's wrong answers include, besides the common traps, equations that hold only in floating point,
more of them at deeper levels: for pi^10, x^(1/5) - pi^2 = 2^-49; for e^(pi sqrt 163),
(sqrt x)^4 - x^2 = 2^63; and e^(1/x) - e^(1/x) = 7/8^8, an identically zero left side matched to its
rounding noise. Such equations have no root near the target, and the 80-digit solve exposes them.

Each run script documents its usage and options in its header; for example (from `benchmark/`):

```
python run/run_benchmark_v0.py --engine <path to vsearch_batch.js> --maxk 6
python run/run_ries_v0.py --ries <path to ries.exe> --level 2
python run/compare_results_v0.py
```

## Rebuild and check

From `benchmark/`:

```
wolframscript -file build/import_wolfram_constants.wls   # only to refresh the Wolfram rows
python build/import_aands_table_1_1.py                   # only to refresh the A&S rows (fetches the OCR)
python build/import_oeis_nice_core.py                    # only to refresh the OEIS rows
python build/import_plouffe_constants.py                 # only to refresh the Plouffe rows
python build/import_oeis_finch.py <oeisdata checkout>    # only to refresh the OEIS rows citing Finch
python build/import_mesearch_names.py <oeisdata checkout> # only to refresh the MESearch rows
wolframscript -file build/build_constants_v0.wls         # writes data/v0/constants_v0.tsv, prints mismatches
python build/check_constants_v0.py                       # mpmath: needs mpmath (pip install mpmath)
```

The build keeps the N[] values of all formulas in `build/formula_values_cache.wl` (not in the repository),
per Mathematica version: the first build evaluates them on all kernels (up to 60 s each), later ones take seconds.

Both must report no mismatch and no constant below its stated digits. To add a constant, add a row per
source to `data/v0/constants_v0_sources.tsv`, rebuild and check; a new sum, product, integral or root with a seed
also needs a hand-written mpmath expression in `MANUAL` of the checker.

The survey's LaTeX and PDF (pandoc and a LaTeX installation; from `results/`; pandoc takes the column
widths of the wide tables from the dashes of their `|---|` lines):

```
pandoc SURVEY_2026-10-01.md -f markdown+lists_without_preceding_blankline --standalone -V geometry:margin=2cm -V fontsize=10pt -V "header-includes=\usepackage{etoolbox}\AtBeginEnvironment{longtable}{\footnotesize}" -o SURVEY_2026-10-01.pdf
```

(the same with `-o SURVEY_2026-10-01.tex` for the LaTeX source; neither is in the repository).
