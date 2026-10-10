# Makefile - Phase 2 programs on Linux / macOS (see build_mitm_gpu.bat for Windows)
#
#   make cpu     mitm_cr_ref: ../mitm_cr.cpp, the CPU reference (no FMA contraction, as icx /fp:precise on Windows)
#   make cuda    mitm_gpu: the CUDA search (ARCH=native by default; --fmad=false)
#   make test    test_df64 (CPU) and, with CUDA, test_df64_cuda; then run them on df64_ref.txt
#   make bench   bench_df64 and fp_rates (CUDA)
#   make ries    ries_cpu and ries_gpu: the search with a RIES-like command line (ries_gpu needs CUDA)
#   make metal   mitm_metal and ries_metal: the search on an Apple GPU (macOS, Xcode Command Line Tools only; the
#                kernels are compiled at run time from mitm_kernels.metal, embedded by embed_metal.sh)
#   make test    also test_df64_metal on macOS: the df64 tests in a Metal kernel (bit identity: --ftz, see below)
#   make fp_rates_metal   float and df64 throughput of the Apple GPU (the counterpart of fp_rates.cu)
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
	if [ "$$(uname -s)" = Darwin ]; then $(MAKE) test_df64_metal && ./test_df64_metal df64_ref.txt --ftz; fi

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

# ---- macOS, Metal (Objective-C++; Apple GPUs flush subnormal floats, hence test_df64_metal --ftz)
MMFLAGS = -O3 -std=c++17 -ffp-contract=off -fobjc-arc -pthread
MFRAMEWORKS = -framework Metal -framework Foundation
KERNEL_SRC = df64.h df64_ops.h mitm_metal_shared.h mitm_kernels.metal
metal: mitm_metal ries_metal
mitm_kernels_src.h: embed_metal.sh $(KERNEL_SRC)
	sh embed_metal.sh kMitmKernels $(KERNEL_SRC) > $@
df64_metal_src.h: embed_metal.sh df64.h df64_apply.h
	sh embed_metal.sh kDf64Source df64.h df64_apply.h > $@
mitm_metal: mitm_metal.mm mitm_kernels_src.h metal_ctx.h $(KERNEL_SRC) ../mitm_cr.cpp
	$(CXX) $(MMFLAGS) mitm_metal.mm $(MFRAMEWORKS) -o $@
ries_metal: ries_metal.mm mitm_metal.mm ries_front.h mitm_kernels_src.h metal_ctx.h $(KERNEL_SRC) ../mitm_cr.cpp
	$(CXX) $(MMFLAGS) ries_metal.mm $(MFRAMEWORKS) -o $@
fp_rates_metal: fp_rates_metal.mm df64.h df64_apply.h df64_metal_src.h metal_ctx.h
	$(CXX) $(MMFLAGS) fp_rates_metal.mm $(MFRAMEWORKS) -o $@
test_df64_metal: test_df64.cpp df64.h df64_apply.h df64_metal_src.h metal_ctx.h
	$(CXX) $(MMFLAGS) -x objective-c++ -DDF64_METAL_TEST test_df64.cpp $(MFRAMEWORKS) -o $@

clean:
	rm -f mitm_cr_ref mitm_gpu ries_cpu ries_gpu test_df64 test_df64_cuda bench_df64 fp_rates
	rm -f mitm_metal ries_metal test_df64_metal fp_rates_metal mitm_kernels_src.h df64_metal_src.h

.PHONY: all cpu cuda ries test bench metal clean
