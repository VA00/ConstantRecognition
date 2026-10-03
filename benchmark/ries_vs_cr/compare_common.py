"""Compare CR (GPU, common grammar, K <= 12) with RIES (same symbols) on alpha within 5 sigma."""
import glob, os, re, sys, collections
import mpmath as mp
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "run"))
import run_ries_v0 as R

mp.mp.dps = 40
HERE = os.path.dirname(os.path.abspath(__file__))
T = mp.mpf("0.0072973525643")

# RIES weights (ries -S, common symbol set); complexity of "x = f" is weight(x) + weights of f
W = {"PI": 14, "EULER": 16, "GOLDENRATIO": 18, "ONE": 10, "TWO": 13, "THREE": 15, "FOUR": 16, "FIVE": 17, "SIX": 18,
     "SEVEN": 18, "EIGHT": 19, "NINE": 19, "LOG": 13, "EXP": 13, "INV": 7, "SQRT": 9, "SQR": 9,
     "PLUS": 4, "TIMES": 4, "SUBTRACT": 5, "DIVIDE": 5, "POWER": 6}
CV = {"PI": mp.pi, "EULER": mp.e, "GOLDENRATIO": mp.phi, **{n: mp.mpf(i) for i, n in enumerate(
    ["ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT", "NINE"], 1)}}
UN = {"LOG": mp.log, "EXP": mp.exp, "INV": lambda a: 1 / a, "SQRT": mp.sqrt, "SQR": lambda a: a * a}
BI = {"PLUS": lambda a, b: a + b, "TIMES": lambda a, b: a * b, "SUBTRACT": lambda a, b: a - b,
      "DIVIDE": lambda a, b: a / b, "POWER": lambda a, b: a ** b}          # GPU kernel order: a op b
INFIX_U = {"LOG": "Log[{}]", "EXP": "Exp[{}]", "INV": "1/({})", "SQRT": "Sqrt[{}]", "SQR": "({})^2"}
INFIX_B = {"PLUS": "({} + {})", "TIMES": "{} {}", "SUBTRACT": "({} - {})", "DIVIDE": "{}/{}", "POWER": "({})^({})"}
NAME = {"PI": "Pi", "EULER": "E", "GOLDENRATIO": "GoldenRatio", **{n: str(i) for i, n in enumerate(
    ["ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT", "NINE"], 1)}}

def cr_eval(toks):
    st, sx = [], []
    for t in toks:
        if t in CV: st.append(CV[t]); sx.append(NAME[t])
        elif t in UN: st.append(UN[t](st.pop())); sx.append(INFIX_U[t].format(sx.pop()))
        else:
            b, a = st.pop(), st.pop(); st.append(BI[t](a, b))
            y, x = sx.pop(), sx.pop(); sx.append(INFIX_B[t].format(x, y))
    return st[0], sx[0]

def key(v):
    return mp.nstr(v, 13)

# ---- CR hits ----
cr = {}
for line in open(os.path.join(HERE, "gpu_common_K12.txt")):
    p = line.rstrip("\n").split("\t")
    if p[0] != "#MATCH":
        continue
    toks = [t.strip() for t in p[3].split(",")]
    v, s = cr_eval(toks)
    if abs(v / T - 1) > mp.mpf("7.5e-10"):
        continue
    k = key(v)
    c = 15 + sum(W[t] for t in toks)
    if k not in cr or c < cr[k]["cplx"]:
        cr[k] = {"K": int(p[2]), "cplx": c, "formula": s, "value": v}
print(f"CR (GPU, common grammar, K <= 12): {len(cr)} distinct values within 5 sigma")
byK = collections.Counter(d["K"] for d in cr.values())
print("  by K:", dict(sorted(byK.items())))

# ---- RIES runs ----
def ries_roots(path):
    eqs = R.parse(open(path).read())
    roots = {}
    for e in eqs:
        try:
            x = mp.mpf(e["root"])
        except Exception:
            continue
        roots.setdefault(key(x), (e["complexity"], e["text"]))
    return eqs, roots

