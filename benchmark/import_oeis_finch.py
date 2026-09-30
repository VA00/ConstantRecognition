"""import_oeis_finch.py - OEIS constants citing Finch's Mathematical Constants into constants_v0_sources.tsv

Author: Andrzej Odrzywolek
Date: September 30, 2026
Code assist: Claude Opus 5.5

Steven R. Finch, Mathematical Constants (Cambridge University Press, 2003)
and Mathematical Constants II (2018) are the most complete hand-made
collections of constants. The books themselves are a source for the larger
benchmark; here are the OEIS decimal expansions (keyword "cons") whose
references cite either book, about 900.

Reads a checkout of the OEIS data repository (https://github.com/oeis/oeisdata);
the decimal expansions are enough, a sparse clone of about 70 MB:

  git clone --depth 1 --filter=blob:none --no-checkout https://github.com/oeis/oeisdata.git
  cd oeisdata && git sparse-checkout init --no-cone
  git sparse-checkout set --stdin < paths.txt     # seq/A000/A000796.seq, ... for every
  git checkout main                               # "Decimal expansion" in oeis.org/names.gz

Per sequence: the digits are its terms, the value is 0.d1 d2 ... * 10^offset.
The formula is the expression inside RealDigits[...] of the first
Mathematica line (%t) that has one, with an outer N[...] removed. The build
runs formulas with ToExpression, so an expression is taken only when it is
plain mathematics: every capitalized name is in ALLOWED, a lowercase name is
only a bound variable of Sum, Product or Integrate ({k, ...}), and there is
no assignment, ";", "/.", "@", "//", option ("->") or pure function outside Root. Otherwise the row has
the digits only. NEGATED: the digits are of minus the value of the
Mathematica line (RealDigits drops the sign).

Replaces the rows of source "OEIS citing Finch ..." and keeps the others.

Usage (from this directory):  python import_oeis_finch.py <path to oeisdata>
"""
import collections
import csv
import glob
import os
import re
import subprocess
import sys

ALLOWED = set('''Pi E I Infinity Degree EulerGamma Catalan GoldenRatio Glaisher Khinchin
    Sqrt CubeRoot Surd Power Times Plus Log Log10 Log2 Exp Abs Re Im Floor
    Sin Cos Tan Cot Sec Csc ArcSin ArcCos ArcTan ArcCot ArcSec ArcCsc
    Sinh Cosh Tanh Coth Sech Csch ArcSinh ArcCosh ArcTanh ArcCoth ArcSech ArcCsch
    Gamma LogGamma PolyGamma Beta BarnesG Zeta HurwitzZeta StieltjesGamma ZetaZero PrimeZetaP PolyLog LerchPhi
    EllipticK EllipticE EllipticTheta ArithmeticGeometricMean ProductLog ExpIntegralEi LogIntegral
    SinIntegral CosIntegral Erf Erfc DawsonF BesselI BesselJ BesselK BesselY BesselJZero AiryAi AiryBi
    Hypergeometric2F1 HypergeometricPFQ QPochhammer Binomial Factorial Fibonacci Prime MoebiusMu
    Sum Product Integrate Root'''.split())


def first_arg(s, i):
    """The first argument of the call whose '[' is just before s[i], bracket-balanced."""
    depth = 0
    for j in range(i, len(s)):
        c = s[j]
        if c in '[({':
            depth += 1
        elif c in '])}':
            if depth == 0:
                return s[i:j]
            depth -= 1
        elif c == ',' and depth == 0:
            return s[i:j]
    return None


def formula(lines):
    for t in lines:
        k = t.find('RealDigits[')
        if k < 0:
            continue
        x = first_arg(t, k + len('RealDigits['))
        if x is None:
            return ''
        base = re.match(r'\s*,\s*(\d+)', t[k + len('RealDigits[') + len(x):])
        if base and base.group(1) != '10':      # an intermediate expansion in another base
            return ''
        x = x.strip()
        while x.startswith('N[') and first_arg(x, 2) is not None:     # N[expr] or N[expr, n]
            inner = first_arg(x, 2)
            rest = x[2 + len(inner):]
            if not re.fullmatch(r'\s*(,\s*\d+\s*)?\]', rest):
                break
            x = inner.strip()
        if re.search(r':=|(?<![=!<>])=(?!=)|;|/\.|@|//|->|\bN\[', x):
            return ''
        if ('#' in x or '&' in x) and not x.startswith('Root['):
            return ''
        bound = set(re.findall(r'\{\s*([a-z]\w*)\s*,', x))
        for name in re.findall(r'(?<![\w$`])[A-Za-z$][A-Za-z0-9$]*', x):
            if name[0].isupper() and name not in ALLOWED:
                return ''
            if not name[0].isupper() and name not in bound:
                return ''
        return x
    return ''


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    root = sys.argv[1]
    commit = subprocess.run(['git', '-C', root, 'log', '-1', '--format=%h %cs'], capture_output=True, text=True).stdout.strip()
    source = f'OEIS citing Finch, Mathematical Constants I or II (oeisdata {commit})'
    rows = []
    for f in sorted(glob.glob(os.path.join(root, 'seq', '*', '*.seq'))):
        e = collections.defaultdict(list)
        for line in open(f, encoding='utf-8', errors='replace'):
            m = re.match(r'^%(\w) (A\d{6}) ?(.*)$', line.rstrip('\n'))
            if m:
                e[m.group(1)].append(m.group(3))
                a = m.group(2)
        refs = ' '.join(e['D'])
        if 'cons' not in ''.join(e['K']).split(',') or not ('Finch, Mathematical Constants' in refs or 'Mathematical Constants II' in refs):
            continue
        digits = ''.join(''.join(e[t]) for t in 'STU').replace(',', '').replace(' ', '')
        if not digits.isdigit():
            print(f'  {a}: skipped, terms are not digits')
            continue
        offset = int(e['O'][0].split(',')[0])
        name = re.sub(r'^Decimal expansion of (the )?', '', e['N'][0]).rstrip('.')
        f_ = formula(e['t'])
        if a in NEGATED and f_:
            f_ = f'-({f_})'
        rows.append([source, a, name[:120], f_, f'0.{digits}e{offset}', ''])
    old = list(csv.reader(open('constants_v0_sources.tsv', encoding='utf-8'), delimiter='\t'))
    kept = [r for r in old if not r[0].startswith('OEIS citing Finch')]
    with open('constants_v0_sources.tsv', 'w', encoding='utf-8', newline='') as out:
        for r in kept + rows:
            out.write('\t'.join(r) + '\n')
    print(f'kept {len(kept) - 1} rows of other sources; added {len(rows)} OEIS rows citing Finch '
          f'({sum(r[3] != "" for r in rows)} with a formula)')


NEGATED = {   # the name says negated, or the constant is |x| of a negative x (found by the build)
    'A059750', 'A086280', 'A086281', 'A086282', 'A126689', 'A244000', 'A245273', 'A245275', 'A245276',
    'A246687', 'A247017', 'A259070', 'A259071', 'A259072', 'A261829', 'A261830',
}

if __name__ == '__main__':
    main()
