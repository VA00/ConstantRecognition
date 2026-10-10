"""run_ordner_v0.py - Ordner (Fungrim's index of real numbers) as a pure lookup table over constants_v0.tsv

Author: Andrzej Odrzywolek
Date: October 10, 2026
Code assist: Claude Opus 5.5

Ordner (F. Johansson, https://fungrim.org/ordner/, part of Fungrim, MIT license, generated 2021-03-15) lists
3249 real numbers by 30-digit decimal keys, each with the constant expressions of Fungrim's formulas whose
value Arb puts within 1 ulp of the key: 5847 expressions (negative values are indexed by their absolute value,
as Neg(x)). It is used here as the minimal example of recognition by table lookup, no search at all:

  1. download the 13 index pages, and the own pages of the numbers whose index row shows only some of their
     expressions (into --cache, by default run/ordner_cache, which is not in the repository)
  2. build an SQLite database <cache>/ordner.sqlite (numbers: key, value, frequency; expressions: number,
     expression, entries), checked against the counts Ordner states
  3. look up every constant with >= 17 digits: the input is its nearest double, as for the other tools, and a
     key matches when it is within 16 eps of |x| (relative, as Constant Recognition's test); the nearest key
     wins (equally near ones: the one in more Fungrim entries) and its answer is its shortest expression
     without Decimal(...) data, negated for x < 0
  4. score: the answer computed with 80 digits (mpmath, Fungrim's functions translated below) against the
     64-digit ground truth: exact (>= 30 digits), false positive (fails beyond double precision), not found.
     Only formulas whose translation agrees with their own 30-digit key are used (checked on the matched keys,
     with --check-all on the whole database); an answer that cannot be computed is computed from another
     formula of the same key, and is unverifiable when there is none (Decimal(...) data are not formulas).

Usage:  python run_ordner_v0.py [--cache DIR] [--refresh] [--check-all]
Writes results/v0_ordner.tsv and prints the times of the steps.
"""
import argparse
import csv
import functools
import html
import os
import re
import sqlite3
import sys
import time
import urllib.request

import mpmath as mp

mp.mp.dps = 80
BENCH = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONSTANTS = os.path.join(BENCH, 'data', 'v0', 'constants_v0.tsv')
RESULTS = os.path.join(BENCH, 'results')
URL = 'https://fungrim.org/ordner/'
EXACT = 30
TOL = 16 * 2.0 ** -52

# ---------------------------------------------------------------- 1. download

def fetch(url, path, refresh):
    if refresh or not os.path.exists(path):
        req = urllib.request.Request(url, headers={'User-Agent': 'ConstantRecognition benchmark (run_ordner_v0.py)'})
        data = urllib.request.urlopen(req, timeout=60).read()
        os.makedirs(os.path.dirname(path), exist_ok=True)
        open(path, 'wb').write(data)
        time.sleep(0.1)
    return open(path, encoding='utf-8').read()


ROW = re.compile(r'<tr><td valign="top">(?:<a href="\.\./([^/"]+)/"><b>)?<tt>([^<]+)</tt>(?:</b></a>)?</td>'
                 r'<td valign="top">(.*?)</td><td valign="top">(\d+)[^<]*</td></tr>', re.S)
EXPR = re.compile(r'<tt>(.*?)</tt> &nbsp;&nbsp;&nbsp;&nbsp;\[(.*?)\]<br/>', re.S)


def expressions(cell):
    return [(html.unescape(e).replace('\xa0', ' '), ' '.join(re.findall(r'entry/([0-9a-f]+)/', ent)))
            for e, ent in EXPR.findall(cell)]


def download(cache, refresh):
    front = fetch(URL, os.path.join(cache, 'ordner.html'), refresh)
    stated = re.search(r'contains (\d+) decimal keys.*?and (\d+) symbolic expressions', front, re.S)
    numbers = {}
    for page in sorted(set(re.findall(r'href="(index\d+)/"', front))):
        for link, key, cell, freq in ROW.findall(fetch(URL + page + '/', os.path.join(cache, page + '.html'), refresh)):
            ex = expressions(cell)
            if link and re.search(r'\d+ of \d+ expressions shown', cell):
                own = fetch(URL + link + '/', os.path.join(cache, 'numbers', link + '.html'), refresh)
                ex = next(expressions(c) for _, k, c, _ in ROW.findall(own) if k == key)
            numbers[key] = (ex, int(freq))      # a key on the border of two pages is listed on both
    return numbers, (int(stated.group(1)), int(stated.group(2)))

# ---------------------------------------------------------------- 2. database

