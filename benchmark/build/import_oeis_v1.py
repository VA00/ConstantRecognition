"""import_oeis_v1.py - benchmark v1: all OEIS decimal expansions, into data/v1/constants_v1_sources.tsv

Author: Andrzej Odrzywolek
Date: October 11, 2026
Code assist: Claude Opus 5.5

Benchmark v1 is every decimal expansion of a constant in the OEIS: the entries with keyword "cons", not
dead, whose terms are single digits, and whose name says "decimal expansion" or that lack keyword "base"
(expansions in other bases have it; so does Champernowne's decimal constant, hence the name test).
Arrays of several expansions (keyword "tabl") are not one constant and are left out.

Reads a sparse checkout of the OEIS data repository (https://github.com/oeis/oeisdata) holding these
entries, and their b-files; fetch_oeis_v1.py fetches both (see BUILD_v1.md). Run it first.

Per entry: the digits are its terms, the value is 0.d1 d2 ... * 10^offset (offset = first number of %O),
with the offset corrected for the entries in OFFSET_ERRATA.
Checks; an entry that fails one is kept and marked suspicious:
  - b-file against terms, digit by digit at the same index n. The value then has only the digits both
    agree on. A last term that is the b-file's digit rounded up is not suspicious ("last term rounded").
  - a malformed b-file (indices not consecutive, a term that is not a digit), one that starts at
    another index than the terms
  - near duplicates: two entries that agree to >= 10 digits but not to all digits both have (a typo in
    one of them, or a genuine near-identity such as pi and Ramanujan's approximation)
Not suspicious, noted: entries with the same digits (the same constant twice in the OEIS).
The formula is the expression of the entry's Mathematica line, as for v0 (import_oeis_finch.formula);
build_constants_v1.wls evaluates it and checks it against the digits.

Columns: key, name, keywords (without cons, nonn), offset, digits (significant digits of the value, at
most 80), ndigits (how many significant digits are known), source (terms or b-file, with lengths),
formula, check ("ok" or why the entry is suspicious), notes, v0 (id of the same constant in constants_v0.tsv).

Usage:  python import_oeis_v1.py <path to oeisdata> [--bfiles DIR]   (default <oeisdata>/files)
"""
import argparse
import collections
import csv
import glob
import os
import re
import subprocess
import sys

from import_oeis_finch import formula

BENCH = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(BENCH, 'data', 'v1', 'constants_v1_sources.tsv')
V0 = os.path.join(BENCH, 'data', 'v0', 'constants_v0.tsv')
KEEP = 80             # significant digits written

# Wrong offsets in the OEIS (2026-10-11): the digits are right, the decimal point is not. Found by
# build_constants_v1.wls, where the entry's formula differed from the digits by a power of 10; the name,
# the formula and the %e or %F line agree on the corrected value. A-number -> correct offset.
OFFSET_ERRATA = {
    'A102521': 0,   # Ahmed's 2nd integral, 0.5904...
    'A110993': 4,   # zeta(zeta(10)) = 1006.03...
    'A111513': 1,   # |log_10 sin 1 degree| = 1.758...
    'A113272': 1,   # Gamma(1/4)^4/Pi^3 = 5.572...
    'A113477': 1,   # Gamma(1/3)^3/(2^(4/3) Pi) = 2.428...
    'A156547': 0,   # central angle of the dodecahedron, arccos(sqrt(5)/3) = 0.7297...
    'A160205': 1,   # (989043 + 524338 sqrt(2))/809^2 = 2.644...
    'A179449': 0,   # volume of the great icosahedron, (5/12)(3 - sqrt(5)) = 0.3183...
    'A242600': 0,   # -dilog(phi) = 0.5421...
    'A245698': 0,   # expected distance in an equilateral triangle, 0.2656...
    'A246644': 0,   # real root of s^3 - s^2 + s - 1/3, 0.4424...
    'A301862': 0,   # probabilities of intersecting chords, 0.5866..., 0.6781..., 0.7277...
    'A301863': 0,
    'A301864': 0,
    'A319129': 1,   # (1 + sqrt(3) + sqrt(2 sqrt(3)))/2 = 2.296...
    'A352527': 0,   # -Sum_{k>=1} (-1)^k zeta(2k)/(2k) = 0.6509...
}


def read_seq(f):
    e = collections.defaultdict(list)
    a = None
    for line in open(f, encoding='utf-8', errors='replace'):
        m = re.match(r'^%(\w) (A\d{6}) ?(.*)$', line.rstrip('\n'))
        if m:
            e[m.group(1)].append(m.group(3))
            a = m.group(2)
    return a, e


