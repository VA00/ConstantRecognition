"""check_constants_v0.py - independent check of constants_v0.tsv with mpmath

Author: Andrzej Odrzywolek
Date: September 29, 2026
Code assist: Claude Opus 5.5

The values in constants_v0.tsv come from Mathematica (N[formula, 96] with
Precision >= 80) or from published digits. Mathematica can claim a precision
it does not have: N[Product[Cos[Pi/n], {n, 3, Infinity}], 80] reports
Precision 80 but is wrong after 26 digits. So every value with a formula is
recomputed here with a second, independent tool, mpmath:

  - most formulas are translated directly: Mathematica syntax to Python, every
    number an exact mpmath number, the function names bound to mpmath
    (MMA below), algebraic Root[poly &, k] by its real roots in Mathematica's
    order;
  - sums, products, integrals, derivatives and roots with a seed use a
    hand-written mpmath expression (MANUAL below).

Prints every constant that mpmath does not reproduce to its stated digits,
and every constant it could not check. A constant it could not check is
still confirmed when its value is published digits (fewer than 64) or when a
source publishes 64 digits or more (the build checks those against the
value); one resting on Mathematica's N[] alone is an error.

Usage:  python check_constants_v0.py
"""
import csv
import os
from fractions import Fraction
import re
import sys

import mpmath as mp

BENCH = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONSTANTS = os.path.join(BENCH, 'data', 'v0', 'constants_v0.tsv')

mp.mp.dps = 80


def Log(*a):
    return mp.log(a[0]) if len(a) == 1 else mp.log(a[1]) / mp.log(a[0])   # Log[b, x] = log_b x


MMA = {
    'Sqrt': mp.sqrt, 'CubeRoot': mp.cbrt, 'Log': Log, 'Log10': mp.log10, 'Exp': mp.exp,
    'Sin': mp.sin, 'Cos': mp.cos, 'Tan': mp.tan, 'Cot': mp.cot, 'Sec': mp.sec, 'Csc': mp.csc,
    'ArcSin': mp.asin, 'ArcCos': mp.acos, 'ArcTan': mp.atan, 'ArcCot': mp.acot,
    'Sinh': mp.sinh, 'Cosh': mp.cosh, 'Tanh': mp.tanh,
    'ArcSinh': mp.asinh, 'ArcCosh': mp.acosh, 'ArcTanh': mp.atanh,
    'Gamma': mp.gamma, 'Zeta': mp.zeta, 'PolyGamma': lambda n, x: mp.psi(n, x),
    'BesselI': mp.besseli, 'ArithmeticGeometricMean': mp.agm, 'InverseErf': mp.erfinv,
    'ExpIntegralEi': mp.ei, 'ProductLog': lambda *a: mp.lambertw(a[-1], int(a[0]) if len(a) == 2 else 0),   # ProductLog[z], ProductLog[k, z]
    'Re': mp.re, 'Im': mp.im, 'I': mp.j, 'PrimeZetaP': mp.primezeta,
    'QPochhammer': lambda a, q: mp.qp(a, q), 'HurwitzZeta': lambda s, a: mp.zeta(s, a), 'ZetaZero': mp.zetazero,
    'EllipticTheta': mp.jtheta, 'Fibonacci': mp.fib, 'Surd': lambda x, n: mp.sign(x) * abs(x) ** (mp.mpf(1) / n),
    'Log2': lambda x: mp.log(x, 2), 'Abs': abs, 'Floor': mp.floor, 'Power': lambda a, b: a ** b,
    'Infinity': mp.inf,
    'Pi': mp.pi, 'E': mp.e, 'GoldenRatio': mp.phi, 'EulerGamma': mp.euler, 'Catalan': mp.catalan,
    'Glaisher': mp.glaisher, 'Khinchin': mp.khinchin, 'Degree': mp.pi / 180,
    # special functions in the Wolfram Knowledgebase formulas (Mathematica conventions)
    'Sech': mp.sech, 'Csch': mp.csch, 'Coth': mp.coth, 'ArcCoth': mp.acoth, 'ArcSech': mp.asech, 'ArcCsch': mp.acsch,
    'EllipticK': mp.ellipk, 'EllipticE': lambda *a: mp.ellipe(*a),     # parameter m, as Mathematica
    'AiryAi': mp.airyai, 'AiryBi': mp.airybi,
    'AiryAiPrime': lambda x: mp.airyai(x, derivative=1), 'AiryBiPrime': lambda x: mp.airybi(x, derivative=1),
    'BesselJ': mp.besselj, 'BesselY': mp.bessely, 'BesselK': mp.besselk,
    'BesselJZero': lambda n, k: mp.besseljzero(n, k),
    'PolyLog': mp.polylog, 'LogIntegral': mp.li, 'CosIntegral': mp.ci, 'SinIntegral': mp.si,
    'Erf': mp.erf, 'Erfc': mp.erfc, 'Beta': mp.beta, 'Hypergeometric2F1': mp.hyp2f1,
    'Gamma2': None, 'LogGamma': mp.loggamma, 'BarnesG': mp.barnesg, 'StieltjesGamma': mp.stieltjes,
    'LerchPhi': mp.lerchphi, 'Factorial': mp.factorial, 'Binomial': mp.binomial,
    'mpf': mp.mpf,
}
MMA['Gamma'] = lambda *a: mp.gamma(a[0]) if len(a) == 1 else mp.gammainc(a[0], a[1])   # Gamma[a, x]: upper incomplete
del MMA['Gamma2']


