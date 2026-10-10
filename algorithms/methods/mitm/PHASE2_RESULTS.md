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

## m3: MacBook Pro, Apple M3 Max, Metal (2026-10-04)

The Metal backend of the plan, built and measured in one night, with the CPU baseline on the same machine. Apple GPUs
have no double precision, so the GPU computes in df64 (pairs of floats, `df64.h`) and only finds candidates; every
decision is taken in double precision on the host, with `mitm_cr`'s own code.

### Machine

- CPU: Apple M3 Max, 14 cores (10 performance, 4 efficiency), 36 GB unified memory; macOS 26.6.2
- GPU: Apple M3 Max, 30 cores, Metal 4 (family Apple9); recommended working set 28.1 GB, largest buffer 21 GB
- Compiler: Apple clang 21.0.0, Command Line Tools only (no Xcode): `-O3 -std=c++17 -ffp-contract=off`; the kernels
  are compiled at run time (`MTLMathModeSafe`, precise library functions, no FMA contraction)
- CPU reference: `mitm_cr_ref` (`make cpu`), Apple's libm

### The answer

**On benchmark v0 the Apple GPU gives the same verdicts as `mitm_cr` in four of the seven configurations and differs
by at most 1 exact identification in the other three; it is 10 to 16 times faster than one CPU core, but only 1.2 to
3.0 times faster than all 14 cores of the M3 Max.** All 1348 constants with >= 17 digits, one process per run, wall
time from process start to end (after the tuning of 5 October, section "Tuning"):

| config | exact / false pos., Metal | exact / false pos., CPU | Metal | CPU, 1 thread | CPU, 14 threads | Metal vs 1 thread | Metal vs 14 threads |
|---|---|---|---|---|---|---|---|
| \|L\|<=4, \|R\|<=5 | 444 / 3 | 444 / 3 | 0.2 s | 0.9 s | 0.3 s | 4.5 | 1.5 |
| \|L\|<=5, \|R\|<=6 | 532 / 8 | 532 / 8 | 2.3 s | 24.2 s | 2.8 s | 10 | 1.2 |
| \|L\|<=5, \|R\|<=6, x any number of times | 550 / 8 | 550 / 8 | 2.4 s | 23.4 s | 2.8 s | 10 | 1.2 |
| \|L\|<=6, \|R\|<=6 | 557 / 51 | 557 / 53 | 29.6 s | 442 s | 66.7 s | 15 | 2.3 |
| \|L\|<=5, \|R\|<=7, tol 2 eps | 547 / 9 | 548 / 9 | 16.0 s | 158 s | 22.5 s | 10 | 1.4 |
| RIES's buttons, x any number of times, \|L\|<=7, \|R\|<=7 | 539 / 8 | 539 / 8 | 40.6 s | 659 s | 94.7 s | 16 | 2.3 |
| \|L\|<=6, \|R\|<=7, tol 2 eps | 568 / 121 | 569 / 125 | 46.2 s | not run | 138 s | - | 3.0 |

(Tags `m3_metal_*`, `m3_cpu1_*`, `m3_cpu14_*` in `benchmark/results/`; the CPU gives the same counts on 1 and 14
threads. The CPU numbers equal Windows' except 6/6, 557 / 53 instead of 557 / 52, and 6/7, 569 / 125 instead of
570 / 123: Apple's libm. `--bench` counts 2 308 910 pairs here, 2 310 800 with icx, 2 310 973 with MSVC. The kernels
are compiled for the longest left and right sides of the run, so the first run of a new pair of lengths, or after a
change of the kernels, takes up to 1.2 s longer: Metal compiles them then, later runs use its cache. The times above
are of such later runs.)

- **The same answers.** 4/5, 5/6, anyx 5/6 and RIES's buttons 7/7: no constant changes its verdict. The rest differ
  by 1 exact identification and a few chance matches of the CPU, all for one reason (section "Differences" below).
