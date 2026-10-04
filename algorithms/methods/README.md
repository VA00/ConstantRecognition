# Methods (How the search space is searched)

The same calculator (search space) can be searched in different ways: on the CPU or the GPU,
memoryless or with stored values, by enumeration or by integer relations.

## Modules
- `gpu_cuda`: CALC4 search on an NVIDIA GPU. `constant_gpu.cu` (FP64), `constant_gpu_fp32.cu` (FP32),
  `constant_gpu_fp32_hybrid.cu` (FP32 search, candidates verified in FP64 on the CPU),
  `constant_gpu_alpha_search_benchmark.cu` (variant of the hybrid search), `constant_gpu_benchmark.cu`
  (the hybrid search for `benchmark/run/run_cuda_v0.py`, many targets per process, shortest first).
  Build: `build.sh` (Linux, FP64 version) or `build_benchmark.bat` (Windows, benchmark version).
  `constant_gpu_benchmark` options: a third argument `list_delta` prints every FP64-verified formula
  within that relative error (for targets with error bars); `-DCOMMON_GRAMMAR` builds it with the
  symbols shared with RIES (see `benchmark/ries_vs_cr`).
- `tensor_julia`: CALC4 up to K = 5 as broadcasted tensors in Julia (`tensor_search.jl`).
- `mitm`: meet-in-the-middle (bidirectional, RIES-like) search on the CPU, `mitm_cr.cpp`: equations
  L(x) = R with x exactly once in L (or any number of times, `--anyx`), the right sides built once per
  batch and shared by all targets, CALC4 or the symbols shared with RIES (`--common`). Build:
  `build_mitm.bat`. Benchmark: `benchmark/run/run_mitm_v0.py`; results and the comparison with Constant
  Recognition and RIES: `PHASE1_RESULTS.md`. `explicit.py` turns its equations into explicit formulas,
  `mitm_bench.cu` measures the matching step alone (tree vs sort vs GPU).
- planned: integer relations (PSLQ/LLL).
