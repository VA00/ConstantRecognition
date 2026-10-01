"""import_aands_table_1_1.py - Abramowitz & Stegun Table 1.1 into constants_v0_sources.tsv

Author: Andrzej Odrzywolek
Date: September 30, 2026
Code assist: Claude Opus 5.5

Table 1.1, Mathematical Constants (pages 2-3) of Abramowitz & Stegun,
Handbook of Mathematical Functions, 10th printing (December 1972, with
corrections), from the public-domain scan https://archive.org/details/AandS-mono600.

The digits are never typed: they are read from archive.org's OCR (hOCR, with
the position of every word). Words on one printed line are joined; the left
and right half of each page are separate columns. Each column holds its
entries in a fixed order, and ORDER below gives the label and the
Mathematica formula of each entry, in that order (read from the page
images). "(k)" before a value is the factor 10^k.

Asterisks mark values corrected since the first printing (errata notice on
page II). The OCR finds three of them; the fourth, at pi*2^(1/2) on page 3,
is in STARRED as read from the image.

Replaces the rows of source "Abramowitz & Stegun ..." and keeps the others.

Usage:  python import_aands_table_1_1.py
"""
import csv
import gzip
import json
import os
import re
import sys
import urllib.request

BENCH = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCES = os.path.join(BENCH, 'data', 'v0', 'constants_v0_sources.tsv')

ITEM = 'https://archive.org/download/AandS-mono600/AandS-mono600'
LEAVES = {2: 15, 3: 16}   # book page -> scan leaf
SOURCE = 'Abramowitz & Stegun, Table 1.1 (10th printing 1972, archive.org AandS-mono600 OCR)'

primes = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61, 67, 71, 73, 79, 83, 89, 97]
ln_n = [2, 3, 4, 5, 6, 7, 8, 9, 10] + primes[4:]            # ln n and log10 n rows
q = ['1/2', '1/3', '2/3', '1/4', '3/4', '4/3', '5/3', '5/4', '7/4']
_ = None   # an entry of the table not taken (log10 10 = 1)