def read_bfile(path):
    """{n: digit} and a problem description ('' when well formed); None when absent or still an LFS pointer"""
    if not os.path.exists(path):
        return None, ''
    text = open(path, encoding='utf-8', errors='replace').read()
    if text.startswith('version https://git-lfs'):
        return None, ''
    d, problem, last = {}, '', None
    for line in text.splitlines():
        s = line.strip()
        if not s or s.startswith('#'):
            continue
        m = re.match(r'^(-?\d+)\s+(-?\d+)', s)
        if not m:
            problem = problem or f'b-file line not "n a(n)": {s[:30]}'
            continue
        n, v = int(m.group(1)), m.group(2)
        if last is not None and n != last + 1:
            problem = problem or f'b-file indices not consecutive at n={n}'
        if len(v) != 1:
            problem = problem or f'b-file term {v} at n={n} is not a digit'
        d[n] = v[-1]
        last = n
    return d, problem


def significant(digits, offset):
    """terms d1 d2 ... with value 0.d1d2... * 10^offset -> (significant digit string, exponent of the first)"""
    s = digits.lstrip('0')
    lead = len(digits) - len(s)
    return s, offset - lead - 1


def rounded(sig, keep):
    """the first keep significant digits, rounded half up (carry may add a digit: returns (digits, carry))"""
    if len(sig) <= keep:
        return sig, 0
    head = sig[:keep]
    if sig[keep] >= '5':
        n = str(int(head) + 1)
        if len(n) > keep:
            return n[:keep], 1
        return n, 0
    return head, 0


def agree(a, b):
    """common leading digits of two (sig, exp) values with the same exponent"""
    if a[1] != b[1]:
        return 0
    k = 0
    for x, y in zip(a[0], b[0]):
        if x != y:
            break
        k += 1
    return k


def select(root):
    """the v1 entries of the checkout: [(A-number, fields, keywords, name, terms)], and the skipped by reason"""
    entries, skipped = [], collections.Counter()
    for f in sorted(glob.glob(os.path.join(root, 'seq', '*', '*.seq'))):
        a, e = read_seq(f)
        if a is None:
            continue
        kw = ''.join(e['K']).split(',')
        name = e['N'][0] if e['N'] else ''
        terms = ''.join(''.join(e[t]) for t in 'STU').replace(' ', '').split(',')
        if 'cons' not in kw:
            continue
        if 'dead' in kw:
            skipped['dead'] += 1
            continue
        if not all(t.isdigit() and len(t) == 1 for t in terms):
            skipped['terms not digits'] += 1
            continue
        if 'base' in kw and not re.search(r'decimal expansion', name, re.I):
            skipped['other base'] += 1
            continue
        if 'tabl' in kw:
            skipped['array (tabl)'] += 1
            continue
        entries.append((a, e, kw, name, terms))
    return entries, skipped