rows = []
for path in sorted(glob.glob(os.path.join(HERE, "ries_common_*_l*.txt"))):
    mode, level = re.search(r"ries_common_(.+)_l(\d)\.txt", path).groups()
    eqs, roots = ries_roots(path)
    both = set(roots) & set(cr)
    maxc = max((c for c, _ in roots.values()), default=0)
    rows.append((mode, int(level), len(eqs), len(roots), len(both), maxc, roots))
    print(f"RIES {mode:9s} -l{level}: {len(eqs):6d} equations, {len(roots):6d} distinct roots, "
          f"{len(both):5d} equal to a CR value, max complexity {maxc}")

# ---- coverage of CR's explicit formulas by RIES, by RIES complexity ----
best = max((r for r in rows if r[0] == "two-sided"), key=lambda r: r[1], default=None)
if best:
    roots = best[6]
    print(f"\nCR formulas found by RIES two-sided -l{best[1]} (same value), by RIES complexity of 'x = f':")
    bins = collections.defaultdict(lambda: [0, 0])
    for k, d in cr.items():
        b = 10 * (d["cplx"] // 10)
        bins[b][0] += 1; bins[b][1] += k in roots
    for b in sorted(bins):
        print(f"  complexity {b:3d}-{b + 9:3d}: {bins[b][1]:5d} of {bins[b][0]:5d}")
    missed = sorted((d for k, d in cr.items() if k not in roots), key=lambda d: d["cplx"])[:10]
    print("  simplest CR formulas RIES did not report:")
    for d in missed:
        print(f"    complexity {d['cplx']:3d}, K={d['K']:2d}: x = {d['formula']}")
    same = sorted((d for k, d in cr.items() if k in roots), key=lambda d: d["cplx"])[:10]
    print("  examples found by both (CR formula | RIES equation):")
    for d in same:
        print(f"    x = {d['formula']}   |   {roots[key(d['value'])][1]}")

# ---- RIES one-sided explicit formulas with <= 12 symbols must be in CR ----
for mode, level, ne, nr, nb, maxc, roots in rows:
    if mode != "one-sided":
        continue
    eqs = R.parse(open(os.path.join(HERE, f"ries_common_one-sided_l{level}.txt")).read())
    short = [e for e in eqs if e["lhs"] == ["x"] and len(e["rhs"]) <= 12]
    miss = [e for e in short if key(mp.mpf(e["root"])) not in cr]
    print(f"\nRIES one-sided -l{level}: {len(short)} explicit formulas with <= 12 symbols, "
          f"{len(short) - len(miss)} also found by CR, {len(miss)} not: {[e['text'] for e in miss[:5]]}")

# ---- same 13 digits is not the same number: check each CR value against RIES's equations at 80 digits ----
# (thousands of RIES roots lie inside the 5-sigma window, so 13-digit coincidences between different formulas occur)
best_path = max(glob.glob(os.path.join(HERE, "ries_common_two-sided_l*.txt")))
eqs = R.parse(open(best_path).read())
byk = {}
for e in eqs:
    try:
        byk.setdefault(key(mp.mpf(e["root"])), []).append(e)
    except Exception:
        pass
mp.mp.dps = 80
print(f"\nIdentity check at 80 digits against {os.path.basename(best_path)}:")
n_id = 0
for k, d in sorted(cr.items(), key=lambda kv: kv[1]["cplx"]):
    best = (0.0, "-")
    for e in byk.get(k, []):
        x = R.solve(e, e["root"])
        if x is not None:
            best = max(best, (R.agree(x, d["value"], 40), e["text"]))
    ok = best[0] >= 30
    n_id += ok
    print(f"  {'IDENTITY' if ok else 'not found':9s} {best[0]:5.1f} digits  x = {d['formula']}   |   {best[1]}")
print(f"  {n_id} of {len(cr)} CR values found by RIES as the same identity")
