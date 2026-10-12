"""benchmarks.py - the benchmark a run script reads: v0 (data/v0/constants_v0.tsv) or v1 (data/v1/constants_v1.tsv)

Author: Andrzej Odrzywolek
Date: October 11, 2026
Code assist: Claude Opus 5.5

A run script over benchmark b reads the constants with >= 17 digits and writes results/<b>_<tool>.tsv. In v1 the
value is |x| (the OEIS gives the digits of |x|), and 41 values are out of the range of doubles (40 too large:
e^e^e^e, e^1000, Mersenne primes, the solution of Archimedes's cattle problem, ...; 1 too small): they have no
double input and are written with the verdict "not representable".
"""
import csv
import math
import os
from decimal import Decimal

BENCH = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RESULTS = os.path.join(BENCH, 'results')
NOT_REPRESENTABLE = 'not representable'


def constants_path(benchmark):
    return os.path.join(BENCH, 'data', benchmark, f'constants_{benchmark}.tsv')


def representable(value):
    """the nearest double of value is finite, and nonzero unless value is 0"""
    x = float(value)
    return not (math.isinf(x) or (x == 0 and Decimal(value) != 0))


def constants(benchmark):
    """(rows with >= 17 digits and a double input, rows with >= 17 digits out of the range of doubles)"""
    rows = [r for r in csv.DictReader(open(constants_path(benchmark), encoding='utf-8'), delimiter='\t')
            if int(r['digits']) >= 17]
    return [r for r in rows if representable(r['value'])], [r for r in rows if not representable(r['value'])]
