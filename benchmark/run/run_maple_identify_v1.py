"""run_maple_identify_v1.py - Maple's identify over benchmark v1 (all OEIS decimal expansions)

Author: Andrzej Odrzywolek
Date: October 11, 2026
Code assist: Claude Opus 5.5

The same run and verdicts as run_maple_identify_v0.py (see there: identify(x) with Digits := 16 and default
options, at most 60 s per constant, the answer evaluated with 80 digits), over data/v1/constants_v1.tsv: every
constant with >= 17 digits, its value |x| (the OEIS gives the digits of |x|) as the nearest double. Constants
out of the range of doubles (Pi^Pi^Pi^Pi, ...) are "not representable".

v1 is ten times v0, so the constants go to Maple in chunks of 100, --jobs processes at a time, and every
finished chunk is appended to results/v1_maple_identify_raw.tsv: an interrupted run resumes.

Usage:
  python run_maple_identify_v1.py --maple "C:/Program Files/Maple 2026/bin.X86_64_WINDOWS/cmaple.exe" [--jobs 12]
Writes results/v1_maple_identify.tsv and prints a summary.
"""
import argparse
import collections
import concurrent.futures
import csv
import math
import os
import sys
import time
from decimal import Decimal

import mpmath as mp

from run_maple_identify_v0 import BENCH, RESULTS, run_chunk

CONSTANTS = os.path.join(BENCH, 'data', 'v1', 'constants_v1.tsv')
RAW = os.path.join(RESULTS, 'v1_maple_identify_raw.tsv')
CHUNK = 100
mp.mp.dps = 80


def representable(value):
    x = float(value)
    return not (math.isinf(x) or (x == 0 and Decimal(value) != 0))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--maple', required=True)
    ap.add_argument('--jobs', type=int, default=12)
    a = ap.parse_args()
    sys.stdout.reconfigure(encoding='utf-8')
    rows = [r for r in csv.DictReader(open(CONSTANTS, encoding='utf-8'), delimiter='\t') if int(r['digits']) >= 17]
    res = {}
    if os.path.exists(RAW):
        for line in open(RAW, encoding='utf-8'):
            p = line.rstrip('\n').split('\t')
            if len(p) == 5:
                res[p[0]] = {'kind': p[1], 'identify': p[2], 'v80': p[3], 'time': float(p[4])}
    todo = [r for r in rows if r['id'] not in res and representable(r['value'])]
    chunks = [todo[i:i + CHUNK] for i in range(0, len(todo), CHUNK)]
    print(f'{len(rows)} constants, {len(res)} done, {len(todo)} to run in {len(chunks)} chunks on {a.jobs} jobs', flush=True)
    t0 = time.time()
    with concurrent.futures.ThreadPoolExecutor(a.jobs) as pool, open(RAW, 'a', encoding='utf-8', newline='\n') as fo:
        futures = [pool.submit(run_chunk, a.maple, c) for c in chunks]
        for k, fut in enumerate(concurrent.futures.as_completed(futures), 1):
            part = fut.result()
            for i, o in part.items():
                res[i] = o
                fo.write(f'{i}\t{o["kind"]}\t{o["identify"]}\t{o["v80"]}\t{o["time"]:.2f}\n')
            fo.flush()
            if k % 10 == 0 or k == len(chunks):
                print(f'  {k} of {len(chunks)} chunks, {time.time() - t0:.0f} s', flush=True)
    elapsed = time.time() - t0

    results = []
    for r in rows:
        if not representable(r['value']):
            results.append({**r, 'kind': '', 'identify': '', 'v80': '', 'time': float('nan'), 'agree': float('nan'),
                            'verdict': 'not representable'})
            continue
        o = res.get(r['id'], {'kind': 'ERROR', 'identify': '', 'v80': '', 'time': float('nan')})
        ref, digits = mp.mpf(r['value']), int(r['digits'])
        d = float('nan')
        if o['kind'] in ('SYMBOLIC', 'RATIONAL') and o['v80']:
            v = mp.mpf(o['v80'])
            d = float(digits) if v == ref else float(min(-mp.log10(abs(v - ref) / abs(ref)) if ref != 0 else -mp.log10(abs(v)), digits))
        if d != d:
            verdict = 'not found'
        elif d >= min(30, digits - 1):
            verdict = 'exact'
        else:
            verdict = 'rational fallback' if o['kind'] == 'RATIONAL' else 'false positive'
        results.append({**r, **o, 'agree': d, 'verdict': verdict})
    with open(os.path.join(RESULTS, 'v1_maple_identify.tsv'), 'w', encoding='utf-8', newline='') as f:
        cols = ['id', 'name', 'class', 'digits', 'verdict', 'identify', 'agree', 'time', 'formula', 'v0']
        f.write('\t'.join(cols) + '\n')
        for x in results:
            f.write('\t'.join(f'{x[c]:.1f}' if c == 'agree' else f'{x[c]:.2f}' if c == 'time' else str(x[c]) for c in cols) + '\n')

    n = len(results)
    tally = collections.Counter(x['verdict'] for x in results)
    print(f'{n} constants with >= 17 digits, Maple identify (Digits = 16, defaults), {elapsed:.0f} s on {a.jobs} jobs; '
          f'written results/v1_maple_identify.tsv\n')
    for v in ('exact', 'false positive', 'rational fallback', 'not found', 'not representable'):
        print(f'  {v:18s} {tally[v]:6d}  ({100 * tally[v] / n:.1f}%)')
    times = sorted(t for t in (x['time'] for x in results) if t == t)
    print(f'  (timeouts or errors: {sum(1 for x in results if x["kind"] == "ERROR")}; median time {times[len(times) // 2]:.2f} s)')
    print('\nby class:           n   exact  false+  rational  not found')
    for c in ('rational', 'algebraic', 'elementary', 'special', 'none'):
        t = collections.Counter(x['verdict'] for x in results if x['class'] == c)
        print(f'  {c:12s} {sum(t.values()):6d} {t["exact"]:7d} {t["false positive"]:7d} {t["rational fallback"]:9d} {t["not found"]:10d}')
    v0 = [x for x in results if x['v0']]
    print(f'\nthe {len(v0)} constants also in v0: exact {sum(x["verdict"] == "exact" for x in v0)}; '
          f'the {n - len(v0)} others: exact {sum(x["verdict"] == "exact" for x in results if not x["v0"])}')


if __name__ == '__main__':
    main()
