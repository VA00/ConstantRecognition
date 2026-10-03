# Methods (How the search space is searched)

The same calculator (search space) can be searched in different ways: on the CPU or the GPU,
memoryless or with stored values, by enumeration or by integer relations.

## Modules
- `gpu_cuda`: CALC4 search on an NVIDIA GPU. `constant_gpu.cu` (FP64), `constant_gpu_fp32.cu` (FP32),
  `constant_gpu_fp32_hybrid.cu` (FP32 search, candidates verified in FP64 on the CPU),
  `constant_gpu_alpha_search_benchmark.cu` (variant of the hybrid search), `constant_gpu_benchmark.cu`
  (the hybrid search for `benchmark/run/run_cuda_v0.py`, many targets per process, shortest first).
  Build: `build.sh` (Linux, FP64 version) or `build_benchmark.bat` (Windows, benchmark version).
- `tensor_julia`: CALC4 up to K = 5 as broadcasted tensors in Julia (`tensor_search.jl`).
- planned: integer relations (PSLQ/LLL), meet-in-the-middle (bidirectional search).
