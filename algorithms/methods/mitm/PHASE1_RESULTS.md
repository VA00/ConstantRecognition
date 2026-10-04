# Phase 1 results: meet-in-the-middle constant recognition on the CPU

Work of the night 2026-10-03/04, following `PHASE1_PLAN.md` (files listed at the end). Machine: AMD Ryzen 9
5900X (12 cores), 32 GB, Windows 11; Intel icx 2025.3 `/O3 /fp:precise`. All times are measured on this
machine; "one thread" means one CPU core.

## The answer in short

**Yes. At equal numbers of exact identifications, a stripped meet-in-the-middle (MITM) search on one CPU core
needs about 10^4 times less CPU time than the Constant Recognition engine and 10^2 to 10^3 times less than RIES;
at the same depth it finds more constants than the Constant Recognition engine.** Benchmark v0 (1348 constants
with >= 17 digits), sorted by the number of exact identifications:

| method | exact | false pos. | time | CPU time |
|---|---|---|---|---|
| **MITM \|L\|<=4, \|R\|<=4** | 416 | 3 | **0.8 s, one thread** | 0.8 s |
| Constant Recognition, CPU, K <= 7 | 417 | 6 | 65 min on 11 processes (WASM) | ~12 h |
| **MITM \|L\|<=4, \|R\|<=5** | 444 | 3 | **1.1 s, one thread** | 1.1 s |
| Constant Recognition, GPU, K <= 8 | 447 | 7 | 35 min on an RTX 5080 | - |
| **MITM \|L\|<=5, \|R\|<=4** | 483 | 4 | **16 s, one thread** | 16 s |
| RIES -l2 | 497 | 6 | 22 s on 12 processes | ~4 min |
| **MITM \|L\|<=5, \|R\|<=5** | 511 | 6 | **17 s, one thread** | 17 s |
| **MITM \|L\|<=5, \|R\|<=6** | 532 | 9 | **27 s, one thread; 5.3 s on 12 threads** | 27 s |
| RIES -l4 | 535 | 9 | 10 min on 12 processes | ~2 h |
| **MITM \|L\|<=6, \|R\|<=5** | 535 | 10 | 7.8 min, one thread | 7.8 min |
| RIES -l5 | 548 | 12 | 50 min on 12 processes | ~10 h |
| **MITM \|L\|<=5, \|R\|<=7, tol 2 eps** | 548 | 11 | 4.0 min, one thread (3.3 min of it: the 5 GB table) | 4.0 min |
| **MITM \|L\|<=5, \|R\|<=6, x any number of times** | **550** | **9** | **27 s, one thread** | 27 s |
| **MITM \|L\|<=5, \|R\|<=7** | 552 | **54** | 4.1 min, one thread | 4.1 min |
| **MITM \|L\|<=6, \|R\|<=6, tol 2 eps** | 554 | 14 | 9.2 min, one thread | 9.2 min |
| **MITM \|L\|<=6, \|R\|<=6** | 556 | **72** | 9.7 min, one thread; 2.5 min on 12 threads | 9.7 min |

MITM: equations L(x) = R over the CALC4 buttons, x exactly once in L (so that every equation can be solved for
x, below) unless "x any number of times" (RIES's semantics); tolerance 16 eps unless stated. "Exact" means that
the root of the reported equation agrees with the 64-digit value to >= 30 digits, as for RIES in the survey.
CPU time of RIES and CR CPU = number of processes x wall time (single-threaded processes).

In plain words:

- **Against Constant Recognition** (same buttons, same tolerance 16 eps): MITM with equations of total length
  <= 9 (the same as formulas of length K <= 8) finds 444-483 constants in 1-16 seconds on one core, where the
  engine needs 35 GPU minutes for 447. Every constant that CR finds at K <= 8 is also found by MITM from
  |L| <= 5, |R| <= 6 on. At equal results the CPU times differ by a factor of about 5e4 (417 exact: 12 CPU
  hours vs 0.8 s).
- **Against RIES** (different buttons): with RIES's semantics (x any number of times), |L| <= 5, |R| <= 6 gives
  550 exact and 9 false positives in 27 s on one core; RIES -l5 gives 548 and 12 in about 10 CPU hours, **1300
  times more**. With x once (explicit formulas): 532 exact in 27 s vs RIES -l4's 535 in about 2 CPU hours (270
  times less); 548 exact, 11 false positives in 4 min with |L| <= 5, |R| <= 7 at tolerance 2 eps (150 times
  less than RIES -l5). Long left sides are expensive for MITM: 535 exact with |L| <= 6, |R| <= 5 take 7.8 min,
  only 15 times less than RIES -l4.
- **The limit is double precision, not time.** Beyond about 1e13 equations per constant (|L| + |R| = 12 at the
  tolerance 16 eps) chance coincidences grow: 54-72 false positives instead of about 10, and 591 at
  |L| <= 6, |R| <= 7 (1.5e15 equations per constant, 4.7 min on 12 threads). MITM gets there in minutes. True
  identities agree to 0-1 eps almost always, chance matches anywhere in 0-16 eps, so a tighter tolerance moves
  the limit by about one order of magnitude (2 eps: 14 instead of 72 false positives at |L| <= 6, |R| <= 6),
  not more.

