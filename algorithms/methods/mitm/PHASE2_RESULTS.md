# Phase 2 results: the meet-in-the-middle search on the GPU

Following `PHASE2_PLAN.md`. One section per machine; files are listed at the end.

## win5080: Windows 11, RTX 5080, CUDA (2026-10-04)

The Metal backend was skipped for now (decision of 2026-10-04): this section is the CUDA backend in double
precision, and the df64 library with its tests, which the Metal backend will need.

### Two programs to use like RIES

`gpu/ries_cpu.exe` and `gpu/ries_gpu.exe` (build: `build_mitm_gpu.bat ries`, or `make ries_cpu` / `make ries`). Type
the number and the level, as with RIES:

```
ries_gpu 1.2020569031595942 -l6
ries_cpu 2.5063141592653589 -l4 -NSCT
```

They use RIES's default symbols (1-9, pi, e, phi; negative, 1/x, x^2, sqrt, ln, e^x, sinpi, cospi, tanpi; + - * / ^,
root, log_A(B), atan2, with RIES's rules for sinpi and the root) and print, as RIES does and in its notation, the
equations that come ever closer to the number, from short to long, up to the first one that holds to double
precision ('exact' match). Differences from RIES:

- The size in braces is the number of symbols (2 x = 3), not RIES's weighted complexity, so the lists are ordered
  a little differently.
