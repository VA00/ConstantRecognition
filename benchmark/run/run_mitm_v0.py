"""run_mitm_v0.py - the meet-in-the-middle search (algorithms/methods/mitm/mitm_cr.cpp) over constants_v0.tsv

Author: Andrzej Odrzywolek
Date: October 3, 2026
Code assist: Claude Opus 5.5

mitm_cr finds equations L(x) = R that hold at the target in double precision (L with x exactly once by default,
both sides over the CALC4 buttons, left sides of length <= KL, right sides <= KR) and reports, per constant, the
accepted equation of the smallest total length |L| + |R|. All constants with at least 17 known digits go through
one process (the right-side table is built once), each as the nearest double, the same input as the other tools.
The reported equation is solved for x next to the target with 80 digits (mpmath findroot) and the root compared
with the 64-digit ground truth, as for RIES (run_ries_v0.py):

  exact           SUCCESS and the root agrees to >= 30 digits (or to all the digits known)
  false positive  SUCCESS, but the root fails beyond double precision
  false negative  FAILURE, but the closest pair found (shown for a FAILURE) agrees to >= 30 digits
  not found       otherwise

The process runs under benchmark/depth/monitor.py with a memory cap and a time limit.

Usage:
  python run_mitm_v0.py --exe <path to mitm_cr> [--kl 5] [--kr 6] [--threads 1] [--opts "--kappa-min 1e-4 ..."]
                        [--tag NAME] [--mem-cap 16] [--time-limit 36000]
Writes results/v0_mitm_<tag>.tsv (default tag: kl<KL>_kr<KR>) and the process output results/v0_mitm_<tag>_raw.txt,
and prints a summary.
"""
import argparse
import collections
import csv
import os
import re
import shlex
import sys

import mpmath as mp

from run_benchmark_v0 import CONST, UNARY, BINARY, agree

BENCH = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONSTANTS = os.path.join(BENCH, 'data', 'v0', 'constants_v0.tsv')
RESULTS = os.path.join(BENCH, 'results')
sys.path.insert(0, os.path.join(BENCH, 'depth'))
import monitor  # noqa: E402

mp.mp.dps = 80


def rpn_value(rpn, x):
    """Value of a code in Constant Recognition's order ("a, b, SUBTRACT" = b - a), x = the unknown; real part."""
    stack = []
    for tok in (t.strip() for t in rpn.split(',')):
        if tok == 'x':
            stack.append(x)
        elif tok in CONST:
            stack.append(CONST[tok])
        elif tok in UNARY:
            stack.append(UNARY[tok](stack.pop()))
        elif tok in BINARY:
            top = stack.pop()
            stack.append(BINARY[tok](top, stack.pop()))
        else:
            raise ValueError(f'unknown token {tok}')
    (v,) = stack
    return mp.re(v) if isinstance(v, mp.mpc) else v


class Wandered(Exception):
    pass


def solve(lhs, rhs, x0):
    """Root of LHS(x) = RHS next to x0, with 80 digits, or None."""
    r = rpn_value(rhs, None)
    x0 = mp.mpf(x0)
    far = abs(x0) * mp.mpf(10) ** -6 + mp.mpf(10) ** -30

    def f(x):
        # an iterate far from x0 is abandoned: it can reach values (exp(exp(x)) at large x) that mpmath
        # evaluates for hours, and roots farther than 1e-8 are rejected anyway
        if abs(x - x0) > far:
            raise Wandered
        return rpn_value(lhs, x) - r
    eps = mp.mpf(10) ** -12
    starts = (x0, (x0 * (1 + eps), x0 * (1 - eps))) if x0 != 0 else (x0, (eps, -eps))
    for start in starts:
        try:
            root = mp.findroot(f, start, tol=mp.mpf(10) ** -75, maxsteps=200)
            root = mp.re(root) if isinstance(root, mp.mpc) else root
            if abs(root - x0) <= abs(x0) * mp.mpf(10) ** -8 + mp.mpf(10) ** -60:
                return root
        except Exception:   # complex intermediates, overflow, zero derivative, no convergence
            continue
    return None


def parse(stdout):
    out = {}
    for line in stdout.splitlines():
        if line.startswith('#'):
            continue
        f = line.split('\t')
        if len(f) < 8:
            continue
        out[f[0]] = {'result': f[1], 'total': int(f[2]), 'LHS': f[3], 'RHS': f[4], 'REL_ERR': float(f[5]),
                     'candidates': int(f[6]), 'ms': float(f[7])}
    return out


