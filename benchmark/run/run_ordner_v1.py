"""run_ordner_v1.py - Ordner (Fungrim's index of real numbers) as a pure lookup table over benchmark v1

Author: Andrzej Odrzywolek
Date: October 11, 2026
Code assist: Claude Opus 5.5

The same lookup and verdicts as run_ordner_v0.py (see there), over data/v1/constants_v1.tsv: the value |x|, and
values out of the range of doubles are "not representable" (see benchmarks.py).

Usage:  python run_ordner_v1.py [--cache DIR] [--refresh] [--check-all]
Writes results/v1_ordner.tsv.
"""
from run_ordner_v0 import main

if __name__ == '__main__':
    main('v1')
