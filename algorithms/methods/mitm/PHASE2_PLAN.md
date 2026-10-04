# Phase 2: the meet-in-the-middle search entirely on the GPU, run from the shell

Instructions written 2026-10-04 for sessions on other machines that start fresh: an **Apple M3 Mac** (Metal)
and later a **Linux machine with a GPU** (CUDA). Read this file and `PHASE1_RESULTS.md` completely before
starting. The program is a command-line tool, like `mitm_cr`: no web page, no GUI.

## The question to answer

How much faster is the Phase 1 search (`mitm_cr.cpp`) when all of its work runs on a GPU, on (a) an NVIDIA GPU
with CUDA and native double precision, and (b) an Apple M3 with Metal, which has **no double precision at all**,
and do the answers stay the same? Measured on benchmark v0 against `mitm_cr` built and run **on the same
machine**.

What the GPU can and cannot buy, from Phase 1:

- **Not depth.** Double precision limits a useful search to about 1e14 equations per constant (|L| + |R| <= 12
  for CALC4); beyond it chance matches take over. The CPU already gets there in minutes.
- **Time where the CPU is slow:** the right-side table of |R| <= 7 (197 s on one thread, 26 s on 12; of it
  generation 119 s, sort 50 s), long left sides (|L| <= 6: 0.43 s per constant on one thread, 9.7 min for v0),
  the largest run (|L| <= 6, |R| <= 7: 4.7 min on 12 threads), batches of many targets, interactive use with
  big tables.
- **The browser later (phase 3).** WebGPU has no double precision either. The double-float arithmetic and the
  design "GPU finds candidates, double precision accepts them" built for Metal here carry over to WebGPU with a
  WebAssembly verifier.

## What exists

- `mitm_cr.cpp`: the reference implementation (CLI, grammar by name, valid forms and ranks, guards, output).
  Compiled with `#define MITM_LIBRARY` it is a library without `main` (`mitm_wasm.cpp` uses it that way). Its
  rules are specified in `PHASE1_RESULTS.md` ("How it works", "Guards", "Engine changes for the web page").
- `mitm_bench.cu`: double-precision generation, thrust radix sort and vectorized binary search on the GPU
  (shared grammar). Matching step only: 7/7 in 0.10 s against 4.1 s for the CPU sort, 8/7 in 1.01 s using 7.6 GB
  of VRAM (RTX 5080).
- `../gpu_cuda/constant_gpu_benchmark.cu`: the Constant Recognition engine on CUDA, with device code for all
  CALC4 buttons and the valid-form generation. `constant_gpu_fp32_hybrid.cu`: FP32 candidates on the GPU,
  FP64 verification on the CPU (prior art for the Metal design below).
- `benchmark/run/run_mitm_v0.py --exe <binary>`: runs any program with `mitm_cr`'s command line and output over
  v0, under `benchmark/depth/monitor.py` (psutil; caps **host** memory only), and classifies every answer at 80
  digits. It parses `mitm_cr`'s stderr lines `CPU ... s (right sides ... s)`, `total build ... s`,
  `right sides: N distinct`; `summarize_mitm.py` parses the same. `test_planted.py --exe` checks retrieval of
  planted formulas.
- Phase 1 numbers (Windows, Ryzen 9 5900X, Intel icx), for orientation only; compare with the CPU baseline
  measured on your machine:

  | config | exact / false pos. | v0 wall, 1 thread | 12 threads | table |
  |---|---|---|---|---|
  | \|L\|<=4, \|R\|<=5 | 444 / 3 | 1.1 s | - | 0.16 s |
  | \|L\|<=5, \|R\|<=6 | 532 / 8 | 27 s | 5.3 s | 4.1 s, 21 M values, 0.24 GB |
  | \|L\|<=5, \|R\|<=6, --anyx | 550 / 9 | 27 s | - | 4.1 s |
  | \|L\|<=6, \|R\|<=6 | 557 / 52 | 9.7 min | 2.5 min | 4.1 s |
  | \|L\|<=5, \|R\|<=7, --tol 2 | 548 / 11 | 4.0 min | - | 197 s, 444 M values, 5.3 GB |
  | --common --anyx \|L\|<=7, \|R\|<=7 | 539 / 8 | 12.7 min | - | 2.9 s |
  | \|L\|<=6, \|R\|<=7, --tol 2 | 569 / 158 | - | 4.2 min | 26 s |

  (5/6 and 6/6 counts after the periodic guard of 2026-10-04; the other rows predate it.)

