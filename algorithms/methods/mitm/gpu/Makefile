# Makefile - Phase 2 programs on Linux / macOS (see build_mitm_gpu.bat for Windows)
#
#   make cpu     mitm_cr_ref: ../mitm_cr.cpp, the CPU reference (no FMA contraction, as icx /fp:precise on Windows)
#   make cuda    mitm_gpu: the CUDA search (ARCH=native by default; --fmad=false)
#   make test    test_df64 (CPU) and, with CUDA, test_df64_cuda; then run them on df64_ref.txt
#   make bench   bench_df64 and fp_rates (CUDA)
#   make ries    ries_cpu and ries_gpu: the search with a RIES-like command line (ries_gpu needs CUDA)
#   make metal   not written yet (Phase 2 on the Mac: mitm_metal.mm + mitm_kernels.metal, see PHASE2_PLAN.md)
# Never build with -ffast-math / --use_fast_math.
CXX ?= c++
NVCC ?= nvcc
ARCH ?= native
CXXFLAGS = -O3 -std=c++17 -ffp-contract=off -pthread
NVFLAGS = -O3 -std=c++17 -arch=$(ARCH) --fmad=false -diag-suppress 20011,20014

all: cpu cuda

cpu: mitm_cr_ref
mitm_cr_ref: ../mitm_cr.cpp
	$(CXX) $(CXXFLAGS) $< -o $@

cuda: mitm_gpu
mitm_gpu: mitm_cuda.cu ../mitm_cr.cpp
	$(NVCC) $(NVFLAGS) mitm_cuda.cu -o $@

test_df64: test_df64.cpp df64.h
	$(CXX) $(CXXFLAGS) test_df64.cpp -o $@
test_df64_cuda: test_df64.cpp df64.h
	$(NVCC) $(NVFLAGS) -x cu test_df64.cpp -DDF64_CUDA_TEST -o $@
df64_ref.txt: gen_df64_ref.py
	python3 gen_df64_ref.py --n 2000 > $@
test: test_df64 df64_ref.txt
	./test_df64 df64_ref.txt
	if command -v $(NVCC) >/dev/null; then $(MAKE) test_df64_cuda && ./test_df64_cuda df64_ref.txt; fi

ries: ries_cpu ries_gpu
ries_cpu: ries_cpu.cpp ries_front.h ../mitm_cr.cpp
	$(CXX) $(CXXFLAGS) ries_cpu.cpp -o $@
ries_gpu: ries_gpu.cu ries_front.h mitm_cuda.cu ../mitm_cr.cpp
	$(NVCC) $(NVFLAGS) ries_gpu.cu -o $@

bench: bench_df64 fp_rates
bench_df64: bench_df64.cu df64.h ../mitm_cr.cpp
	$(NVCC) $(NVFLAGS) bench_df64.cu -o $@
fp_rates: fp_rates.cu
	$(NVCC) -O3 -arch=$(ARCH) fp_rates.cu -o $@

metal:
	@echo "the Metal backend is not written yet (see PHASE2_PLAN.md)"; exit 1

clean:
	rm -f mitm_cr_ref mitm_gpu ries_cpu ries_gpu test_df64 test_df64_cuda bench_df64 fp_rates

.PHONY: all cpu cuda ries test bench metal clean