- `-lN` picks the left and right side lengths whose number of equations is closest to what RIES tests at -lN
  (RIES's own counts on this machine). -l6 and -l7 run the same search, 7/7 symbols.
- Supported RIES options: the number, `-l`, `-S`, `-N` (RIES's letters; W does not exist here). Others give an error.
  Own options: `--calc` (the calculator's buttons instead), `--once` (x only once), `--kl/--kr`, `--threads`,
  `--vram`; see the header of `gpu/ries_front.h`.
- `ries_cpu` builds the right-side table on all cores; the search for the number itself runs on one core.

Time for one number with the same symbols (zeta(3) = 1.2020569031595942, which has no known closed form, so every
level runs to the end; RIES built with MSVC /O2, one core):

| level | RIES | ries_cpu, 1 thread | ries_cpu, 24 threads | ries_gpu (RTX 5080) | left/right symbols | equations: ours / RIES's |
|---|---|---|---|---|---|---|
| -l2 | 0.18 s | 0.12 s | 0.10 s | 0.19 s | 5/5 | 8.1e9 / 1.2e10 |
| -l3 | 0.91 s | 0.27 s | 0.26 s | 0.15 s | 6/5 | 1.3e11 / 1.5e11 |
| -l4 | 5.2 s | 0.90 s | 0.40 s | 0.16 s | 6/6 | 1.8e12 / 1.8e12 |
| -l5 | 28 s | 5.9 s | 5.5 s | 0.39 s | 7/6 | 3.2e13 / 2.1e13 |
| -l6 | 150 s | 23 s | 8.8 s | 0.60 s | 7/7 | 4.9e14 / 2.7e14 |
| -l7 | 374 s | 23 s | 8.8 s | 0.61 s | 7/7 | 4.9e14 / 9.6e14 |

Beyond about 1e14 equations (-l6 and up) double precision cannot tell a true identity from a chance match: an
'exact' match there has to be checked with more digits. RIES has the same limit.

### Machine

- CPU: AMD Ryzen 9 5900X, 12 cores (24 logical), 32 GB RAM; Windows 11 Education 10.0.26300
- GPU: NVIDIA GeForce RTX 5080, 16 GB (84 SMs), driver 616.92; CUDA 13.1 (nvcc 13.1.80)
- Compilers: Intel icx 2025.3 `/O3 /fp:precise` for the CPU reference (`mitm_cr_ref.exe`, as in Phase 1); MSVC 2022
  (the host compiler of nvcc) for the host side of `mitm_gpu.exe` and for a second CPU reference
  (`mitm_cr_ref_cl.exe`); nvcc `-O3 -arch=sm_120 --fmad=false`.

### The answer

**On benchmark v0 the GPU gives the same answers as `mitm_cr`, 80 to 115 times faster than one CPU core and 9 to
28 times faster than all 12 cores** (runs of more than a second; the smallest configuration is dominated by
start-up). Not 500 times faster than `mitm_cr`: the factor 500 of the plan's notes was one step (building a table
and looking up every left side) against a RIES-like binary tree on one core. `mitm_cr` already replaced the tree by
sorting and can use 12 cores.

All 1348 constants of v0 with >= 17 digits, one process per run (the right-side table built once), wall time from
process start to end, GPU start-up included:

| config | exact / false pos., GPU | exact / false pos., CPU | GPU | CPU, 1 thread | CPU, 12 threads | GPU vs 1 thread | GPU vs 12 threads |
|---|---|---|---|---|---|---|---|
| \|L\|<=4, \|R\|<=5 | 444 / 3 | 444 / 3 | 0.2 s | 1.6 s | 0.4 s | 8 | 2 |
| \|L\|<=5, \|R\|<=6 | 532 / 8 | 532 / 8 | 0.7 s | 55.9 s | 6.1 s | 80 | 9 |
| \|L\|<=5, \|R\|<=6, x any number of times | 550 / 8 | 550 / 8 | 0.7 s | 55.9 s | 6.4 s | 80 | 9 |
| \|L\|<=6, \|R\|<=6 | 557 / 51 | 557 / 52 | 8.7 s | 938 s | 183 s | 108 | 21 |
| \|L\|<=5, \|R\|<=7, tol 2 eps | 548 / 9 | 548 / 9 | 2.9 s | 333 s | 40 s | 115 | 14 |
| RIES's buttons, x any number of times, \|L\|<=7, \|R\|<=7 | 540 / 8 | 539 / 8 | 13.2 s | 1262 s | 280 s | 96 | 21 |
| \|L\|<=6, \|R\|<=7, tol 2 eps | 570 / 125 | 570 / 123 | 10.8 s | not run (> 30 min) | 298 s | - | 28 |

(CPU: `mitm_cr` built with icx, the Phase 1 reference. Tags `win5080_cuda_*`, `win5080_cpu1_*`, `win5080_cpu12_*` in
`benchmark/results/`.)

- **The same answers.** In six of the seven configurations the number of exact identifications is the same and no
  constant changes between exact and anything else; with RIES's buttons the GPU finds one more (constant 248, the
  Rayleigh kurtosis excess, an identity of total length 14 that agrees to 64 digits). What differs otherwise are
  false positives: chance matches at the precision limit (total length 12-13, agreement 13-15 digits), which appear
  or vanish with the last bit of a library function. Section "Differences" lists them.
- **`mitm_cr` on 12 threads** is 4.5 to 9 times faster than on one (5/6: 55.9 s -> 6.1 s; 6/6: 938 s -> 183 s;
  the lookups are bound by memory latency), so the GPU's lead over all cores is 9 to 28 times.
- **Against RIES** (Phase 1's runs on this machine): RIES -l5 needs about 10 CPU hours for 548 exact; the GPU finds
  550 in 0.7 s with the same semantics (x any number of times, CALC4 buttons). On exactly RIES's buttons, RIES -l4
  needs 1.8 CPU hours for 527 exact; the GPU finds 540 in 13.2 s, about 500 times less time (one GPU against one CPU
  core). Most of that factor is the algorithm (Phase 1), the rest the GPU.
- **The 4 October engine refactor made `mitm_cr` slower.** Phase 1's 27 s for |L|<=5, |R|<=6 on one thread predate
  the refactor for the web page (per-length right-side tables, closest-first candidates): the same run takes 55.9 s
  now (its own timers: matching 32 s instead of 11 s; the right sides are now searched in one table per length,
  six lookups per left value instead of one). 6/6: 938 s instead of 581 s. The table above compares against
  today's `mitm_cr`. Worth a look when the CPU engine is next touched.
- **What the GPU buys.** Not depth: double precision still limits a useful search to about 1e13-1e14 equations per
  constant (Phase 1), and the false positives grow beyond (125 at 6/7, tol 2). It buys time: the 5 GB table of
  |R| <= 7 in 2.2 s instead of 264 s, a whole v0 run at 5/6 in less than a second, long left sides (6/6) in 9 s.

### What was built (`algorithms/methods/mitm/gpu/`)

- `mitm_cuda.cu` -> `mitm_gpu.exe`: the search on the GPU, the same command line, input and output as `mitm_cr`
  (`run_mitm_v0.py --exe`, `summarize_mitm.py` and `test_planted.py --exe` work unchanged). Extra options:
  `--verify gpu|host` (default gpu), `--vram GB` (device memory cap, default 80 % of the free memory), `--input FILE`
  (instead of stdin; Nsight Systems does not pass stdin through), `--compare-r K` (tables against `mitm_cr`'s, see
  below). `--threads` = host threads for `--verify host`; `--list` is not supported.
- `mitm_cr.cpp` is included as a library (host side: buttons, forms, ranks, RPN output, Newton refinement of the
  closest pairs). Change to it: a macro `MITM_HD` (`__host__ __device__` under nvcc, empty otherwise) on the
  functions shared with the kernels (`un`, `dun`, `bin`, `dbin`, `digamma`, `decode`, `eval_full`, `key_of`), and
  `eval_full` became a template over the grammar type. Checked: `mitm_cr` built from the changed source gives the
  same `--bench` count (2 310 800) and the same output for all 1348 constants at 5/6 as the binary built before.
- `build_mitm_gpu.bat` (targets: default, `cpu` = icx reference, `cpucl` = MSVC reference, `fmad`, `test`, `bench`),
  `Makefile` (the same for Linux; not yet tried there),
  `run_matrix.sh` (the benchmark matrix through `run_mitm_v0.py`), `compare_v0.py` (two outputs classified at 80
  digits, every verdict that differs), `machine_info.sh`.
- `df64.h`, `gen_df64_ref.py`, `test_df64.cpp` (accuracy and GPU-host bit identity), `bench_df64.cu` (generation in
  double vs df64), `fp_rates.cu` (float vs double throughput of the GPU).
- `ries_cpu.cpp`, `ries_gpu.cu`, `ries_front.h`: the two programs with RIES's command line (section above). For
  them `mitm_cuda.cu`'s `main` was split into `gpu_setup` and `gpu_search` (compiled without `main` when
  `MITM_GPU_LIBRARY` is defined); `mitm_gpu`'s output on v0 is unchanged.

### How it works

1. **Right sides**, once: each GPU thread walks about 256 consecutive codes of one form with an odometer (only the
   changed positions are evaluated again; a prefix with an unusable value contributes nothing). Pairs (value key,
   rank) are sorted with CUB's radix sort, one code per value is kept (the lowest rank, i.e. the shortest:
   `ReduceByKey` with min), and the result is split by length. When all codes do not fit into device memory at
   once (|R| <= 7: 1.2e9 usable codes), the values are first counted per 2^20 key bins, and the codes are generated
   again for each pass over a range of bins, as in `mitm_cr`. The tables stay on the device (one chunk per pass and
   length, joined at the end).
