# RIES vs Constant Recognition on the same grammar (fine-structure constant, 2026-10-03)

A direct comparison in the symbols CALC4 and RIES share: constants 1..9, pi, e, phi; ln, exp, 1/x,
sqrt, x^2; + - * / ^ (`ries -S123456789pefrqslE+-*/^`, GPU program built with `-DCOMMON_GRAMMAR`).
Target alpha = 0.0072973525643, tolerance 5 sigma (relative 7.5e-10, CODATA 2022 sigma = 1.1e-12).

| | CR on GPU, K <= 12 | RIES two-sided -l7 | RIES --one-sided -l7 |
|---|---|---|---|
| time | 68 min (RTX 5080) | 11 min (one CPU core) | 10.5 min |
| memory | ~0.2 GB, flat | 6.2 GB (x3.5 per level) | 4.7 GB |
| matches within 5 sigma | 85 explicit formulas, 11 distinct values, all K = 12 | 28763 equations, 9611 distinct roots | 0 |

- 10 of the 11 CR values are found by RIES as the same identity (rearranged equation, checked at 80
  digits); one, x = e/28^(8^(1/(2+phi))), is not, although its RIES complexity (147) is far below the
  maximum RIES reached (188). At -l6 RIES missed 3 values below its maximum complexity. RIES is not
  exhaustive by complexity.
- Equal to 13 digits is not the same number here: thousands of RIES roots lie in the 5-sigma window.
  `compare_common.py` therefore checks identities at 80 digits.
- Restricted to explicit formulas (`--one-sided`), RIES finds nothing up to -l7.

Files:
- `gpu_common_K12.txt`: output of `constant_gpu_common.exe 12 64 7.5e-10` (the #MATCH lines);
  build: `nvcc -O3 -arch=sm_120 -DCOMMON_GRAMMAR "-DMAX_CANDIDATES=(48*1024*1024)" constant_gpu_benchmark.cu -o constant_gpu_common`
  in `algorithms/methods/gpu_cuda`, run with `echo "alpha 0.0072973525643" | constant_gpu_common 12 64 7.5e-10`.
- `ries_common_runs.py`: the RIES runs (`RIES=<path to ries> python ries_common_runs.py`), log in
  `ries_common_runs.jsonl`, outputs `ries_common_*_l*.txt` (level 7, 2.6 MB, is not kept).
- `compare_common.py`: the comparison; its output is `comparison.txt`.
- `alpha_l5.nb`: the 66 RIES equations at -l5 (default symbols, 1.36 sigma) as a notebook, built by
  `make_alpha_notebook.wls` from `alpha_l5_F3.txt` / `alpha_l5_equations.wl`.