def classify(rows, out):
    results = []
    for r in rows:
        o = out[r['id']]
        ref, digits = mp.mpf(r['value']), int(r['digits'])
        d, root = float('nan'), None
        if o['LHS']:
            try:
                root = solve(o['LHS'], o['RHS'], repr(float(r['value'])))
            except (ValueError, ZeroDivisionError, OverflowError):
                root = None
            if root is not None:
                d = agree(root, ref, digits)
        if o['result'] == 'SUCCESS':
            verdict = 'exact' if d >= min(30, digits - 1) else 'false positive'
        else:
            verdict = 'false negative' if d >= min(30, digits - 1) else 'not found'
        results.append({**r, **o, 'agree': d, 'solved': root is not None, 'verdict': verdict})
    return results


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--exe', required=True)
    ap.add_argument('--kl', type=int, default=5)
    ap.add_argument('--kr', type=int, default=6)
    ap.add_argument('--threads', type=int, default=1)
    ap.add_argument('--opts', default='', help='further mitm_cr options, one string')
    ap.add_argument('--tag', default='')
    ap.add_argument('--mem-cap', type=float, default=16.0, help='GB, the process is killed above it')
    ap.add_argument('--time-limit', type=float, default=36000.0, help='seconds')
    ap.add_argument('--limit', type=int, default=0, help='only the first N constants (tests)')
    argv = sys.argv[1:]
    if '--opts' in argv[:-1]:              # "--opts --anyx": the value starts with "--", argparse would take it as an option
        i = argv.index('--opts')
        argv[i:i + 2] = [f'--opts={argv[i + 1]}']
    a = ap.parse_args(argv)
    sys.stdout.reconfigure(encoding='utf-8')
    tag = a.tag or f'kl{a.kl}_kr{a.kr}'
    rows = [r for r in csv.DictReader(open(CONSTANTS, encoding='utf-8'), delimiter='\t') if int(r['digits']) >= 17]
    if a.limit:
        rows = rows[:a.limit]
    targets = ''.join(f'{r["id"]} {repr(float(r["value"]))}\n' for r in rows)
    cmd = [a.exe, '--kl', str(a.kl), '--kr', str(a.kr), '--threads', str(a.threads),
           '--memcap', str(a.mem_cap * 0.9)] + shlex.split(a.opts)
    run = monitor.run(cmd, stdin_text=targets, mem_cap_gb=a.mem_cap, time_limit=a.time_limit)
    os.makedirs(RESULTS, exist_ok=True)
    raw = f'{RESULTS}/v0_mitm_{tag}_raw.txt'
    with open(raw, 'w', encoding='utf-8', newline='') as f:
        f.write(f'# command: {" ".join(cmd)}\n# wall {run["seconds"]:.1f} s, peak memory {run["peak_gb"]:.2f} GB, '
                f'killed: {run["killed"]}, probe max {run["probe_max_s"]}\n')
        f.write(''.join('# ' + line + '\n' for line in run['stderr'].splitlines()))
        f.write(run['stdout'])
    sys.stderr.write(run['stderr'])
    if run['killed']:
        print(f'mitm_cr killed ({run["killed"]}) after {run["seconds"]:.0f} s; output kept in {raw}')
        return 1
    out = parse(run['stdout'])
    missing = [r['id'] for r in rows if r['id'] not in out]
    if missing:
        print(f'{len(missing)} constants without output, e.g. {missing[:5]}')
        return 1
    results = classify(rows, out)
    path = f'{RESULTS}/v0_mitm_{tag}.tsv'
    cols = ['id', 'name', 'class', 'digits', 'verdict', 'total', 'LHS', 'RHS', 'REL_ERR', 'candidates', 'ms', 'agree',
            'solved', 'formula']
    with open(path, 'w', encoding='utf-8', newline='') as f:
        f.write('\t'.join(cols) + '\n')
        for x in results:
            f.write('\t'.join(f'{x[c]:.1f}' if c == 'agree' else f'{x[c]:.3e}' if c == 'REL_ERR' else str(x[c])
                              for c in cols) + '\n')

    n = len(results)
    tally = collections.Counter(x['verdict'] for x in results)
    cpu = re.search(r'CPU ([\d.]+) s \(right sides ([\d.]+) s\)', run['stderr'])
    rbuild = re.search(r'total build ([\d.]+) s', run['stderr'])
    print(f'{n} constants with >= 17 digits, mitm_cr KL = {a.kl}, KR = {a.kr}, {a.threads} thread(s), options '
          f'"{a.opts}": {run["seconds"]:.1f} s wall (right-side table {rbuild.group(1) if rbuild else "?"} s), '
          f'CPU {cpu.group(1) if cpu else "?"} s, peak memory {run["peak_gb"]:.2f} GB; written {path}\n')
    for v in ('exact', 'false positive', 'false negative', 'not found'):
        print(f'  {v:15s} {tally[v]:5d}')
    print(f'  (SUCCESS whose equation could not be solved at 80 digits: '
          f'{sum(1 for x in results if x["result"] == "SUCCESS" and not x["solved"])})')
    print('\nby class:           n   exact  false+  false-  not found')
    for c in ('rational', 'algebraic', 'elementary', 'special', 'none'):
        t = collections.Counter(x['verdict'] for x in results if x['class'] == c)
        print(f'  {c:12s} {sum(t.values()):6d} {t["exact"]:7d} {t["false positive"]:7d} {t["false negative"]:7d} {t["not found"]:10d}')
    print('\nexact, by total length:', dict(sorted(collections.Counter(x['total'] for x in results if x['verdict'] == 'exact').items())))
    print('false positive, by total length:',
          dict(sorted(collections.Counter(x['total'] for x in results if x['verdict'] == 'false positive').items())))
    for name, other in (('CR CPU K<=7', 'v0_K7.tsv'), ('CR GPU K<=8', 'v0_cuda_K8.tsv'), ('RIES -l5', 'v0_ries_l5.tsv')):
        p = f'{RESULTS}/{other}'
        if os.path.exists(p):
            c = {r['id']: r['verdict'] for r in csv.DictReader(open(p, encoding='utf-8'), delimiter='\t')}
            both = collections.Counter((c.get(x['id']) == 'exact', x['verdict'] == 'exact') for x in results)
            print(f'compared with {name}: exact in both {both[(True, True)]}, {name} only {both[(True, False)]}, '
                  f'MITM only {both[(False, True)]}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
