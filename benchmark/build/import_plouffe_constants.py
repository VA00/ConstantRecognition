"""import_plouffe_constants.py - Plouffe's Miscellaneous Mathematical Constants into constants_v0_sources.tsv

Author: Andrzej Odrzywolek
Date: September 30, 2026
Code assist: Claude Opus 5.5

Simon Plouffe (ed.), Miscellaneous Mathematical Constants, Project Gutenberg
eBook #634 (1996), https://www.gutenberg.org/ebooks/634: about 110 constants,
most to 1000-20000 digits, computed in Maple and elsewhere, independently of
Mathematica. Not the Inverse Symbolic Calculator tables.

The text is split into its sections (lines of dashes). SECTIONS gives, per
section number, the start of its title (checked, so that a changed file
fails instead of mislabeling rows) and one (key, name, formula) per digit
block of the section, in order; None skips a block. Formulas are the ones
the section states, written in Mathematica; empty for constants without a
closed form. Digits are copied from the blocks, truncated to 256
significant digits.

Left out: the identification requests sent to the ISC in 1995-1996 whose
numbers remain unidentified (sections 106, 108, 109, 111), and the request
of section 105: its number 1.60140224354988761393325 was matched with
-Integrate[Sqrt[x]/Log[1 - x], {x, 0, 1}] = 1.6014022435498875998..., which
agrees to 16 digits only.

Replaces the rows of source "Plouffe, ..." and keeps the others.

Usage:  python import_plouffe_constants.py
"""
import csv
import os
import re
import sys
import urllib.request

BENCH = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCES = os.path.join(BENCH, 'data', 'v0', 'constants_v0_sources.tsv')

URL = 'https://www.gutenberg.org/files/634/634.txt'
SOURCE = 'Plouffe, Miscellaneous Mathematical Constants (Project Gutenberg #634, 1996)'
DIGITS = 256

