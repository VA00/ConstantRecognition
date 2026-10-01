"""import_oeis_nice_core.py - OEIS constants with keyword "nice" or "core" into constants_v0_sources.tsv

Author: Andrzej Odrzywolek
Date: September 30, 2026
Code assist: Claude Opus 5.5

OEIS holds about 15,000 decimal expansions of constants (keyword "cons",
about 4% of all sequences); they are a separate, larger benchmark. Only the
ones the editors marked "nice" or "core" are taken here.

Per sequence: the digits are its terms (%S %T %U lines), the value is
0.d1 d2 d3 ... * 10^offset. The formula is written here (FORMULA), from the
name, the %F formulas or the %t Mathematica line of the entry; empty when
the constant has no closed form. Left out (EXCLUDED): sequences that are not
constants, physical measurements, an integer, a binary expansion, and a
duplicate with too few digits to be merged.

Replaces the rows of source "OEIS keyword:cons with ..." and keeps the others.

Usage:  python import_oeis_nice_core.py
"""
import collections
import csv
import datetime
import os
import re
import sys
import urllib.parse
import urllib.request

BENCH = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCES = os.path.join(BENCH, 'data', 'v0', 'constants_v0_sources.tsv')

SOURCE = f'OEIS keyword:cons with keyword:nice or keyword:core (fetched {datetime.date.today().isoformat()})'
EXCLUDED = {
    'A000007': 'not a constant: characteristic function of {0}',
    'A000012': 'not a constant: the all 1s sequence',
    'A000035': 'not a constant: n mod 2',
    'A057427': 'not a constant: 1 for n > 0',
    'A003131': 'an integer: order of the Monster group',
    'A003677': 'physical measurement: proton mass',
    'A005601': 'physical measurement: proton-to-electron mass ratio',
    'A079365': 'binary expansion (Chaitin Omega)',
    'A065421': "duplicate: Brun's constant, 9 digits (Wikipedia has 13); too few digits to be merged by value",
}
OFFSET = {'A012245': 0}   # characteristic function of the factorials: its offset is that of a sequence, the value is 0.110001...
# names the name of the entry does not give in a few words
NAME = {
    'A001622': 'golden ratio', 'A001620': "Euler's constant gamma", 'A000796': 'Pi', 'A002117': "Apery's constant zeta(3)",
    'A012245': "Liouville's constant", 'A052119': 'continued fraction [0; 1, 2, 3, 4, ...]',
    'A059526': 'real part of the solution of z = log z', 'A059527': 'imaginary part of the solution of z = log z',
    'A278813': 'c for which b(n+1) = c^(b(n)/n) neither explodes nor converges (A278453)',
    'A379651': 'smallest number > 1 with the same digits in decimal and binary',
    'A242168': 'integral of the q-Pochhammer symbol over -1..1', 'A057823': 'q of the maximum of the Dedekind eta function',
    'A233700': '2 Pi/sin(arctan(2 Pi))', 'A383289': 'triple integral of ({x/y}{y/z}{z/x})^2 over the unit cube',
    'A167155': 'exponential primorial constant',
}
FORMULA = {
    'A001622': 'GoldenRatio',
    'A001620': 'EulerGamma',
    'A000796': 'Pi',
    'A001113': 'E',
    'A002117': 'Zeta[3]',
    'A013661': 'Pi^2/6',
    'A074962': 'Glaisher',
    'A060006': 'Root[#1^3 - #1 - 1 &, 1]',
    'A002210': 'Khinchin',
    'A052119': 'BesselI[1, 2]/BesselI[0, 2]',          # continued fraction [0; 1, 2, 3, ...]
    'A201488': 'Cos[Pi/8]^2',
    'A014549': '1/ArithmeticGeometricMean[1, Sqrt[2]]',
    'A073012': '4/105 + 17/105*Sqrt[2] - 2/35*Sqrt[3] + 1/5*Log[1 + Sqrt[2]] + 2/5*Log[2 + Sqrt[3]] - 1/15*Pi',
    'A053004': 'ArithmeticGeometricMean[1, Sqrt[2]]',
    'A012245': 'Sum[10^(-n!), {n, 1, Infinity}]',
    'A153810': '1 - EulerGamma',
    'A222056': '6*PrimeZetaP[2]/Pi^2',
    'A060007': 'Root[#1^4 - #1 - 1 &, 2]',
    'A013706': '2*Sum[(-1)^(k - 1)/(2*k - 1), {k, 1, 50000}]',
    'A013707': 'Sum[(-1)^(k + 1)/k, {k, 1, 50000}]',
    'A059526': 'Re[-ProductLog[-1]]',                   # z = log z: z = -W(-1)
    'A059527': 'Im[ProductLog[-1]]',
    'A077589': 'Re[-ProductLog[-Log[I]]/Log[I]]',
    'A077590': 'Im[-ProductLog[-Log[I]]/Log[I]]',
    'A137421': 'Root[#1^3 + #1^2 - #1 - 2 &, 1]',
    'A242168': '4*Sqrt[3/23]*Pi*(2*Sinh[Sqrt[23]*Pi/6] + Sqrt[2]*Sinh[Sqrt[23]*Pi/4])/(2*Cosh[Sqrt[23]*Pi/3] - 1)',
    'A085851': 'Root[-32751691810479015985152 + 97143135277377575190528*#1^4 - 73347491183630103871488*#1^6 - '
               '71220809441400405884928*#1^8 + 107155448150443388043264*#1^10 - 72405670285649161617408*#1^12 + '
               '2958015038376958230528*#1^14 + 7449488310131083100160*#1^16 + 797726698866658379776*#1^18 + '
               '2505062311720673792*#1^20 + 2013290651222784*#1^22 + 25937424601*#1^24 &, 2]',
    'A169670': '9099999999923/27500000000000',
    'A233700': '2*Pi/Sin[ArcTan[2*Pi]]',
    'A383289': '1 - Zeta[2]/2 - Zeta[3]/2 + 7*Zeta[6]/48 + Zeta[2]*Zeta[3]/18 + Zeta[3]^2/18 + Zeta[3]*Zeta[4]/12',
    'A243407': '5/3 + Log[9, 32]',
}


