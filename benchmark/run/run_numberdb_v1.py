"""run_numberdb_v1.py - NumberDB (numberdb.org) as a lookup table over benchmark v1 (all OEIS decimal expansions)

Author: Andrzej Odrzywolek
Date: October 11, 2026
Code assist: Claude Opus 5.5

The same lookup and scoring as run_numberdb_v0.py (see there), over data/v1/constants_v1.tsv: every constant
with >= 17 digits, its value |x| (the OEIS gives the digits of |x|) as the nearest double. Constants out of the
range of doubles (Pi^Pi^Pi^Pi, ...) are "not representable". A constant also in v0 (column v0) whose nearest
double is the one asked in the v0 run takes that answer from results/v0_numberdb_raw.jsonl instead of asking
again.

About 14,800 constants, about 500 requests: with an API key (1000 units per hour) about 8 hours, as the limit
allows; the run can be interrupted and resumed (results/v1_numberdb_raw.jsonl).

Usage:  python run_numberdb_v1.py
Writes results/v1_numberdb.tsv and prints a summary.
"""
import csv
import json
import os
import sys

from run_numberdb_v0 import BENCH, RAW as RAW_V0, RESULTS, double, run

CONSTANTS = os.path.join(BENCH, 'data', 'v1', 'constants_v1.tsv')
RAW = os.path.join(RESULTS, 'v1_numberdb_raw.jsonl')


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    v0 = {}
    if os.path.exists(RAW_V0):
        for line in open(RAW_V0, encoding='utf-8'):
            if line.strip():
                d = json.loads(line)
                v0[d['id']] = d
    prefill = {}
    for b in csv.DictReader(open(CONSTANTS, encoding='utf-8'), delimiter='\t'):
        d = v0.get(b['v0'])
        x = double(b['value']) if b['v0'] else None
        if d and x is not None and d['x'] == repr(x):
            prefill[b['id']] = {'id': b['id'], 'x': d['x'], 'matches': d['matches'], 'from_v0': b['v0']}
    run(CONSTANTS, RAW, os.path.join(RESULTS, 'v1_numberdb.tsv'), prefill)


if __name__ == '__main__':
    main()
