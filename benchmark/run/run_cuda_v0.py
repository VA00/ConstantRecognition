"""run_cuda_v0.py - the hybrid FP32 GPU search (cuda/constant_gpu_benchmark.cu) over constants_v0.tsv

Author: Andrzej Odrzywolek
Date: October 1, 2026
Code assist: Claude Opus 5.5

The same buttons as Constant Recognition (CALC4: 13 constants, 18 functions, 5 operators) and
the same success test (FP64 relative error <= 16 eps, shortest K first), but searched on the
GPU in single precision: every formula within THRESHOLD FLT_EPSILON of the target is a
candidate, verified in double precision on the CPU. All targets go through one process.
Measured like run_benchmark_v0.py: the formula found is evaluated with 80 digits and compared
with the 64-digit ground truth (verdicts exact, false positive, false negative, not found).

Differences from Constant Recognition that the benchmark can show: formulas whose FP32 value
is off by more than the threshold (cancellation, overflow of FP32 beyond 3.4e38) are never
candidates; and for a FAILURE only candidates are known, so no best approximation is reported
when there is none within the threshold.

Build (Windows, from cuda/, in a "x64 Native Tools" prompt or after vcvars64.bat):
  nvcc -O3 -arch=sm_120 constant_gpu_benchmark.cu -o constant_gpu_benchmark
Usage:
  python run_cuda_v0.py --exe <path to constant_gpu_benchmark> [--maxk 7] [--threshold 64]
Writes results/v0_cuda_K<MaxK>.tsv and prints a summary.
"""
import argparse
import collections
import csv
import os
import subprocess
import sys
import time

import mpmath as mp

from run_benchmark_v0 import CONST, UNARY, agree

BENCH = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONSTANTS = os.path.join(BENCH, 'data', 'v0', 'constants_v0.tsv')
RESULTS = os.path.join(BENCH, 'results')

mp.mp.dps = 80
# this kernel applies f(second, top): "a, b, SUBTRACT" is a - b, "a, b, POWER" is a^b
BINARY = {'PLUS': lambda s, t: s + t, 'TIMES': lambda s, t: s * t, 'SUBTRACT': lambda s, t: s - t,
          'DIVIDE': lambda s, t: s / t, 'POWER': lambda s, t: s ** t}


def rpn_value(rpn):
    stack = []
    for tok in (t.strip() for t in rpn.split(',')):
        if tok in CONST:
            stack.append(CONST[tok])
        elif tok in UNARY:
            stack.append(UNARY[tok](stack.pop()))
        elif tok in BINARY:
            top = stack.pop()
            stack.append(BINARY[tok](stack.pop(), top))
        else:
            raise ValueError(f'unknown token {tok}')
    (v,) = stack
    return v


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--exe', required=True)
    ap.add_argument('--maxk', type=int, default=7)
    ap.add_argument('--threshold', type=float, default=64.0, help='FP32 candidate threshold in FLT_EPSILON')
    a = ap.parse_args()
    sys.stdout.reconfigure(encoding='utf-8')
    rows = [r for r in csv.DictReader(open(CONSTANTS, encoding='utf-8'), delimiter='\t') if int(r['digits']) >= 17]
    targets = ''.join(f'{r["id"]} {repr(float(r["value"]))}\n' for r in rows)
    t0 = time.time()
    p = subprocess.run([a.exe, str(a.maxk), str(a.threshold)], input=targets, capture_output=True, text=True)
    elapsed = time.time() - t0
    sys.stderr.write(p.stderr)
    out = {}
    for line in p.stdout.splitlines():
        f = line.split('\t')
        out[f[0]] = {'result': f[1], 'K': int(f[2]), 'RPN': f[3], 'REL_ERR': float(f[4]), 'candidates': int(f[5]),
                     'overflow': int(f[6]), 'ms': float(f[7])}
    results = []
    for r in rows:
        o = out[r['id']]
        ref, digits = mp.mpf(r['value']), int(r['digits'])
        try:
            d = agree(rpn_value(o['RPN']), ref, digits) if o['RPN'] else float('nan')
        except (ValueError, ZeroDivisionError, OverflowError):
            d = float('nan')
        if o['result'] == 'SUCCESS':
            verdict = 'exact' if d >= min(30, digits - 1) else 'false positive'
        else:
            verdict = 'false negative' if d >= min(30, digits - 1) else 'not found'
        results.append({**r, **o, 'agree': d, 'verdict': verdict})
    os.makedirs(RESULTS, exist_ok=True)
    path = f'{RESULTS}/v0_cuda_K{a.maxk}.tsv'
    cols = ['id', 'name', 'class', 'digits', 'verdict', 'K', 'RPN', 'REL_ERR', 'candidates', 'overflow', 'ms', 'agree', 'formula']
    with open(path, 'w', encoding='utf-8', newline='') as f:
        f.write('\t'.join(cols) + '\n')
        for x in results:
            f.write('\t'.join(f'{x[c]:.1f}' if c == 'agree' else f'{x[c]:.3e}' if c == 'REL_ERR' else str(x[c]) for c in cols) + '\n')

    n = len(results)
    tally = collections.Counter(x['verdict'] for x in results)
    ms = sorted(x['ms'] for x in results)
    print(f'{n} constants with >= 17 digits, GPU hybrid FP32/FP64, MaxK = {a.maxk}, threshold {a.threshold:g} FLT_EPSILON: '
          f'{elapsed:.0f} s in total, median {ms[n // 2]:.0f} ms, max {ms[-1]:.0f} ms per constant; written {path}\n')
    for v in ('exact', 'false positive', 'false negative', 'not found'):
        print(f'  {v:15s} {tally[v]:5d}')
    print(f'  (candidate buffer overflows: {sum(x["overflow"] for x in results)})')
    print('\nby class:           n   exact  false+  false-  not found')
    for c in ('rational', 'algebraic', 'elementary', 'special', 'none'):
        t = collections.Counter(x['verdict'] for x in results if x['class'] == c)
        print(f'  {c:12s} {sum(t.values()):6d} {t["exact"]:7d} {t["false positive"]:7d} {t["false negative"]:7d} {t["not found"]:10d}')
    for x in results:
        if x['verdict'] in ('false positive', 'false negative'):
            print(f'  {x["verdict"]}: {x["name"][:50]}  {x["RPN"]}  FP64 error {x["REL_ERR"]:.2e}, agrees to {x["agree"]:.1f} digits')
    print('\nexact, by K:', dict(sorted(collections.Counter(x['K'] for x in results if x['verdict'] == 'exact').items())))
    cpu = f'{RESULTS}/v0_K{a.maxk}.tsv'
    if os.path.exists(cpu):
        c = {r['id']: r['verdict'] for r in csv.DictReader(open(cpu, encoding='utf-8'), delimiter='\t')}
        both = collections.Counter((c.get(x['id']) == 'exact', x['verdict'] == 'exact') for x in results)
        print(f'\ncompared with Constant Recognition at K <= {a.maxk} ({cpu}): exact in both {both[(True, True)]}, '
              f'CPU only {both[(True, False)]}, GPU only {both[(False, True)]}')


if __name__ == '__main__':
    main()
