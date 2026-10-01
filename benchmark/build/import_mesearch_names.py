"""import_mesearch_names.py - constants predefined in MESearch 2.0 that the other sources miss

Author: Andrzej Odrzywolek
Date: September 30, 2026
Code assist: Claude Opus 5.5

MESearch 2.0 (J. Zurutuza Salsamendi, 2013; https://tilde.green/~danny12/MESearch/)
has 158 predefined named constants, in the order of Finch's Mathematical
Constants, which its User Guide names as its reference. Only the names are
used here (from its interface text); its values are compiled into the
program and its license forbids decompiling, and they are not needed: the
digits come from the OEIS entry of each constant.

Of the 158, all but those in MAP are already in the benchmark (under these
or other names: pi, e, Madelung M3 = NaCl, Polya P4 = 4-D return
probability, ...). Without an OEIS entry, and so left out: the Smarandache
constants, Fill's logarithmic constants, the quadratic residues constant,
the Stolarsky-Harborth constant, the Quinn-Rand-Strogatz c1, c3, c4 and C,
the abelian group enumeration constants A2 and A3.

Reads a checkout of the OEIS data repository, see import_oeis_finch.py.
Replaces the rows of source "MESearch ..." and keeps the others.

Usage:  python import_mesearch_names.py <path to oeisdata>
"""
import collections
import csv
import os
import re
import subprocess
import sys

from import_oeis_finch import formula

BENCH = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCES = os.path.join(BENCH, 'data', 'v0', 'constants_v0_sources.tsv')

MAP = {   # MESearch name -> OEIS decimal expansion
    "Wagon's constant": 'A122790',
    'Maximal unitary square-free divisor sum constant': 'A191622',
    'Quinn-Rand-Strogatz constant c2 (negated)': 'A244850',
    'Series-parallel networks constant': 'A058964',
    "Rumor's constant": 'A106533',
    "Otter's weakly binary tree enumeration asymptotic constant xi": 'A086317',
}


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    root = sys.argv[1]
    commit = subprocess.run(['git', '-C', root, 'log', '-1', '--format=%h'], capture_output=True, text=True).stdout.strip()
    source = f'MESearch 2.0 predefined constants (names), digits from OEIS (oeisdata {commit})'
    rows = []
    for name, a in MAP.items():
        e = collections.defaultdict(list)
        for line in open(os.path.join(root, 'seq', a[:4], a + '.seq'), encoding='utf-8'):
            m = re.match(r'^%(\w) A\d{6} ?(.*)$', line.rstrip('\n'))
            if m:
                e[m.group(1)].append(m.group(2))
        digits = ''.join(''.join(e[t]) for t in 'STU').replace(',', '').replace(' ', '')
        assert digits.isdigit(), a
        offset = int(e['O'][0].split(',')[0])
        rows.append([source, a, name, formula(e['t']), f'0.{digits}e{offset}', ''])
    old = list(csv.reader(open(SOURCES, encoding='utf-8'), delimiter='\t'))
    kept = [r for r in old if not r[0].startswith('MESearch')]
    with open(SOURCES, 'w', encoding='utf-8', newline='') as out:
        for r in kept + rows:
            out.write('\t'.join(r) + '\n')
    print(f'kept {len(kept) - 1} rows of other sources; added {len(rows)} MESearch rows ({sum(r[3] != "" for r in rows)} with a formula)')


if __name__ == '__main__':
    main()
