"""compare_v0.py - two outputs of mitm_cr / mitm_gpu on benchmark v0, classified at 80 digits, and every difference

Author: Andrzej Odrzywolek
Date: October 4, 2026
Code assist: Claude Opus 5.5

Reads two program outputs (stdout lines "id SUCCESS|FAILURE total LHS RHS rel_err candidates ms", or the _raw.txt
files written by benchmark/run/run_mitm_v0.py), classifies every answer exactly as run_mitm_v0.py does (the
equation solved next to the target with 80 digits, compared with the 64-digit value: exact, false positive, false
negative, not found) and prints the tallies of both, how many answers are identical, and every constant whose
verdict differs, with both equations.

Usage: python compare_v0.py A.txt B.txt [--names cpu gpu] [--show-same-verdict N]
"""
import argparse
import collections
import csv
import functools
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(HERE))))
sys.path.insert(0, os.path.join(ROOT, 'benchmark', 'run'))
import run_mitm_v0 as rm  # noqa: E402

rm.solve = functools.lru_cache(maxsize=None)(rm.solve)    # most answers of the two outputs are the same equation


def load(path):
    return rm.parse(open(path, encoding='utf-8').read())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('a')
    ap.add_argument('b')
    ap.add_argument('--names', nargs=2, default=['A', 'B'])
    ap.add_argument('--show-same-verdict', type=int, default=0,
                    help='also list up to N constants with the same verdict but another equation')
    o = ap.parse_args()
    sys.stdout.reconfigure(encoding='utf-8')
    rows = [r for r in csv.DictReader(open(rm.CONSTANTS, encoding='utf-8'), delimiter='\t') if int(r['digits']) >= 17]
    outs = [load(o.a), load(o.b)]
    for name, out in zip(o.names, outs):
        missing = [r['id'] for r in rows if r['id'] not in out]
        if missing:
            print(f'{name}: {len(missing)} constants without output, e.g. {missing[:5]}')
            return 1
    res = [{x['id']: x for x in rm.classify(rows, out)} for out in outs]
    for name, r in zip(o.names, res):
        t = collections.Counter(x['verdict'] for x in r.values())
        print(f'{name:8s} exact {t["exact"]:4d}  false pos. {t["false positive"]:3d}  false neg. {t["false negative"]:3d}  '
              f'not found {t["not found"]:4d}')
    same_eq = sum(1 for r in rows if (res[0][r['id']]['LHS'], res[0][r['id']]['RHS'], res[0][r['id']]['result']) ==
                  (res[1][r['id']]['LHS'], res[1][r['id']]['RHS'], res[1][r['id']]['result']))
    print(f'same equation and result: {same_eq} of {len(rows)}')
    diff = [r for r in rows if res[0][r['id']]['verdict'] != res[1][r['id']]['verdict']]
    kinds = collections.Counter((res[0][r['id']]['verdict'], res[1][r['id']]['verdict']) for r in diff)
    print(f'different verdicts: {len(diff)}  ' + ', '.join(f'{k[0]} -> {k[1]}: {v}' for k, v in sorted(kinds.items())))

    def show(r):
        print(f'  {r["id"]:>5s} {r["name"][:40]:40s}')
        for name, x in zip(o.names, (res[0][r['id']], res[1][r['id']])):
            print(f'        {name:6s} {x["verdict"]:15s} {x["total"]:2d}  [{x["LHS"]}] = [{x["RHS"]}]  err {x["REL_ERR"]:.2e}'
                  f'  agree {x["agree"]:.1f}')
    for r in diff:
        show(r)
    if o.show_same_verdict:
        other = [r for r in rows if r not in diff and (res[0][r['id']]['LHS'], res[0][r['id']]['RHS']) !=
                 (res[1][r['id']]['LHS'], res[1][r['id']]['RHS'])]
        totals = collections.Counter((res[0][r['id']]['total'] > res[1][r['id']]['total']) - (res[0][r['id']]['total'] < res[1][r['id']]['total'])
                                     for r in other)
        print(f'same verdict, other equation: {len(other)} (total length {o.names[0]} longer: {totals[1]}, shorter: '
              f'{totals[-1]}, equal: {totals[0]})')
        for r in other[:o.show_same_verdict]:
            show(r)
    return 0


if __name__ == '__main__':
    sys.exit(main())