def search(query):
    url = 'https://oeis.org/search?' + urllib.parse.urlencode({'q': query, 'fmt': 'text', 'n': 100})
    text = urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'ConstantRecognition benchmark'}), timeout=120).read().decode('utf-8')
    m = re.search(r'Showing 1-(\d+) of (\d+)', text)
    if not m or m.group(1) != m.group(2):
        sys.exit(f'{query}: not all results on one page')
    entries = collections.OrderedDict()
    for line in text.splitlines():
        m = re.match(r'^%(\w) (A\d{6}) ?(.*)$', line)
        if m:
            entries.setdefault(m.group(2), collections.defaultdict(list))[m.group(1)].append(m.group(3))
    return entries


def name(n):
    n = re.sub(r'^Decimal expansion of (the )?', '', n).rstrip('.')
    return re.split(r' = |; |: ', n)[0]


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    entries = search('keyword:cons keyword:nice')
    for a, e in search('keyword:cons keyword:core').items():
        entries.setdefault(a, e)
    rows, excluded = [], []
    for a, e in entries.items():
        if a in EXCLUDED:
            excluded.append(a)
            continue
        digits = ''.join(''.join(e[t]) for t in 'STU').replace(',', '')
        if not digits.isdigit():
            sys.exit(f'{a}: terms are not digits')
        offset = OFFSET.get(a, int(e['O'][0].split(',')[0]))
        rows.append([SOURCE, a, NAME.get(a) or name(e['N'][0]), FORMULA.get(a, ''), f'0.{digits}e{offset}', ''])
    old = list(csv.reader(open(SOURCES, encoding='utf-8'), delimiter='\t'))
    kept = [r for r in old if not r[0].startswith('OEIS keyword:cons with')]
    with open(SOURCES, 'w', encoding='utf-8', newline='') as f:
        for r in kept + rows:
            f.write('\t'.join(r) + '\n')
    print(f'kept {len(kept) - 1} rows of other sources; added {len(rows)} OEIS rows '
          f'({sum(r[3] != "" for r in rows)} with a formula); excluded {len(excluded)}: {", ".join(excluded)}')


if __name__ == '__main__':
    main()
