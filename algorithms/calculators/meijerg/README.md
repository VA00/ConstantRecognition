# MeijerG calculator (prototype, candidate algorithm)

Constant recognition by enumerating values of **MeijerG** (and its normalized special case
**HypergeometricPFQ**) with **rational parameters**, combined at the top by **one arithmetic
operation**. Unlike the CALC4 engine, there are no elementary functions inside the special
functions: the parameters that occur in practice are small rationals.

## Why this shape

`reduce.wls` converts 59 functions with Mathematica's `MeijerGReduce` (table in
`meijerg_reductions.txt`). For exp, log, trig and inverse trig, erf, Ei, Gamma(a, x), Bessel
J/Y/I/K, Airy, Struve, Si/Ci, Fresnel, elliptic K/E, PolyLog, Legendre, ... the parameters are
always rationals with denominators 1, 2, 3, 4, 6, the argument is x, x/2, -x, x^2 (sometimes with
Mathematica's power argument r), and the prefactor is pi^(k/2), a rational or Gamma(rational).
Tan, Sec, Gamma(x), Zeta(x) and compositions such as Sin[Sin[x]] are not G-functions.

## Layers and costs

Every node costs at least 1, so each cost level is finite and the enumeration is exhaustive in
order of cost.

| layer | contents | cost |
|---|---|---|
| bottom | rational atoms, generated from 1 by x -> x+1 and x -> x/(1+x) (Stern-Brocot tree, each positive rational once), negation, seed 0 | tree depth = sum of continued-fraction terms: 1/2, 2 -> 2; 1/3, 2/3, 3 -> 3; 1/4, 3/4 -> 4 |
| middle (leaves) | `HypergeometricPFQ[A, B, z]`, `MeijerG[{A1, A2}, {B1, B2}, z]`; lists are multisets of atoms, z an atom | 1 + lists (1 + atoms each) + z |
| top (pairs) | leaf1 op leaf2, op in + - * / | 1 + both leaves |
| glue | value * r * pi^(k/2); r = +-p/q with p, q <= 4; k = -2..2 for leaves, k = 0 for pairs | free: applied to the targets |

Redundant leaves are skipped before evaluation (`grammar.py`): parameters that cancel, terminating
series and poles, divergent PFQ, undefined G, the inversion z -> 1/z (keep p <= q), shifts at z = 1.
After evaluation, rational values and repeated values (12 digits) are dropped.

Costs of some constants: e 4, 2 K0(2) 8, ln 2 9, Gompertz 9, Gauss and lemniscate constants 10,
zeta(2) 11, Euler gamma 11, zeta(3) 14, Catalan 14.

## Choices made by observation (not by ablation)

From a first run with leaves up to cost 14 and no pairs (2026-10-03):
- 195 of 247 identifications came from PFQ, 52 from MeijerG (Euler gamma, Gompertz, 1/Gamma(1/3),
  Ising constant need G): both are kept; PFQ is also much faster to evaluate.
- parameter denominators used: 1 (350 times), 2 (228), 3 (27), 4 (17), 6 and 7 once; arguments z:
  1, 1/2, -1, 2/3, 1/4 dominate. The Stern-Brocot cost matches this.
- glue: mostly a plain rational, then pi, 1/pi, 1/sqrt(pi).
- most v0 constants still missing have Log, Sqrt, Zeta in their formulas: sums and products of two
  simple constants. Hence the top layer of one arithmetic operation.

Alternatives considered: Fox H (irrational scalings almost never occur), q-hypergeometric (would
add theta functions and eta, a different family), Heun/holonomic (whole ODE as parameters),
Painleve (no standard numerical implementation, no parametrized family to enumerate).

## Numerics

Leaves are evaluated with mpmath at 15 digits (machine precision) in worker processes. A worker
that runs longer than 2 s on one evaluation is killed and restarted (mpmath limits like maxterms
do not bound the time, and some G-functions at z = 1 take minutes). Every match is re-evaluated at
40 digits and counts only if at least 30 digits agree. Mathematica was rejected for this: its
machine-precision MeijerG is no faster than 50 digits (1-7 ms), and some evaluations ignore
`TimeConstrained`. A dedicated evaluator could be ~100x faster, since only real rational arguments
and a finite set of rational parameters occur (series with acceleration at z = +-1; tabulated
log-Gamma values for the Mellin-Barnes integral of G).

## Use

    python meijerg_search.py KLEAF [KPAIR] [workers]      # needs mpmath, numpy
    python compare.py meijerg_K14_19_matches.tsv          # against benchmark/results

Leaves are complete up to KLEAF, pairs up to KPAIR <= KLEAF + 5.

## Results on benchmark v0

`python meijerg_search.py 14 19` (leaves up to cost 14, pairs up to 19): 82 s on 12 processes
(AMD Ryzen 9 5900X, the machine of the survey; Python 3.14.0, mpmath 1.3.0, numpy 2.4.0). Best match per constant: `meijerg_K14_19_best.tsv` (the run log and the full match list are written next to the script, not kept in git).

| | count |
|---|---|
| v0 constants with >= 17 digits | 1348 |
| identified (>= 30 digits agree at 40-digit precision) | **267** (249 by a leaf, 18 by a pair) |
| ... also found by CR GPU K<=8 / AskConstants / RIES -l5 / Maple / Wolfram\|Alpha / nsimplify | 220 / 265 / 203 / 194 / 173 / 136 |
| not found by CR GPU K<=8 | 47 (Gauss, lemniscate, Catalan, zeta(3), Euler gamma, Gompertz, Baker, Baxter, ...) |
| not found by any other tool | 2 |

The two:
- v0:129, Integral_0^oo x cos(x)/(1+x^2) dx = -1/2 sqrt(pi) MeijerG[{{0}, {}}, {{0, 0}, {1/2}}, 1/4]
- v0:1171, (1/sqrt(pi) + e erfc(-1))/2 = 1/2 (PFQ[{}, {}, 1] + MeijerG[{{0}, {}}, {{0}, {1/2}}, -1])

Pairs found, for example, the first continued fraction constant I1(2)/I0(2) =
PFQ[{}, {2}, 1]/PFQ[{}, {1}, 1], -1/(e^2 Ei(-1)) = PFQ[{}, {}, -1]/MeijerG[{{0}, {}}, {{0, 0}, {}}, 1],
sqrt(2 pi) log 2 and Pi/8 + sqrt(3)/4.

Comparison caveats: AskConstants finds 265 of the 267 (it also uses tables of known constants);
the other tools were run with their own alphabets and time limits (see benchmark/results/SURVEY_2026-10-01.md).

## Open

- evaluator in C (see Numerics), then higher costs;
- more top-layer operations (log, sqrt of a leaf; products of three), q-hypergeometric leaves;
- ablation of the choices above once benchmarks with ground truth exist;
- output in the format of benchmark/results so that compare_results_v0.py includes it.