def has_bfile(a, e):
    return any(f'/{a}/b{a[1:]}.txt' in h for h in e['H'])


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    ap = argparse.ArgumentParser()
    ap.add_argument('oeisdata')
    ap.add_argument('--bfiles', help='directory of the b-files, A000/b000796.txt, ... (default <oeisdata>/files)')
    args = ap.parse_args()
    root = args.oeisdata
    bdir = args.bfiles or os.path.join(root, 'files')
    commit = subprocess.run(['git', '-C', root, 'log', '-1', '--format=%h %cs'], capture_output=True, text=True).stdout.strip()

    entries, skipped = select(root)
    print(f'oeisdata {commit}: {len(entries)} decimal expansions; skipped: {dict(skipped)}')

    rows, stats = [], collections.Counter()
    for a, e, kw, name, terms in entries:
        offset = int(e['O'][0].split(',')[0])
        n0 = offset                                # index of the first term: for "cons" the offset
        tdig = ''.join(terms)
        has_link = has_bfile(a, e)
        b, bproblem = read_bfile(os.path.join(bdir, a[:4], f'b{a[1:]}.txt')) if has_link else (None, '')
        check, notes, digits, source = [], [], tdig, f'terms({len(tdig)})'
        if has_link and b is None:
            notes.append('b-file not read')
            stats['b-file missing'] += 1
        if b is not None:
            stats['b-file'] += 1
            b0, b1 = min(b), max(b)
            if bproblem:
                check.append(bproblem)
            if b0 != n0:
                check.append(f'b-file starts at n={b0}, the terms at n={n0}')
            mism = [n for n in range(n0, n0 + len(tdig)) if n in b and b[n] != tdig[n - n0]]
            last = n0 + len(tdig) - 1
            if mism == [last] and int(tdig[-1]) == (int(b[last]) + 1) % 10:
                notes.append('last term rounded')
                mism = []
            if mism:
                k = mism[0] - n0          # digits before the first disagreement
                check.append(f'b-file differs from the terms at term {k + 1} ({tdig[k]} vs {b[mism[0]]})')
                digits = tdig[:k]
                source = f'terms({len(tdig)}) agree with b-file({len(b)}) to {k}'
            elif not bproblem and b0 == n0 and all(n in b for n in range(b0, b1 + 1)):
                bdig = ''.join(b[n] for n in range(b0, b1 + 1))
                if len(bdig) > len(tdig):
                    digits = bdig
                source = f'terms({len(tdig)}); b-file({len(bdig)})'
        point = OFFSET_ERRATA.get(a, offset)
        if point != offset:
            notes.append(f'OEIS offset {offset} corrected to {point} (the name and the formula agree)')
        sig, exp = significant(digits, point)
        r, carry = rounded(sig, KEEP)
        rows.append({'key': a, 'name': re.sub(r'^Decimal expansion of (the )?', '', name).rstrip('.')[:160],
                     'keywords': ','.join(k for k in kw if k not in ('cons', 'nonn')), 'offset': offset,
                     'sig': sig, 'exp': exp, 'digits': r, 'dexp': exp + carry, 'ndigits': len(sig), 'source': source,
                     'formula': formula(e['t']), 'check': check, 'notes': notes, 'v0': ''})

    # duplicates and near duplicates, by value
    srt = sorted((r for r in rows if r['ndigits'] >= 10), key=lambda r: (r['exp'], r['sig']))
    for x, y in zip(srt, srt[1:]):
        k, m = agree((x['sig'], x['exp']), (y['sig'], y['exp'])), min(x['ndigits'], y['ndigits'])
        if k >= m - 1:
            x['notes'].append(f'same digits as {y["key"]}')
            y['notes'].append(f'same digits as {x["key"]}')
            stats['same digits'] += 1
        elif k >= 10:
            x['check'].append(f'near duplicate of {y["key"]} (agree to {k} of {m} digits)')
            y['check'].append(f'near duplicate of {x["key"]} (agree to {k} of {m} digits)')
            stats['near duplicates'] += 1

    # the same constant in v0 (>= 12 digits, agreeing to all digits both have within one unit of the last,
    # as v0 rounds and the OEIS truncates; near-identities that agree to only 20 or 40 digits are not linked)
    v0 = collections.defaultdict(list)
    for r in csv.DictReader(open(V0, encoding='utf-8'), delimiter='\t'):
        m = re.match(r'^-?(\d*)\.?(\d*)(?:[eE]([+-]?\d+))?$', r['value'])    # 1.25, -0.10491, 0.123e5
        if not m:
            continue
        s, e = significant(m.group(1) + m.group(2), len(m.group(1)) + int(m.group(3) or 0))
        if int(r['digits']) >= 12:
            v0[s[:12], e].append((s, e, int(r['digits']), r['id']))
    for r in rows:
        if r['ndigits'] >= 12:
            for s, e, d, i in v0.get((r['sig'][:12], r['exp']), []):
                k = min(d, r['ndigits'])
                if abs(int(s[:k]) - int(r['sig'][:k])) <= 1:
                    r['v0'] = i
    stats['in v0'] = sum(r['v0'] != '' for r in rows)

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    cols = ['key', 'name', 'keywords', 'value', 'ndigits', 'source', 'formula', 'check', 'notes', 'v0']
    with open(OUT, 'w', encoding='utf-8', newline='') as fo:
        fo.write('\t'.join(cols) + '\n')
        for r in rows:
            value = f'0.{r["digits"]}e{r["dexp"] + 1}' if r['digits'] else ''
            fo.write('\t'.join(str(x) for x in (r['key'], r['name'].replace('\t', ' '), r['keywords'], value, r['ndigits'],
                                                 r['source'], r['formula'], '; '.join(r['check']) or 'ok',
                                                 '; '.join(r['notes']), r['v0'])) + '\n')
    sus = [r for r in rows if r['check']]
    print(f'wrote {len(rows)} rows ({sum(r["formula"] != "" for r in rows)} with a formula), '
          f'{sum(r["ndigits"] >= 17 for r in rows)} with >= 17 digits; suspicious: {len(sus)}; {dict(stats)}')
    reasons = collections.Counter(re.sub(r' (at|of|starts|differs).*', '', c) for r in sus for c in r['check'])
    print('suspicious, by reason:', dict(reasons))


if __name__ == '__main__':
    main()
