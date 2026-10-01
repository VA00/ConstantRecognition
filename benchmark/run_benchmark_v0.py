"""run_benchmark_v0.py - run Constant Recognition (the C search engine) over constants_v0.tsv and measure the output

Author: Andrzej Odrzywolek
Date: September 30, 2026
Code assist: Claude Opus 5.5

A proof of concept of how to measure constant recognition, not a benchmark
of record. For every constant with at least 17 known digits, the engine
(C/vsearch_batch.c: CALC4, 36 buttons, relative error, no final steps) gets
the nearest double and searches up to MaxK. Its best formula is then
evaluated in mpmath with 80 digits and compared with the 64-digit ground
truth, which double precision cannot do:

  exact           the engine reports SUCCESS (relative error <= 16 eps) and
                  the formula agrees with the value to >= 30 digits (or to
                  all its digits)
  false positive  SUCCESS in double precision, but fewer than 30 digits agree
  false negative  FAILURE, but the best formula agrees to >= 30 digits: the
                  right formula, rejected by the double-precision test
  not found       FAILURE: best formula up to MaxK is not within 16 eps

Build the engine for Node.js (emsdk, see C/compile.bat), from C/:
  emcc -O2 vsearch_batch.c vsearch_RPN_core.c utils.c -s ALLOW_MEMORY_GROWTH=1 -s NODERAWFS=1 -o vsearch_batch.js
or natively (Linux, macOS): make vsearch_batch, and pass --engine ./vsearch_batch.

Usage (from this directory):
  python run_benchmark_v0.py --engine <path to vsearch_batch.js or vsearch_batch> [--maxk 5] [--jobs 24]
Writes results/v0_K<MaxK>.tsv and prints a summary.
"""
import argparse
import collections
import concurrent.futures
import csv
import json
import os
import re
import subprocess
import sys
import time

import mpmath as mp

mp.mp.dps = 80
CONST = {'PI': mp.pi, 'EULER': mp.e, 'NEG': mp.mpf(-1), 'GOLDENRATIO': mp.phi, 'ONE': mp.mpf(1), 'TWO': mp.mpf(2),
         'THREE': mp.mpf(3), 'FOUR': mp.mpf(4), 'FIVE': mp.mpf(5), 'SIX': mp.mpf(6), 'SEVEN': mp.mpf(7),
         'EIGHT': mp.mpf(8), 'NINE': mp.mpf(9)}
UNARY = {'LOG': mp.log, 'EXP': mp.exp, 'INV': lambda x: 1 / x, 'GAMMA': mp.gamma, 'SQRT': mp.sqrt, 'SQR': lambda x: x * x,
         'SIN': mp.sin, 'ARCSIN': mp.asin, 'COS': mp.cos, 'ARCCOS': mp.acos, 'TAN': mp.tan, 'ARCTAN': mp.atan,
         'SINH': mp.sinh, 'ARCSINH': mp.asinh, 'COSH': mp.cosh, 'ARCCOSH': mp.acosh, 'TANH': mp.tanh, 'ARCTANH': mp.atanh}
# the engine applies f(top, second): "a, b, SUBTRACT" is b - a, "a, b, POWER" is b^a
BINARY = {'PLUS': lambda t, s: t + s, 'TIMES': lambda t, s: t * s, 'SUBTRACT': lambda t, s: t - s,
          'DIVIDE': lambda t, s: t / s, 'POWER': lambda t, s: t ** s}


def rpn_value(rpn):
    """High-precision value of the engine's RPN code, real part (the engine works in real doubles)."""
    stack = []
    for tok in (t.strip() for t in rpn.split(',')):
        if tok in CONST:
            stack.append(CONST[tok])
        elif tok in UNARY:
            stack.append(UNARY[tok](stack.pop()))
        elif tok in BINARY:
            top = stack.pop()
            stack.append(BINARY[tok](top, stack.pop()))
        else:
            raise ValueError(f'unknown token {tok}')
    (v,) = stack
    return v


def run(engine, target, maxk):
    cmd = (['node', engine] if engine.endswith('.js') else [engine]) + [repr(target), '0', '1', str(maxk)]
    out = subprocess.run(cmd, capture_output=True, text=True).stdout
    final = out[out.rindex('"result":"'):]   # the summary after the results array
    get = lambda key: re.search(rf'"{key}":\s*(?:"([^"]*)"|([^,}}\s]+))', final).group(1, 2)
    get1 = lambda key: next(g for g in get(key) if g is not None)
    return {'result': get1('result'), 'RPN': get1('RPN'), 'K': int(get1('K')), 'REL_ERR': float(get1('REL_ERR')),
            'CR': float(get1('COMPRESSION_RATIO')), 'evaluations': int(get1('evaluations'))}


