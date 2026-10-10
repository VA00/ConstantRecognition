"""score_mesearch_v0.py - MESearch 2.0 over constants_v0.tsv: its results files scored like the other runs

Author: Andrzej Odrzywolek
Date: October 10, 2026
Code assist: Claude Opus 5.5

MESearch 2.0 (J. Zurutuza Salsamendi, 2013, https://tilde.green/~danny12/MESearch/) is an exhaustive
bidirectional search for the shortest expressions within a tolerance. It has only a GUI, so the run is
made by driving it (run/mesearch_gui: make_targets_v0.py, start.ps1, batch.ps1), which saves one results
file per constant. Input: the constants with >= 17 digits, rounded to 15 significant digits (MESearch's
maximum, instead of the nearest double of the other tools); all 38 functions and all 236 constants ticked
(pi, e, sqrt2, phi, 165 other named constants, 1-32, 35 fractions), length <= 5.

MESearch lists every expression within its tolerance, by length; its answer is the first one. That
expression is computed with 80 digits (mpmath) and compared with the 64-digit ground truth:

  exact           the first expression agrees to >= 30 digits
  false positive  the first expression fails beyond double precision
  false negative  the first fails, a later listed expression agrees to >= 30 digits
  unverifiable    the first fails, but uses a named constant known only to MESearch's 16 digits
  not found       no expression listed

Named constants: pi, e, sqrt2, phi, ln2, gamma, apery, catalan, glaisher, khinchin, watsonI2, watsonI3 from mpmath; the others
from the benchmark row whose absolute value agrees with MESearch's to 1e-13 (sign from MESearch), else MESearch's own 16 digits.
Every parsed expression must reproduce the value MESearch prints next to it (checks the parser).

Usage:  python score_mesearch_v0.py <MESearch results dir> [--tag l5]
Writes results/v0_mesearch_<tag>.tsv and results/v0_mesearch_<tag>_raw.tsv (every listed expression of every
constant, with its agreement with the ground truth) and prints a summary.
"""
import argparse
import csv
import os
import re
import sys

import mpmath as mp

mp.mp.dps = 80
BENCH = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONSTANTS = os.path.join(BENCH, 'data', 'v0', 'constants_v0.tsv')
RESULTS = os.path.join(BENCH, 'results')
EXACT = 30


def student_t_cdf(nu, t):
    x = nu / (nu + t * t)
    tail = mp.betainc(nu / 2, mp.mpf(1) / 2, 0, x, regularized=True) / 2
    return 1 - tail if t > 0 else tail


FUNCS = {
    'Ln': mp.log, 'Log': lambda b, x: mp.log(x) / mp.log(b),
    'Sin': mp.sin, 'Cos': mp.cos, 'Tan': mp.tan, 'ArcSin': mp.asin, 'ArcCos': mp.acos, 'ArcTan': mp.atan,
    'Sinh': mp.sinh, 'Cosh': mp.cosh, 'Tanh': mp.tanh, 'ArcSinh': mp.asinh, 'ArcCosh': mp.acosh, 'ArcTanh': mp.atanh,
    'Gamma': mp.gamma, 'LogGamma': lambda x: mp.log(abs(mp.gamma(x))), 'Psi': mp.digamma,
    'GammaRegularized': lambda a, x: mp.gammainc(a, x, mp.inf, regularized=True),
    'Beta': mp.beta, 'BetaRegularized': lambda x, a, b: mp.betainc(a, b, 0, x, regularized=True),
    'Ei': mp.ei, 'AGM': mp.agm, 'Zeta': mp.zeta, 'Wp': lambda x: mp.lambertw(x, 0), 'Wm': lambda x: mp.lambertw(x, -1),
    'Erf': mp.erf, 'CDFNormal': mp.ncdf, 'CDFStudentT': student_t_cdf,
}
MPCONST = {'pi': mp.pi, 'e': mp.e, 'sqrt2': mp.sqrt(2), 'phi': mp.phi, 'ln2': mp.ln2, 'gamma': mp.euler,
           'apery': mp.zeta(3), 'catalan': mp.catalan, 'glaisher': mp.glaisher, 'khinchin': mp.khinchin,
           # Watson's integrals as MESearch scales them (simple cubic: the benchmark's value / 3), checked to 16 digits
           'watsonI2': 3 * mp.gamma(mp.mpf(1) / 3) ** 6 / (2 ** (mp.mpf(14) / 3) * mp.pi ** 4),
           'watsonI3': mp.sqrt(6) / (32 * mp.pi ** 3) * mp.gamma(mp.mpf(1) / 24) * mp.gamma(mp.mpf(5) / 24)
                       * mp.gamma(mp.mpf(7) / 24) * mp.gamma(mp.mpf(11) / 24) / 3}