2. **Left sides**, per length a = 1, 2, ..., for all targets still open, in batches that fit into device memory:
   generated with their derivatives and all guards of `enum_L`; kappa at the root tested before duplicates are
   dropped (the 4 October fix); sorted by value, then stably by target; duplicates dropped (lowest rank kept).
3. **Matching**, one thread per distinct left value: binary search in every table b <= bmax, the window
   |L - R| <= tol |T| |L'| walked closest first (at most maxtry). With `--verify gpu` the candidate is verified in
   the kernel with Phase 1's rules (four Newton steps, errcap from `eval_full`'s error bounds); the shortest total so
   far per target (an atomic minimum) prunes longer right sides, ties allowed. With `--verify host` the GPU only
   lists the candidates, and the host decides with `mitm_cr`'s own `Worker::newton` and `r_error`, in `mitm_cr`'s
   order.
4. **Result** per target: the shortest accepted equation; ties by error, then by `mitm_cr`'s order (length of L,
   then left value). A target leaves the batch as soon as no shorter equation is possible. For a FAILURE: the
   closest pair of every total length (with `mitm_cr`'s noise check), refined by Newton steps on the host.

**Optimizations, each measured on v0 at 6/6** (first working version 23.9 s, final 8.7 s; answers unchanged):

- Threads of a warp evaluating different buttons serialize the `switch` over 18 functions. The unit of a thread is
  now a multiple of the radices of the form's last positions, and the threads of a warp step in lockstep, so they
  apply the same button at the same time: left-side generation 15.1 s -> 2.7 s.
- Duplicate removal read the values at random positions; now the target sort carries each entry's position in the
  value order, so the reads are sequential or monotone: sort and dedup 4.2 s -> 3.5 s.
- The closest-pair bookkeeping (needed for the FAILURE lines) evaluated both sides of a pair (`mitm_cr`'s noise
  check) 31 million times on 400 targets; two cheap passes over every 4096th and every 64th left value first set
  the thresholds: 0.28 million checks, matching 3.2 s -> 2.2 s.
- The |R| <= 7 table went through host memory and back (5.8 s of 7.4 s); now it stays on the device: 2.2 s.

### Where the time goes

GPU times from the program's own timers (`_raw.txt`), v0:

| config | GPU start | right sides | left sides | sort + dedup | match + verify | total |
|---|---|---|---|---|---|---|
| \|L\|<=5, \|R\|<=6 | 0.09 s | 0.06 s | 0.19 s | 0.14 s | 0.12 s | 0.65 s |
| \|L\|<=6, \|R\|<=6 | 0.08 s | 0.06 s | 2.70 s | 3.45 s | 2.21 s | 8.56 s |
| \|L\|<=5, \|R\|<=7, tol 2 | 0.08 s | 2.24 s (gen 1.25, sort 0.33, split 0.27, join 0.10) | 0.16 s | 0.11 s | 0.21 s | 2.84 s |
| RIES's buttons, anyx, 7/7 | 0.08 s | 0.04 s | 2.92 s | 8.13 s | 1.90 s | 13.1 s |
| \|L\|<=6, \|R\|<=7, tol 2 | 0.08 s | 2.24 s | 2.81 s | 3.02 s | 2.54 s | 10.7 s |

- The **sort** of the left values dominates the long runs (64-bit radix sort, 8 passes over 12 bytes per value). With
  RIES's buttons and x any number of times, 12.9e9 left values reduce to 2.6e9 distinct ones: most of the sort
  moves duplicates. A cheaper pre-deduplication would pay off there.
- **Peak device memory** is the cap (11.7 GB): the left-side batch buffers take whatever remains. The right-side
  build itself peaks at 9.9 GB for |R| <= 7 (5.0 GB of tables).
- **Generation is not limited by the FP64 rate.** The RTX 5080 runs double 45-109 times slower than float
  (`fp_rates.cu`: FMA 0.40 vs 28.4 Tflop/s, exp 23.6 vs 2567 G/s, log 13.0 vs 1094, sin 20.3 vs 910), but the
  lockstep odometer evaluates mostly one cheap node per code: 9.6e9 right-side codes per second in double.

### Differences from `mitm_cr`, and why

Verdicts, all constants, `compare_v0.py` (80-digit classification of both outputs):

| config | different verdicts | same equation |
|---|---|---|
| 4/5, 5/6, anyx 5/6, 5/7 tol 2 | 0 | 93-95 % |
| 6/6 | 3: two chance matches of the CPU that the GPU does not find (762, 915), one the other way (1040) | 92 % |
| RIES's buttons, anyx, 7/7 | 1: constant 248 exact on the GPU, not found on the CPU | 93 % |
| 6/7, tol 2 | 28, all chance matches of total length 13: 15 only on the GPU, 13 only on the CPU | 88 % |

The other answers have another equation of the same total length and the same verdict: among equations of equal
length, `mitm_cr` reports the one with the smallest error, and for exact identities that error is 0 to 1 ulp, so
the choice follows the last bit of the library functions. The two CPU builds differ from each other just as much
(icx vs MSVC at 5/6: 196 different equations, 0 different verdicts; GPU vs MSVC: 92).

**The cause: CUDA's math library.** Arithmetic and sqrt are IEEE on both sides and agree bit for bit; the library
functions do not. All 3.2 million right sides of length <= 5, evaluated node by node on the GPU and on the host
(MSVC), first node that differs (`mitm_gpu --compare-r 5`):

| function | calls rounded differently | function | calls rounded differently |
|---|---|---|---|
| GAMMA | 35 % | COSH | 18 % |
| TAN | 29 % | SINH | 15 % |
| ARCTAN | 26 % | COS | 15 % |
| ARCSINH | 20 % | POWER | 14 % |
| SIN | 11 % | ARCSIN | 4.5 % |
| TANH | 2.9 % | EXP | 2.4 % |
| ARCTANH | 2.4 % | ARCCOS, ARCCOSH | 1.6-1.7 % |
| LOG | 0.16 % | + - * / sqrt 1/x x^2 | 0 |

Almost all by 1 ulp, some by 2. The tables (`--compare-r`, length 6): 20 263 185 distinct values on the host,
20 436 993 on the GPU, 13.2 million with the same value and code, 0.3 million with the same value but another
code. Notable: CUDA's `tgamma(4)` is 5.9999999999999991, not 6 (MSVC's `tgamma(8)` is
5040.0000000000009). So the GPU's tables hold 0.9 % more distinct values (codes that coincide on the CPU, like
Gamma(4) and 6, do not on the GPU), and the `--bench` count is 2 335 894 pairs instead of 2 310 800 (+1.1 %).