- **On exactly the same buttons and semantics as RIES** the factor is smaller, 10 to 40: MITM finds 513
  constants in 41 s on one core where RIES -l3 needs 19 CPU minutes for 514, and 539 in 12.7 min where RIES -l4
  needs 1.8 CPU hours for 527 and RIES -l5 8.7 CPU hours for 541. Part of RIES's strength is its weighting of
  symbols (cheap 1/x and small digits let it reach longer equations), which MITM could adopt (see "The same
  grammar as RIES").

## What was built

`algorithms/methods/mitm/`:

- `mitm_cr.cpp` - the search, one C++17 file (about 1000 lines). Single-threaded by default; `--threads N` runs
  the targets in parallel (the right-side table is then also built in parallel). Build: `build_mitm.bat`
  (Intel icx; `build_mitm.bat cl` for MSVC). Usage in the header of the file.
- `test_planted.py` - retrieval of planted CALC4 formulas.
- `explicit.py` - Phase 1b as post-processing: solves the equations for x (explicit CR-style formulas).
- `summarize_mitm.py` - the table of all runs, from the result files.

`benchmark/run/run_mitm_v0.py` runs `mitm_cr` over v0 under `benchmark/depth/monitor.py` (memory cap 16 GB, time
limit) and classifies the answers exactly as the RIES runner does. `benchmark/run/run_ries_v0.py` got two options
(`--symbols` = RIES's `-S`, `--tag`) for the same-grammar runs. Results: `benchmark/results/v0_mitm_<config>.tsv`
(one line per constant: equation, error, verdict) and `..._raw.txt` (the program's output and its timings).

### How it works

An equation L(x) = R is split into its two halves, which are enumerated separately:

1. **Right sides** R: every CALC4 code of length 1..KR without x. They do not depend on the target, so they are
   built **once for the whole batch** of 1348 constants: evaluated, non-finite and subnormal values dropped,
   sorted, and **one entry per distinct double** kept, with its shortest code. An entry is 12 bytes: the value
   and a 32-bit index from which the code is rebuilt when needed. RIES rebuilds both halves for every target.
2. **Left sides** L: every code of length 1..KL with x **exactly once** (default; `--anyx`: any number of
   times, as RIES), evaluated at the target T together with dL/dx (dual numbers), sorted, duplicates dropped.
3. **Matching**: both lists are sorted, so a single pass finds the R near every L. The test is made in x, not in
   value: the Newton root x* = T - (L(T) - R)/L'(T) must lie within 16 DBL_EPSILON of T, the CR engine's SUCCESS
   criterion; candidates are refined by Newton steps and checked again. The lookups in the (large) right-side
   table go through a small index that stays in cache, and the table block of each lookup is prefetched 16 left
   sides ahead, so that the memory latency overlaps (this alone made the matching 1.8 times and the whole run
   1.4 times faster, with identical answers).
4. Per constant the accepted equation of the **smallest total length** |L| + |R| is reported, like the shortest
   formula of CR. Left sides are processed by increasing length, and the search stops as soon as nothing shorter
   is possible.

The enumeration has no dead ends. The valid postfix shapes are listed first (as in the GPU code); all button
assignments of a shape then run through like an odometer whose last digit turns fastest. Only the positions that
changed are evaluated again (each node's value is stored per position: no stack, no undo), so a new code costs
about one operation instead of K. A prefix with an unusable value is skipped with all its completions.

The right-side table is built in passes over value ranges when it does not fit into the memory budget: the
sizes are counted first (per 2^20 value bins), and every pass regenerates all codes but keeps only one range.
|R| <= 7 (2.4e9 codes, 4.4e8 distinct values, 5 GB table) takes 4 passes and 197 s on one thread, peak memory
8.6 GB under the 14.4 GB cap.

## Correctness checks

- **The same pair counts as `mitm_bench.cu`.** In its mode (`--bench`: shared grammar, x any number of times,
  value tolerance 1e-12 at alpha) the program counts exactly the pairs of the earlier benchmark: 2 310 973 at
  size 7/7 and 17 753 889 at 8/7 (MSVC build, the same libm as `mitm_bench`). The icx build counts 2 310 800 at
  7/7: the Intel libm rounds a few values differently, which moves 0.007 % of the pairs across the tolerance.
- **Planted formulas** (`test_planted.py`: 30 random CALC4 formulas per length K, nearest double as input,
  |L| <= 5, |R| <= 6). Retrieved = SUCCESS, root right to >= 30 digits, total length <= K + 1:

  | K | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
  |---|---|---|---|---|---|---|---|---|
  | retrieved of 30 | 29 | 30 | 29 | 29 | 27 | 27 | 20 | 19 |

  Up to K = 6 = KR every formula is reachable as x = formula. The three misses there are formulas whose double
  value is more than 16 eps off: tan(sinh 5), sin(Gamma(phi + 5)), arcsin(cos(Gamma(7 + pi))) are ill-conditioned
  by factors of hundreds, and CR misses them for the same reason (for tan(sinh 5) MITM reported another, better
  conditioned equation, correct to 59 digits). Beyond KR (K = 7..10) most formulas are still found, through
  equations that split them; 2 false positives at K = 10.
- **Known identities** (spot check): pi, e, e^pi, pi^2/6, ln 2 as x = formula; sqrt 2 + sqrt 3 as
  exp(arsinh(sqrt 2)); with `--anyx` also the Dottie number (x / arccos x = 1) and the omega constant
  (x / ln x = -1).
- **Threads**: the multithreaded runs give the same answer for every constant as the single-threaded run.
- **Explicit formulas** (below): all 532 exact equations of |L| <= 5, |R| <= 6 solved for x reproduce the
  constant to >= 30 digits, an independent check of the equations.

## Guards that the plan did not have, and why they are needed

The first test showed that "the Newton root is within 16 eps of T" is not enough when a whole table of left
sides meets a whole table of right sides: some equations hold at T in double precision without saying anything
about T. Four kinds turned up in the first runs, each with a rule against it:

1. **Pseudo-random left sides.** For alpha, `tan(exp(1/x)) = -1` was accepted: exp(1/alpha) = 1e59, and tan of
   that has roots 1e-64 apart, so there is always one within 16 eps (18.8 million pairs fell into the window of
   this single L). The measure is kappa = |L(T)| / (|L'(T)| |T|): R is needed only to relative precision
   tol / kappa, so the chance of a random match grows like 1/kappa. The same holds for x - 1 = R with R ~ 1e-12
   (the "nu" trap of v0). **Rule: kappa >= 1/32** at the root of L **and at every intermediate node that depends
   on x** (checked during the enumeration, which also saves time). The intermediate check is needed for chains
   like tanh(Gamma(tan(exp(x^2)))): at x = -5.3, tan of exp(28.2) = 1.8e12 is a pseudo-random number, and tanh
   brings it within a few ulp of 1, where every double is some right side, while kappa of the whole L looks
   normal (0.08). Before this rule, |L| <= 6, |R| <= 4 had 52 false positives, almost all of this kind; after it, 7.
2. **Flat left sides.** Rounding L(T) to double alone moves the root by up to eps kappa / 2. **Rule: kappa <=
   2 tol / eps = 32**; above, a match is a coincidence of rounding (tanh(36 x) = 1 is "true" for every x > 1).
3. **Subnormal numbers.** x^120 or exp(e - sinh(4)^2) = 5e-323 keep a few bits; both sides then "agree". At
   first the largest source of false positives (about 100 of 159 at |L| <= 5, |R| <= 6, together with an
   underflow in the kappa test). **Rule: subnormal values are unusable**, as final and as intermediate values.
4. **Equations that cannot determine x in double precision.** A first-order bound of the rounding errors of
   both sides (0.5-4 ulp per operation) is mapped to x; **rule: <= 1e-12** relative (rejects 3 % of the
   candidates at |L| <= 5, |R| <= 6 and half of them at |L| <= 6, |R| <= 6, where long left sides with
   cancellations appear).

Plus a guard of the running time: a left side whose window holds more than 1000 right sides is skipped; with the
kappa rules in place it practically never triggers.

The choice of kappa_min, on |L| <= 5, |R| <= 6 (final code; all other settings default):

| kappa_min | 1e-4 | 1e-3 | 1e-2 | **1/32 (default)** | 0.1 | 0.3 |
|---|---|---|---|---|---|---|
| exact | 530 | 530 | 530 | **532** | 531 | 530 |
| false positives | 40 | 17 | 11 | **9** | 8 | 7 |

The exact count hardly depends on it; the false positives fall steeply up to about 1/32. (Without the
four rules in their final form - kappa in [1e-4, 1e10] at the root only, subnormals allowed - the same
configuration had 527 exact and 158 false positives.)

## Results on v0

All runs, from `summarize_mitm.py` (CALC4, x exactly once, tol 16 eps, kappa in [1/32, 32], one thread unless
stated). "Equations per constant" = distinct left values tested per constant x distinct right values: the size of
the search.

| config | KL | KR | threads | options | exact | false pos. | false neg. | not found | wall s | CPU s | table s | median ms per constant (time of one thread) | peak GB | distinct R | distinct L per constant | equations per constant |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| kl3_kr4 | 3 | 4 | 1 | - | 368 | 3 | 0 | 977 | 0.1 | 0.1 | 0.0 | 0.1 | 0.00 | 5.33e+04 | 304 | 1.6e+07 |
| kl3_kr5 | 3 | 5 | 1 | - | 402 | 3 | 0 | 943 | 0.3 | 0.2 | 0.2 | 0.1 | 0.09 | 1.05e+06 | 304 | 3.2e+08 |
| kl4_kr4 | 4 | 4 | 1 | - | 416 | 3 | 0 | 929 | 0.8 | 0.8 | 0.0 | 0.7 | 0.08 | 5.33e+04 | 6.2e+03 | 3.3e+08 |
| kl3_kr6 | 3 | 6 | 1 | - | 427 | 5 | 1 | 915 | 4.3 | 4.3 | 4.2 | 0.1 | 0.56 | 2.13e+07 | 304 | 6.5e+09 |
| kl4_kr5 | 4 | 5 | 1 | - | 444 | 3 | 0 | 901 | 1.1 | 1.1 | 0.2 | 0.8 | 0.09 | 1.05e+06 | 6.2e+03 | 6.5e+09 |
| kl5_kr4 | 5 | 4 | 1 | - | 483 | 4 | 1 | 860 | 15.6 | 15.6 | 0.0 | 14.5 | 0.08 | 5.33e+04 | 1.29e+05 | 6.9e+09 |
| kl4_kr6 | 4 | 6 | 1 | - | 459 | 6 | 1 | 882 | 5.4 | 5.4 | 4.2 | 1.1 | 0.56 | 2.13e+07 | 6.2e+03 | 1.3e+11 |
| kl5_kr5 | 5 | 5 | 1 | - | 511 | 6 | 1 | 830 | 17.5 | 17.4 | 0.2 | 16.3 | 0.09 | 1.05e+06 | 1.29e+05 | 1.3e+11 |
| kl6_kr4 | 6 | 4 | 1 | - | 512 | 7 | 0 | 829 | 445.4 | 444.2 | 0.0 | 441.8 | 0.08 | 5.33e+04 | 3.41e+06 | 1.8e+11 |
| kl4_kr7 | 4 | 7 | 1 | - | 488 | 9 | 0 | 851 | 200.0 | 199.4 | 197.1 | 2.4 | 8.46 | 4.44e+08 | 6.2e+03 | 2.7e+12 |
| kl5_kr6 | 5 | 6 | 1 | - | 532 | 9 | 0 | 807 | 26.7 | 26.7 | 4.1 | 21.1 | 0.56 | 2.13e+07 | 1.29e+05 | 2.7e+12 |
| kl6_kr5 | 6 | 5 | 1 | - | 535 | 10 | 0 | 803 | 467.7 | 466.5 | 0.2 | 465.6 | 0.09 | 1.05e+06 | 3.41e+06 | 3.6e+12 |
| kl5_kr7 | 5 | 7 | 1 | - | 552 | 54 | 0 | 742 | 247.8 | 247.1 | 196.3 | 48.9 | 8.43 | 4.44e+08 | 1.29e+05 | 5.7e+13 |
| kl6_kr6 | 6 | 6 | 1 | - | 556 | 72 | 0 | 720 | 580.9 | 579.7 | 4.2 | 578.9 | 0.56 | 2.13e+07 | 3.4e+06 | 7.2e+13 |
| kl5_kr6_t2 | 5 | 6 | 2 | - | 532 | 9 | 0 | 807 | 14.3 | 28.3 | 2.3 | 22.6 | 0.80 | 2.13e+07 | 1.29e+05 | 2.7e+12 |
| kl5_kr6_t6 | 5 | 6 | 6 | - | 532 | 9 | 0 | 807 | 7.5 | 42.9 | 1.0 | 36.0 | 0.70 | 2.13e+07 | 1.29e+05 | 2.7e+12 |
| kl5_kr6_t12 | 5 | 6 | 12 | - | 532 | 9 | 0 | 807 | 5.3 | 58.6 | 0.8 | 45.4 | 1.14 | 2.13e+07 | 1.29e+05 | 2.7e+12 |
| kl6_kr6_t12 | 6 | 6 | 12 | - | 556 | 72 | 0 | 720 | 151.0 | 1800.2 | 0.8 | 1787.2 | 1.14 | 2.13e+07 | 3.4e+06 | 7.2e+13 |
| kl6_kr7_t12 | 6 | 7 | 12 | - | 571 | 591 | 0 | 186 | 279.8 | 3312.9 | 26.3 | 3033.2 | 8.42 | 4.44e+08 | 3.4e+06 | 1.5e+15 |
| kl5_kr6_t24 | 5 | 6 | 24 | - | 532 | 9 | 0 | 807 | 6.6 | 135.6 | 0.6 | 122.9 | 2.04 | 2.13e+07 | 1.29e+05 | 2.7e+12 |
| anyx_kl4_kr4 | 4 | 4 | 1 | --anyx | 423 | 3 | 0 | 922 | 0.8 | 0.8 | 0.0 | 0.7 | 0.08 | 5.33e+04 | 6.29e+03 | 3.4e+08 |
| anyx_kl4_kr5 | 4 | 5 | 1 | --anyx | 451 | 3 | 0 | 894 | 1.1 | 1.1 | 0.2 | 0.8 | 0.09 | 1.05e+06 | 6.29e+03 | 6.6e+09 |
| anyx_kl5_kr4 | 5 | 4 | 1 | --anyx | 501 | 4 | 1 | 842 | 15.7 | 15.6 | 0.0 | 14.6 | 0.08 | 5.33e+04 | 1.32e+05 | 7e+09 |
| anyx_kl5_kr5 | 5 | 5 | 1 | --anyx | 530 | 6 | 1 | 811 | 17.7 | 17.7 | 0.2 | 16.5 | 0.09 | 1.05e+06 | 1.32e+05 | 1.4e+11 |
| anyx_kl5_kr6 | 5 | 6 | 1 | --anyx | 550 | 9 | 0 | 789 | 27.0 | 26.9 | 4.1 | 21.6 | 0.56 | 2.13e+07 | 1.32e+05 | 2.8e+12 |
| common_anyx_kl4_kr5 | 4 | 5 | 1 | --common --anyx | 388 | 2 | 0 | 958 | 0.2 | 0.2 | 0.0 | 0.1 | 0.08 | 6.02e+04 | 1.16e+03 | 7e+07 |
| common_anyx_kl5_kr5 | 5 | 5 | 1 | --common --anyx | 464 | 3 | 1 | 880 | 2.2 | 2.2 | 0.0 | 2.0 | 0.08 | 6.02e+04 | 1.46e+04 | 8.8e+08 |
| common_anyx_kl5_kr6 | 5 | 6 | 1 | --common --anyx | 482 | 4 | 1 | 861 | 2.6 | 2.6 | 0.2 | 2.2 | 0.09 | 6.7e+05 | 1.46e+04 | 9.8e+09 |
| common_anyx_kl6_kr6 | 6 | 6 | 1 | --common --anyx | 507 | 4 | 0 | 837 | 34.9 | 34.8 | 0.2 | 34.6 | 0.09 | 6.7e+05 | 1.77e+05 | 1.2e+11 |
| common_anyx_kl6_kr7 | 6 | 7 | 1 | --common --anyx | 513 | 7 | 0 | 828 | 41.4 | 41.2 | 2.9 | 38.1 | 0.41 | 7.45e+06 | 1.77e+05 | 1.3e+12 |
| common_anyx_kl7_kr7 | 7 | 7 | 1 | --common --anyx | 539 | 8 | 0 | 801 | 763.2 | 761.3 | 2.9 | 810.5 | 0.41 | 7.45e+06 | 4.04e+06 | 3e+13 |
| common_anyx_kl7_kr8 | 7 | 8 | 1 | --common --anyx | 542 | 40 | 0 | 766 | 1236.7 | 1233.5 | 67.2 | 1250.5 | 4.55 | 8.53e+07 | 4.04e+06 | 3.4e+14 |
| kl5_kr6_kmin0.1 | 5 | 6 | 1 | --kappa-min 0.1 | 531 | 8 | 0 | 809 | 25.9 | 25.8 | 4.1 | 19.8 | 0.56 | 2.13e+07 | 1.21e+05 | 2.6e+12 |
| kl5_kr6_kmin0.3 | 5 | 6 | 1 | --kappa-min 0.3 | 530 | 7 | 0 | 811 | 23.1 | 23.1 | 4.1 | 16.7 | 0.59 | 2.13e+07 | 1.04e+05 | 2.2e+12 |
| kl5_kr6_kmin1e-2 | 5 | 6 | 1 | --kappa-min 1e-2 | 530 | 11 | 0 | 807 | 27.3 | 27.1 | 4.1 | 21.9 | 0.56 | 2.13e+07 | 1.32e+05 | 2.8e+12 |
| kl5_kr6_kmin1e-3 | 5 | 6 | 1 | --kappa-min 1e-3 | 530 | 17 | 0 | 801 | 27.6 | 27.5 | 4.1 | 22.3 | 0.56 | 2.13e+07 | 1.35e+05 | 2.9e+12 |
| kl5_kr6_kmin1e-4 | 5 | 6 | 1 | --kappa-min 1e-4 | 530 | 40 | 0 | 778 | 27.7 | 27.6 | 4.2 | 22.3 | 0.64 | 2.13e+07 | 1.36e+05 | 2.9e+12 |
| kl5_kr6_tol2 | 5 | 6 | 1 | --tol 2 | 528 | 7 | 0 | 813 | 25.0 | 24.9 | 4.2 | 19.7 | 0.56 | 2.13e+07 | 1.29e+05 | 2.7e+12 |
| kl5_kr7_tol2 | 5 | 7 | 1 | --tol 2 | 548 | 11 | 0 | 789 | 240.3 | 239.8 | 196.5 | 41.7 | 8.55 | 4.44e+08 | 1.29e+05 | 5.7e+13 |
| kl6_kr6_tol2 | 6 | 6 | 1 | --tol 2 | 554 | 14 | 1 | 779 | 549.7 | 548.6 | 4.1 | 545.7 | 0.56 | 2.13e+07 | 3.41e+06 | 7.3e+13 |
| kl6_kr7_tol2_t12 | 6 | 7 | 12 | --tol 2 | 569 | 158 | 0 | 621 | 249.1 | 2945.9 | 26.4 | 2628.9 | 8.47 | 4.44e+08 | 3.41e+06 | 1.5e+15 |
| kl6_kr6_tol2_kmax32 | 6 | 6 | 1 | --tol 2 --kappa-max 32 | 555 | 15 | 0 | 778 | 580.3 | 579.0 | 4.1 | 573.5 | 0.56 | 2.13e+07 | 3.4e+06 | 7.2e+13 |

(wall s: as measured by `monitor.py`, process start to end; CPU s, table s: the program's own timers; median ms
per constant: the time of the thread that handled it, so for multithreaded runs it is not the wall time;
distinct L per constant: after the shortest-first stop, averaged over the constants.)

By class (exact): |L| <= 5, |R| <= 6: rational 11, algebraic 96, elementary 359, special 47, none 19; CR GPU
K <= 8: 11, 91, 299, 32, 14; RIES -l5: 10, 119, 374, 15, 30. Compared with CR, MITM gains on elementary (+60)
and special (+15) constants. Compared with RIES -l5, it finds many more special constants (47 vs 15: Gamma and
the inverse trigonometric and hyperbolic functions are in CALC4, not in RIES's defaults), fewer algebraic ones
(96 vs 119: nth roots and equations with x several times, e.g. polynomial roots) and slightly fewer elementary
ones (359 vs 374).

Overlaps (exact in both / only the reference / only MITM):

| MITM config | vs CR CPU K<=7 | vs CR GPU K<=8 | vs RIES -l4 | vs RIES -l5 |
|---|---|---|---|---|
| \|L\|<=4, \|R\|<=5 | 417 / 0 / 27 | 440 / 7 / 4 | 412 / 123 / 32 | 412 / 136 / 32 |
| \|L\|<=5, \|R\|<=6 | 417 / 0 / 115 | 447 / 0 / 85 | 482 / 53 / 50 | 484 / 64 / 48 |
| \|L\|<=6, \|R\|<=6 | 417 / 0 / 139 | 447 / 0 / 109 | 496 / 39 / 60 | 499 / 49 / 57 |

What RIES finds and MITM (x once) does not are mostly equations with x several times, which have no explicit
formula: x^x = e, x^(1/x) = 1/e, x - 1/x^2 = 1 (plastic constant and other polynomial roots), Lambert W values;
the rest is depth (e.g. 3x - ln 2 = pi/sqrt 3 needs |L| = 6).

With x any number of times (`--anyx`, RIES's semantics) the number of left sides of length <= 5 hardly grows
(1.32e5 instead of 1.29e5 distinct per constant: a short code rarely has room for a second x), the times are the
same, but implicit equations come in (x^x = e, x / arccos x = 1, polynomial roots):

| \|L\| / \|R\| | 4/4 | 4/5 | 5/4 | 5/5 | 5/6 |
|---|---|---|---|---|---|
| x once: exact / false pos. | 416 / 3 | 444 / 3 | 483 / 4 | 511 / 6 | 532 / 9 |
| x any number of times | 423 / 3 | 451 / 3 | 501 / 4 | 530 / 6 | 550 / 9 |

|L| <= 5, |R| <= 6 with x any number of times (27 s, one thread) finds more than RIES -l5 (550 vs 548, false
positives 9 vs 12): 500 constants in both, 48 RIES only, 50 MITM only. These equations do not always have an
explicit formula.

## Where the time goes

One thread, from the program's own timers (`..._raw.txt`):

| config | right-side table (once) | per constant | left sides | sort | match | verify |
|---|---|---|---|---|---|---|
| \|L\|<=4, \|R\|<=5 | 0.16 s | 0.7 ms | 33 % | 22 % | 44 % | 0 |
| \|L\|<=5, \|R\|<=6 | 4.1 s (21 M values, 0.24 GB) | 17 ms | 34 % | 18 % | 48 % | 0 |
| \|L\|<=6, \|R\|<=6 | 4.1 s | 428 ms | 34 % | 22 % | 44 % | 0.1 % |
| \|L\|<=4, \|R\|<=7 | 197 s (444 M values, 5 GB; generate 119 s, sort 50 s, count 27 s) | 2 ms | 11 % | 6 % | 83 % | 0 |

- The **right-side table** is the only part that grows with KR, and it is paid once per batch: 4 s for
  |R| <= 6, 200 s for |R| <= 7 on one thread (26 s on 12 threads).
- **Per constant** the cost is set by the number of left sides: 1.3e5 distinct values at |L| <= 5, 3.4e6 at
  |L| <= 6 (x once). Each costs about 28 ns to generate (one library call, with the derivative), 15-18 ns to
  sort and 55-65 ns to match (a lookup in a table much larger than the cache; 270 ns in the 5 GB table of
  |R| <= 7, where few left sides share cache lines). Verification of candidates is negligible.
- So the cheap direction is **long right sides, short left sides**: |L| <= 5, |R| <= 7 costs 38 ms per
  constant after a one-time table, |L| <= 6, |R| <= 5 costs 350 ms per constant for fewer identifications.
  RIES grows both sides together for every target.
- Threads: |L| <= 5, |R| <= 6 takes 26.7 s on 1 thread, 14.3 s on 2, 7.5 s on 6, 5.3 s on 12, 6.6 s on 24
  (the lookups are bound by memory latency; hyperthreads do not help). |L| <= 6, |R| <= 6: 9.7 min -> 2.5 min on
  12 threads.

Compared with the plan's earlier measurements: the tree (std::set, RIES-like) took 486 s for the matching step of
size 8/7 alone, the sort-based variant 61 s. Here the whole search, including the generation, the sorting with
deduplication and the verification, takes seconds to minutes for 1348 constants, because (a) the right sides are
shared by all constants, (b) the enumeration costs about one operation per code, (c) duplicates are removed
early (right sides keep 36-52 % of the finite values), and (d) the shortest-first stop ends most searches
early (63 % of the identified constants stop at total length 6 or less).

## Explicit formulas (Phase 1b)

With x exactly once, L(x) = R can be solved for x by undoing the operations of L from the root down to x and
applying the inverses to R: LOG <-> EXP, INV, SQRT <-> SQR, SIN <-> ARCSIN, ... and t + s, t s, t - s, t / s,
t^s with x in either operand (`explicit.py`). Multivalued inverses (SQR, COSH, SIN, COS, TAN) take the branch
(sign, multiple of pi) that reproduces the value of the inverted part at the target; GAMMA has no inverse among
the buttons (it never occurred on the path of x in the exact equations). The explicit formula is checked again
with 80 digits.

For |L| <= 5, |R| <= 6: **all 532 exact equations give an explicit formula** correct to >= 30 digits. The
explicit formula is as long as the equation minus one (the "x") in 432 cases, and 1-4 buttons longer in 100
(an inverse function or a sign that the equation did not need, e.g. log_10 R = ln R / ln 10 for 10^x = R). For
the 447 constants also found by CR the explicit formula has CR's length 435 times and is longer 12 times, never
shorter (as it must be: CR's search is exhaustive by length). For the **85 constants that CR does not find**
MITM gives explicit formulas of length 9 to 13, beyond CR's reach, for example:

- lemniscate constant: x sqrt(arcsin 1) = (Gamma(1/4) / 2)^2, i.e. x = Gamma(1/4)^2 / (2 sqrt(2 pi)), in CALC4
  `ONE, ARCSIN, SQRT, TWO, FOUR, INV, GAMMA, DIVIDE, SQR, DIVIDE` (10 buttons)
- Gamma(1/4)^4 / (16 pi^2): sqrt(pi sqrt x) = Gamma(1/4) / 2
- Erdos-Tenenbaum-Ford constant: 2^x = 2 / (e ln 2)
- log_10 of the integers 61, 79, 83, 97 (10^x = 9^2 + 2, ...), log pi/180, log 1/(4 pi), ...

So MITM with x once is a drop-in replacement for CR's search: same buttons, same output (an explicit formula),
deeper.

## The same grammar as RIES

Both tools with exactly the same buttons, the symbols CALC4 shares with RIES's defaults (1..9, pi, e, phi; ln,
exp, 1/x, sqrt, x^2; + - * / ^, i.e. `ries -S123456789pefrqslE+-*/^`), and the same semantics (x any number of
times on the left side): MITM `--common --anyx`, RIES with `run_ries_v0.py --symbols ...` (12 processes, CPU time
= 12 x wall time).

| method | exact | false pos. | time | CPU time |
|---|---|---|---|---|
| MITM \|L\|<=5, \|R\|<=6 | 482 | 4 | 2.6 s, one thread | 2.6 s |
| MITM \|L\|<=6, \|R\|<=6 | 507 | 4 | 35 s, one thread | 35 s |
| MITM \|L\|<=6, \|R\|<=7 | 513 | 7 | 41 s, one thread | 41 s |
| RIES -l3 | 514 | 8 | 94 s on 12 processes | 19 min |
| RIES -l4 | 527 | 9 | 529 s on 12 processes | 1.8 h |
| MITM \|L\|<=7, \|R\|<=7 | 539 | 8 | 12.7 min, one thread | 12.7 min |
| RIES -l5 | 541 | 11 | 2601 s on 12 processes | 8.7 h |
| MITM \|L\|<=7, \|R\|<=8 | 542 | 40 | 20.6 min, one thread | 20.6 min |

Overlaps (exact in both / RIES only / MITM only): MITM 7/7 vs RIES -l3: 514 / 0 / 25; vs RIES -l4: 526 / 1 / 13.
MITM 7/7 vs RIES -l5: 533 / 8 / 6; the 8 equations only RIES -l5 has all have left sides of 8-9 cheap
symbols, e.g. x - (1 - 1/(2x))^2 = 2/3 or 9x - (2 + sqrt 2) = 5 ln(1 + sqrt 2).

So on identical buttons and semantics the speed-up is smaller than against RIES with its default symbols: about
30 times at RIES -l3's level (513 exact in 41 s vs 19 CPU minutes), 8 times at -l4's level (539 vs 527 exact)
and 40 times at -l5's level (539 exact in 12.7 min vs 541 in 8.7 CPU hours), with a similar false-positive rate.
MITM's results contain RIES's almost completely up to -l4 (MITM enumerates every equation up to the given
lengths; RIES is not exhaustive, as found before for alpha).

Why the gap shrinks: RIES does not count symbols but **weighs** them (its complexity score: small digits, 1/x
and x^2 are cheap, pi or ^ expensive). Its -l3 reaches left sides of 7-8 symbols and totals of up to 15 symbols
when they are made of cheap symbols, while MITM's |L| <= 6, |R| <= 7 stops at 13 symbols of any kind. Of the 13
constants that RIES -l3 finds and MITM 6/7 does not, all have left sides of 6-8 symbols, such as
x + 1/x^3 = 2, x + 1/(1 - sqrt x) = 2, x^(1/x) - 1/x = 1 or x / (4 - 1/x)^2 = (1/(2 sqrt 3))^2. The weighting
is a prior that simple symbols are more likely, and it is independent of meet-in-the-middle: enumerating by
weighted complexity instead of length is the obvious next step for MITM (the odometer can do it: a prefix whose
weight plus the cheapest completion exceeds the budget is skipped).

## What limits the depth: double precision, not time

Every additional button multiplies the number of equations by about 20. The chance that some equation holds at a
random T within the tolerance grows with it: the number of equations per constant times 2 tol, times a factor
for the uneven distribution of the values. On v0 the false positives stay at 3-10 up to about 4e12 equations per
constant (total length 11) and jump to 54-72 at 6e13-7e13 (total length 12, |L| <= 5, |R| <= 7 and |L| <= 6,
|R| <= 6); there, 60 of the 72 false positives have the maximal length 12, against 16 exact ones. CR at K <= 8
checks 7e10 formulas per constant, three orders of magnitude below this limit; MITM reaches it in minutes.

The errors tell true and chance matches apart: at |L| <= 6, |R| <= 6, 533 of the 540 exact equations of length
<= 11 have a relative error of 0-1 eps (the double of the equation's root is the input itself or its neighbour),
while the 60 chance matches of length 12 spread evenly over 0-16 eps. A tighter tolerance therefore removes chance
matches almost without losing true ones:

| \|L\| / \|R\| | equations per constant | tol 16 eps: exact / false pos. | tol 2 eps: exact / false pos. |
|---|---|---|---|
| 5/6 | 2.7e12 | 532 / 9 | 528 / 7 |
| 5/7 | 5.7e13 | 552 / 54 | 548 / 11 |
| 6/6 | 7.2e13 | 556 / 72 | 554 / 14 (with kappa_max kept at 32: 555 / 15) |
| 6/7 (12 threads) | 1.5e15 | 571 / 591 | 569 / 158 |

(kappa_max = 2 tol / eps follows the tolerance: 4 at 2 eps.) At 2 eps the false positives fall about five-fold
for a loss of 2-4 exact identifications; at 1.5e15 equations per constant even 2 eps is overwhelmed. Below 1 eps
the tolerance cannot go (the input itself is rounded to 0.5 ulp), so with doubles the useful search size is
about 1e14 equations per constant, |L| + |R| <= 12 for CALC4. Going deeper needs higher precision for the
candidates (double-double or MPFR re-evaluation of the matches), not more speed.

For the physical constants (error bars of 1e-8 to 1e-11) this limit is reached at a few hundred times fewer
equations, and the regime is the other one (all matches within the error bar plus their chance statistics), as
discussed in memory `cr-two-precision-regimes`.

## In WebAssembly (measured 2026-10-04)

The same source compiles with `em++ -O2 -std=c++17 mitm_cr.cpp -s ALLOW_MEMORY_GROWTH=1 -s MAXIMUM_MEMORY=4GB`
(130 KB of WASM; the prefetch is a no-op there). Node.js, one thread, first 100 constants of v0:

| config | right-side table | build (WASM / native) | per constant (WASM / native) |
|---|---|---|---|
| CALC4 \|L\|<=4, \|R\|<=5 | 1.05e6 values, 13 MB | 0.28 s / 0.16 s | 0.9 ms / 0.7 ms |
| CALC4 \|L\|<=5, \|R\|<=6 | 2.13e7 values, 0.24 GB | 6.7 s / 4.2 s | 23 ms / 12.5 ms |
| common, x any, \|L\|<=6, \|R\|<=7 | 7.4e6 values, 0.09 GB | 4.9 s | 40 ms |

WASM is 1.6-1.8 times slower than native. The build needs a temporary buffer of 16 bytes per surviving value
(0.56 GB for |R| <= 6), so the heap peaks at 0.8 GB while the finished table is 0.24 GB; WASM memory never shrinks,
so in a browser the build should run in a worker that hands the finished table over and is then terminated (or
the build buffer should be made smaller). musl's libm rounds a few values differently (0.3 % more distinct right
values), so WASM answers can differ slightly from the native benchmark.

## Caveats

- **Grammars differ.** CR and MITM use CALC4 (with Gamma and inverse trigonometric/hyperbolic functions); RIES's
  defaults have nth roots, logarithms to a base, sin(pi x), atan2, negation, and no Gamma. Exact counts between
  MITM (CALC4) and RIES (defaults) compare tools, not algorithms; the same-grammar comparison is above.
- **x once vs. any.** The default (x once) is what makes explicit formulas possible; it cannot express x^x = e.
  `--anyx` can, at a higher cost per constant.
- **Times.** RIES and CR CPU ran as 12 single-threaded processes (WASM for CR), MITM in one process. The CPU
  times compare work; the wall times compare what a user waits for. RIES's per-call startup is included in its
  times (small at -l4/-l5).
- **The guards were tuned on v0** (kappa_min from the sweep above), so v0 is not an independent test of the
  false-positive rate. The rules have a physical meaning (relative sensitivity of the equation to x), and the
  planted-formula test, which did not influence them, shows few false positives below the depth limit.
- **libm.** icx's libm (<= 0.53 ulp) was used; with MSVC's UCRT a few values near the tolerance differ.
- **Not done:** the GPU and WebGPU phases; a significance estimate per equation (expected number of chance
  matches for the length found) instead of the global tolerance; right sides of length 8 for CALC4 (6.9e10 codes;
  the distinct values would need about 2e10 x 12 bytes, beyond 16 GB, so a disk-backed or value-partitioned
  table would be needed).

## Next steps (suggestions)

1. Enumerate by weighted complexity (symbol costs, as RIES) instead of plain length, on both sides; the
   same-grammar comparison shows that this is what RIES gains at equal work.
2. Report per equation the expected number of chance matches at its length (from the counts of left and right
   sides per length and the local density of right values), and claim SUCCESS only when it is small. This
   replaces the global tolerance and allows going deeper safely.
3. Put the matching on the GPU (the earlier `mitm_bench` measured 1 s for 1.2e16 pairs) or in WebGPU; the
   right-side table of |R| <= 6 (0.24 GB) fits easily into a browser.
4. Integrate into the frontend as an alternative search: |L| <= 5, |R| <= 6 answers in ~20 ms per constant
   after a 4 s table, |L| <= 4, |R| <= 5 in < 1 ms after 0.2 s, with CR-style explicit formulas.

## Files

New (all under `ConstantRecognition/`):

- `algorithms/methods/mitm/mitm_cr.cpp`, `build_mitm.bat`, `test_planted.py`, `explicit.py`,
  `summarize_mitm.py`, `PHASE1_RESULTS.md` (this file); the binaries `mitm_cr.exe` (icx) and `mitm_cr_cl.exe`
  (MSVC) are build products, not in git.
- `benchmark/run/run_mitm_v0.py`
- `benchmark/results/v0_mitm_<config>.tsv`, `v0_mitm_<config>_raw.txt` (one pair per row of the table above),
  `v0_mitm_kl5_kr6_explicit.tsv` (explicit formulas), `v0_ries_common_l<3,4,5>.tsv` and `_raw.tsv` (RIES with the
  common symbols).

Changed:

- `benchmark/run/run_ries_v0.py`: options `--symbols` and `--tag` (defaults unchanged).
- `algorithms/methods/README.md`: the `mitm` module listed.

From the previous session: `mitm_bench.cu`, `bench_8_7.txt`,
`PHASE1_PLAN.md`. Not touched: `C/`, the frontend.