- **The M3 Max CPU is fast.** One core runs `mitm_cr` 2.3 times faster than one core of the Ryzen 9 5900X (5/6:
  24.2 s against 55.9 s), and 14 cores finish 5/6 in 2.8 s (Ryzen, 12 threads: 6.1 s). Against that, the GPU wins
  clearly only where the left sides are long (6/6, 7/7, 6/7: 2.3 to 3.0 times).
- **Against the RTX 5080** (CUDA, double precision, section win5080): the RTX is 3.1 to 5.5 times faster (5/6: 0.7 s
  against 2.3 s; 6/6: 8.7 s against 29.6 s; 6/7: 10.8 s against 46.2 s). The Mac's GPU computes everything in df64
  (exp is 75 times slower than float, see below), and the right-side table needs a pass on the host.

### What was built (`algorithms/methods/mitm/gpu/`)

- `mitm_metal.mm` (host, Objective-C++) and `mitm_kernels.metal` (kernels) -> `mitm_metal`: the search, with the
  command line, input and output of `mitm_cr` (`run_mitm_v0.py --exe`, `compare_v0.py`, `run_matrix.sh` work unchanged).
  Extra options: `--vram GB` (cap of the GPU buffers, default 60 % of the recommended working set, at most `--memcap`),
  `--verify gpu` (decisions in df64 alone, below), `--tol-u`, `--margin`, `--cw`, `--cand-max`, `--df64-stats`,
  `--input FILE`. `mitm_cr.cpp` is included as a library, unchanged except one line (below).
- `ries_metal.mm` -> `ries_metal`: the RIES-like program (`ries_front.h`) on the GPU, as `ries_gpu`.
- `df64_ops.h`: the buttons of `mitm_cr` in df64 (values, derivatives, error bounds), shared by the kernels and the host;
  `mitm_metal_shared.h`: data layouts of host and kernels; `metal_ctx.h`: device, buffers, dispatches;
  `embed_metal.sh`: the kernel sources as one string in the binary (no file next to it is needed).
- `df64_apply.h` and the `DF64_METAL_TEST` part of `test_df64.cpp` -> `test_df64_metal`: the df64 tests in a Metal
  kernel; `fp_rates_metal.mm`: float and df64 throughput of the GPU.
- `Makefile`: `make metal` (`mitm_metal`, `ries_metal`), `make test` (adds `test_df64_metal --ftz` on macOS),
  `make fp_rates_metal`.

Changes to existing files: `mitm_cr.cpp`: peak memory on macOS in the right unit (`ru_maxrss` is in bytes there, in
kilobytes on Linux; it printed "517 GB"); `df64.h`: the host-only `df_to_double` hidden from Metal (`double` does not
compile there); `test_df64.cpp`: the function table moved to `df64_apply.h`, the Metal run added;
`benchmark/depth/monitor.py`: the responsiveness probe runs `true` outside Windows (it ran `cmd /c exit`, so
`run_mitm_v0.py` failed on macOS).

### How it works

The pipeline is `mitm_cuda.cu`'s, with df64 values on the GPU and the decisions on the host:

1. **Right sides.** Generated on the GPU in df64 (lockstep odometer, as CUDA), sorted, one entry per df64 value (the
   lowest rank), split by length; passes over value ranges when everything does not fit (|R| <= 7: 5 passes under
   the 14.4 GB cap). Then the host evaluates every entry in double with `mitm_cr`'s buttons (sorted by rank, so that
   neighbouring codes share their prefix, as the odometer) and stores the difference c = double value - df64 value as a
   float: the kernels compare with df64 value + c, i.e. with `mitm_cr`'s own values. As `mitm_cr`, one code per double
   value is kept: an entry whose double value is that of a code of lower rank (shorter, or of the same length) is
   dropped. Entries whose double value is more than 32 u from their df64 value (7-9 % of them: Gamma, powers, chains
   of exp) go to a side table per length, sorted by the double value, which the kernels search as well.