## Design

### One program, two backends

Directory `algorithms/methods/mitm/gpu/`, binary `mitm_gpu`:

- **Same command line and output as `mitm_cr`**: the same options (`--kl --kr --anyx --common --consts --funcs
  --ops --tol --tolrel --kappa-min --kappa-max --errcap --periodic-max --maxtry --memcap --bench`; accept and
  ignore `--threads`, or use it for host-side verification), targets `id value` on stdin, the same stdout line
  per target, and the stderr summary lines that `run_mitm_v0.py` and `summarize_mitm.py` parse. Add new stderr
  lines for the GPU timings (generation, sort, match, verify, transfers) and peak device memory.
- **Host side from `mitm_cr.cpp`** (included with `MITM_LIBRARY`): grammar, forms, rank decoding, RPN output,
  double-precision verification. Do not copy it. If something must be exposed, refactor minimally and confirm
  that `mitm_cr` still gives identical output (the `--bench` count and v0 `--kl 5 --kr 6`, before and after).
- **Backends:** CUDA (`mitm_cuda.cu`) for NVIDIA; Metal (`mitm_metal.mm` host + `mitm_kernels.metal` source)
  for the Mac. The kernels interpret the RPN opcodes (one switch over the enabled buttons), as the CR GPU code
  does.

### Numbers: double on CUDA, double-float on Metal

Apple GPUs have no FP64; the Metal Shading Language has no `double`. Use **double-float (df64)**: a value is an
unevaluated sum of two floats (hi, lo). Its significand is about 48 bits, so the unit roundoff is
u = 2^-48 ≈ 3.6e-15, the same as Phase 1's tolerance of 16 DBL_EPSILON. A tolerance of a few u therefore
cannot reproduce double-precision decisions on its own. The exponent range is that of float: hi overflows
above 3.4e38, and lo loses precision below about 2^-100 (1e-30). Codes whose values leave roughly
[2^-100, 2^127] in magnitude are unusable on Metal (for example exp(100), Gamma(40)), whereas the CPU accepts
up to 1e±308. Count how many right and left sides this removes, and report it.

- **`df64.h`, written once** in the common subset of C++17, CUDA and the Metal Shading Language: macros for
  address-space qualifiers and `inline`, no recursion, no standard library. The same code is unit-tested on the
  CPU, runs on Metal, and also runs on CUDA, which gives a df64-versus-double comparison on the same GPU.
  Arithmetic from the standard error-free transformations: TwoSum, FastTwoSum, TwoProd with `fma`.
- **Functions:** everything the grammar uses: sqrt, exp, log, sin, cos, tan, asin, acos, atan, sinh, cosh,
  tanh, asinh, acosh, atanh, pow (as `mitm_cr` does it), log_b, 1/x, and Gamma (for example Lanczos, or
  Stirling with recurrence). Each also needs its derivative, for the dual numbers of the left sides.
  Trigonometric argument reduction uses pi/2 split into two or three floats. Arguments on the path of x are
  limited to |arg| <= 32 anyway (the periodic guard). Right sides may have larger arguments: measure the
  accuracy there, and declare values unusable where it degrades.
- **Accuracy test `test_df64.cpp`**:
  - Inputs: random arguments over each function's domain, plus points near 0, 1, multiples of pi/2 and the
    poles.
  - References: long double, or tables generated with mpmath at 40 digits.
  - Report: the maximum and the 99.9 % error per function, in units of u.
  - Goals: basic operations <= 4 u, functions <= 16 u, Gamma <= 64 u. Report what is reached, not only
    pass/fail.