S = {
    2: ('1-6/(Pi^2)', [('1-6/pi^2', '1 - 6/pi^2', '1 - 6/Pi^2')]),
    3: ('1/log(2)', [('1/log(2)', '1/ln 2', '1/Log[2]')]),
    4: ('1/sqrt(2*Pi)', [('1/sqrt(2pi)', '1/sqrt(2 pi)', '1/Sqrt[2*Pi]')]),
    5: ('sum(1/2^(2^n)', [('sum 1/2^(2^n)', 'sum_{n>=0} 1/2^(2^n)', 'Sum[1/2^(2^n), {n, 0, Infinity}]')]),
    6: ('3/(Pi*Pi)', [('3/pi^2', '3/pi^2', '3/Pi^2')]),
    7: ('arctan(1/2)', [('arctan(1/2)', 'arctan(1/2)', 'ArcTan[1/2]')]),
    8: ("The Artin's Constant", [('Artin', "Artin's constant", '')]),
    9: ('The Backhouse constant', [('Backhouse', 'Backhouse constant', '')]),
    10: ('The Berstein Constant', [('Bernstein', 'Bernstein constant', '')]),
    11: ('The Catalan Constant', [('Catalan', "Catalan's constant", 'Catalan')]),
    12: ('Champernowne constant', [('Champernowne', 'Champernowne constant', '')]),
    13: ('Copeland-Erdos constant', [('Copeland-Erdos', 'Copeland-Erdos constant', '')]),
    14: ('cos(1)', [('cos(1)', 'cos 1', 'Cos[1]')]),
    15: ('The cube root of 3', [('3^(1/3)', 'cube root of 3', '3^(1/3)')]),
    16: ('2**(1/3)', [('2^(1/3)', 'cube root of 2', '2^(1/3)')]),
    17: ('Zeta(1,2)', [("zeta'(2)", "zeta'(2)", 'Derivative[1][Zeta][2]')]),
    18: ('This number is (exp(2)-7)/2', [('Dubois-Raymond', 'second du Bois-Reymond constant (e^2 - 7)/2', '(E^2 - 7)/2')]),
    19: ('exp(1/e)', [('exp(1/e)', 'e^(1/e)', 'E^(1/E)')]),
    20: ('-exp(1)*Ei(-1)', [('Gompertz', 'Gompertz constant', '-E*ExpIntegralEi[-1]')]),
    21: ('exp(2)', [('exp(2)', 'e^2', 'E^2')]),
    22: ('exp(E)', [('exp(e)', 'e^e', 'E^E')]),
    23: ('exp(-1)**exp(-1)', [('exp(-1)^exp(-1)', '(1/e)^(1/e)', 'E^(-1/E)')]),
    24: ('The exp(gamma)', [('exp(gamma)', 'e^gamma', 'E^EulerGamma')]),
    25: ('exp(-exp(1))', [('exp(-e)', 'e^-e', 'E^(-E)')]),
    26: ('exp(-gamma)', [('exp(-gamma)', 'e^-gamma', 'E^(-EulerGamma)')]),
    27: ('exp(-1) =', [('exp(-1)', '1/e', '1/E')]),
    28: ('exp(Pi)', [('exp(pi)', 'e^pi', 'E^Pi')]),
    29: ('exp(-Pi/2)', [('exp(-pi/2)', 'e^(-pi/2) = i^i', 'E^(-Pi/2)')]),
    30: ('exp(Pi/4)', [('exp(pi/4)', 'e^(pi/4)', 'E^(Pi/4)')]),
    31: ('exp(Pi)-Pi', [('exp(pi)-pi', 'e^pi - pi', 'E^Pi - Pi')]),
    32: ('exp(Pi)/Pi**E', [('exp(pi)/pi^e', 'e^pi/pi^e', 'E^Pi/Pi^E')]),
    33: ('Feigenbaum reduction parameter', [('Feigenbaum alpha', 'Feigenbaum reduction parameter alpha', ''),
                                            ('Feigenbaum delta', 'Feigenbaum bifurcation velocity delta', '')]),
    34: ('Fransen-Robinson constant', [('Fransen-Robinson', 'Fransen-Robinson constant', '')]),
    35: ('170000 digits of gamma', [('gamma', 'Euler gamma', 'EulerGamma')]),
    36: ('GAMMA(1/3)', [('Gamma(1/3)', 'Gamma(1/3)', 'Gamma[1/3]')]),
    37: ('GAMMA(1/4)', [('Gamma(1/4)', 'Gamma(1/4)', 'Gamma[1/4]')]),
    38: ('The Euler constant squared', [('gamma^2', 'gamma^2', 'EulerGamma^2')]),
    39: ('GAMMA(2/3)', [('Gamma(2/3)', 'Gamma(2/3)', 'Gamma[2/3]')]),
    40: ('gamma cubed', [('gamma^3', 'gamma^3', 'EulerGamma^3')]),
    41: ('GAMMA(3/4)', [('Gamma(3/4)', 'Gamma(3/4)', 'Gamma[3/4]')]),
    42: ('gamma**(exp(1)', [('gamma^e', 'gamma^e', 'EulerGamma^E')]),
    43: ('2**sqrt(2)', [('2^sqrt(2)', '2^sqrt(2)', '2^Sqrt[2]')]),
    44: ('Si(Pi) or the Gibbs Constant', [('Si(pi)', 'Gibbs constant Si(pi)', 'SinIntegral[Pi]')]),
    45: ('The Gauss-Kuzmin-Wirsing constant', [('Gauss-Kuzmin-Wirsing', 'Gauss-Kuzmin-Wirsing constant', '')]),
    46: ('The golden ratio', [('golden ratio', 'golden ratio', 'GoldenRatio')]),
    47: ('The Golomb constant', [('Golomb', 'Golomb-Dickman constant', '')]),
    48: ("Grothendieck's majorant", [('Grothendieck majorant', "Grothendieck's majorant pi/(2 ln(1 + sqrt 2))", 'Pi/(2*Log[1 + Sqrt[2]])')]),
    49: ('1/W(1)', [('1/W(1)', '1/W(1)', '1/ProductLog[1]')]),
    50: ('Khinchin constant', [('Khinchin', 'Khinchin constant', 'Khinchin')]),
    51: ('Landau-Ramanujan constant', [('Landau-Ramanujan', 'Landau-Ramanujan constant', '')]),
    52: ('The Lehmer constant', [('Lehmer', 'Lehmer constant', '')]),
    53: ('Lemniscate constant', [('lemniscate', 'lemniscate constant', 'Gamma[1/4]^2/(2*Sqrt[2*Pi])')]),
    54: ('The Lengyel constant', [('Lengyel', 'Lengyel constant', '')]),
    55: ('The Levy constant', [('Levy', 'Levy constant', 'E^(Pi^2/(12*Log[2]))')]),
    56: ('log(10)', [('log(10)', 'ln 10', 'Log[10]')]),
    57: ('The log10 of 2', [('log10(2)', 'log10 2', 'Log[10, 2]')]),
    58: ('log(2), natural logarithm', [('log(2)', 'ln 2', 'Log[2]')]),
    59: ('log(2) squared', [('log(2)^2', '(ln 2)^2', 'Log[2]^2')]),
    60: ('log(2*Pi)', [('log(2pi)', 'ln(2 pi)', 'Log[2*Pi]')]),
    61: ('log(3), natural logarithm', [('log(3)', 'ln 3', 'Log[3]')]),
    62: ('log(4)/log(3)', [('log(4)/log(3)', 'ln 4/ln 3', 'Log[4]/Log[3]')]),
    63: ('-log(gamma)', [('-log(gamma)', '-ln gamma', '-Log[EulerGamma]')]),
    64: ('The log of the log of 2', [('-log(log(2))', '-ln ln 2', '-Log[Log[2]]')]),
    65: ('1/2', [('log(golden ratio)', 'ln of the golden ratio', 'Log[GoldenRatio]')]),
    66: ('log(Pi)', [('log(pi)', 'ln pi', 'Log[Pi]')]),
    67: ('The Madelung constant', [('Madelung NaCl', 'Madelung constant of NaCl (absolute value)', '')]),
    68: ('The gamma function has a minumum', [('Gamma minimum x', 'position of the minimum of Gamma(x), x > 0', ''),
                                              ('Gamma minimum y', 'minimum value of Gamma(x), x > 0', '')]),
    69: ('Minimal y of GAMMA(x)', [None, None]),      # the same two numbers again
    70: ('BesselI(1,2)/BesselI(0,2)', [('I1(2)/I0(2)', 'continued fraction constant I1(2)/I0(2)', 'BesselI[1, 2]/BesselI[0, 2]')]),
    71: ('The omega constant', [('W(1)', 'omega constant W(1)', 'ProductLog[1]')]),
    72: ('1/(one-ninth constant)', [('one-ninth', 'one-ninth constant', '')]),
    73: ('The Parking or Renyi constant', [('Renyi parking', 'Renyi parking constant', '')]),
    74: ('Pi/2*sqrt(3)', [('pi/2*sqrt(3)', 'pi sqrt(3)/2', 'Pi*Sqrt[3]/2')]),
    75: ('1/2', [('pi/(2 sqrt(3))', 'densest circle packing density pi/(2 sqrt 3)', 'Pi/(2*Sqrt[3])')]),
    76: ('Pi**exp(1)', [('pi^e', 'pi^e', 'Pi^E')]),
    77: ('Pi^2', [('pi^2', 'pi^2', 'Pi^2')]),
    78: ('The Smallest Pisot-Vijayaraghavan number', [('smallest Pisot', 'smallest Pisot-Vijayaraghavan number', 'Root[#1^3 - #1 - 1 &, 1]')]),
    79: ('arctan(1/2)/Pi', [('arctan(1/2)/pi', 'arctan(1/2)/pi', 'ArcTan[1/2]/Pi')]),
    80: ('product(1+1/n**3', [('product 1+1/n^3', 'prod_{n>=1} (1 + 1/n^3) = cosh(sqrt(3) pi/2)/pi', 'Cosh[Sqrt[3]*Pi/2]/Pi')]),
    81: ('exp(Pi*sqrt(163))', [('exp(pi sqrt(163))', 'Ramanujan constant e^(pi sqrt 163)', 'E^(Pi*Sqrt[163])')]),
    82: ('The Robbins constant', [('Robbins', 'Robbins constant',
                                   '4/105 + 17/105*Sqrt[2] - 2/35*Sqrt[3] + 1/5*Log[1 + Sqrt[2]] + 2/5*Log[2 + Sqrt[3]] - 1/15*Pi')]),
    83: ('Salem Constant', [('Salem', "Salem constant (Lehmer's number)", 'Root[#1^10 + #1^9 - #1^7 - #1^6 - #1^5 - #1^4 - #1^3 + #1 + 1 &, 2]')]),
    84: ('sin(1)', [('sin(1)', 'sin 1', 'Sin[1]')]),
    85: ('2**(1/4)', [('2^(1/4)', '2^(1/4)', '2^(1/4)')]),
    86: ('sqrt(3)/2', [('sqrt(3)/2', 'sqrt(3)/2', 'Sqrt[3]/2')]),
    87: ('sum(1/binomial(2*n,n)', [('sum 1/binomial(2n,n)', 'sum_{n>=1} 1/binomial(2n, n)', '1/3 + 2*Sqrt[3]*Pi/27')]),
    88: ('sum(1/(n*binomial(2*n,n))', [('sum 1/(n binomial(2n,n))', 'sum_{n>=1} 1/(n binomial(2n, n))', 'Pi/(3*Sqrt[3])')]),
    89: ('sum(1/n^n', [('sum 1/n^n', 'sum_{n>=1} 1/n^n', 'Sum[1/n^n, {n, 1, Infinity}]')]),
    90: ('The Traveling Salesman Constant', [('TSP conjecture', 'conjectured traveling salesman constant 4/153 (1 + 2 sqrt 2) sqrt 51',
                                              '4/153*(1 + 2*Sqrt[2])*Sqrt[51]')]),
    91: ('The Tribonacci constant', [('Tribonacci', 'Tribonacci constant', 'Root[#1^3 - #1^2 - #1 - 1 &, 1]')]),
    93: ('The twin primes constant', [('twin primes', 'twin primes constant', '')]),
    94: ('The Varga constant', [('Varga', 'Varga constant, 1/(one-ninth constant)', '')]),
    95: ('to 256 digits is also this closed expression', [('Weierstrass', 'Weierstrass constant',
                                                          '2^(5/4)*Sqrt[Pi]*E^(Pi/8)/Gamma[1/4]^2')]),
    96: ('-Zeta(1,1/2)', [("-zeta'(1/2)", "-zeta'(1/2)", '-Derivative[1][Zeta][1/2]')]),
    97: ('-Zeta(-1/2)', [('-zeta(-1/2)', '-zeta(-1/2)', '-Zeta[-1/2]')]),
    98: ('Zeta(2)', [('zeta(2)', 'zeta(2) = pi^2/6', 'Pi^2/6')]),
    99: ('Zeta(3)', [('zeta(3)', "Apery's constant zeta(3)", 'Zeta[3]')]),
    100: ('Zeta(4)', [('zeta(4)', 'zeta(4) = pi^4/90', 'Pi^4/90')]),
    101: ('Zeta(5)', [('zeta(5)', 'zeta(5)', 'Zeta[5]')]),
    102: ('Zeta(7)', [('zeta(7)', 'zeta(7)', 'Zeta[7]')]),
    103: ('Zeta(9)', [('zeta(9)', 'zeta(9)', 'Zeta[9]')]),
    104: ('This number, the Product[Cos[Pi/n]', [('Kepler-Bouwkamp', 'polygon inscribing constant (Kepler-Bouwkamp)',
                                                   'Product[Cos[Pi/n], {n, 3, Infinity}]')]),
    106: ('There is a pattern in the binary expansion', [None]),
    107: ('The request was sent by Joe Keane', [('arccosh(8)/2', 'arccosh(8)/2 = ln((3 + sqrt 7)/sqrt 2)', 'ArcCosh[8]/2')]),
    109: ('The request was sent by Jon Borwein', [None]),
    110: ('The number of correct digits in the number:', [('AGM(1,2)', 'AGM(1, 2)', 'ArithmeticGeometricMean[1, 2]')]),
    111: ('The request was sent by Olivier Gerard', [None]),
    112: ('The request was sent by Michael Mossinghoff', [('Mossinghoff Salem', 'Salem number of degree 38 (Mossinghoff)',
        'Root[#1^38 - #1^36 - #1^34 - #1^29 + #1^28 - #1^24 - #1^14 + #1^10 - #1^9 - #1^4 - #1^2 + 1 &, 4]')]),   # real roots -1, -1, 1/lambda, lambda
    113: ('Reference Philippe Flajolet and Andrew Odlyzko', [('1-ln(1-1/e)', '1 - ln(1 - 1/e) (random mappings)', '1 - Log[1 - 1/E]'),
                                                              ('(1+1/e)/(1/e-1)', '(1 + 1/e)/(1/e - 1) = -coth(1/2)', '(1 + 1/E)/(1/E - 1)')]),
    114: ('The Hard hexagons Entropy Constant', [('hard hexagon', 'hard hexagon entropy constant', ''), None]),
}
# digits that disagree with all other sources (checked with mpmath)
ERRATA = {
    'Artin': 'erratum: digit 27, 0.37395581361920228805472805434|6|5164... should be 0.37395581361920228805472805434|6|4164... (Wikipedia, Wolfram)',
    'Renyi parking': 'erratum: wrong after 26 digits, 0.74759792025341143517873094|3636... should be 0.74759792025341143517873094|3830... (Wolfram, mpmath)',
}
DIGIT_LINE = re.compile(r'^\s*-?\d*\.?\d[\d ]*[\\;]?\s*$')