2. **Left sides.** Per length, all open targets in batches: df64 values and derivatives with `enum_L`'s guards,
   corrected for the rounding of T to df64 (L(T) = L(Tdf) + L'(T - Tdf)), and two error bounds: one of the df64
   rounding (for the window) and `mitm_cr`'s own double-precision bound (`eval_full`'s rule, in float), sorted by value
   and target, one entry per (target, df64 value).
3. **Matching.** Per distinct left value and right length: every right side with |L - R| <= tol |T| |L'| + 2 E (mitm_cr's
   window, widened by the df64 error bound E of L) is a candidate for the host. A left value whose double-precision
   error bound alone exceeds errcap gets none: `mitm_cr` would try its candidates and reject them all
   (`atanh(tanh(x))` at large x had windows of thousands of entries before this rule). At most 256 candidates per
   left value and length, closest first (reached 78 times at 5/6, 55 740 times for RIES's buttons 7/7; no verdict
   depends on it).
4. **Decisions** on the host, per target, as `mitm_cr`'s `flush` and `match_length` would take them: each left value
   re-evaluated in double with all guards, duplicates of a double value dropped, per length the candidates inside
   `mitm_cr`'s window, closest first, at most maxtry, Newton steps, errcap (`Worker::newton`, `r_error`). The GPU passes
   the host 3 000 (4/5) to 14 million (RIES's buttons 7/7) candidates, of which it tries 1 350 to 3 900 (`mitm_cr` tries
   1 400 to 610 000, mostly of left values whose candidates errcap rejects: the "candidates" column of the output
   differs for that reason).
5. **Closest pairs** (FAILURE lines, the listing of `ries_metal`): per (target, total length) on the GPU with `mitm_cr`'s
   noise check (its error bounds, one byte per right side), near ties included, then decided in double on the host
   in `mitm_cr`'s order, and refined by Newton steps as `mitm_cr`. The slot of a (target, length) holds an upper
   bound of the distance (df64 distance + margin E), lowered only by pairs that pass the noise check for sure; a pair
   is recorded when its lower bound reaches the slot. So the host sees every pair that can be the closest in double,
   whatever the order of the threads or the batches. (Until 5 October a doubtful pair could lower the slot and hide a
   sure one, and the FAILURE lines changed from run to run in a few cases.)
6. **Own primitives:** a stable LSD radix sort of (64- or 32-bit key, 32-bit value) with 8-bit digits (tiles reordered
   in threadgroup memory before the scatter; equal digits ranked with SIMD ballots): 100 million pairs in 0.18 s;
   prefix sums; compactions. Atomics only 32-bit.

### Differences from `mitm_cr`, and why

Verdicts that differ (`compare_v0.py`, 80-digit classification of both outputs):

| config | different verdicts | same equation |
|---|---|---|
| 4/5, 5/6, anyx 5/6, RIES's buttons 7/7 | 0 | 87-97 % |
| 6/6 | 2: chance matches of the CPU (454, 915) not found | 95 % |
| 5/7, tol 2 | 1: 248 (Rayleigh kurtosis excess) exact on the CPU, not found | 87 % |
| 6/7, tol 2 (CPU on 14 threads) | 5: 248 as above; 4 chance matches of the CPU not found (194, 290, 576, 720) | 85 % |

**The cause: two codes with the same df64 value and different double values.** A df64 value has 48 bits, a double 53,
and the GPU keeps one code per df64 value. 248: `x atan(tan 4) = acos(cos(8 / asin(cos 2)))` is the CPU's equation;
on the GPU, `acos(cos(...))` has the same df64 value as `asin(sin(...))` of lower rank, which is kept, but in double
their values differ by 1.5 windows of tol 2 eps. 454 (a chance match): `cos(5) tanh(e^e)` has the same df64 value as
`cos(tan(atan 5 + pi))`, whose df64 value is 40 u off. Keeping the two lowest codes per df64 value would remove most
of these cases at the cost of a larger table (not tried; at |R| <= 7 memory is already the limit).