def primes_up_to(n):
    sieve = bytearray([1]) * (n + 1)
    sieve[0] = sieve[1] = 0
    for i in range(2, int(n ** 0.5) + 1):
        if sieve[i]:
            sieve[i * i::i] = bytearray(len(sieve[i * i::i]))
    return [i for i in range(n + 1) if sieve[i]]


def log_series(poly, n):
    """Exact coefficients a_1..a_n of log(poly(x)), poly a list of integer coefficients with poly[0] = 1."""
    f = [Fraction(c) for c in poly] + [Fraction(0)] * (n + 1)
    a = [Fraction(0)] * (n + 1)
    for m in range(1, n + 1):
        a[m] = f[m] - sum((k * a[k] * f[m - k] for k in range(1, m)), Fraction(0)) / m
    return a


def euler_product(num, den, first=1, explicit=200, terms=40):
    """prod over primes p >= prime(first) of num(1/p)/den(1/p), num and den integer polynomials in x = 1/p
    with constant term 1. The first `explicit` primes are multiplied directly; for the rest,
    log prod = sum_k a_k (P(k) - sum_{p <= prime(explicit)} p^-k), with P the prime zeta function and a_k the
    exact coefficients of log(num/den): the tail converges like prime(explicit)^-k. The standard method for
    Hardy-Littlewood type constants (H. Cohen, P. Moree)."""
    primes = primes_up_to(10**5)[first - 1:first - 1 + explicit]
    head = mp.fprod(mp.polyval(num[::-1], mp.mpf(1) / p) / mp.polyval(den[::-1], mp.mpf(1) / p) for p in primes)
    a = [x - y for x, y in zip(log_series(num, terms), log_series(den, terms))]
    small = primes_up_to(primes[-1])    # all primes up to the last explicit one
    tail = mp.fsum(mp.mpf(a[k].numerator) / a[k].denominator * (mp.primezeta(k) - mp.fsum(mp.mpf(p) ** -k for p in small))
                   for k in range(2, terms + 1) if a[k])
    return head * mp.exp(tail)


def thue_morse(n_bits=300):
    return mp.fsum(mp.mpf(bin(n).count('1') % 2) / mp.mpf(2) ** (n + 1) for n in range(n_bits))


def fib(n):
    a, b = 0, 1
    for _ in range(int(n)):
        a, b = b, a + b
    return a


