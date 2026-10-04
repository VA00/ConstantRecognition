"""run_ries_v0.py - RIES (R. Munafo, GPL) over constants_v0.tsv

Author: Andrzej Odrzywolek
Date: October 1, 2026
Code assist: Claude Opus 5.5

RIES finds equations LHS(x) = RHS, not formulas for x, by a bidirectional search
(https://mrob.com/pub/ries/). For every constant with at least 17 known digits, ries -F3 -x
-l<level> gets the nearest double (the digits that round-trip), the same input as the other
tools, with RIES's default symbols. RIES claims a match by marking an equation "'exact'
match" (both sides equal in double precision) or by stopping early because its best match
is within about 1e-15 of the target. Its answer is the first equation marked exact, or else
its last (most accurate) one. The root of that equation next to
the value RIES prints is computed with 80 digits (mpmath findroot) and compared with the
64-digit ground truth:

  exact           RIES claims a match and the root agrees to >= 30 digits
  false positive  a claimed match whose root fails beyond double precision
  false negative  no claimed match, but the last equation's root agrees to >= 30 digits
  not found       otherwise

RIES's postfix format (-F3): A B ** = A^B, A B root = B-th root of A, A B logN = log base B
of A, sinpi/cospi/tanpi = sin, cos, tan of pi*x, A B atan2 as checked against RIES below.

Build (Windows): cl /O2 ries-for-windows.c (with an empty stdafx.h), or elsewhere
gcc ries.c -lm -o ries.
Usage:
  python run_ries_v0.py --ries <path to ries> [--level 2] [--jobs 12] [--symbols 123456789pefrqslE+-*/^ --tag common_l4]
  (--symbols: RIES's -S, only these symbols; --tag: name of the result files instead of l<level>)
Writes results/v0_ries_l<level>.tsv (and the raw RIES output, results/v0_ries_l<level>_raw.tsv) and prints a summary.
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
import threading
import time

import mpmath as mp

BENCH = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONSTANTS = os.path.join(BENCH, 'data', 'v0', 'constants_v0.tsv')
RESULTS = os.path.join(BENCH, 'results')

mp.mp.dps = 80

UNARY = {'neg': lambda a: -a, 'recip': lambda a: 1 / a, 'sqrt': mp.sqrt, 'dup*': lambda a: a * a, 'ln': mp.log,
         'exp': mp.exp, 'sinpi': lambda a: mp.sin(mp.pi * a), 'cospi': lambda a: mp.cos(mp.pi * a),
         'tanpi': lambda a: mp.tan(mp.pi * a), 'W': mp.lambertw}
BINARY = {'+': lambda a, b: a + b, '-': lambda a, b: a - b, '*': lambda a, b: a * b, '/': lambda a, b: a / b,
          '**': lambda a, b: a ** b, 'root': lambda a, b: a ** (1 / b), 'logN': lambda a, b: mp.log(a) / mp.log(b),
          'atan2': lambda a, b: mp.atan2(a, b)}
CONST = {'pi': mp.pi, 'e': mp.e, 'phi': mp.phi}


def postfix(tokens, x):
    stack = []
    for t in tokens:
        if t == 'x':
            stack.append(x)
        elif t in CONST:
            stack.append(CONST[t])
        elif re.fullmatch(r'\d+', t):
            stack.append(mp.mpf(t))
        elif t in UNARY:
            stack.append(UNARY[t](stack.pop()))
        elif t in BINARY:
            b = stack.pop()
            stack.append(BINARY[t](stack.pop(), b))
        else:
            raise ValueError(f'unknown RIES symbol {t}')
    (v,) = stack
    return mp.re(v) if isinstance(v, mp.mpc) else v


LINE = re.compile(r"^\s*(.+?) = (.+?)\s+(?:for x = (\S+)|\('exact' match\))\s*(?:\{(\d+)\})?\s*$")   # one space only before "for" in long lines


def parse(out):
    """Equations of RIES's output: (lhs tokens, rhs tokens, printed root or None, exact flag, complexity)."""
    eqs = []
    for line in out.splitlines():
        m = LINE.match(line)
        if not m or 'Your target value' in line:
            continue
        lhs, rhs, root, comp = m.group(1).split(), m.group(2).split(), m.group(3), m.group(4)
        exact = "'exact' match" in line
        eqs.append({'lhs': lhs, 'rhs': rhs, 'root': root, 'exact': exact, 'complexity': int(comp) if comp else None,
                    'text': f'{" ".join(lhs)} = {" ".join(rhs)}'})
    return eqs


def solve(eq, x0):
    """Root of LHS(x) = RHS next to x0, with 80 digits."""
    f = lambda x: postfix(eq['lhs'], x) - postfix(eq['rhs'], x)
    x0 = mp.mpf(x0)
    for start in (x0, (x0 * (1 + mp.mpf(10) ** -12), x0 * (1 - mp.mpf(10) ** -12))):
        try:
            r = mp.findroot(f, start, tol=mp.mpf(10) ** -75, maxsteps=200)
            if abs(r - x0) <= abs(x0) * mp.mpf(10) ** -8 + mp.mpf(10) ** -60:
                return r
        except Exception:   # complex intermediates (atan2), overflow, zero derivative, ...
            continue
    return None