- **No fast math anywhere.** Fast math silently destroys the error-free transformations.
  - Metal: set `MTLCompileOptions.mathMode = MTLMathModeSafe` and
    `mathFloatingPointFunctions = MTLMathFloatingPointFunctionsPrecise` (macOS 15); on older macOS use
    `fastMathEnabled = NO`.
  - Also add `#pragma METAL fp contract(off)` where the compiler supports it.
  - Then run the df64 unit tests in a GPU kernel and require results **bit-identical to the CPU run of
    `df64.h`**. That test catches any reordering by the compiler.
- **Metal matching:**
  - The GPU finds **candidates** with a window wider than the final tolerance: about tol_gpu = max(tol, 32 u)
    relative in x.
  - The guards are applied with margins: kappa_min / 2, and kappa_max relative to df64's rounding instead of
    double's.
  - The host then re-evaluates every candidate in double and accepts it with **exactly Phase 1's rules**:
    Newton steps, errcap, kappa at the root and at every node that depends on x, the periodic guard, usable
    values.
  - Default `--verify host`. Also implement `--verify gpu` (accept in df64 alone, tolerance in units of u) to
    measure how much worse pure df64 is: that is what a browser gets without a WebAssembly verifier.
- **CUDA matching:** double throughout, verification on the device with Phase 1's rules, `--verify host` as a
  cross-check. Also `--num df64`, to run the same df64 code on the NVIDIA GPU. Consumer NVIDIA cards run FP64 at
  1/64 of the FP32 rate, so df64 may well be faster there than native double; data-center cards (A100, H100)
  run FP64 at half rate. Measure, do not assume.
- **Library differences:** CUDA's device math functions and the df64 library round differently from the CPU's
  libm. In Phase 1, icx and UCRT moved 0.007 % of the pairs across the tolerance, and musl's tgamma caused a
  false negative. Small differences in the answers are expected. **List and explain every one on v0**: which
  constant, which function, which side.

### Pipeline for a batch of targets

1. **Right sides**, once per grammar and KR:
   - **Generation:** enumerate the codes of length 1..KR without x on the GPU. Each thread takes a block of
     consecutive mixed-radix indices of one form. Start with full evaluation of every code; reusing the
     unchanged prefix positions, Phase 1's odometer, is an optimization to measure.
   - **Deduplication:** drop unusable values, sort by value key, and keep one entry per distinct value with its
     shortest code (rank order is length order).
   - **Layout:** split the result into per-length tables, as in Phase 1: value plus 32-bit rank, 12 bytes. A
     64-bit rank is needed above 2^32 codes, i.e. KR >= 8.
   - **Too large for device memory:** use value-range passes, as in Phase 1 (count per 2^20 value bins first,
     regenerate everything for each pass).
   - **Sort:** on CUDA, CUB `DeviceRadixSort`. On Metal there is no library sort: write an LSD radix sort for
     a 64-bit key with a 32-bit payload, or start with a bitonic sort, measure, and improve only if the sort
     dominates.
   - **Keys:** Phase 1's `key_of` (orderable bits) for double. For df64, the orderable bits of hi shifted left
     by 32, OR the orderable bits of lo. This orders normalized pairs correctly.
2. **Left sides**, per target, all targets of the batch in parallel:
   - Enumerate the codes of length 1..KL with x once (or any number of times with `--anyx`) at T, with their
     derivatives (dual numbers).
   - Apply the guards of `enum_L`: kappa at every node that depends on x, the periodic guard, usable values.
   - Keep (value, derivative, rank, target).
3. **Shortest first:**
   - Process left lengths a = 1, 2, ... for the whole batch, keeping each target's best (total, error) on the
     device.
   - A target whose best total is <= a + 1 drops out of later lengths, and right lengths only go up to
     best - a (as `flush` in `mitm_cr`).
   - Avoid 64-bit atomics (Apple GPUs support them only partly): pack (total, quantized error) into 32 bits, or
     reduce per target in a separate pass.
