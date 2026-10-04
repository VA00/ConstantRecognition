# Phase 1: meet-in-the-middle constant recognition core on the CPU (bare metal)

Instructions written 2026-10-03 at the end of a long session, for an overnight session that starts fresh.
Read this file completely before starting. The user is away; work autonomously, but follow the
constraints at the end.

## The question to answer

Is a stripped, cache-aware meet-in-the-middle (MITM) search, in the style of RIES but without its
overhead, a **significant speed-up on the CPU** for constant recognition on benchmark v0, compared with
(a) the Constant Recognition engine (memoryless enumeration, `C/`), (b) RIES, at an equivalent depth and
an equal or better number of exact identifications? Native code ("bare metal"), not WASM; ignore the
WASM 4 GB limit for now.

## What is already known (measured 2026-10-03)

- `algorithms/methods/mitm/mitm_bench.cu` (uncommitted) measures only the matching step on the shared
  grammar (constants 1..9, pi, e, phi; ln, exp, 1/x, sqrt, x^2; + * - / ^). R = all codes of length
  <= KR without x, L = codes of length <= KL with x at the target, values deduplicated, pairs with
  relative difference <= 1e-12 counted. Results (output of size 8/7 in `bench_8_7.txt`):

  | size | equations | tree (std::set, RIES-like) | sort + two-pointer sweep, 1 thread | all on GPU |
  |---|---|---|---|---|
  | 7/7 | 7.4e14 | 26.4 s + 3.5 s generation | 4.1 s + 3.5 s generation | 0.10 s |
  | 8/7 | 1.2e16 | 486 s + 37 s generation | 61 s (std::sort) + 37 s generation | 1.01 s |

  90% of R values are duplicates. `std::sort` on one thread dominates the CPU sort variant; a radix
  sort or a parallel sort should cut it further.
- RIES internals (`cr_work/ries/ries.c`, architecture comment at lines 715-760; `-Dy` statistics):
  recursive generation by complexity (`gen_forms`/`gf_1`/`ge_2`) with about 10 dead ends per finished
  expression, a metastack with undo and derivative, one binary tree mixing left and right sides
  (64-byte nodes with the symbols, average depth 32), neighbour check on every insertion, Newton on
  close pairs. Common grammar `-l6`: 1.37e8 expressions generated, 2.5e7 distinct, 1.5e14 equations,
  147 s, about 1.1 us per generated expression (the bare tree costs about 0.45 us per value).
- Same-grammar comparison on alpha (`benchmark/ries_vs_cr/`): RIES `-l7` found 10 of the 11 explicit
  formulas CR's GPU search found up to K = 12, and 9600 implicit equations. RIES is not exhaustive.

## What to build

Directory `algorithms/methods/mitm/`. One C or C++17 program, e.g. `mitm_cr.cpp`, single-threaded first
(optionally a multithreaded variant afterwards, reported separately).

1. **Grammar.** Default CALC4 exactly as `C/CALC4.h` (13 constants including NEG = -1 and
   GOLDENRATIO, 18 unary, 5 binary), because the v0 results of the CR engine and its GPU version use
   CALC4. Option `--common` for the shared RIES grammar (to compare with `ries -S123456789pefrqslE+-*/^`).
   Use the C99 libm functions as the CR engine does (MSVC UCRT or Intel icx; note the tgamma accuracy
   issue in memory `constantrecognition-native-libm`).
2. **Enumeration without dead ends.** Valid postfix forms (ternary: constant / unary / binary, stack
   never underflows, ends with one value) generated as in `constant_gpu_benchmark.cu` `generate_forms`
   and `mitm_bench.cu` `forms`; then all button assignments by mixed-radix index. No recursion with
   undo, no rejected partial expressions.
3. **Right sides (target independent).** All codes of length 1..KR without x. Store compactly: the
   double value plus an index from which the code can be rebuilt (form id + mixed-radix index, e.g.
   12-16 bytes), not the symbols. Drop non-finite values. Deduplicate by value (sort, keep the
   shortest code per bit-identical value). **Build once and reuse for all targets** (batch mode:
   targets read from stdin, one per line `id value`, like `constant_gpu_benchmark`). This is a major
   advantage over RIES, which rebuilds both sides for every target.
4. **Left sides (per target).** Codes of length 1..KL containing x (x is an extra constant button with
   value T). Evaluate value and derivative d/dx at T (dual numbers). Default: x exactly once (allows an
   explicit formula by inversion later); option for any number of x (RIES semantics, for the speed
   comparison with RIES). Deduplicate, sort.