def build(numbers, db):
    if os.path.exists(db):
        os.remove(db)
    con = sqlite3.connect(db)
    con.executescript('''
        CREATE TABLE numbers (id INTEGER PRIMARY KEY, key TEXT UNIQUE, value REAL, frequency INTEGER);
        CREATE TABLE expressions (number INTEGER REFERENCES numbers(id), expression TEXT, entries TEXT);
        CREATE INDEX numbers_value ON numbers(value);''')
    for key, (ex, freq) in numbers.items():
        nid = con.execute('INSERT INTO numbers (key, value, frequency) VALUES (?, ?, ?)', (key, float(key), freq)).lastrowid
        con.executemany('INSERT INTO expressions VALUES (?, ?, ?)', [(nid, e, ent) for e, ent in ex])
    con.commit()
    return con

# ---------------------------------------------------------------- Fungrim expressions in mpmath

class Unsupported(Exception):
    pass


def jacobi_theta(j, z, tau):     # Fungrim: theta_3(z, tau) = sum q^(n^2) w^(2n), q = exp(pi i tau), w = exp(pi i z)
    q = mp.exp(mp.pi * 1j * tau)
    if abs(q) > 0.9:             # slow in mpmath (an integral down to t = 0)
        raise Unsupported('JacobiTheta with |q| > 0.9')
    return mp.jtheta(int(j), mp.pi * z, q)


def dedekind_eta(tau):
    return mp.exp(mp.pi * 1j * tau / 12) * mp.qp(mp.exp(2 * mp.pi * 1j * tau))


def modular_lambda(tau):
    return (jacobi_theta(2, 0, tau) / jacobi_theta(3, 0, tau)) ** 4


def log(z, b=None):
    return mp.log(z) if b is None else mp.log(z) / mp.log(b)


def small(n, cap):               # an index for which mpmath is fast
    if n != int(n) or abs(n) > cap:
        raise Unsupported(f'index {n}')
    return int(n)


def lambert_w(*a):               # Fungrim: LambertW(z), LambertW(k, z); LambertW(k, z, r) is a derivative
    if len(a) > 2:
        raise Unsupported('LambertW derivative')
    return mp.lambertw(a[0]) if len(a) == 1 else mp.lambertw(a[1], small(a[0], 10))


def carlson_rc(x, y):            # for y < 0 Fungrim's branch is not mpmath's principal value
    if mp.im(y) == 0 and mp.re(y) < 0:
        raise Unsupported('CarlsonRC with y < 0')
    return mp.elliprc(x, y)


def digamma_zero(n):             # Fungrim: x_0 = 1.4616... (the minimum of Gamma), x_n in (-n, 1 - n)
    n = small(n, 1000)
    if n == 0:
        return mp.findroot(mp.digamma, mp.mpf('1.4616'))
    return mp.findroot(mp.digamma, -n + mp.atan(mp.pi / mp.log(n + 1)) / mp.pi)


def stieltjes(n, a=1):
    return mp.stieltjes(small(n, 100), a)


FUNCS = {
    'Add': lambda *a: mp.fsum(a), 'Sub': lambda a, b: a - b, 'Mul': lambda *a: mp.fprod(a), 'Div': lambda a, b: a / b,
    'Neg': lambda a: -a, 'Pow': mp.power, 'Sqrt': mp.sqrt, 'Exp': mp.exp, 'Log': log,
    'Sin': mp.sin, 'Cos': mp.cos, 'Tan': mp.tan, 'Asin': mp.asin, 'Acos': mp.acos, 'Atan': mp.atan,
    'Sinh': mp.sinh, 'Cosh': mp.cosh, 'Tanh': mp.tanh, 'Coth': mp.coth, 'Sinc': mp.sinc,
    'Abs': abs, 'Arg': mp.arg, 'Re': mp.re, 'Im': mp.im,
    'Gamma': mp.gamma, 'LogGamma': mp.loggamma, 'DigammaFunction': lambda z, m=0: mp.psi(small(m, 100), z), 'BarnesG': mp.barnesg,
    'Factorial': mp.factorial, 'Fibonacci': mp.fib, 'BellNumber': lambda n: mp.bell(small(n, 1000)),
    'BernoulliB': lambda n: mp.bernoulli(small(n, 1000)),
    'RiemannZeta': mp.zeta, 'HurwitzZeta': mp.zeta, 'StieltjesGamma': stieltjes,
    'RiemannZetaZero': lambda n: mp.zetazero(small(n, 10000)), 'PolyLog': mp.polylog,
    'EllipticK': mp.ellipk, 'EllipticE': mp.ellipe, 'EllipticPi': mp.ellippi,
    'IncompleteEllipticF': mp.ellipf, 'IncompleteEllipticE': mp.ellipe,
    'CarlsonRF': mp.elliprf, 'CarlsonRC': carlson_rc, 'CarlsonRJ': mp.elliprj, 'CarlsonRD': mp.elliprd,
    'CarlsonRG': mp.elliprg, 'AGM': mp.agm, 'Hypergeometric2F1': mp.hyp2f1,
    'LambertW': lambert_w, 'AiryAi': mp.airyai, 'AiryBi': mp.airybi,
    'JacobiTheta': jacobi_theta, 'DedekindEta': dedekind_eta, 'ModularJ': lambda tau: 1728 * mp.kleinj(tau),
    'ModularLambda': modular_lambda, 'DigammaFunctionZero': digamma_zero, 'HarmonicNumber': mp.harmonic,
}
CONSTS = {'Pi': mp.pi, 'ConstE': mp.e, 'ConstI': mp.mpc(0, 1), 'ConstGamma': mp.euler, 'ConstCatalan': mp.catalan,
          'ConstGlaisher': mp.glaisher, 'GoldenRatio': mp.phi, 'Infinity': mp.inf}
