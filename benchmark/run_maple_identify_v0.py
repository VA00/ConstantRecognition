"""run_maple_identify_v0.py - Maple's identify over constants_v0.tsv, measured like run_benchmark_v0.py

Author: Andrzej Odrzywolek
Date: September 30, 2026
Code assist: Claude Opus 5.5

For comparison with the C engine and with sympy's nsimplify. For every
constant with at least 17 known digits, identify(x) with Digits := 16 and
default options gets the nearest double x (written with the digits that
round-trip), the same input as the others. Maple evaluates each answer with
80 digits; it is compared with the 64-digit ground truth:

  exact              agrees to >= 30 digits (or to all digits of the value)
  false positive     a symbolic answer that fails beyond double precision
  rational fallback  a rational p/q that fails beyond double precision
  not found          identify returns the float unchanged, an error, or no
                     answer within TIMEOUT seconds (timelimit)

Needs Maple (cmaple). The constants are split over --jobs Maple processes.

Usage (from this directory):
  python run_maple_identify_v0.py --maple "C:/Program Files/Maple 2026/bin.X86_64_WINDOWS/cmaple.exe" [--jobs 12] [--compare results/v0_K6.tsv]
Writes results/v0_maple_identify.tsv and prints a summary and the comparison.
"""
import argparse
import collections
import concurrent.futures
import csv
import os
import subprocess
import sys
import tempfile
import time

import mpmath as mp

TIMEOUT = 60
mp.mp.dps = 80

SCRIPT = r'''interface(quiet = true, prettyprint = 0, screenwidth = infinity):
Digits := 16:
run := proc(id, x)
  local r, t, v, s;
  t := time[real]();
  r := traperror(timelimit(%d, identify(x)));
  t := time[real]() - t;
  if r = lasterror then
    printf("%%s\tERROR\t\t\t%%.2f\n", id, t);
  else
    s := sprintf("%%a", r);
    if type(r, float) then v := "" else v := sprintf("%%.80e", evalf[80](r)) end if;
    printf("%%s\t%%s\t%%s\t%%a\t%%.2f\n", id, `if`(type(r, float), "FLOAT", `if`(type(r, rational), "RATIONAL", "SYMBOLIC")), s, v, t);
  end if;
end proc:
'''


def run_chunk(maple, chunk):
    with tempfile.NamedTemporaryFile('w', suffix='.mpl', delete=False, encoding='ascii') as f:
        f.write(SCRIPT % TIMEOUT)
        for r in chunk:
            f.write(f'run("{r["id"]}", {repr(float(r["value"]))}):\n')
        f.write('quit;\n')
        path = f.name
    out = subprocess.run([maple, '-q', path], capture_output=True, text=True).stdout
    os.unlink(path)
    res = {}
    for line in out.splitlines():
        p = line.split('\t')
        if len(p) == 5:
            res[p[0]] = {'kind': p[1], 'identify': p[2], 'v80': p[3].strip('"'), 'time': float(p[4])}
    return res


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--maple', required=True)
    ap.add_argument('--jobs', type=int, default=12)
    ap.add_argument('--compare', default='results/v0_K6.tsv', help='engine results of run_benchmark_v0.py')
    a = ap.parse_args()
    sys.stdout.reconfigure(encoding='utf-8')
    rows = [r for r in csv.DictReader(open('constants_v0.tsv', encoding='utf-8'), delimiter='\t') if int(r['digits']) >= 17]
    chunks = [rows[i::a.jobs] for i in range(a.jobs)]
    t0 = time.time()
    res = {}
    with concurrent.futures.ThreadPoolExecutor(a.jobs) as pool:
        for part in pool.map(lambda c: run_chunk(a.maple, c), chunks):
            res.update(part)
    elapsed = time.time() - t0
    results = []
    for r in rows:
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
    os.makedirs('results', exist_ok=True)
    with open('results/v0_maple_identify.tsv', 'w', encoding='utf-8', newline='') as f:
        cols = ['id', 'name', 'class', 'digits', 'verdict', 'identify', 'agree', 'time', 'formula']
        f.write('\t'.join(cols) + '\n')
        for x in results:
            f.write('\t'.join(f'{x[c]:.1f}' if c == 'agree' else f'{x[c]:.2f}' if c == 'time' else str(x[c]) for c in cols) + '\n')

    n = len(results)
    tally = collections.Counter(x['verdict'] for x in results)
    print(f'{n} constants with >= 17 digits, Maple identify (Digits = 16, defaults), {elapsed:.0f} s on {a.jobs} jobs; '
          f'written results/v0_maple_identify.tsv\n')
    for v in ('exact', 'false positive', 'rational fallback', 'not found'):
        print(f'  {v:18s} {tally[v]:5d}  ({100 * tally[v] / n:.1f}%)')
    print(f'  (timeouts or errors: {sum(1 for x in results if x["kind"] == "ERROR")}; '
          f'median time {sorted(t for t in (x["time"] for x in results) if t == t)[n // 2]:.2f} s)')
    print('\nby class:           n   exact  false+  rational  not found')
    for c in ('rational', 'algebraic', 'elementary', 'special', 'none'):
        t = collections.Counter(x['verdict'] for x in results if x['class'] == c)
        print(f'  {c:12s} {sum(t.values()):6d} {t["exact"]:7d} {t["false positive"]:7d} {t["rational fallback"]:9d} {t["not found"]:10d}')

    others = {'engine': a.compare, 'nsimplify': 'results/v0_nsimplify.tsv'}
    for label, path in others.items():
        if not os.path.exists(path):
            continue
        o = {r['id']: r['verdict'] for r in csv.DictReader(open(path, encoding='utf-8'), delimiter='\t')}
        both = collections.Counter((o[x['id']] == 'exact', x['verdict'] == 'exact') for x in results)
        wrong = sum(1 for v in o.values() if v in ('false positive', 'rational fallback'))
        print(f'\ncompared with {label} ({path}):  exact in both {both[(True, True)]}, {label} only {both[(True, False)]}, '
              f'Maple only {both[(False, True)]}, neither {both[(False, False)]}')
        print(f'  wrong answers claimed exact: {label} {wrong}, Maple {tally["false positive"] + tally["rational fallback"]}')


if __name__ == '__main__':
    main()