# mpmath expressions for formulas the translator does not handle (keyed by name)
MANUAL = {
    'Kepler–Bouwkamp constant': lambda: mp.exp(-mp.nsum(lambda k: (4**k - 1) * mp.zeta(2*k) * mp.zeta(2*k, 3) / k, [1, mp.inf])),
    "Liouville's constant": lambda: mp.fsum(mp.mpf(10) ** -mp.factorial(n) for n in range(1, 8)),
    'Champernowne constant': lambda: mp.mpf('0.' + ''.join(str(i) for i in range(1, 60))),
    'Omega constant': lambda: mp.re(mp.lambertw(1)),
    'Laplace limit': lambda: mp.findroot(lambda x: x * mp.exp(mp.sqrt(1 + x**2)) - 1 - mp.sqrt(1 + x**2), 0.6627),
    'Dottie number': lambda: mp.findroot(lambda x: mp.cos(x) - x, 0.739),
    'Soldner constant': lambda: mp.findroot(mp.li, 1.45),
    'Erdős–Borwein constant': lambda: mp.nsum(lambda n: 1 / (2**n - 1), [1, mp.inf]),
    'Reciprocal Fibonacci constant': lambda: mp.fsum(mp.mpf(1) / fib(n) for n in range(1, 400)),
    'Niven\'s constant': lambda: 1 + mp.nsum(lambda n: 1 - 1 / mp.zeta(n), [2, mp.inf]),
    'Regular paperfolding sequence': lambda: mp.fsum(mp.mpf(8) ** (2**n) / (mp.mpf(2) ** (2 ** (2 + n)) - 1) for n in range(0, 12)),
    'MRB constant': lambda: mp.nsum(lambda n: (-1)**n * (n ** (1 / n) - 1), [1, mp.inf]),
    'Fransén–Robinson constant': lambda: mp.quad(lambda x: 1 / mp.gamma(x), [0, 1, 2, 4, 8, mp.inf]),
    "Porter's constant": lambda: -mp.mpf(1)/2 + 6 * mp.log(2) * (-2 + 4 * mp.euler + 3 * mp.log(2) - 24 * mp.zeta(2, derivative=1) / mp.pi**2) / mp.pi**2,
    "Somos' quadratic recurrence constant": lambda: mp.exp(-mp.diff(lambda s: mp.polylog(s, mp.mpf(1)/2), 0)),
    # sum_k log(k)/(4k^2-1) = -sum_j 4^-j zeta'(2j): geometric; nsum of the log series itself is inaccurate
    'Asymptotic behavior of Lebesgue constants': lambda: (-4 * mp.psi(0, mp.mpf(1)/2) - 8 * mp.nsum(lambda j: mp.mpf(4)**-j * mp.zeta(2*j, derivative=1), [1, mp.inf])) / mp.pi**2,
    'Imaginary part of first non-trivial zero of zeta function': lambda: mp.im(mp.zetazero(1)),
    'Meissel-Mertens constant': lambda: mp.mertens,
    'Twin primes constant': lambda: mp.twinprime,
    # Euler products over primes with a rational factor in x = 1/p: numerator, denominator coefficients
    "Artin's constant": lambda: euler_product([1, -1, -1], [1, -1]),                       # 1 - 1/(p(p-1))
    'Feller-Tornier product constant': lambda: euler_product([1, 0, -2], [1]),             # 1 - 2/p^2
    'Taniguchi constant': lambda: euler_product([1, 0, 0, -3, 2, 1, -1], [1]),             # 1 - 3/p^3 + 2/p^4 + 1/p^5 - 1/p^6
    'carefree product constant': lambda: euler_product([1, 1, -1], [1, 1]),                # 1 - 1/(p(p+1))
    'Sarnak constant': lambda: euler_product([1, 0, -1, -2], [1], first=2),                # 1 - (p+2)/p^3, p >= 3
    'strongly carefree product constant': lambda: euler_product([1, 2], [1, 2, 1]),        # 1 - 1/(p+1)^2
    'quadratic class number constant': lambda: euler_product([1, 1, 0, -1], [1, 1]),       # 1 - 1/(p^2(p+1))
    'totient product constant': lambda: euler_product([1, -1, 0, 1], [1, -1]),             # 1 + 1/((p-1)p^2)
    'inverse of carefree constant': lambda: euler_product([1, 1], [1, 1, -1]),             # 1 + 1/(p^2+p-1)
    'Barban constant': lambda: euler_product([1, 1, 2, -1, -1], [1, 1, -1, -1]),           # 1 + (3p^2-1)/(p(p+1)(p^2-1))
    # the defining series (Finch), against the Eisenstein near-identity of its source row
    'constant appearing in the variance for inserting in a digital tree':
        lambda: mp.mpf(1) / 12 + mp.pi**2 / (6 * mp.log(2)**2) - mp.nsum(lambda k: 1 / (2**k - 1), [1, mp.inf])
                - mp.nsum(lambda k: 1 / (2**k - 1)**2, [1, mp.inf]),
    # fast or closed forms of constants whose formulas are sums, products or limits
    'Prouhet–Thue–Morse constant': lambda: thue_morse(),
    'Prouhet-Thue-Morse constant': lambda: 2 * thue_morse(),
    'Prime constant': lambda: mp.fsum(mp.mpf(2) ** -p for p in primes_up_to(400)),
    'meander connective constant': lambda: mp.fprod(1 - mp.mpf(2) ** -(2 ** k) for k in range(12)),
    'totient constant': lambda: euler_product([1, -1, 0, 1], [1, -1, -1, 1]),            # sum 1/(n phi(n)) = prod 1 + p/((p-1)^2 (p+1))
    'infinite tetration of i absolute value': lambda: abs(-mp.lambertw(-mp.log(mp.j)) / mp.log(mp.j)),
    # sum_k log(1+1/k)/k = sum_n (-1)^(n+1) (zeta(n+1)-1)/n + log 2, geometric
    'infinite product constant': lambda: 2 * mp.exp(mp.nsum(lambda n: (-1)**(n + 1) * (mp.zeta(n + 1) - 1) / n, [1, mp.inf])),
    # sum_k 1/((1+k) sqrt k) = 1/2 + sum_j (-1)^j (zeta(3/2+j) - 1), geometric
    'spiral of Theodorus constant': lambda: mp.mpf(1) / 2 + mp.nsum(lambda j: (-1)**j * (mp.zeta(mp.mpf(3) / 2 + j) - 1), [0, mp.inf]),
}