TOKEN = re.compile(r'\s*(?:(\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)|"([^"]*)"|([A-Za-z_][A-Za-z0-9_]*)|(\S))')


@functools.lru_cache(maxsize=None)
def halphen():                   # Fungrim: the zero in (0, 1) of -1/8 + sum_(n>=1) n x^n / (1 - (-x)^n)
    return mp.findroot(lambda x: mp.nsum(lambda n: n * x ** n / (1 - (-x) ** n), [1, mp.inf]) - mp.mpf(1) / 8,
                       mp.mpf('0.1077'))


LAZY = {'HalphenConstant': halphen}


def parse(s):
    """Fungrim's notation, Name(args) | Name | number | "string" | -x, as a tree"""
    t = TOKEN.findall(s)
    pos = 0

    def node():
        nonlocal pos
        n, q, w, o = t[pos]
        pos += 1
        if n:
            return ('num', n)
        if q:
            return ('str', q)
        if o == '-':
            return ('neg', node())
        if not w:
            raise Unsupported(o or '?')
        if pos < len(t) and t[pos][3] == '(':
            pos += 1
            args = [node()]
            while t[pos][3] == ',':
                pos += 1
                args.append(node())
            if t[pos][3] != ')':
                raise Unsupported(f'expected ) in {s}')
            pos += 1
            return ('call', w, args)
        return ('name', w)

    tree = node()
    if pos != len(t):
        raise Unsupported(f'trailing tokens in {s}')
    return tree


def ev(x, env):
    kind = x[0]
    if kind == 'num':
        return mp.mpf(x[1])
    if kind == 'neg':
        return -ev(x[1], env)
    if kind == 'name':
        w = x[1]
        if w in env:
            return env[w]
        if w in CONSTS:
            return CONSTS[w]
        if w in LAZY:
            return LAZY[w]()
        raise Unsupported(w)
    if kind == 'call':
        w, args = x[1], x[2]
        if w == 'Decimal' and args[0][0] == 'str':
            return mp.mpf(args[0][1])
        if w in ('Sum', 'Integral') and len(args) == 2 and args[1][:2] == ('call', 'For') and len(args[1][2]) == 3 \
                and args[1][2][0][0] == 'name':
            var, lo, hi = args[1][2]
            if w == 'Integral' and 'Integral' in repr(args[0]):
                raise Unsupported('nested Integral')     # double integrals: too slow in mpmath
            f = lambda v: ev(args[0], {**env, var[1]: v})
            a, b = ev(lo, env), ev(hi, env)
            return mp.quad(f, [a, b]) if w == 'Integral' else mp.nsum(f, [a, b])
        if w in FUNCS:
            return FUNCS[w](*[ev(a, env) for a in args])
        raise Unsupported(w)
    raise Unsupported(kind)


def evaluate(s):
    v = ev(parse(s), {})
    if isinstance(v, mp.mpc):
        if abs(v.imag) > mp.mpf(10) ** -60 * max(1, abs(v.real)):
            raise Unsupported('complex value')
        v = v.real
    return v


def agree(f, v):
    d = abs(f - v)
    if d == 0:
        return 64.0
    scale = abs(v) if v != 0 else mp.mpf(1)
    return float(min(64, max(0, -mp.log10(d / scale))))


def check_translation(con, nids=None):
    """every expression that can be computed must agree with its key to ~30 digits; only those are used for scoring
    (nids: only the expressions of these numbers)"""
    verified, bad, unsupported = {}, [], {}
    for nid, key, e in con.execute('SELECT numbers.id, key, expression FROM numbers JOIN expressions ON numbers.id = number'):
        if nids is not None and nid not in nids:
            continue
        try:
            v = evaluate(e)
        except Unsupported as u:
            name = (str(u) or '?').split()[0]
            unsupported[name] = unsupported.get(name, 0) + 1
            continue
        except Exception as x:         # mpmath's NoConvergence, a pole, a malformed expression
            unsupported[type(x).__name__] = unsupported.get(type(x).__name__, 0) + 1
            continue
        if agree(mp.mpf(v), mp.mpf(key)) >= 28 or (mp.mpf(key) == 0 and abs(v) < mp.mpf(10) ** -30):
            verified[nid, e] = v
        else:
            bad.append((key, e, mp.nstr(v, 20)))
    return verified, bad, unsupported