The other answers that are not the same equation have another equation of the same length and the same verdict, as
between the CPU builds of Windows.

**Planted formulas** (`test_planted.py`, 210 formulas of length 3-9, 5/6): 189 retrieved by both, the same counts per
length (the RTX 5080 missed two more there, through CUDA's math library; here every decision is taken with the CPU's
libm). **Known identities** (pi, e, the lemniscate constant; with `--anyx` the Dottie number and the omega constant):
the same equations as `mitm_cr`.

**What the GPU's tables miss.** At |R| <= 6 the search on the GPU sees 19 950 984 distinct right values, 6.4 % fewer
than `mitm_cr`'s 21 307 215: 3.4 % are not usable in df64 (2.1 % sin, cos or tan of arguments beyond 1608, 1.3 %
magnitudes above 3.4e38 or below 2^-76 = 1.3e-23; `mitm_cr`'s table evaluated in df64), the other 3.1 % are codes
merged with another code of the same df64 value (above). Duplicate left values are dropped per batch.

### df64 on Metal

- **Bit identity.** The 44 000 cases of `test_df64` in a Metal kernel give results bit-identical to the CPU when the
  CPU flushes subnormal floats to zero as well (`test_df64_metal --ftz`, which sets the FZ bit of the ARM FPCR):
  0 of 44 000 differ. Without it, 59 differ (sqrt 6, exp 2, gamma 51), every one through an intermediate or a low
  part below 2^-126. So the Apple GPU computes IEEE float arithmetic with flush-to-zero, in the safe math mode, and the
  pragma against FMA contraction works.
- **Accuracy:** the table of the win5080 section holds for the GPU, except for results below about 1e-30, whose low
  part is flushed: there exp and gamma lose up to 2^-30 relative. Hence the usable range on Metal starts at 2^-76
  (instead of 2^-100): the low part keeps 2^-50 relative there. A result flushed to zero is unusable unless zero is
  exact (exp(-100) = 0 in df64).
- **Buttons in df64** (`df64_ops.h`): x^n for integer |n| <= 64 by repeated squaring (2^3 = 8 exactly, as the C
  library; exp(s log t) is a few u off), Gamma of the integers 1..21 exact; SINPI, COSPI, TANPI as `mitm_cr`'s
  sin(M_PI a) with the double M_PI, 1.2e-16 below pi (sinpi(1) = 1.2e-16, tanpi(1/2) = 1.6e16), to first order.
- **df64 against double** (`--df64-stats`, right sides usable in both):

  | \|df64 - double\| / \|double\|, in u = 2^-48 | < 1 | 1-4 | 4-16 | 16-64 | 64-256 | 256-4096 | 4096-2^20 | >= 2^20 |
  |---|---|---|---|---|---|---|---|---|
  | length <= 6 (21.8 M) | 53.2 % | 22.1 % | 12.6 % | 6.8 % | 2.5 % | 1.8 % | 0.7 % | 0.3 % |
  | length <= 7 (456 M) | 48.9 % | 22.8 % | 13.9 % | 7.8 % | 3.2 % | 2.3 % | 0.9 % | 0.3 % |

  So a fixed window of a few u around the df64 values would lose 10-20 % of the right sides: the double values from the
  host (or side tables) are needed.
- **Throughput** (`fp_rates_metal`, dependent chains, 2^20 threads):

  | operation | float, G/s | df64, G/s | float / df64 |
  |---|---|---|---|
  | fma (df64: mul + add) | 577 | 147 | 3.9 |
  | exp | 577 | 7.7 | 75 |
  | log | 456 | 7.1 | 65 |
  | sin | 177 | 10.5 | 17 |
  | 1/x | 426 | 34 | 12 |
  | sqrt | 321 | 51 | 6.3 |

### What a GPU without double decides alone (`--verify gpu`)