TOKEN = re.compile(r'\s*(?:(\d+(?:\.\d+)?)|([A-Za-z][A-Za-z0-9]*)|(.))')


def tokenize(s):
    out = []
    for num, name, op in TOKEN.findall(s.strip()):
        out.append(('num', num) if num else ('name', name) if name else ('op', op))
    return [t for t in out if t != ('op', '')]


class Parser:
    """+ - < · / < unary minus < ^ (right associative, exponent may be negated: x^-1)"""

    def __init__(self, s, consts):
        self.t, self.i, self.c, self.used = tokenize(s), 0, consts, set()

    def peek(self):
        return self.t[self.i] if self.i < len(self.t) else (None, None)

    def take(self, kind=None, val=None):
        k, v = self.peek()
        if (kind and k != kind) or (val and v != val):
            raise ValueError(f'expected {val or kind} at token {self.i}, got {v}')
        self.i += 1
        return v

    def parse(self):
        v = self.expr()
        if self.i != len(self.t):
            raise ValueError(f'trailing tokens from {self.i}')
        return v

    def expr(self):
        v = self.term()
        while self.peek() in (('op', '+'), ('op', '-')):
            op = self.take()
            w = self.term()
            v = v + w if op == '+' else v - w
        return v

    def term(self):
        v = self.unary()
        while self.peek() in (('op', '\u00b7'), ('op', '/')):
            op = self.take()
            w = self.unary()
            v = v * w if op == '\u00b7' else v / w
        return v

    def unary(self):
        if self.peek() == ('op', '-'):
            self.take()
            return -self.unary()
        return self.power()

    def power(self):
        b = self.atom()
        if self.peek() == ('op', '^'):
            self.take()
            return b ** self.unary()       # right associative; covers x^-1 and e^x^y
        return b

    def atom(self):
        k, v = self.peek()
        if k == 'num':
            self.take()
            return mp.mpf(v)
        if k == 'op' and v == '(':
            self.take()
            x = self.expr()
            self.take('op', ')')
            return x
        if k == 'name':
            self.take()
            if self.peek() == ('op', '(') and v in FUNCS:
                self.take()
                args = [self.expr()]
                while self.peek() == ('op', ','):
                    self.take()
                    args.append(self.expr())
                self.take('op', ')')
                return FUNCS[v](*args)
            if v in self.c:
                self.used.add(v)
                return self.c[v]
        raise ValueError(f'unknown token {v!r}')


def real(x):
    if isinstance(x, mp.mpc):
        if abs(x.imag) > mp.mpf(10) ** -60 * max(1, abs(x.real)):
            raise ValueError('complex value')
        return x.real
    return x


def agree(f, v):
    d = abs(f - v)
    if d == 0:
        return 64.0
    scale = abs(v) if v != 0 else mp.mpf(1)
    return float(min(64, max(0, -mp.log10(d / scale))))


