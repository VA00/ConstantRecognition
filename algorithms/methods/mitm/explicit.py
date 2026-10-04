"""explicit.py - explicit formulas x = F from the equations L(x) = R found by mitm_cr (Phase 1b, post-processing)

Author: Andrzej Odrzywolek
Date: October 3, 2026
Code assist: Claude Opus 5.5

With x exactly once in L, the equation can be solved for x by inverting the operations on the path from the
root of L to x, one at a time, applying the inverse to the right side:
  unary   LOG <-> EXP, INV, SQRT <-> SQR, SIN <-> ARCSIN, COS <-> ARCCOS, TAN <-> ARCTAN, SINH <-> ARCSINH,
          COSH <-> ARCCOSH, TANH <-> ARCTANH; GAMMA has no inverse among the buttons
  binary  (engine order: "s, t, OP" = OP(t, s)) t + s, t * s, t - s, t / s, t^s, with x in t or in s
Multivalued inverses (SQR, COSH, SIN, COS, TAN) get the branch that reproduces the value of the inverted subtree
at the target: the candidates (principal branch, sign change, shifts by multiples of pi) are evaluated with
40 digits and the one closest to the subtree is kept. The explicit formula is then evaluated with 80 digits and
compared with the 64-digit value of the constant: it must agree to >= 30 digits, as the equation did.

Usage: python explicit.py [--tag kl5_kr6]     reads benchmark/results/v0_mitm_<tag>.tsv, writes
       benchmark/results/v0_mitm_<tag>_explicit.tsv and prints a summary
"""
import argparse
import collections
import csv
import os
import sys

import mpmath as mp

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
RESULTS = os.path.join(ROOT, 'benchmark', 'results')
sys.path.insert(0, os.path.join(ROOT, 'benchmark', 'run'))
from run_mitm_v0 import rpn_value                 # noqa: E402
from run_benchmark_v0 import UNARY, agree        # noqa: E402

BIN = ('PLUS', 'TIMES', 'SUBTRACT', 'DIVIDE', 'POWER')


def tree(rpn):
    """Nodes (op, children) of a code in the engine's order; binary children are (top, second)."""
    st = []
    for tok in (t.strip() for t in rpn.split(',')):
        if tok in BIN:
            t = st.pop()
            s = st.pop()
            st.append((tok, t, s))
        elif tok in UNARY:
            st.append((tok, st.pop()))
        else:
            st.append((tok,))
    (root,) = st
    return root


def code(node):
    """Token list of a node (engine order)."""
    if len(node) == 1:
        return [node[0]]
    if len(node) == 2:
        return code(node[1]) + [node[0]]
    return code(node[2]) + code(node[1]) + [node[0]]


def has_x(node):
    return node[0] == 'x' or any(has_x(c) for c in node[1:])


def b(op, t, s):
    """Tokens of op(t, s) from token lists t and s."""
    return s + t + [op]


INVERSE = {'LOG': 'EXP', 'EXP': 'LOG', 'INV': 'INV', 'SQRT': 'SQR', 'SQR': 'SQRT', 'SIN': 'ARCSIN', 'ARCSIN': 'SIN',
           'COS': 'ARCCOS', 'ARCCOS': 'COS', 'TAN': 'ARCTAN', 'ARCTAN': 'TAN', 'SINH': 'ARCSINH', 'ARCSINH': 'SINH',
           'COSH': 'ARCCOSH', 'ARCCOSH': 'COSH', 'TANH': 'ARCTANH', 'ARCTANH': 'TANH'}


def value(tokens, x):
    return rpn_value(', '.join(tokens), x)


def candidates(f, y):
    """Token lists for the solutions u of f(u) = y (y: token list), principal branch first."""
    g = y + [INVERSE[f]]
    neg = lambda e: b('TIMES', e, ['NEG'])
    digits = ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE']

    def shifts(e, step):                                        # e + k step pi, |k| <= 9 (k step <= 9)
        out = [e]
        for k in range(1, 10):
            if k * step > 9:
                break
            kpi = ['PI'] if k * step == 1 else [digits[k * step - 1], 'PI', 'TIMES']
            out += [b('PLUS', e, kpi), b('SUBTRACT', e, kpi)]
        return out

    if f in ('SQR', 'COSH'):
        return [g, neg(g)]
    if f == 'SIN':                                              # asin y + 2 k pi,  pi - asin y + 2 k pi
        return shifts(g, 2) + shifts(b('SUBTRACT', ['PI'], g), 2)
    if f == 'COS':                                              # +- acos y + 2 k pi
        return shifts(g, 2) + shifts(neg(g), 2)
    if f == 'TAN':                                              # atan y + k pi
        return shifts(g, 1)
    return [g]


