"""run_ries_v1.py - RIES over benchmark v1 (all OEIS decimal expansions)

Author: Andrzej Odrzywolek
Date: October 11, 2026
Code assist: Claude Opus 5.5

The same run and verdicts as run_ries_v0.py (see there), over data/v1/constants_v1.tsv: the value |x|, and
values out of the range of doubles are "not representable" (see benchmarks.py). Resumable, as for v0.

Usage:  python run_ries_v1.py --ries <path to ries> [--level 2] [--jobs 12]
Writes results/v1_ries_l<level>.tsv and results/v1_ries_l<level>_raw.tsv.
"""
from run_ries_v0 import main

if __name__ == '__main__':
    main('v1')