4. **Match:**
   - For every left value and b = 1..bmax: binary search in table b, then walk the window
     |L - R| <= tol_gpu |T| |L'| closest first, at most `maxtry` entries.
   - Emit candidates (target, left rank, right rank, b).
   - Sorting the left values per target (as on the CPU) makes the memory access coherent. That is an
     optimization to measure, not a requirement.
5. **Verify** (above), then print the shortest accepted equation per target (ties: smallest error) in
   `mitm_cr`'s format.

### Practical limits

- **Memory cap**, enforced by the program itself:
  - CUDA: default 80 % of the free VRAM from `cudaMemGetInfo`.
  - Metal: default 60 % of `recommendedMaxWorkingSetSize`. Unified memory is shared with macOS, which swaps
    silently, so watch `memory_pressure` while testing. Respect `maxBufferLength` and split large tables
    across several buffers.
  - `monitor.py` sees only host RSS, not GPU memory.
- **Watchdog:** a GPU that drives a display kills long kernels (Windows TDR about 2 s; Linux with X about 5 s;
  macOS reports a GPU timeout). Keep every dispatch under about 0.5 s by chunking.
- **What fits:**
  - |R| <= 7: a 5.3 GB table plus build buffers. Fits an RTX 5080 (16 GB), or a Mac with at least 24 GB.
  - A base M3 with 8 or 16 GB: |R| <= 6 (0.24 GB).
  - Skip configurations that do not fit and say so; do not swap.

## Build, from the shell

- `gpu/Makefile` with targets:
  - `cpu`: `mitm_cr` built natively, the reference.
  - `cuda`, `metal`.
  - `test`: df64 accuracy, GPU-versus-CPU df64, small end-to-end checks.
- **CPU reference** on every machine: `c++ -O3 -std=c++17 -ffp-contract=off`.
  - GCC contracts a*b+c into FMA by default in GNU mode; clang's default depends on the version.
  - Phase 1's icx used `/fp:precise`, i.e. no contraction.
- **macOS:**
  - Needs only the Xcode Command Line Tools (`xcode-select --install`).
  - Host in Objective-C++: `clang++ -O3 -std=c++17 -fobjc-arc -framework Metal -framework Foundation`.
  - Kernels are compiled at run time from their source (`newLibraryWithSource:`), so the full Xcode is not
    needed. The offline compiler `xcrun metal` would need Xcode and its Metal toolchain component.
- **Linux, NVIDIA:**
  - The CUDA toolkit (CUB comes with it).
  - `nvcc -O3 -std=c++17 -arch=native`. State the FMA setting (`--fmad=false` for the comparison with the CPU
    reference); test both settings once.
  - With an AMD GPU instead: a HIP port (hipify, hipCUB). Ask the user before starting it.
- **Windows** (the RTX 5080 of Phase 1): `build_mitm_gpu.bat` with nvcc `-arch=sm_120` after `vcvars64`, as
  `build_mitm.bat` does.
- **Python** for the runners: `pip install mpmath psutil`.

## Steps, each with its check

0. **Machine record:** `gpu/machine_info.sh` writes the CPU model, cores, RAM, OS, compiler and driver versions,
   and the GPU (`nvidia-smi`, or `system_profiler SPDisplaysDataType` and `sysctl hw.memsize` on macOS) into
   `PHASE2_RESULTS.md`.
1. **CPU baseline on this machine:**
   - Build `mitm_cr` and run `--bench 0.0072973525643 1e-12 --kl 7 --kr 7 --common`. Windows gave 2 310 973
     pairs with MSVC's libm and 2 310 800 with icx's.
   - Run v0 `--kl 4 --kr 5`, `--kl 5 --kr 6` and `--kl 5 --kr 6 --anyx`, on one thread and on all cores.
   - Compare with the Phase 1 counts, and list the constants that differ (libm).
2. **df64 library** and its tests, on the CPU first, then the same tests in a Metal kernel and a CUDA kernel:
   bit-identical to the CPU.