ORDER = {
    (2, 'left'):
        [(f'sqrt({n})', f'Sqrt[{n}]') for n in primes]
        + [(f'e^{n}', f'E^{n}') for n in range(1, 11)]
        + [(f'e^({n}pi)', f'E^({n}*Pi)') for n in range(1, 11)]
        + [('e^e', 'E^E'), ('e^gamma', 'E^EulerGamma')]
        + [(f'ln({n})', f'Log[{n}]') for n in ln_n[:19]],
    (2, 'right'):
        [(f'{b}^({e})', f'{b}^({e})') for b, e in [(10, '1/2'), (10, '1/3'), (10, '1/4'), (10, '1/5'), (100, '1/3'), (100, '1/5'),
                                                   (1000, '1/4'), (1000, '1/5'), (2, '1/3'), (3, '1/3'), (2, '1/4'), (3, '1/4'),
                                                   (2, '-1/2'), (3, '-1/2'), (5, '-1/2')]]
        + [(f'e^({e})', f'E^({f})') for e, f in [('pi/2', 'Pi/2'), ('pi/4', 'Pi/4'), ('-pi/2', '-Pi/2'), ('-pi/4', '-Pi/4'),
                                                 ('1/2', '1/2'), ('-1/2', '-1/2'), ('1/3', '1/3'), ('-1/3', '-1/3')]]
        + [(f'e^-{n}', f'E^(-{n})') for n in range(1, 11)]
        + [(f'e^(-{n}pi)', f'E^(-{n}*Pi)') for n in range(1, 11)]
        + [('e^-e', 'E^(-E)'), ('e^-gamma', 'E^(-EulerGamma)')]
        + [(f'log10({n})', f'Log[10, {n}]') if n != 10 else _ for n in ln_n[:19]],
    (3, 'left'):
        [(f'ln({n})', f'Log[{n}]') for n in ln_n[19:]]
        + [('ln(pi)', 'Log[Pi]'), ('ln(sqrt(2pi))', 'Log[Sqrt[2*Pi]]')]
        + [(f'{n}ln(10)', f'{n}*Log[10]') for n in range(1, 10)]
        + [(f'pi^{n}', f'Pi^{n}') for n in range(1, 11)]
        + [('pi/2', 'Pi/2'), ('pi/3', 'Pi/3'), ('pi/4', 'Pi/4'), ('pi^(1/2)', 'Pi^(1/2)'), ('pi^(1/3)', 'Pi^(1/3)'),
           ('pi^(1/4)', 'Pi^(1/4)'), ('pi^(2/3)', 'Pi^(2/3)'), ('pi^(3/4)', 'Pi^(3/4)'), ('pi^(3/2)', 'Pi^(3/2)'),
           ('pi^e', 'Pi^E'), ('(2pi)^(1/2)', '(2*Pi)^(1/2)'), ('(pi/2)^(1/2)', '(Pi/2)^(1/2)'), ('pi(2)^(-1/2)', 'Pi*2^(-1/2)'),
           ('1 radian in degrees', '180/Pi'), ('1 degree in radians', 'Pi/180'), ('gamma', 'EulerGamma')]
        + [(f'Gamma({x})', f'Gamma[{x}]') for x in q]
        + [(f'ln(Gamma({x}))', f'LogGamma[{x}]') for x in ['1/3', '2/3', '1/4', '3/4']],
    (3, 'right'):
        [(f'log10({n})', f'Log[10, {n}]') for n in ln_n[19:]]
        + [('log10(pi)', 'Log[10, Pi]'), ('log10(e)', 'Log[10, E]')]
        + [(f'{n}pi', f'{n}*Pi') for n in range(1, 10)]
        + [(f'pi^-{n}', f'Pi^(-{n})') for n in range(1, 11)]
        + [('3pi/2', '3*Pi/2'), ('4pi/3', '4*Pi/3'), ('pi(2)^(1/2)', 'Pi*2^(1/2)'), ('pi^(-1/2)', 'Pi^(-1/2)'), ('pi^(-1/3)', 'Pi^(-1/3)'),
           ('pi^(-1/4)', 'Pi^(-1/4)'), ('pi^(-2/3)', 'Pi^(-2/3)'), ('pi^(-3/4)', 'Pi^(-3/4)'), ('pi^(-3/2)', 'Pi^(-3/2)'),
           ('pi^-e', 'Pi^(-E)'), ('(2pi)^(-1/2)', '(2*Pi)^(-1/2)'), ('(2/pi)^(1/2)', '(2/Pi)^(1/2)'), ('2^(1/2)/pi', '2^(1/2)/Pi'),
           ('1 arcminute in radians', 'Pi/10800'), ('1 arcsecond in radians', 'Pi/648000'), ('ln(gamma)', 'Log[EulerGamma]')]
        + [(f'1/Gamma({x})', f'1/Gamma[{x}]') for x in q]
        + [(f'ln(Gamma({x}))', f'LogGamma[{x}]') for x in ['4/3', '5/3', '5/4', '7/4']],
}
STARRED = {'pi(2)^(1/2)'}   # asterisk the OCR misses
# last digit off by more than one unit (checked with mpmath and Mathematica)
ERRATA = {
    '10^(1/3)': 'erratum: last digit, 2.1544346900318837219 should be ...218 (2.15443469003188372176)',
    '100^(1/5)': 'erratum: last digit, 2.5118864315095801112 should be ...111 (2.51188643150958011109)',
    'ln(sqrt(2pi))': 'erratum: last digit, 0.9189385332046727417803296 should be ...297 (0.91893853320467274178032974)',
}

