# Distinct values: a second engine for few buttons (results, and notes for later upgrades)

Work of 2026-10-31. Files: `mitm_distinct.cpp` (the engine and its command line), `mitm_wasm.cpp` (both engines in
one WebAssembly module), `calculator_frontend/app/mitm` (engine choice on the page). Machine: AMD Ryzen 9 5900X
(12 cores), 32 GB, RTX 5080; times on one thread unless said otherwise.

## Why: few buttons, mostly repeated values

- The trigger: @N8Programs (X, 2026-10-30) wrote 2868 with e and pi only (+, *, ^): the expression equals
  2868 + 1.299e-13, relative 4.5e-17, 0.29 ulp, so `x == 2868.0` holds in doubles only. 43 symbols (about 37 with
  x^2); about 1e27 expressions of that size, CR = 16.3 / (43 log10 5) = 0.54: chance.
- `mitm_cr` on 2868 with pi, e, x^2, +, *, ^ (MAXK raised to 16 in a scratch build): best errors 1.4e-10 (23 symbols,
  |L| <= 12, |R| <= 12), 1.8e-11 (26), 2.1e-13 (27), 1.7e-13 (29), 1.0e-13 (31, |L| <= 16, |R| <= 15), all with
  CR < 1: about 0.4 digits per symbol, double precision near 37 symbols, the length of N8's expression.
- With few buttons almost every code repeats a value: 2% of the codes of length <= 15 have a value of their own
  (pi, e, x^2, +, *, ^), and a duplicate of a short length reappears inside every longer code made from it.
- The GPU (scratch `mitm_gpu` with MAXK 16) does 6.8e8 left values per second: 12/12 0.08 s, 14/13 1.0 s, 15/14
  5.0 s, 16/15 27 s. The sub-second double precision of Phase 2 (`ries_gpu -l6`: 4.9e14 equations in 0.6 s) holds
  for RIES's ~30 symbols: about 20 times more distinct values per added symbol (3.5 here), values crowded near 1
  (here all above e and spread over hundreds of decades), few duplicates.

## The engine (`mitm_distinct.cpp`)

Every length is made only from the distinct values of shorter lengths (dynamic programming over values): right
sides R_k from R_(k-1) (functions) and R_i, R_j (operators); left sides (x once) as pairs (L(T), L'(T)) from shorter
left values and right values (the constants of a left side come from the right table). Same buttons, guards,
matching, Newton steps and output as `mitm_cr`. Per right value the code with the smallest rounding-error bound is
kept (`mitm_cr` keeps the first code of its enumeration). Memory: 24 bytes per right value, 28 per left value kept;
right levels up to max(|R|, |L| - 2); left levels kept within the memory cap, the longest (up to 6 lengths) made on
the fly. x once only; sides up to 30 symbols.

- The tables are `mitm_cr`'s: pi, e, x^2, +, *, ^ at |R| <= 12, 13, 14: 853627, 2918863, 9948131 values, made with
  about 2 operations per value instead of 49 codes per value (at 14).
- Benchmark v0, default buttons, |L| <= 5, |R| <= 6 (8 threads): the same 540 SUCCESS / 808 FAILURE and the same
  lengths as `mitm_cr` (g++ and icx builds). Three cosmetic differences: #166 and #765 report the closest pair at
  the neighbouring length (errors equal to 3 digits), #504 has 1.8e-16 instead of 0 (1/x^3 and (1/x)^3 merged). Time:
  targets 6.0 s against 6.4 s; the table 2.2-3.9 s (one thread) against 1.1 s (threads).
- One constant, default buttons, |L| <= 7, |R| <= 5 (zeta(3)): 10.8 s against 20.0 s, the same answer.
- 2868, pi, e, x^2, +, *, ^:

  | \|L\| / \|R\| | `mitm_cr`, CPU | `mitm_cr`, GPU | `mitm_distinct`, CPU | WebAssembly (Node), table + search | best error |
  |---|---|---|---|---|---|
  | 12 / 12 | 2.2 s | 0.29 s | 0.33 s | 0.22 + 0.42 s (`mitm_cr`: 2.45 + 4.45 s) | 1.40e-10 |
  | 14 / 13 | 60 s | 1.4 s | 3.3 s | 0.72 + 5.6 s | 2.07e-13 |
  | 15 / 14 | 369 s | 5.9 s | 12.7 s | 3.6 + 27 s, 1.56 GB | 1.73e-13 |
  | 16 / 15 | (about 30 min) | 31 s | 50-67 s, 5.6 GB | refused (memory) | 1.06e-13 |

## The page

Engine: Automatic / All codes / Distinct values. A probe in JavaScript (`probeDistinct`, milliseconds) counts the
distinct right values of the first lengths; `distinctSizes` extrapolates the fraction of distinct values; the
estimates (`estimateDistinct`) take 330 ns per right value and 350 ns per left value (left values: 0.55 times the
right fraction, calibrated on pi, e, x^2, +, *, ^). Automatic: x any number of times, all codes; sides above 12,
distinct values; otherwise the engine within the browser's limits, distinct values if 30% faster. Default buttons:
all codes up to |L| = 6, distinct values from 7. In the browser (headless Chrome): pi, e, x^2, +, *, ^ at 12/12 0.9 s,
15/14 32 s. The module frees its table before building another: a failed build leaves none (fixed: the page forgets
its table then, and a search answering "no right-side table" builds it once more).

## Buttons without one-argument functions (binary trees)

pi, e, +, *, ^: only odd lengths exist (n operators, n + 1 constants); an even length adds nothing. Distinct right
values of length 1, 3, ..., 17: 2, 10, 69, 637, 5643, 49375, 418667, 3476084, 28606438. 2868 natively: 15/15 1.5 s
(4.9e-12, 30 symbols), 17/15 15 s (8.4e-13, 32), 17/17 25 s and 3.6 GB at the peak (1.5e-13, 34). In the browser:
15/16 2.6 s, 17/16 12 s (estimated 47 s); |R| <= 17 refused (the 28.6 million values of length 17, held twice while
the passes are joined: about 1.9 GB over the limit of 1.5 GB); |L| <= 19 refused (a left side x o c needs constants
of 17 symbols, the same level). Probably worth an algorithm of its own (binary trees of 2n + 1 symbols), not tried.

## Open points for later upgrades

1. Odd-only button sets: the sliders and "Deeper" buttons should step by 2 (after |L| <= 15, "Deeper left side"
   offers 16, the same search).
2. Estimates: probe the left side too (with the target), instead of 0.55 times the right fraction (4 times too
   pessimistic for pi, e, +, *, ^); count the memory as the engine uses it (fewer left levels kept, the longest made on
   the fly) instead of refusing.
3. A level made in several passes is held twice while the parts are joined: counting first and filling one array
   would put |R| <= 17 for pi, e, +, *, ^ at about 1.25 GB (twice the build time); or levels in segments; or a higher
   limit than the page's 1.5 GB (WebAssembly allows 4 GB).
4. GPU version of `mitm_distinct` (a level is a large batch of independent combinations, then sort and merge).
5. x any number of times (left o left combinations).
6. Threads: the right levels are made on one thread; one target uses one thread (|L| <= 18, |R| <= 17 for six
   buttons, about 3.5e9 left values, would take about 20 min on one thread).