def agree(v, ref, digits):
    """Digits of agreement between v and the reference, at most the digits the reference has."""
    if v == ref:
        return float(digits)
    d = -mp.log10(abs(v - ref) / abs(ref)) if ref != 0 else -mp.log10(abs(v))   # absolute for the constant 0
    return float(min(d, digits))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--engine', required=True)
    ap.add_argument('--maxk', type=int, default=5)
    ap.add_argument('--jobs', type=int, default=os.cpu_count())
    a = ap.parse_args()
    sys.stdout.reconfigure(encoding='utf-8')
    rows = [r for r in csv.DictReader(open('constants_v0.tsv', encoding='utf-8'), delimiter='\t') if int(r['digits']) >= 17]
    t0 = time.time()
    with concurrent.futures.ThreadPoolExecutor(a.jobs) as pool:
        outs = list(pool.map(lambda r: run(a.engine, float(r['value']), a.maxk), rows))
    elapsed = time.time() - t0
    results = []
    for r, o in zip(rows, outs):
        ref, digits = mp.mpf(r['value']), int(r['digits'])
        try:
            d = agree(rpn_value(o['RPN']), ref, digits)
        except (ValueError, ZeroDivisionError, OverflowError):
            d = float('nan')
        if o['result'] == 'SUCCESS':
            verdict = 'exact' if d >= min(30, digits - 1) else 'false positive'
        else:
            verdict = 'false negative' if d >= min(30, digits - 1) else 'not found'
        results.append({**r, **o, 'agree': d, 'verdict': verdict})
    os.makedirs('results', exist_ok=True)
    path = f'results/v0_K{a.maxk}.tsv'
    cols = ['id', 'name', 'class', 'digits', 'verdict', 'K', 'RPN', 'REL_ERR', 'CR', 'agree', 'formula']
    with open(path, 'w', encoding='utf-8', newline='') as f:
        f.write('\t'.join(cols) + '\n')
        for x in results:
            f.write('\t'.join(f'{x[c]:.1f}' if c == 'agree' else f'{x[c]:.3e}' if c == 'REL_ERR' else str(x[c]) for c in cols) + '\n')

    n = len(results)
    tally = collections.Counter(x['verdict'] for x in results)
    print(f'{n} constants with >= 17 digits, MaxK = {a.maxk}, {elapsed:.0f} s on {a.jobs} jobs; written {path}\n')
    print(f'  exact           {tally["exact"]:5d}  ({100 * tally["exact"] / n:.1f}%)')
    print(f'  false positive  {tally["false positive"]:5d}')
    print(f'  false negative  {tally["false negative"]:5d}')
    print(f'  not found       {tally["not found"]:5d}\n')
    print('by class:           n   exact  false+  false-  not found')
    for c in ('rational', 'algebraic', 'elementary', 'special', 'none'):
        xs = [x for x in results if x['class'] == c]
        t = collections.Counter(x['verdict'] for x in xs)
        print(f'  {c:12s} {len(xs):6d} {t["exact"]:7d} {t["false positive"]:7d} {t["false negative"]:7d} {t["not found"]:10d}')
    nf = sorted(x['agree'] for x in results if x['verdict'] == 'not found' and x['agree'] == x['agree'])
    if nf:
        print(f'\nnot found, digits of the best formula: median {nf[len(nf) // 2]:.1f}, '
              f'90th percentile {nf[int(0.9 * len(nf))]:.1f}, max {nf[-1]:.1f}')
        ev = max(x['evaluations'] for x in results)
        print(f'  (chance level: the search evaluates {ev} formulas up to K = {a.maxk}, so the best of them '
              f'is expected to agree to about log10({ev}) = {float(mp.log10(ev)):.1f} digits by chance)')
    fp = [x for x in results if x['verdict'] in ('false positive', 'false negative')]
    for x in fp:
        print(f'  {x["verdict"]}: {x["name"][:50]}  {x["RPN"]}  double rel. error {x["REL_ERR"]:.2e}, agrees to {x["agree"]:.1f} digits')
    print('\nexact, by K:', dict(sorted(collections.Counter(x['K'] for x in results if x['verdict'] == 'exact').items())))


if __name__ == '__main__':
    main()