def read_results(path):
    text = open(path, encoding='latin-1').read()
    rows, consts = [], {}
    m = re.search(r'^\tTarget constant:\t(\S+)', text, re.M)
    target = m.group(1) if m else ''
    m = re.search(r'^\tConstants:\t(.*)$', text, re.M)
    if m:
        for item in m.group(1).split('\t'):
            name, val = item.rsplit(': ', 1)
            consts[name] = val
    m = re.search(r'Search results:\n\n[^\n]*\n\n(.*?)\n\n\nExploration', text, re.S)
    if m:
        for line in m.group(1).split('\n'):
            f = line.split('\t')
            if len(f) >= 4 and f[0].isdigit():
                rows.append({'length': int(f[0]), 'expr': f[1], 'value': f[2], 'diff': f[3],
                             'fpp': f[7] if len(f) > 7 else '', 'target': target})
    return rows, consts


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    ap = argparse.ArgumentParser()
    ap.add_argument('rdir', help='directory of the MESearch results files <id>.txt and log.tsv')
    ap.add_argument('--tag', default='l5')
    args = ap.parse_args()
    rdir = args.rdir
    out = os.path.join(RESULTS, f'v0_mesearch_{args.tag}.tsv')
    rawout = open(os.path.join(RESULTS, f'v0_mesearch_{args.tag}_raw.tsv'), 'w', encoding='utf-8', newline='')
    rawout.write('id\ttarget\trank\tlength\texpression\tvalue\tdifference\tFPP\tagree\n')
    bench = {r['id']: r for r in csv.DictReader(open(CONSTANTS, encoding='utf-8'), delimiter='\t') if int(r['digits']) >= 17}
    secs = {}
    log = os.path.join(rdir, 'log.tsv')
    if os.path.exists(log):
        for r in csv.DictReader((l for l in open(log, encoding='utf-8-sig') if not l.startswith('#')), delimiter='\t'):
            if r['status'] in ('done', 'timeout'):
                secs[r['id']] = (r['seconds'].replace(',', '.'), r['status'])

    # named constants: 80-digit values where known
    _, raw = read_results(os.path.join(rdir, next(f for f in os.listdir(rdir) if re.fullmatch(r'\d+\.txt', f))))
    consts, lowprec = {}, set()
    bvals = [(mp.mpf(r['value']), r['id']) for r in bench.values()]
    for name, val in raw.items():
        if re.fullmatch(r'\d+(/\d+)?', name):
            p, _, q = name.partition('/')
            consts[name] = mp.mpf(p) / mp.mpf(q or 1)
        elif name in MPCONST:
            consts[name] = MPCONST[name]
        else:
            c = mp.mpf(val)
            hit = [(v, i) for v, i in bvals if abs(abs(v) - abs(c)) <= mp.mpf('1e-13') * abs(c)]
            if hit:   # MESearch may store the negated constant (Stieltjes gamma_1, Madelung M3, ...)
                consts[name] = mp.sign(c) * abs(hit[0][0])
            else:
                consts[name], _ = c, lowprec.add(name)
    print(f'{len(raw)} constants in MESearch, {len(lowprec)} known only to 16 digits: {" ".join(sorted(lowprec))}')

    fields = ['id', 'name', 'class', 'digits', 'verdict', 'mesearch', 'length', 'agree', 'time', 'formula']
    counts, parse_bad, missing = {}, [], []
    with open(out, 'w', encoding='utf-8', newline='') as fo:
        w = csv.DictWriter(fo, fieldnames=fields, delimiter='\t', lineterminator='\n')
        w.writeheader()
        for i, b in bench.items():
            path = os.path.join(rdir, f'{i}.txt')
            if not os.path.exists(path):
                missing.append(i)
                continue
            rows, _ = read_results(path)
            v = mp.mpf(b['value'])
            scored = []
            for r in rows:
                p = Parser(r['expr'], consts)
                try:
                    f = real(p.parse())
                except (ValueError, ZeroDivisionError, TypeError) as e:
                    parse_bad.append((i, r['expr'], str(e)))
                    scored.append((r, None, p.used))
                    continue
                printed = mp.mpf(r['value'])
                if abs(f - printed) > mp.mpf('1e-11') * max(1, abs(printed)) and not (p.used & lowprec):
                    parse_bad.append((i, r['expr'], f'value {mp.nstr(f, 17)} vs printed {r["value"]}'))
                scored.append((r, agree(f, v), p.used))
            for k, (r, a, _) in enumerate(scored, 1):
                rawout.write('\t'.join(map(str, (i, r['target'], k, r['length'], r['expr'], r['value'], r['diff'],
                                                 r['fpp'], '' if a is None else f'{a:.1f}'))) + '\n')
            if not scored:
                verdict, top, a = 'not found', None, None
            else:
                top, a, used = scored[0]
                if a is not None and a >= EXACT:
                    verdict = 'exact'
                elif any(s[1] is not None and s[1] >= EXACT for s in scored[1:]):
                    verdict = 'false negative'
                elif used & lowprec:
                    verdict = 'unverifiable'
                else:
                    verdict = 'false positive'
            counts[verdict] = counts.get(verdict, 0) + 1
            sec, status = secs.get(i, ('', ''))
            w.writerow({'id': i, 'name': b['name'], 'class': b['class'], 'digits': b['digits'], 'verdict': verdict,
                        'mesearch': top['expr'] if top else '', 'length': top['length'] if top else '',
                        'agree': '' if a is None else f'{a:.1f}', 'time': sec + (' (timeout)' if status == 'timeout' else ''),
                        'formula': b['formula']})
    rawout.close()
    print(f'scored {sum(counts.values())}, missing {len(missing)}:', ', '.join(f'{k} {n}' for k, n in sorted(counts.items())))
    for i, e, msg in parse_bad[:30]:
        print(f'  parse check failed: id {i}: {e}  ({msg})')
    if len(parse_bad) > 30:
        print(f'  ... {len(parse_bad)} parse check failures in total')


if __name__ == '__main__':
    main()