**Planted formulas** (`test_planted.py`, 210 formulas of length 3-9, 5/6): GPU 189 retrieved, CPU 191. The two
extra misses are tan(sinh 5) and arccos(sin(sinh 4)): trigonometric functions of 74 and 27, where a 1-2 ulp error
of CUDA's `sinh` or `sin` is amplified beyond the tolerance (icx's library happens to stay within it there).
Known identities (pi, e, the lemniscate constant; with `--anyx` the Dottie number and the omega constant): the same
equations on both.

**GPU vs host verification** (`--verify host`: the host decides on the GPU's candidates): the same verdicts up to
the false positives at the precision limit (6/6: 557 / 50 vs 557 / 51; 6/7 tol 2: 569 / 111 vs 570 / 125), and
no difference in time (the host verifies 1e5-1e6 candidates per run in milliseconds).

**FMA contraction** (`build_mitm_gpu.bat fmad`): identical answers for all 1348 constants at 5/6 and 6/6, the same
speed, `--bench` 2 335 892 instead of 2 335 894. The default stays `--fmad=false`.

**By design:** duplicate left values are dropped per batch (`mitm_cr`: per chunk of 2^20 values), so fewer left
values are matched (6/6: 3.2e9 instead of 4.6e9); the candidate count follows the GPU's order and the race of the
pruning (it varies by a few between runs; the equations do not); "ms" per constant is the batch time divided by the
number of constants.

### df64 (for Metal and WebGPU)

`df64.h` is written in the common subset of C++17, CUDA and the Metal Shading Language, with only +, -, *, fma,
floor and comparisons (division and square root by Newton steps from bit-level estimates, since a float division
need not be correctly rounded on every GPU). Accuracy on 2000 random arguments per function plus points near 0, 1,
the multiples of pi/2 and the poles, against 40-digit mpmath references (`gen_df64_ref.py`), in units of
u = 2^-48 (`test_df64.exe`):

| function | max | 99.9 % | median | function | max | 99.9 % | median |
|---|---|---|---|---|---|---|---|
| add | 1.3 | 1.3 | 0.09 | asin | 3.3 | 3.1 | 0.40 |
| sub | 1.5 | 1.3 | 0.08 | acos | 5.4 | 2.6 | 0.36 |
| mul | 2.3 | 2.0 | 0.22 | atan | 2.1 | 1.5 | 0.24 |
| div | 1.1 | 1.1 | 0.18 | sinh | 2.2 | 1.9 | 0.18 |
| sqrt | 4.2 | 3.6 | 0.22 | cosh | 1.9 | 1.4 | 0.17 |
| exp | 1.3 | 1.1 | 0.14 | tanh | 3.4 | 3.0 | 0.13 |
| log | 4.3 | 2.4 | 0.17 | asinh | 2.5 | 2.3 | 0.22 |
| sin | 2.8 | 1.8 | 0.13 | acosh | 4.4 | 3.4 | 0.27 |
| cos | 2.0 | 1.5 | 0.13 | atanh | 3.3 | 2.3 | 0.23 |
| tan | 2.7 | 2.0 | 0.31 | pow | 74 | 67 | 2.1 |
| gamma | 61 | 50 | 8.1 | digamma | 353 | 107 | 0.33 |

- Arithmetic within 4 u and all functions but three within 6 u: the plan's goals (4 u, 16 u) are met there.
  sin, cos, tan include arguments within 1e-8 of a multiple of pi/2 (10 % of their cases): pi/2 is split into five
  floats (90 bits) for the reduction; with four (66 bits) the error near the zeros was up to 213 u.
- pow and gamma: exp amplifies the absolute error of its argument, so the error of pow is about |s log t| u. Gamma
  evaluates Stirling's series only on [10, 11) and reaches it by the recurrence from both sides, so |log Gamma|
  stays below 16 there (evaluated directly at x = 33 it was e^83 and 236 u). digamma: largest near its zeros.
- **Bit identity:** the same 44 000 cases in a CUDA kernel give results bit-identical to the host, and the icx and
  MSVC builds give bit-identical results too (`test_df64_cuda.exe`, `build_mitm_gpu.bat test`). The Metal run of
  the same test is the first step on the Mac.

**df64 is not faster than double on the RTX 5080** (`bench_df64.cu`, right-side generation, counting usable values):
|R| <= 6: double 9.6e9 codes/s, df64 6.9e9 (0.72 times); |R| <= 7: 11.6e9 vs 8.7e9 (0.76). The generation is not
FP64-bound (see above), and the df64 functions are long and branchy. So `--num df64` was not built into `mitm_gpu`
for CUDA; on data-center GPUs (FP64 at half rate) double wins even more clearly.

What df64 costs in values:

- right sides of length <= 6: 3.3 % of the usable ones are lost (out of df64's range, or trigonometric arguments
  beyond 1608), 3.9 % at length <= 7;
- left sides of length <= 5 (x once, before the guards) at all v0 targets: 1.5 % (`bench_df64 --kl 5 --left FILE`);
- right sides usable in both: 59 % agree with double within 1 u, 89 % within 16 u, 0.9 % differ by more than
  2^20 u (ill-conditioned codes, where double is not accurate either).

For Metal and WebGPU this confirms the plan: candidates from the GPU with a window wider than the final
tolerance, acceptance in double precision on the host.

### Next steps (suggestions)

- Metal backend on the Mac: run `test_df64` in a Metal kernel first (bit identity), then the kernels of
  `mitm_cuda.cu` with df64 values (derivatives `dun`/`dbin` in df64 still to write) and host verification.
- A cheaper deduplication of left values (most of the sort moves duplicates with x any number of times).
- Find out where `mitm_cr` lost half of its single-thread speed in the 4 October refactor (matching 11 s -> 32 s at
  5/6), and win it back.
- The out-of-scope items of the plan: weighted complexity, `--list`, right sides beyond device memory (|R| = 8).

### Files

`algorithms/methods/mitm/gpu/`: `mitm_cuda.cu`, `ries_cpu.cpp`, `ries_gpu.cu`, `ries_front.h`, `build_mitm_gpu.bat`,
`Makefile`, `run_matrix.sh`, `compare_v0.py`, `machine_info.sh`, `df64.h`, `gen_df64_ref.py`, `test_df64.cpp`,
`bench_df64.cu`, `fp_rates.cu`; binaries (`mitm_gpu.exe`, `ries_cpu.exe`, `ries_gpu.exe`, `mitm_cr_ref.exe`,
`mitm_cr_ref_cl.exe`, test programs) and `df64_ref.txt` (made by `gen_df64_ref.py`) are build outputs, not in git. Results:
`benchmark/results/v0_mitm_win5080_{cuda,cuda_vhost,cpu1,cpu12}_<config>.tsv` and `_raw.txt`.
