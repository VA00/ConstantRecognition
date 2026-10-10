"""make_targets_v0.py - targets for the MESearch GUI run (batch.ps1): id<TAB>target

Author: Andrzej Odrzywolek
Date: October 10, 2026
Code assist: Claude Opus 5.5

The constants of constants_v0.tsv with >= 17 digits (as for the other tools), rounded to 15 significant
digits: MESearch rejects more ("too precise"). E-notation outside [1e-3, 1e15), which MESearch accepts.

Usage:  python make_targets_v0.py <targets.tsv>
"""
import csv
import os
import sys
from decimal import Decimal, ROUND_HALF_EVEN

BENCH = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CONSTANTS = os.path.join(BENCH, 'data', 'v0', 'constants_v0.tsv')


def main():
    rows = list(csv.DictReader(open(CONSTANTS, encoding='utf-8'), delimiter='\t'))
    with open(sys.argv[1], 'w', encoding='utf-8', newline='') as f:
        f.write('id\ttarget\n')
        for r in rows:
            if int(r['digits']) < 17:
                continue
            v = Decimal(r['value'])
            if v == 0:
                t = '0.00000000000000'
            else:
                e = v.adjusted()
                q = v.quantize(Decimal(1).scaleb(e - 14), rounding=ROUND_HALF_EVEN)
                if q.adjusted() != e:  # rounding carried into a new digit (9.99.. -> 10.0..)
                    e = q.adjusted()
                    q = v.quantize(Decimal(1).scaleb(e - 14), rounding=ROUND_HALF_EVEN)
                t = format(q, 'f') if -3 <= e < 15 else format(q, '.14E')
            f.write(f"{r['id']}\t{t}\n")


if __name__ == '__main__':
    main()
