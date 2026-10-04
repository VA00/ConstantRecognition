"""test_planted.py - retrieval of planted CALC4 formulas by mitm_cr

Author: Andrzej Odrzywolek
Date: October 3, 2026
Code assist: Claude Opus 5.5

Formulas of exact length K are sampled uniformly from CALC4 (benchmark/depth/grammars.py, values with 50 digits,
ill-conditioned and near-rational values rejected), rounded to the nearest double and given to mitm_cr in one
batch. A planted formula counts as retrieved if mitm_cr reports SUCCESS with an equation whose root agrees with
the planted value to >= 30 digits, and its total length is at most K + 1 (the equation x = formula). For K <= KR
retrieval is guaranteed in exact arithmetic; for longer formulas it depends on whether the formula splits into a
left side with x of length <= KL and a right side of length <= KR.

Usage: python test_planted.py --exe mitm_cr.exe [--kl 5] [--kr 6] [--n 30] [--kmin 3] [--kmax 9] [--seed 1]
"""
import argparse
import collections
import os
import random
import subprocess
import sys

import mpmath as mp

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
sys.path.insert(0, os.path.join(ROOT, 'benchmark', 'depth'))
sys.path.insert(0, os.path.join(ROOT, 'benchmark', 'run'))
import grammars                                   # noqa: E402
from run_mitm_v0 import solve                     # noqa: E402
import math                                       # noqa: E402

# double-precision screen before mpmath: grammars.planted can stall for minutes in mpmath on codes such as
# sin(exp(exp(exp(3)))) (precision ~ size of the argument); planted values need finite, moderate intermediates
F64_UNARY = {'LOG': math.log, 'EXP': math.exp, 'INV': lambda x: 1 / x, 'GAMMA': math.gamma, 'SQRT': math.sqrt,
             'SQR': lambda x: x * x, 'SIN': math.sin, 'ARCSIN': math.asin, 'COS': math.cos, 'ARCCOS': math.acos,
             'TAN': math.tan, 'ARCTAN': math.atan, 'SINH': math.sinh, 'ARCSINH': math.asinh, 'COSH': math.cosh,
             'ARCCOSH': math.acosh, 'TANH': math.tanh, 'ARCTANH': math.atanh}
F64_BINARY = {'PLUS': lambda a, b: a + b, 'TIMES': lambda a, b: a * b, 'SUBTRACT': lambda a, b: a - b,
              'DIVIDE': lambda a, b: a / b, 'POWER': lambda a, b: a ** b}


def screen(code):
    st = []
    try:
        for s in code:
            if s in grammars.CALC4['const']:
                st.append(float(grammars.CALC4['const'][s]()))
            elif s in F64_UNARY:
                st.append(F64_UNARY[s](st.pop()))
            else:
                b = st.pop(); a = st.pop()
                st.append(F64_BINARY[s](a, b))
            if isinstance(st[-1], complex) or not math.isfinite(st[-1]) or abs(st[-1]) > 1e12:
                return False
    except (ValueError, ZeroDivisionError, OverflowError):
        return False
    return True


def planted(K, rng):
    while True:
        code = grammars.sample(grammars.CALC4, K, rng)
        if not screen(code):
            continue
        try:
            v = grammars.evaluate(grammars.CALC4, code)
        except Exception:
            continue
        if not grammars.acceptable(v):
            continue
        try:
            with mp.workdps(100):
                w = grammars.evaluate(grammars.CALC4, code)
            if isinstance(w, mp.mpc) or not mp.isfinite(w) or abs(w - v) > abs(v) * mp.mpf(10) ** -40:
                continue
        except Exception:
            continue
        return code, v


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--exe', required=True)
    ap.add_argument('--kl', type=int, default=5)
    ap.add_argument('--kr', type=int, default=6)
    ap.add_argument('--n', type=int, default=30)
    ap.add_argument('--kmin', type=int, default=3)
    ap.add_argument('--kmax', type=int, default=9)
    ap.add_argument('--seed', type=int, default=1)
    ap.add_argument('--opts', default='')
    a = ap.parse_args()
    rng = random.Random(a.seed)
    cases = []
    for K in range(a.kmin, a.kmax + 1):
        for i in range(a.n):
            code, v = planted(K, rng)
            cases.append((f'K{K}_{i}', K, code, v))
    targets = ''.join(f'{cid} {repr(float(v))}\n' for cid, K, code, v in cases)
    p = subprocess.run([a.exe, '--kl', str(a.kl), '--kr', str(a.kr)] + a.opts.split(), input=targets,
                       capture_output=True, text=True)
    out = {}
    for line in p.stdout.splitlines():
        f = line.split('\t')
        if len(f) >= 8 and not line.startswith('#'):
            out[f[0]] = f
    mp.mp.dps = 80
    stat = collections.defaultdict(collections.Counter)
    misses = []
    for cid, K, code, v in cases:
        f = out[cid]
        ok_len = f[1] == 'SUCCESS' and int(f[2]) <= K + 1
        root = solve(f[3], f[4], repr(float(v))) if f[3] else None
        with mp.workdps(60):
            true = grammars.evaluate(grammars.CALC4, code)     # planted value, 60 digits
        digits = float(-mp.log10(abs(root - true) / abs(true))) if root is not None and root != true else (60.0 if root is not None else 0)
        exact = f[1] == 'SUCCESS' and digits >= 30
        stat[K]['n'] += 1
        stat[K]['retrieved'] += exact and ok_len
        stat[K]['exact other length'] += exact and not ok_len
        stat[K]['false positive'] += f[1] == 'SUCCESS' and not exact
        stat[K]['failure'] += f[1] != 'SUCCESS'
        if not (exact and ok_len):
            misses.append((K, ' '.join(code), f[1], f[2], f[3], f[4], f'{digits:.1f}'))
    print(f'mitm_cr KL = {a.kl}, KR = {a.kr} {a.opts}, {a.n} planted CALC4 formulas per K (GPU operand order a-b, a^b in the codes)')
    print(' K   n  retrieved  exact(longer)  false+  failure')
    for K in sorted(stat):
        s = stat[K]
        print(f'{K:2d} {s["n"]:3d} {s["retrieved"]:9d} {s["exact other length"]:13d} {s["false positive"]:7d} {s["failure"]:8d}')
    for m in misses:
        if m[0] <= a.kr:
            print('  miss at K <= KR:', m)
    print(sys.stderr.write(p.stderr[-600:]) and '')


if __name__ == '__main__':
    main()