# ---------------------------------------------------------------- 3., 4. lookup and score

def candidates(con, x):
    a = abs(x)
    rows = con.execute('SELECT id, key, value, frequency FROM numbers WHERE value BETWEEN ? AND ?',
                       (a * (1 - TOL), a * (1 + TOL))).fetchall()
    return sorted(rows, key=lambda r: (abs(r[2] - a), -r[3]))     # nearest; equally near: the more frequent


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    ap = argparse.ArgumentParser()
    ap.add_argument('--cache', default=os.path.join(BENCH, 'run', 'ordner_cache'))
    ap.add_argument('--refresh', action='store_true', help='download the pages again')
    ap.add_argument('--check-all', action='store_true', help='check the translation on all expressions, not only on the matched keys')
    args = ap.parse_args()

    t0 = time.perf_counter()
    numbers, (n_stated, e_stated) = download(args.cache, args.refresh)
    t1 = time.perf_counter()
    con = build(numbers, os.path.join(args.cache, 'ordner.sqlite'))
    t2 = time.perf_counter()
    n_keys = con.execute('SELECT COUNT(*) FROM numbers').fetchone()[0]
    n_expr = con.execute('SELECT COUNT(*) FROM expressions').fetchone()[0]
    print(f'Ordner: {n_keys} keys, {n_expr} expressions (stated: {n_stated}, {e_stated}); '
          f'pages read in {t1 - t0:.1f} s, database built in {t2 - t1:.2f} s')

    bench = [r for r in csv.DictReader(open(CONSTANTS, encoding='utf-8'), delimiter='	') if int(r['digits']) >= 17]
    t3 = time.perf_counter()
    hits = [(b, float(b['value']), candidates(con, float(b['value']))) for b in bench]
    t4 = time.perf_counter()
    print(f'lookup of {len(bench)} constants: {t4 - t3:.3f} s ({(t4 - t3) / len(bench) * 1e6:.0f} us per constant)')

    nids = None if args.check_all else {cand[0][0] for _, _, cand in hits if cand}
    verified, bad, unsupported = check_translation(con, nids)
    print(f'translation check ({"all keys" if nids is None else "matched keys"}, {time.perf_counter() - t4:.1f} s): '
          f'{len(verified)} agree with their keys, {len(bad)} disagree, {sum(unsupported.values())} not computable '
          f'({", ".join(f"{k} {n}" for k, n in sorted(unsupported.items(), key=lambda kv: -kv[1]))})')
    for key, e, v in bad[:20]:
        print(f'  disagrees: {key}  {e}  = {v}')

    fields = ['id', 'name', 'class', 'digits', 'verdict', 'ordner', 'key', 'keys', 'agree', 'checked_with', 'formula']
    counts = {}
    with open(os.path.join(RESULTS, 'v0_ordner.tsv'), 'w', encoding='utf-8', newline='') as fo:
        w = csv.DictWriter(fo, fieldnames=fields, delimiter='\t', lineterminator='\n')
        w.writeheader()
        for b, x, cand in hits:
            row = {'id': b['id'], 'name': b['name'], 'class': b['class'], 'digits': b['digits'], 'formula': b['formula'],
                   'keys': len(cand)}
            if not cand:
                verdict = 'not found'
            else:
                nid, key = cand[0][:2]
                ex = sorted((e for e, in con.execute('SELECT expression FROM expressions WHERE number = ?', (nid,))),
                            key=lambda e: ('Decimal(' in e, len(e), e))
                sign = -1 if x < 0 else 1
                answer = ex[0] if sign > 0 else f'Neg({ex[0]})'
                a = used = None
                for e in ex:                   # the answer, or else another verified formula of the same key
                    if (nid, e) in verified and 'Decimal(' not in e:
                        a, used = agree(sign * verified[nid, e], mp.mpf(b['value'])), e
                        break
                verdict = 'unverifiable' if a is None else 'exact' if a >= EXACT else 'false positive'
                row.update({'ordner': answer, 'key': key, 'agree': '' if a is None else f'{a:.1f}',
                            'checked_with': '' if used in (None, ex[0]) else used})
            row['verdict'] = verdict
            counts[verdict] = counts.get(verdict, 0) + 1
            w.writerow(row)
    print(f'{len(bench)} constants:', ', '.join(f'{k} {n}' for k, n in sorted(counts.items())))


if __name__ == '__main__':
    main()