def solve_for_x(lhs, rhs, xval):
    """Token list F with x = F, or None (GAMMA on the path, or no branch reproduces the value)."""
    node, y = tree(lhs), [t.strip() for t in rhs.split(',')]
    with mp.workdps(40):
        while node[0] != 'x':
            if len(node) == 2:
                f, child = node
                if f == 'GAMMA':
                    return None
                want = value(code(child), xval)
                best = None
                for c in candidates(f, y):
                    try:
                        d = abs(value(c, None) - want)
                    except (ValueError, ZeroDivisionError, OverflowError):
                        continue
                    if best is None or d < best[0]:
                        best = (d, c)
                if best is None or best[0] > abs(want) * mp.mpf(10) ** -25 + mp.mpf(10) ** -30:
                    return None
                y, node = best[1], child
            else:
                op, t, s = node
                xt = has_x(t)
                ct, cs = code(t), code(s)
                if op == 'PLUS':
                    y = b('SUBTRACT', y, cs) if xt else b('SUBTRACT', y, ct)
                elif op == 'TIMES':
                    y = b('DIVIDE', y, cs) if xt else b('DIVIDE', y, ct)
                elif op == 'SUBTRACT':                          # t - s = y
                    y = b('PLUS', y, cs) if xt else b('SUBTRACT', ct, y)
                elif op == 'DIVIDE':                            # t / s = y
                    y = b('TIMES', y, cs) if xt else b('DIVIDE', ct, y)
                else:                                           # t^s = y
                    if xt:
                        g = b('POWER', y, cs + ['INV'])
                        want = value(ct, xval)
                        try:
                            if abs(value(g, None) - want) > abs(want) * mp.mpf(10) ** -25:
                                g = b('TIMES', g, ['NEG'])      # odd root of a negative base
                        except (ValueError, ZeroDivisionError, OverflowError):
                            return None
                        y = g
                    else:
                        y = b('DIVIDE', y + ['LOG'], ct + ['LOG'])
                node = t if xt else s
    return y


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--tag', default='kl5_kr6')
    a = ap.parse_args()
    sys.stdout.reconfigure(encoding='utf-8')
    mp.mp.dps = 80
    rows = list(csv.DictReader(open(f'{RESULTS}/v0_mitm_{a.tag}.tsv', encoding='utf-8'), delimiter='\t'))
    cr = {}
    for name in ('v0_cuda_K8.tsv', 'v0_K7.tsv'):
        p = f'{RESULTS}/{name}'
        if os.path.exists(p):
            for r in csv.DictReader(open(p, encoding='utf-8'), delimiter='\t'):
                if r['verdict'] == 'exact' and r['id'] not in cr:
                    cr[r['id']] = int(r['K'])
    vals = {r['id']: r['value'] for r in csv.DictReader(open(os.path.join(ROOT, 'benchmark', 'data', 'v0', 'constants_v0.tsv'),
                                                             encoding='utf-8'), delimiter='\t')}
    out, stat, lens = [], collections.Counter(), collections.Counter()
    for r in rows:
        if r['verdict'] != 'exact':
            continue
        ref, digits = mp.mpf(vals[r['id']]), int(r['digits'])
        F = solve_for_x(r['LHS'], r['RHS'], ref)
        d = float('nan')
        if F is not None:
            try:
                d = agree(value(F, None), ref, digits)
            except (ValueError, ZeroDivisionError, OverflowError):
                pass
        ok = d >= min(30, digits - 1)
        stat['exact equations'] += 1
        stat['GAMMA on the path of x' if F is None and 'GAMMA' in r['LHS'] else
             'no branch found' if F is None else 'explicit, verified' if ok else 'explicit, fails at 80 digits'] += 1
        K = len(F) if F else ''
        if ok:
            lens[(int(r['total']), K)] += 1
        out.append({'id': r['id'], 'name': r['name'], 'total': r['total'], 'equation': f'{r["LHS"]} = {r["RHS"]}',
                    'K': K, 'F': ', '.join(F) if F else '', 'agree': d, 'CR_K': cr.get(r['id'], '')})
    path = f'{RESULTS}/v0_mitm_{a.tag}_explicit.tsv'
    cols = ['id', 'name', 'total', 'K', 'CR_K', 'agree', 'equation', 'F']
    with open(path, 'w', encoding='utf-8', newline='') as f:
        f.write('\t'.join(cols) + '\n')
        for x in out:
            f.write('\t'.join(f'{x[c]:.1f}' if c == 'agree' else str(x[c]) for c in cols) + '\n')
    print(f'{a.tag}: {dict(stat)}; written {path}')
    ok = [x for x in out if x['agree'] == x['agree'] and x['agree'] >= 30]
    extra = collections.Counter(x['K'] - (int(x['total']) - 1) for x in ok)
    print('explicit length K minus (total length - 1), i.e. symbols added by the inversion:', dict(sorted(extra.items())))
    both = [x for x in ok if x['CR_K'] != '']
    print(f'constants also exact in CR (GPU K<=8 or CPU K<=7): {len(both)}; explicit K vs CR K: '
          f'shorter {sum(x["K"] < x["CR_K"] for x in both)}, equal {sum(x["K"] == x["CR_K"] for x in both)}, '
          f'longer {sum(x["K"] > x["CR_K"] for x in both)}')
    print('explicit formulas by K for constants not found by CR:',
          dict(sorted(collections.Counter(x['K'] for x in ok if x['CR_K'] == '').items())))


if __name__ == '__main__':
    main()