What WebGPU gets without a WebAssembly verifier: the df64 table as generated (no double values, no side tables),
candidates inside tol-u u, accepted by Newton steps and error bounds in df64 on the GPU:

| config | --verify host (= mitm_cr) | gpu, tol 1 u | 2 u | 4 u | 8 u | 16 u | 2 u, errcap 16x |
|---|---|---|---|---|---|---|---|
| 4/5 | 444 / 3 | | 425 / 3 | | | | |
| 5/6 | 532 / 8 | 506 / 11 | 506 / 15 | 507 / 20 | 511 / 32 | 515 / 50 | 516 / 15 |

df64 alone loses 3-5 % of the identifications and gains false positives; a wider tolerance buys few identifications
for many false positives. Of the 26 identifications lost at 5/6, 24 contain Gamma, whose df64 values are tens of u off
(even e^x = Gamma(3/2), constant 289); errcap 1.6e-11 (16 times larger, as the df64 error bounds) recovers 10 of them.

### Where the time goes

Timers of `mitm_metal` (`_raw.txt`):

| config | right sides (GPU / host) | left sides | sort + dedup | match | host decisions | total |
|---|---|---|---|---|---|---|
| \|L\|<=5, \|R\|<=6 | 0.54 s (0.18 / 0.36) | 0.59 s | 0.54 s | 0.57 s | 0.02 s | 2.3 s |
| \|L\|<=6, \|R\|<=6 | 0.54 s | 7.86 s | 12.97 s | 7.98 s | 0.13 s | 29.5 s |
| \|L\|<=5, \|R\|<=7, tol 2 | 13.69 s (gen 2.7, sort 1.8, split 0.9; double values 7.9) | 0.52 s | 0.41 s | 1.20 s | 0.02 s | 15.9 s |
| RIES's buttons, anyx, 7/7 | 0.25 s | 6.53 s | 25.42 s | 7.18 s | 1.11 s | 40.5 s |
| \|L\|<=6, \|R\|<=7, tol 2 | 13.92 s | 7.86 s | 9.91 s | 14.21 s | 0.14 s | 46.1 s |

- The **sort of the left values** dominates the long runs, as on CUDA (12.8e9 left values for RIES's buttons 7/7; the
  sort runs at about 1.7 ns per value, 8 passes of 8 bits over 12 bytes, about 150 GB/s). A cheaper deduplication
  first would pay off.
- The **right-side table of |R| <= 7** takes 13.8 s (CPU, 14 threads: 17.6 s; RTX 5080: 2.2 s): the double values of
  457 million entries on the host (values 1.0 s, the bounds kernel and rank sorts 2.1 s, duplicates and side tables
  2.3 s), and five passes because of the memory cap. Peak memory 15.0 GB (unified: host and GPU together).
- The **host decisions** are cheap (0.02-1.1 s): the double precision costs the Mac little time, the df64 arithmetic
  of the generation and the window search cost more.

### Tuning (5 October)