def root(formula):
    """Root[poly &, k] or Root[poly &, k, 0]: k-th root in Mathematica's order (real roots ascending first)."""
    m = re.match(r'^Root\[(.*?)\s*&\s*,\s*(\d+)(?:\s*,\s*0)?\]$', formula)
    poly, k = m.group(1), int(m.group(2))
    coeffs = {}
    for term in re.findall(r'[+-]?[^+-]+', poly.replace(' ', '').replace('#1', '#')):
        tm = re.match(r'^([+-]?\d*)\*?(?:#(?:\^(\d+))?)?$', term)
        c = tm.group(1)
        c = int(c) if c not in ('', '+', '-') else (-1 if c == '-' else 1)
        d = 0 if '#' not in term else int(tm.group(2) or 1)
        coeffs[d] = coeffs.get(d, 0) + c
    deg = max(coeffs)
    roots = mp.polyroots([coeffs.get(d, 0) for d in range(deg, -1, -1)], maxsteps=500, extraprec=400)
    real = sorted(mp.re(r) for r in roots if abs(mp.im(r)) < mp.mpf(10) ** -40)
    return real[k - 1]


TOKEN = re.compile(r'\d+\.\d*|\.\d+|\d+|[A-Za-z][A-Za-z0-9]*|\S')


def translate(formula):
    """Mathematica to Python: exact numbers, f[x] -> f(x), ^ -> **, and the implicit
    multiplication of Mathematica (2 Pi, 2Catalan, Pi Log[2], (a)(b)) made explicit."""
    out, prev = [], None      # prev: 'value' after a number, a symbol or a closing bracket
    toks = TOKEN.findall(formula)
    for i, t in enumerate(toks):
        is_num, is_name = t[0].isdigit() or t[0] == '.', t[0].isalpha()
        if prev == 'value' and (is_num or is_name or t == '('):
            out.append('*')
        if is_num:
            out.append(f"mpf('{t}')")
            prev = 'value'
        elif is_name:
            out.append(t)
            prev = None if i + 1 < len(toks) and toks[i + 1] == '[' else 'value'
        else:
            out.append({'[': '(', ']': ')', '^': '**'}.get(t, t))
            prev = 'value' if t in ')]' else None
    return ''.join(out)


def mp_value(name, formula):
    if name in MANUAL:
        return mp.mpf(MANUAL[name]()), 'manual'
    if formula.startswith('Root['):
        return root(formula), 'Root'
    if re.search(r'Sum\[|Product\[|Integrate\[|Limit\[|Derivative|Prime\[|#|\\\[Formal|Entity\[', formula):
        raise ValueError('needs a MANUAL entry')
    return mp.mpf(mp.re(eval(translate(formula), {'__builtins__': {}}, MMA))), 'translated'


def main():
    sys.stdout.reconfigure(encoding='utf-8')   # names such as Erdős on a Windows console
    rows = list(csv.DictReader(open(CONSTANTS, encoding='utf-8'), delimiter='\t'))
    low, unchecked, n_checked = [], [], 0
    for r in rows:
        stated = int(r['digits'])
        if not r['formula'] and r['name'] not in MANUAL:
            unchecked.append((r['name'], 'no formula: value from published digits only'))
            continue
        try:
            v, how = mp_value(r['name'], r['formula'])
        except Exception as e:
            unchecked.append((r['name'], f'{type(e).__name__}: {str(e)[:70]}'))
            continue
        n_checked += 1
        ref = mp.mpf(r['value'])
        agree = 80.0 if v == ref else float(-mp.log10(abs(v - ref) / max(abs(ref), mp.mpf(10)**-80)))
        if agree < min(stated, 64) - 1:
            low.append((r['name'], stated, agree, how, r['formula']))
    print(f'{len(rows)} constants, {n_checked} recomputed with mpmath')
    print(f'\nBELOW their stated digits ({len(low)}):')
    for name, stated, agree, how, f in low:
        print(f'  {name}: stated {stated}, mpmath agrees to {agree:.1f} ({how})   {f[:70]}')
    by_name = {r['name']: r for r in rows}

    def confirmed_by_published(name):
        r = by_name[name]
        return int(r['digits']) < 64 or max([int(d) for d in re.findall(r'\((\d+)\)', r['sources'])] or [0]) >= 64
    alone = [(n, why) for n, why in unchecked if not confirmed_by_published(n)]
    print(f'\nNot checked by mpmath ({len(unchecked)}), of them {len(unchecked) - len(alone)} confirmed by published digits:')
    for name, why in unchecked:
        print(f'  {name}: {why}')
    print(f'\nNeither mpmath nor published digits, Mathematica N[] alone ({len(alone)}):')
    for name, why in alone:
        print(f'  {name}: {why}')
    return 1 if low or alone else 0


if __name__ == '__main__':
    sys.exit(main())