5. **Matching.** Both sorted, one two-pointer sweep. A pair (L, R) is a candidate if the root estimate
   x* = T - (L(T) - R)/L'(T) satisfies |x* - T| <= tol |T| (RIES measures the distance in x the same
   way). Default tol = 16 DBL_EPSILON (the CR engine's SUCCESS criterion). The window in value space
   for a given L is |L(T) - R| <= tol |T| |L'(T)|; the sweep must handle that the window width varies
   with L (sort L by its window start, or use binary search per L into the sorted R, which is still
   cache-friendly when L is sorted).
6. **Verification and output.** For each candidate: refine with a few Newton steps on L(x) = R (cheap,
   only for candidates) and require |x - T| <= tol |T|. Report per target the best match in order of
   total length (left length + right length), i.e. shortest first, and its RPN in Constant Recognition
   button names. Careful: the CR engine pops operands as func(b, a) ("a, b, SUBTRACT" means b - a,
   "a, b, POWER" means b^a, see `C/CALC4.h` lines 93 and 136), while `constant_gpu_benchmark.cu`
   uses a - b and a^b; state the convention used in the output.
   Optional (Phase 1b): with x exactly once, turn L(x) = R into an explicit formula x = L^{-1}(R) by
   inverting the left side's spine (PLUS/SUBTRACT/TIMES/DIVIDE with the constant subtree, POWER both
   ways, LOG<->EXP, INV, SQRT<->SQR with both signs, trig/hyperbolic principal branches, GAMMA not
   invertible), evaluate it forward and accept only if it reproduces T within tol (this guards branch
   errors). That gives CR-style explicit formulas.
7. **Memory cap.** Count codes per length before allocating; refuse (or lower KR/KL) if the estimate
   exceeds a cap, default 16 GB. Print counts, distinct counts and peak memory.
8. **Output.** One tab-separated line per target, like `constant_gpu_benchmark`:
   `id  SUCCESS|FAILURE  total_length  LHS_RPN  RHS_RPN  rel_err  candidates  ms`.

## How to benchmark on v0

- Write `benchmark/run/run_mitm_v0.py`, modeled on `benchmark/run/run_cuda_v0.py` (batch over
  `benchmark/data/v0/constants_v0.tsv`, constants with >= 17 digits, nearest double as input) and on
  `benchmark/run/run_ries_v0.py` for the classification of equations: solve the reported equation at 80
  digits with mpmath next to the target (`R.solve`) and compare with the 64-digit value: exact if >= 30
  digits agree, false positive if SUCCESS in double but < 30 digits, etc. (same categories as
  `run_benchmark_v0.py`). Write `benchmark/results/v0_mitm_<config>.tsv`.
- Compare with the existing results in `benchmark/results/`: CR CPU K <= 7 (`v0_K7.tsv`, 417 exact,
  65 min on 11 cores), CR GPU K <= 8 (`v0_cuda_K8.tsv`, 447 exact), RIES `-l5` (`v0_ries_l5.tsv`, 548
  exact, 50 min on 12 processes); see `benchmark/results/SURVEY_2026-10-01.md` for settings. Choose
  KR/KL so that the exact count is comparable (for example the depth at which MITM matches CR K <= 8,
  and the depth at which it matches RIES -l5), and report wall time and CPU time single-threaded.
  Report time to build the right-side table separately (it is shared by all targets).
- Correctness checks before the big run: planted formulas from `benchmark/depth/grammars.py` must be
  retrieved; on the shared grammar the candidate counts must agree with `mitm_bench` for the same sizes;
  spot-check a few known identities (pi, e, Euler-type constants).
- Deliverable: `algorithms/methods/mitm/PHASE1_RESULTS.md` with what was built, how it was run, a
  table (method, depth, exact, false positives, wall time, CPU time, peak memory), and the answer to the
  question above, including where the time goes (generation, sort, matching, verification).

## Build notes

Windows, MSVC via `vcvars64.bat` found with vswhere (see `algorithms/methods/gpu_cuda/build_benchmark.bat`),
or Intel icx (`C:\Program Files (x86)\Intel\oneAPI\compiler\2025.3\bin`, call vcvars64 first), or MinGW
gcc (`C:\msys64\ucrt64\bin`). Intel icx has the most accurate libm. RIES binary for comparisons:
`C:\Users\Misiek\temp\cr_work\ries\ries.exe` (set the environment variable `RIES` for the scripts in
`benchmark/`).

## Constraints

- Do not modify the CR engine in `C/` or the web frontend.
- Do not commit and do not push; leave everything in the working tree for the user to review.
- Keep memory below 16 GB (the machine has 32 GB). Run long jobs with a memory cap and a time limit
  (`benchmark/depth/monitor.py`), never let the machine page. Long runs overnight are allowed.
- Never trust same-to-13-digits as identity when many matches lie in a narrow window; verify at 80 digits.
- Explain results plainly in `PHASE1_RESULTS.md`; the user reads it in the morning.