Profiled with Instruments (Xcode 27; `xctrace record` with a template of Metal System Trace and the "Performance
Limiters" counter set, made once in the GUI; every counter sample attributed to the kernel running at its time).
6/6 on the first 300 constants of v0, before:

| kernel | GPU time | occupancy (target) | ALU | limiter |
|---|---|---|---|---|
| `k_gen_l` (left sides) | 2.82 s | 17 % (25 %) | 28 % | F32 40 %, instruction issue 37 %; registers spilled to L1 (L1 register residency 56 %) |
| `k_match` | 1.50 s | 32 % (39 %) | 27 % | instruction issue 57 %, integer 43 % |
| `k_rs_scatter2_64` (sort) | 1.27 s | 25 % (95 %) | 11 % | threadgroup launch 99 % |
| no kernel running (host waits) | about 20 % of the samples | | | |

The Apple GPU allocates registers per thread at launch: `k_gen_l` ran at 17 % occupancy and spilled registers to L1
(its df64 state: value, derivative and two error bounds per node, for MAXK = 12 nodes), the sort and the matching
waited for the host between short command buffers. Three changes, none of which changed a result (output identical to
a reference build after each step):

1. The `--verify gpu` branch of `k_match` moved to its own kernel `k_match_verify`, the window statistics only with
   `MITM_METAL_CHECK`: fewer registers in `k_match`.
2. The kernels are compiled for the longest sides of the run (`MM_LK` = `--kl`, `MM_RK` = `--kr`, prepended to the
   source) instead of MAXK = 12, and read the forms from device memory instead of copying them: 6 instead of 12 nodes
   at 6/6.
3. Fewer host waits: per left-side batch, the generation is one command buffer, and keys, both sorts, deduplication,
   prefix sum and compaction another (all radix passes encoded at once, the sizes from the generation's counters);
   matching in ranges of 2^20 distinct left values per dispatch instead of 2^18.

After (same run): `k_gen_l` 2.13 s (occupancy hardly higher, 18 %, target 27 %, but half the spills: L1 register
residency 31 %), `k_match` 1.26 s (197 GB/s read instead of 156), the sort unchanged, no kernel running in about 10 %
of the samples. Whole v0 runs: 5/6 2.5 -> 2.3 s, 6/6 35.7 -> 29.6 s, RIES's buttons 7/7 46.8 -> 40.6 s, 6/7
51.8 -> 46.2 s.

What did not help: smaller sort tiles (1024 instead of 2048 elements per threadgroup: the same 1.71 ns per element,
200 million pairs alone and in the run), `noinline` on the df64 buttons (slower). The left-side generation stays at
an occupancy target of 27 %, set by its registers; the sort now runs at its stand-alone rate, so the next gain there
is fewer elements (a deduplication before the sort) or fewer bits per key, not tuning.

The same day also fixed the closest pairs (section "How it works", item 5) and one bound: `mitm_cr`'s error bound of
a power with a negative base is NaN (`eval_full` multiplies the exponent's error by log t), so `mitm_cr` treats such a
left side as noisy; the kernels now do the same (`cpu_bound_nan`). With both, the output equals `mitm_cr`'s (same
equation and result) for 16 more constants at 5/6 and 42 more with RIES's buttons 7/7, all FAILURE lines; no verdict
changed (`compare_v0.py` of the runs before and after: 0 different verdicts in every configuration; the `--verify gpu`
runs identical).

### `ries_metal` against `ries_cpu` and RIES

zeta(3) = 1.2020569031595942 (no known closed form, every level runs to the end), RIES's default symbols:

| level | RIES (1 core) | ries_cpu, 1 thread | ries_cpu, 14 threads | ries_metal | left/right symbols |
|---|---|---|---|---|---|
| -l2 | 0.16 s | 0.10 s | 0.18 s | 0.09 s | 5/5 |
| -l3 | 0.79 s | 0.25 s | 0.26 s | 0.08 s | 6/5 |
| -l4 | 3.8 s | 0.66 s | 0.36 s | 0.15 s | 6/6 |
| -l5 | 21.8 s | 3.5 s | 3.3 s | 0.56 s | 7/6 |
| -l6 | 117 s | 13.7 s | 5.1 s | 1.9 s | 7/7 |
| -l7 | 285 s | 13.7 s | 5.2 s | 1.8 s | 7/7 |

(RIES: the `ries` binary in `gpu/`, wall time; `ries_cpu` and `ries_metal`: the times they print, process start to end.
One M3 Max core runs RIES 1.3 times faster than the Ryzen.)

**The listings** of `ries_metal` and `ries_cpu` (the lines of equations) are identical in 13 of 18 checks (zeta(3) at
-l2 to -l6; -l4 for pi, e, ln 2, sqrt 2, alpha, 1/alpha, Catalan, pi^2/6, the Dottie number, the omega constant, Euler's
gamma, Feigenbaum's delta and 1.3063778838630806, all to 16-17 digits; alpha = 0.0072973525693, 1/alpha =
137.035999084). Rerun after the tuning; a build with the closest-pair logic of 4 October gives the same listings in
the cases that differ. The five others:

- zeta(3) at -l5 and -l6: `ries_cpu` stops at `atan2(atan2(x,e^(e^6)),x) = 1/e^(e^6)` ('exact', 11 symbols), which
  holds for every x (e^(e^6) = 1e175: atan2(x, 1e175) = x / 1e175 to double precision); e^(e^6) is outside df64's range,
  so `ries_metal` lists three more approximations instead (at -l6 it ends with a chance 'exact' match of 14 symbols,
  4.8e14 equations, beyond the precision limit). At -l5 one line has another equation of the same size and distance
  (`5^((e-2)"/x) = 8` against `((2-e)"/x)"/5 = 8`).
- 1/alpha, Euler's gamma and 1.3063778838630806 at -l4: one or two lines show another equation of the same size and
  the same distance to 6 digits (`tanpi(log_(e^8)(x))^2` against `tanpi(ln(8"/x))^2`, `8-4"/7` against
  `8-sqrt(sqrt(7))`, `tanpi(x"/pi-3)` against `tanpi(x"/pi-2)`): two codes with the same df64 value and different
  double values, as in "Differences". (ln 2 to 8 digits, 0.69314718, gives one line more of that kind.) For
  1.3063778838630806 `ries_metal` also misses `phi-e^(-x) = atan2(e,1/phi)` (size 9, 4.7e-10) and lists a worse
  equation of size 9 and one of size 10 instead; not investigated.

The "values" counts of the two programs differ: `ries_cpu` counts distinct left values per chunk of 2^20 codes, so a
value that recurs in several chunks counts several times; `ries_metal` counts per batch.

### Recommendations for the WebGPU phase

- **df64 on the GPU, decisions in double (WebAssembly) works**: on Metal it gives `mitm_cr`'s verdicts. The verifier
  needs (a) the double values of the right sides, one evaluation per table entry (21 million at |R| <= 6, 0.35 s on 14
  cores here), (b) the candidates of the GPU (28 000 for all of v0 at 5/6), and (c) `mitm_cr`'s decisions per target. Without (a), a fixed window around the df64 values misses 10-20 % of the
  right sides (table above).
- Apple GPUs flush subnormal floats (so WebGPU on them will too, not checked elsewhere): the usable range
  [2^-76, 3.4e38] of `df64_ops.h` keeps df64 accurate there.
- Without a verifier, 3-5 % fewer identifications and more false positives (v0, above); almost all the lost ones
  contain Gamma, so a more accurate df64 Gamma is the first thing to improve.
- The browser will be limited by the left-side sort and by memory: |R| <= 6 needs 0.33 GB of tables plus left-side
  batches; |R| <= 7 (6.8 GB) is out of reach.

### Files

`algorithms/methods/mitm/gpu/`: `mitm_metal.mm`, `mitm_kernels.metal`, `mitm_metal_shared.h`, `metal_ctx.h`,
`df64_ops.h`, `df64_apply.h`, `embed_metal.sh`, `ries_metal.mm`, `fp_rates_metal.mm`; changed: `Makefile`,
`test_df64.cpp`, `df64.h`, `ries_front.h` (comments), `../mitm_cr.cpp` (one line), `benchmark/depth/monitor.py`. Build
outputs, not in git: `mitm_metal`, `ries_metal`, `test_df64_metal`, `test_df64`, `fp_rates_metal`, `mitm_cr_ref`,
`df64_ref.txt`, the generated `mitm_kernels_src.h` and `df64_metal_src.h`. Results: `benchmark/results/v0_mitm_m3_{metal,cpu1,cpu14}_<config>.tsv` and `_raw.txt`;
`v0_mitm_m3_metal_vgpu_*` (`--verify gpu`). The tools need only the Command Line Tools; `run_mitm_v0.py` needs
`psutil` (`pip install psutil`).
