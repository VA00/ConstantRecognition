"""run_cuda_v1.py - the hybrid FP32 GPU search over benchmark v1 (all OEIS decimal expansions)

Author: Andrzej Odrzywolek
Date: October 11, 2026
Code assist: Claude Opus 5.5

The same run and verdicts as run_cuda_v0.py (see there), over data/v1/constants_v1.tsv: the value |x|, and
values out of the range of doubles are "not representable" (see benchmarks.py). Resumable per chunk of targets.

Usage:  python run_cuda_v1.py --exe <path to constant_gpu_benchmark> [--maxk 7] [--threshold 64]
Writes results/v1_cuda_K<MaxK>.tsv and results/v1_cuda_K<MaxK>_raw.tsv.
"""
import sys

from run_cuda_v0 import main

if __name__ == '__main__':
    sys.exit(main('v1'))