3. **Right-side tables on the GPU:**
   - Distinct values per length compared with `mitm_cr`'s table on the same machine. CUDA double: equal up to
     libm differences; list the differing codes for KR <= 5. df64: report the differences.
   - Build times for KR = 4..7.
4. **End to end:**
   - First one target, then batches.
   - `--bench` pair counts against the CPU.
   - `test_planted.py --exe gpu/mitm_gpu`.
   - Known identities: pi, e, the lemniscate constant; with `--anyx` the Dottie number and the omega constant.
5. **v0 runs** (matrix below) with `run_mitm_v0.py --exe ... --tag <machine>_<backend>_<config>`.
6. **`PHASE2_RESULTS.md`.**

## Benchmark matrix

| tag suffix | options | why |
|---|---|---|
| kl4_kr5 | `--kl 4 --kr 5` | small: launch and transfer overheads |
| kl5_kr6 | `--kl 5 --kr 6` | the main configuration |
| anyx_kl5_kr6 | `--kl 5 --kr 6 --anyx` | RIES's semantics |
| kl6_kr6 | `--kl 6 --kr 6` | long left sides, where the CPU is slow |
| kl5_kr7_tol2 | `--kl 5 --kr 7 --tol 2` | the 5 GB table (skip if it does not fit) |
| common_anyx_kl7_kr7 | `--common --anyx --kl 7 --kr 7` | the grammar shared with RIES |
| kl6_kr7_tol2 | `--kl 6 --kr 7 --tol 2` | 1.5e15 equations per constant, the precision limit |

**For every run, record:**

- exact, false positives, false negatives, not found;
- wall time, table build time, median time per constant;
- GPU time split into generation, sort, match, verification and transfers;
- peak host memory and peak device memory.

**Comparisons:**

- **Same-machine baseline:** the CPU baseline on one thread and on all cores, on the same machine.
- **df64 on CUDA:** `--num df64` against double on the same NVIDIA GPU, for kl5_kr6 and kl6_kr6: time and
  every differing answer.
- **Metal verification modes:** `--verify host` against `--verify gpu`: exact and false positives.

## Deliverables

- `algorithms/methods/mitm/gpu/`: sources, `Makefile`, `build_mitm_gpu.bat`, `df64.h`, tests,
  `machine_info.sh`.
- `benchmark/results/v0_mitm_<machine>_<backend>_<config>.tsv` and `_raw.txt`. The machine tag is, for example,
  `m3`, `linux_<gpu>` or `win5080`. **Separate files per machine**, so that results from different machines
  merge through git without conflicts.
- `algorithms/methods/mitm/PHASE2_RESULTS.md`, one section per machine (they are filled in at different times),
  with:
  - the answer to the question;
  - a table (machine, backend, config, exact, false positives, wall time, table time, per constant);
  - where the time goes;
  - the df64 findings: accuracy per function, what drops out of range, `--verify gpu` versus `host`;
  - a recommendation for the WebGPU phase.

## Out of scope

Weighted complexity, a significance estimate per equation, listing all matches (`--list`), the closest
approximations of the web page, and right sides that do not fit into memory (|R| = 8, streamed in chunks against
resident left sides). These are separate steps, to be proposed in `PHASE2_RESULTS.md`, not built here.

## Constraints

- `mitm_cr` and the Phase 1 results are the reference. Do not change `mitm_cr`'s behaviour, and do not touch
  `C/` or the web frontend.
- Commit only when the user asks, and push only when the user explicitly says so.
- Never move, overwrite or delete existing build outputs or result files; use new names.
- Respect the memory caps above; never let the machine swap or freeze the display. Ask the user before any
  run longer than about 30 minutes.
- Equality to 13 or 16 digits is not an identity when many candidates lie in a narrow window: every reported
  equation is verified at 80 digits (`run_mitm_v0.py` does this).
- Explain plainly in `PHASE2_RESULTS.md`. Report measured numbers only; no speed-ups estimated before they are
  measured.
