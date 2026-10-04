"""gen_df64_ref.py - inputs and 40-digit references for test_df64.cpp

Author: Andrzej Odrzywolek
Date: October 4, 2026
Code assist: Claude Opus 5.5

Every input is a df64 value (hi, lo floats; the input is exactly hi + lo), drawn over the function's domain plus
points near 0, 1, multiples of pi/2 and the poles. The reference is the function at the exact input with 40
digits (mpmath). Cases whose reference lies outside the df64 range (|v| > 3.4e38, or 0 < |v| < 2^-100) are dropped.
Line format: name hi lo [hi2 lo2] reference   (floats as hexadecimal bit patterns, reference as a decimal string)

Usage: python gen_df64_ref.py [--n 4000] [--seed 1] > df64_ref.txt
"""
import argparse
import random
import struct
import sys

import mpmath as mp

mp.mp.dps = 40
LO, HI = mp.mpf(2) ** -100, mp.mpf('3.4e38')


def f32(x):
    return struct.unpack('<f', struct.pack('<f', float(x)))[0]


def bits(x):
    return '%08x' % struct.unpack('<I', struct.pack('<f', x))[0]


def df(x):
    """x (a float or mpf) as a df64 pair (hi, lo)"""
    hi = f32(x)
    lo = f32(mp.mpf(x) - mp.mpf(hi))
    return hi, lo


def val(p):
    return mp.mpf(p[0]) + mp.mpf(p[1])


def logu(r, a, b):
    return 10 ** r.uniform(a, b)


def samples(name, r):
    s = r.random()
    if name in ('add', 'sub', 'mul', 'div'):
        return (r.choice((-1, 1)) * logu(r, -10, 10), r.choice((-1, 1)) * logu(r, -10, 10))
    if name == 'sqrt':
        return (logu(r, -25, 30),)
    if name == 'exp':
        return (r.uniform(-69, 88),) if s < 0.8 else (r.uniform(-1, 1) * 10 ** r.uniform(-8, 0),)
    if name == 'log':
        return (logu(r, -28, 38),) if s < 0.7 else (1 + r.uniform(-1, 1) * 10 ** r.uniform(-10, -1),)
    if name in ('sin', 'cos', 'tan'):
        if s < 0.6:
            return (r.uniform(-32, 32),)
        if s < 0.8:
            return (r.uniform(-1500, 1500),)
        k = r.randint(-20, 20)
        return (float(k * mp.pi / 2) + r.uniform(-1, 1) * 10 ** r.uniform(-8, -1),)
    if name in ('asin', 'acos'):
        return (r.uniform(-1, 1),) if s < 0.7 else (r.choice((-1, 1)) * (1 - 10 ** r.uniform(-12, -1)),)
    if name == 'atan':
        return (r.choice((-1, 1)) * logu(r, -8, 8),)
    if name in ('sinh', 'cosh'):
        return (r.uniform(-88, 88),) if s < 0.7 else (r.uniform(-0.5, 0.5),)
    if name == 'tanh':
        return (r.uniform(-20, 20),) if s < 0.7 else (r.uniform(-0.5, 0.5),)
    if name == 'asinh':
        return (r.choice((-1, 1)) * logu(r, -8, 12),)
    if name == 'acosh':
        return (1 + logu(r, -10, 12),)
    if name == 'atanh':
        if s < 0.6:
            return (r.uniform(-1, 1),)
        if s < 0.8:
            return (r.choice((-1, 1)) * (1 - 10 ** r.uniform(-12, -1)),)
        return (r.uniform(-1, 1) * 10 ** r.uniform(-8, -1),)
    if name == 'pow':
        if s < 0.8:
            return (logu(r, -3, 3), r.uniform(-10, 10))
        return (-logu(r, -2, 2), float(r.randint(-8, 8)))
    if name == 'gamma':
        if s < 0.7:
            return (r.uniform(0.01, 35),)
        x = r.uniform(-30, 0)
        return (x,) if abs(x - round(x)) > 1e-6 else (x + 1e-3,)
    if name == 'digamma':
        if s < 0.7:
            return (r.uniform(0.01, 50),)
        x = r.uniform(-30, 0)
        return (x,) if abs(x - round(x)) > 1e-6 else (x + 1e-3,)
    raise ValueError(name)


FUN = {
    'add': lambda a, b: a + b, 'sub': lambda a, b: a - b, 'mul': lambda a, b: a * b, 'div': lambda a, b: a / b,
    'sqrt': mp.sqrt, 'exp': mp.exp, 'log': mp.log, 'sin': mp.sin, 'cos': mp.cos, 'tan': mp.tan, 'asin': mp.asin,
    'acos': mp.acos, 'atan': mp.atan, 'sinh': mp.sinh, 'cosh': mp.cosh, 'tanh': mp.tanh, 'asinh': mp.asinh,
    'acosh': mp.acosh, 'atanh': mp.atanh, 'pow': lambda t, s: mp.power(t, s), 'gamma': mp.gamma, 'digamma': mp.digamma,
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--n', type=int, default=4000)
    ap.add_argument('--seed', type=int, default=1)
    a = ap.parse_args()
    r = random.Random(a.seed)
    out = sys.stdout
    for name, f in FUN.items():
        k = 0
        while k < a.n:
            args = [df(x) for x in samples(name, r)]
            try:
                v = f(*[val(p) for p in args])
            except (ValueError, ZeroDivisionError):
                continue
            if isinstance(v, mp.mpc) or not mp.isfinite(v) or (v != 0 and not (LO <= abs(v) <= HI)) or v == 0:
                continue
            fields = [name] + [bits(c) for p in args for c in p] + [mp.nstr(v, 25, min_fixed=1, max_fixed=0)]
            out.write(' '.join(fields) + '\n')
            k += 1


if __name__ == '__main__':
    main()