def blocks(section):
    """Digit blocks of a section: runs of lines of digits (at least 10 per line)."""
    out, cur = [], None
    for line in section.split('\n'):
        if DIGIT_LINE.match(line) and len(re.sub(r'\D', '', line)) >= 10:
            s = line.strip().replace(' ', '').rstrip('\\;')
            if cur is None:
                out.append(s)
                cur = len(out) - 1
            else:
                out[cur] += s
        else:
            cur = None
    return out


def decimal(block, key):
    """'.3920...' -> '0.3920...'; truncated to DIGITS significant digits."""
    sign = '-' if block.startswith('-') else ''
    b = block.lstrip('-')
    if '.' not in b:
        if key != 'Catalan':
            sys.exit(f'{key}: no decimal point in {b[:20]}')
        b = '0.' + b          # the 50000 digits of Catalan's constant 0.9159... are printed without "0."
    whole, frac = b.split('.')
    whole = whole.lstrip('0') or '0'
    sig = len(whole.lstrip('0')) if whole != '0' else 0
    if sig >= DIGITS:
        sys.exit(f'{key}: integer part too long')
    if whole == '0':
        lead = len(frac) - len(frac.lstrip('0'))
        frac = frac[:lead + DIGITS]
    else:
        frac = frac[:DIGITS - sig]
    return f'{sign}{whole}.{frac}'


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    req = urllib.request.Request(URL, headers={'User-Agent': 'ConstantRecognition benchmark'})
    text = urllib.request.urlopen(req, timeout=120).read().decode('utf-8', errors='replace')
    body = text.split('*** START')[1].split('*** END')[0].split('\n-----', 1)[1]     # after the contents
    sections = re.split(r'\n-{20,}[^\n]*\n', '\n' + body)
    rows = []
    for i, (title, entries) in S.items():
        sec = sections[i]
        first = next(l.strip() for l in sec.split('\n') if l.strip() and not DIGIT_LINE.match(l))
        if not first.startswith(title):
            sys.exit(f'section {i}: title "{first[:50]}" is not "{title}"')
        bl = blocks(sec)
        if len(bl) != len(entries):
            sys.exit(f'section {i} ({title}): {len(bl)} digit blocks, {len(entries)} entries')
        for b, e in zip(bl, entries):
            if e:
                rows.append([SOURCE, e[0], e[1], e[2], decimal(b, e[0]), ERRATA.get(e[0], '')])
    old = list(csv.reader(open(SOURCES, encoding='utf-8'), delimiter='\t'))
    kept = [r for r in old if not r[0].startswith('Plouffe,')]
    with open(SOURCES, 'w', encoding='utf-8', newline='') as f:
        for r in kept + rows:
            f.write('\t'.join(r) + '\n')
    print(f'kept {len(kept) - 1} rows of other sources; added {len(rows)} Plouffe rows ({sum(r[3] != "" for r in rows)} with a formula)')


if __name__ == '__main__':
    main()