# a value: optional "(k)" (OCR reads 1 as D, i, I, l and "(" as c), then d.dddd and groups of digits
EXP = r'(?:[(c]\s*([-_—–]?)\s*([0-9DiIlO]+)\s*\)\s*)?'
VALUE = re.compile(EXP + r'(-?\d+)\.\s?(\d{4})((?:\s\d{5,6})+)')


def fetch(url, byte_range=None):
    req = urllib.request.Request(url, headers={'User-Agent': 'ConstantRecognition benchmark'})
    if byte_range:
        req.add_header('Range', 'bytes=%d-%d' % byte_range)
    return urllib.request.urlopen(req, timeout=120).read()


def page_lines(leaf, index):
    """Printed lines of one scan leaf: [(y, left text, right text, right has an asterisk)]."""
    start, end = index[leaf][2], index[leaf][3]
    h = fetch(ITEM + '_hocr.html', (start, end - 1)).decode('utf-8')
    words = []
    for m in re.finditer(r'class="ocrx_word"[^>]*title="bbox (\d+) (\d+) (\d+) (\d+);[^"]*"[^>]*>([^<]*)<', h):
        x0, y0, x1, y1 = map(int, m.groups()[:4])
        words.append((x0, (y0 + y1) / 2, m.group(5).strip()))
    words.sort(key=lambda w: w[1])
    lines = []
    for w in words:
        if lines and abs(w[1] - lines[-1][0]) < 25:
            lines[-1][1].append(w)
        else:
            lines.append([w[1], [w]])
    out = []
    for y, ws in lines:
        ws.sort()
        left = ' '.join(w[2] for w in ws if w[0] < 2150)
        right = ' '.join(w[2] for w in ws if w[0] >= 2150 and w[2] != '*')
        out.append((y, left, right, any(w[2] == '*' and w[0] > 3900 for w in ws)))
    return out


def value(text):
    """'(-1) 3. 0102 99956 ...' -> '3.010299956...e-1', or None when the text holds no value."""
    m = VALUE.search(re.sub(r'\((\s*-?)\s*D', r'(\g<1>1)', text))   # "(-D": the OCR reads "1)" as "D"
    if not m:
        return None
    sign, k, whole, first, groups = m.groups()
    exp = 0
    if k:
        exp = int(k.translate(str.maketrans('DiIlO', '11110')))
        exp = -exp if sign else exp
    digits = first + ''.join(groups.split())
    return f'{whole}.{digits}e{exp}'


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    index = json.loads(gzip.decompress(fetch(ITEM + '_hocr_pageindex.json.gz')))
    rows = []
    for page, leaf in LEAVES.items():
        lines = page_lines(leaf, index)
        for col in ('left', 'right'):
            found = [(value(l[1] if col == 'left' else l[2]), l[3] and col == 'right', l) for l in lines]
            found = [f for f in found if f[0]]
            order = ORDER[(page, col)]
            if len(found) != len(order):
                sys.exit(f'page {page} {col}: {len(found)} values in the OCR, {len(order)} in ORDER')
            for (v, star, line), entry in zip(found, order):
                if entry is None:
                    continue
                label, formula = entry
                note = '; '.join(n for n in (ERRATA.get(label, ''),
                                             'corrected since the first printing (asterisk)' if star or label in STARRED else '') if n)
                rows.append([SOURCE, label, label, formula, v, note])
    old = list(csv.reader(open(SOURCES, encoding='utf-8'), delimiter='\t'))
    kept = [r for r in old if not r[0].startswith('Abramowitz & Stegun')]
    with open(SOURCES, 'w', encoding='utf-8', newline='') as f:
        for r in kept + rows:
            f.write('\t'.join(r) + '\n')
    print(f'kept {len(kept) - 1} rows of other sources; added {len(rows)} A&S rows, '
          f'{sum("asterisk" in r[5] for r in rows)} with an asterisk, {sum("erratum" in r[5] for r in rows)} errata')


if __name__ == '__main__':
    main()
