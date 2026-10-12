"""run_askconstants_v1.py - AskConstants 5.0 (Propose) over benchmark v1 (all OEIS decimal expansions)

Author: Andrzej Odrzywolek
Date: October 11, 2026
Code assist: Claude Opus 5.5

The same run and verdicts as run_askconstants_v0.py (see there), over data/v1/constants_v1.tsv: the value |x|,
and values out of the range of doubles are "not representable" (see benchmarks.py). Resumable: every answer goes
at once to results/v1_askconstants_raw_<job>.tsv, and a rerun, with any number of jobs, skips them.

Usage:  python run_askconstants_v1.py --askconstants <directory AskConstants5.0> [--jobs 4] [--maxsec 120]
Writes results/v1_askconstants.tsv.
"""
from run_askconstants_v0 import main

if __name__ == '__main__':
    main('v1')