def run(ries, target, level, symbols=''):
    p = subprocess.run([ries, '-F3', '-x', f'-l{level}'] + ([f'-S{symbols}'] if symbols else []) + [repr(target)],
                       capture_output=True, text=True)
    return p.stdout


def agree(v, ref, digits):
    if v == ref:
        return float(digits)
    return float(min(-mp.log10(abs(v - ref) / abs(ref)) if ref != 0 else -mp.log10(abs(v)), digits))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--ries', required=True)
    ap.add_argument('--level', default='2')
    ap.add_argument('--jobs', type=int, default=12)
    ap.add_argument('--limit', type=int, default=0)
    ap.add_argument('--symbols', default='', help="RIES -S symbol set, e.g. 123456789pefrqslE+-*/^")
    ap.add_argument('--tag', default='', help='result files v0_ries_<tag>.tsv (default l<level>)')
    a = ap.parse_args()
    sys.stdout.reconfigure(encoding='utf-8')
    rows = [r for r in csv.DictReader(open(CONSTANTS, encoding='utf-8'), delimiter='\t') if int(r['digits']) >= 17]
    if a.limit:
        rows = rows[:a.limit]
    t0 = time.time()
    # RIES's output per constant is kept (json-encoded) in a raw file, so that scoring can be redone
    # and an interrupted run resumes
    os.makedirs(RESULTS, exist_ok=True)
    tag = a.tag or f'l{a.level}'
    raw_path = f'{RESULTS}/v0_ries_{tag}_raw.tsv'
    raw = {}
    if os.path.exists(raw_path):
        for line in open(raw_path, encoding='utf-8'):
            i, text = line.rstrip('\n').split('\t', 1)
            raw[i] = json.loads(text)
    lock = threading.Lock()

    def job(r):
        if r['id'] not in raw:
            out = run(a.ries, float(r['value']), a.level, a.symbols)
            with lock:
                raw[r['id']] = out
                with open(raw_path, 'a', encoding='utf-8') as f:
                    f.write(r['id'] + '\t' + json.dumps(out) + '\n')
        return raw[r['id']]

    with concurrent.futures.ThreadPoolExecutor(a.jobs) as pool:
        outs = list(pool.map(job, rows))
    elapsed = time.time() - t0
    results = []
    for r, out in zip(rows, outs):
        ref, digits = mp.mpf(r['value']), int(r['digits'])
        eqs = parse(out)
        exacts = [e for e in eqs if e['exact']]
        # RIES marks "'exact' match" only when both sides are equal in double precision; otherwise it
        # declares success by stopping early: "Stopping now because best match is within ... of target"
        stopped = 'Stopping now because best match is within' in out
        eq = exacts[0] if exacts else (eqs[-1] if eqs else None)
        d, root = float('nan'), None
        if eq:
            root = solve(eq, eq['root'] if eq['root'] else repr(float(r['value'])))
            if root is not None:
                d = agree(root, ref, digits)
        claimed = bool(exacts) or (stopped and eq is not None)
        if claimed:
            verdict = 'exact' if d >= min(30, digits - 1) else 'false positive'
        else:
            verdict = 'false negative' if d >= min(30, digits - 1) else 'not found'
        results.append({**r, 'verdict': verdict, 'equation': eq['text'] if eq else '', 'complexity': eq['complexity'] if eq else '',
                        'agree': d, 'solved': root is not None, 'n_equations': len(eqs)})
    os.makedirs(RESULTS, exist_ok=True)
    path = f'{RESULTS}/v0_ries_{tag}.tsv'
    cols = ['id', 'name', 'class', 'digits', 'verdict', 'equation', 'complexity', 'agree', 'solved', 'formula']
    with open(path, 'w', encoding='utf-8', newline='') as f:
        f.write('\t'.join(cols) + '\n')
        for x in results:
            f.write('\t'.join(f'{x[c]:.1f}' if c == 'agree' else str(x[c]) for c in cols) + '\n')
    n = len(results)
    tally = collections.Counter(x['verdict'] for x in results)
    print(f'{n} constants with >= 17 digits, RIES -l{a.level}{" -S" + a.symbols if a.symbols else ""}, {elapsed:.0f} s on {a.jobs} jobs; written {path}\n')
    for v in ('exact', 'false positive', 'false negative', 'not found'):
        print(f'  {v:15s} {tally[v]:5d}')
    print(f'  (equations not solved numerically: {sum(1 for x in results if x["equation"] and not x["solved"])}, '
          f'no equation at all: {sum(1 for x in results if not x["equation"])})')
    print('\nby class:           n   exact  false+  false-  not found')
    for c in ('rational', 'algebraic', 'elementary', 'special', 'none'):
        t = collections.Counter(x['verdict'] for x in results if x['class'] == c)
        print(f'  {c:12s} {sum(t.values()):6d} {t["exact"]:7d} {t["false positive"]:7d} {t["false negative"]:7d} {t["not found"]:10d}')
    for x in results:
        if x['verdict'] in ('false positive', 'false negative'):
            print(f'  {x["verdict"]}: {x["name"][:45]}  {x["equation"]}  agrees to {x["agree"]:.1f} digits')


if __name__ == '__main__':
    main()
