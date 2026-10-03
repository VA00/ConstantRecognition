"""Random planted formulas of exact length K, sampled uniformly from a tool's own grammar.

A postfix code of length K is valid if the stack never underflows and ends with one value.
count[pos][depth] = number of valid completions; sampling symbol by symbol with weights
(number of buttons of that arity) x (completions after it) gives every valid code the same
probability. Values are computed with mpmath (50 digits); complex or non-finite values,
values outside 1e-6..1e6 and values close to simple rationals are rejected.
"""
import random
import mpmath as mp

mp.mp.dps = 50

# CALC4 (C/CALC4.h): 13 constants, 18 unary, 5 binary; Constant Recognition's button names.
CALC4 = {
    "const": {"PI": lambda: mp.pi, "EULER": lambda: mp.e, "NEG": lambda: mp.mpf(-1), "GOLDENRATIO": lambda: mp.phi,
              **{n: (lambda v=v: mp.mpf(v)) for v, n in enumerate(
                  ["ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT", "NINE"], start=1)}},
    "unary": {"LOG": mp.log, "EXP": mp.exp, "INV": lambda x: 1 / x, "GAMMA": mp.gamma, "SQRT": mp.sqrt,
              "SQR": lambda x: x * x, "SIN": mp.sin, "ARCSIN": mp.asin, "COS": mp.cos, "ARCCOS": mp.acos,
              "TAN": mp.tan, "ARCTAN": mp.atan, "SINH": mp.sinh, "ARCSINH": mp.asinh, "COSH": mp.cosh,
              "ARCCOSH": mp.acosh, "TANH": mp.tanh, "ARCTANH": mp.atanh},
    # GPU kernel's operand order: "a, b, SUBTRACT" = a - b, "a, b, POWER" = a^b
    "binary": {"PLUS": lambda a, b: a + b, "TIMES": lambda a, b: a * b, "SUBTRACT": lambda a, b: a - b,
               "DIVIDE": lambda a, b: a / b, "POWER": lambda a, b: a ** b},
}

# RIES default symbols (ries -S), RIES's own semantics.
RIES = {
    "const": {**{str(v): (lambda v=v: mp.mpf(v)) for v in range(1, 10)},
              "e": lambda: mp.e, "f": lambda: mp.phi, "p": lambda: mp.pi},
    "unary": {"n": lambda x: -x, "r": lambda x: 1 / x, "s": lambda x: x * x, "q": mp.sqrt, "l": mp.log,
              "E": mp.exp, "S": lambda x: mp.sinpi(x), "C": lambda x: mp.cospi(x), "T": lambda x: mp.tan(mp.pi * x)},
    "binary": {"+": lambda a, b: a + b, "-": lambda a, b: a - b, "*": lambda a, b: a * b, "/": lambda a, b: a / b,
               "^": lambda a, b: a ** b, "v": lambda a, b: b ** (1 / a), "L": lambda a, b: mp.log(b) / mp.log(a),
               "A": lambda a, b: mp.atan2(a, b)},
}


def evaluate(g, code):
    st = []
    for s in code:
        if s in g["const"]:
            st.append(g["const"][s]())
        elif s in g["unary"]:
            st.append(g["unary"][s](st.pop()))
        else:
            b = st.pop(); a = st.pop()
            st.append(g["binary"][s](a, b))
    (v,) = st
    return v


def _counts(g, K):
    nc, nu, nb = len(g["const"]), len(g["unary"]), len(g["binary"])
    cnt = [[0] * (K + 2) for _ in range(K + 1)]
    cnt[K][1] = 1
    for pos in range(K - 1, -1, -1):
        for d in range(0, K + 1):
            c = nc * cnt[pos + 1][d + 1]
            if d >= 1:
                c += nu * cnt[pos + 1][d]
            if d >= 2:
                c += nb * cnt[pos + 1][d - 1]
            cnt[pos][d] = c
    return cnt


def sample(g, K, rng):
    cnt = _counts(g, K)
    code, d = [], 0
    for pos in range(K):
        w = [len(g["const"]) * cnt[pos + 1][d + 1],
             len(g["unary"]) * cnt[pos + 1][d] if d >= 1 else 0,
             len(g["binary"]) * cnt[pos + 1][d - 1] if d >= 2 else 0]
        kind = rng.choices(["const", "unary", "binary"], weights=w)[0]
        code.append(rng.choice(list(g[kind])))
        d += {"const": 1, "unary": 0, "binary": -1}[kind]
    return code


def acceptable(v):
    if v is None or isinstance(v, mp.mpc) or not mp.isfinite(v):
        return False
    a = abs(v)
    if not (mp.mpf("1e-6") < a < mp.mpf("1e6")):
        return False
    return all(abs(v * q - mp.nint(v * q)) > mp.mpf("1e-6") * q for q in range(1, 13))   # not a simple rational


def planted(g, K, rng):
    while True:
        code = sample(g, K, rng)
        try:
            v = evaluate(g, code)
        except Exception:                      # domain errors, complex intermediates (atan2), overflow
            continue
        if not acceptable(v):
            continue
        try:                       # reject ill-conditioned values, e.g. artanh(ln e) = artanh(1) rounded to finite
            with mp.workdps(100):
                w = evaluate(g, code)
            if isinstance(w, mp.mpc) or not mp.isfinite(w) or abs(w - v) > abs(v) * mp.mpf(10) ** -40:
                continue
        except Exception:
            continue
        return code, v
