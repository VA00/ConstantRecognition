"""run_nsimplify_v1.py - sympy's nsimplify over benchmark v1 (all OEIS decimal expansions)

Author: Andrzej Odrzywolek
Date: October 11, 2026
Code assist: Claude Opus 5.5

The same run and verdicts as run_nsimplify_v0.py (see there), over data/v1/constants_v1.tsv: the value |x|,
and values out of the range of doubles are "not representable" (see benchmarks.py).

Usage:  python run_nsimplify_v1.py [--jobs 12]
Writes results/v1_nsimplify.tsv.
"""
from run_nsimplify_v0 import main

if __name__ == '__main__':
    main('v1')
