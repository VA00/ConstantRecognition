"""run_nsimplify_v0.py - sympy's nsimplify over constants_v0.tsv, measured like run_benchmark_v0.py

Author: Andrzej Odrzywolek
Date: September 30, 2026
Code assist: Claude Opus 5.5

For comparison with the C engine. For every constant with at least 17 known
digits, nsimplify(x, [pi, E, GoldenRatio]) gets the nearest double x, the same
input and the same named constants as the engine's CALC4 (integers, roots and
rationals are built into nsimplify). Its answer is evaluated with 80 digits
and compared with the 64-digit ground truth:

  exact              agrees to >= 30 digits (or to all digits of the value)
  false positive     a symbolic answer that fails beyond double precision
  rational fallback  a rational p/q that fails beyond double precision
  not found          a Float returned, an error, or no answer in TIMEOUT seconds

nsimplify always answers: when nothing simple fits, it returns an integer
relation of x with pi, e and phi (mpmath.identify) or a rational, which are
right in double precision. Only the 64 digits of the benchmark tell them apart.

Usage (from this directory):  python run_nsimplify_v0.py [--jobs 12]
Writes results/v0_nsimplify.tsv, and compares with the engine results given by
--compare (default results/v0_K5.tsv).
"""
import argparse
import collections
import csv
import multiprocessing
import os
import sys
import time

TIMEOUT = 60


def work(args):
    value = args
    import sympy as sp
    t = time.time()
    try:
        r = sp.nsimplify(float(value), [sp.pi, sp.E, sp.GoldenRatio])
        return str(r), sp.count_ops(r), time.time() - t, None
    except Exception as e:
        return '', 0, time.time() - t, f'{type(e).__name__}: {e}'[:80]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--jobs', type=int, default=12)
    ap.add_argument('--compare', default='results/v0_K5.tsv', help='engine results of run_benchmark_v0.py')
    a = ap.parse_args()
    sys.stdout.reconfigure(encoding='utf-8')
    import mpmath as mp
    import sympy as sp
    mp.mp.dps = 80
    rows = [r for r in csv.DictReader(open('constants_v0.tsv', encoding='utf-8'), delimiter='\t') if int(r['digits']) >= 17]
    t0 = time.time()
    with multiprocessing.Pool(a.jobs) as pool:
        pending = [pool.apply_async(work, (r['value'],)) for r in rows]
        outs = []
        for p in pending:
            try:
                outs.append(p.get(TIMEOUT))
            except multiprocessing.TimeoutError:
                outs.append(('', 0, TIMEOUT, 'timeout'))
    elapsed = time.time() - t0
    results = []
    for r, (expr, ops, dt, err) in zip(rows, outs):
        ref, digits = mp.mpf(r['value']), int(r['digits'])
        d = float('nan')
        if expr and not err:
            e = sp.sympify(expr)
            if not e.is_Float:
                v = mp.mpf(str(sp.N(e, 80)))
                d = float(digits) if v == ref else float(min(-mp.log10(abs(v - ref) / abs(ref)) if ref != 0 else -mp.log10(abs(v)), digits))
        if d != d:
            verdict = 'not found'
        elif d >= min(30, digits - 1):
            verdict = 'exact'
        else:
            verdict = 'rational fallback' if sp.sympify(expr).is_Rational else 'false positive'
        results.append({**r, 'nsimplify': expr, 'ops': ops, 'time': dt, 'agree': d, 'verdict': verdict, 'error': err or ''})
    os.makedirs('results', exist_ok=True)
    with open('results/v0_nsimplify.tsv', 'w', encoding='utf-8', newline='') as f:
        cols = ['id', 'name', 'class', 'digits', 'verdict', 'ops', 'nsimplify', 'agree', 'time', 'error', 'formula']
        f.write('\t'.join(cols) + '\n')
        for x in results:
            f.write('\t'.join(f'{x[c]:.1f}' if c == 'agree' else f'{x[c]:.2f}' if c == 'time' else str(x[c]) for c in cols) + '\n')

    n = len(results)
    tally = collections.Counter(x['verdict'] for x in results)
    print(f'{n} constants with >= 17 digits, nsimplify(x, [pi, E, GoldenRatio]), sympy {sp.__version__}, '
          f'{elapsed:.0f} s on {a.jobs} jobs; written results/v0_nsimplify.tsv\n')
    for v in ('exact', 'false positive', 'rational fallback', 'not found'):
        print(f'  {v:18s} {tally[v]:5d}  ({100 * tally[v] / n:.1f}%)')
    print('\nby class:           n   exact  false+  rational  not found')
    for c in ('rational', 'algebraic', 'elementary', 'special', 'none'):
        t = collections.Counter(x['verdict'] for x in results if x['class'] == c)
        print(f'  {c:12s} {sum(t.values()):6d} {t["exact"]:7d} {t["false positive"]:7d} {t["rational fallback"]:9d} {t["not found"]:10d}')
    for v in ('exact', 'false positive'):
        ops = sorted(x['ops'] for x in results if x['verdict'] == v)
        if ops:
            print(f'size (count_ops) of {v} answers: median {ops[len(ops) // 2]}, max {ops[-1]}')

    if os.path.exists(a.compare):
        eng = {r['id']: r for r in csv.DictReader(open(a.compare, encoding='utf-8'), delimiter='\t')}
        both = collections.Counter()
        for x in results:
            e = eng[x['id']]['verdict'] == 'exact'
            s = x['verdict'] == 'exact'
            both[(e, s)] += 1
        print(f'\ncompared with the engine ({a.compare}):')
        print(f'  exact in both          {both[(True, True)]:5d}')
        print(f'  engine only            {both[(True, False)]:5d}')
        print(f'  nsimplify only         {both[(False, True)]:5d}')
        print(f'  neither                {both[(False, False)]:5d}')
        fp_e = sum(1 for r in eng.values() if r['verdict'] == 'false positive')
        print(f'  wrong answers claimed exact: engine {fp_e}, nsimplify {tally["false positive"] + tally["rational fallback"]}')


if __name__ == '__main__':
    main()
