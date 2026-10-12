"""run_benchmark_v1.py - Constant Recognition (the C engine) over benchmark v1 (all OEIS decimal expansions)

Author: Andrzej Odrzywolek
Date: October 11, 2026
Code assist: Claude Opus 5.5

The same run and verdicts as run_benchmark_v0.py (see there), over data/v1/constants_v1.tsv: the value |x|, and
values out of the range of doubles are "not representable" (see benchmarks.py).

Usage:  python run_benchmark_v1.py --engine <path to vsearch_batch.js or vsearch_batch> [--maxk 5] [--jobs 24]
Writes results/v1_K<MaxK>.tsv and prints a summary.
"""
from run_benchmark_v0 import main

if __name__ == '__main__':
    main('v1')
