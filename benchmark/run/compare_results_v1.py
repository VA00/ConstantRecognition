"""compare_results_v1.py - all recognition runs over benchmark v1 side by side (as compare_results_v0.py)

Author: Andrzej Odrzywolek
Date: October 11, 2026
Code assist: Claude Opus 5.5

Reads results/v1_*.tsv; "not found" includes the constants out of the range of doubles ("not representable").

Usage:  python compare_results_v1.py
"""
from compare_results_v0 import main

if __name__ == '__main__':
    main('v1')
