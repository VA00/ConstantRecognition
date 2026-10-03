"""MeijerG calculator: constant recognition by enumerating MeijerG and PFQ values over rational
parameters (grammar.py), combined at the top by one arithmetic operation. Prototype.

Three layers, each with a cost (every node >= 1, so each cost level is finite):
  bottom  rational atoms, Stern-Brocot depth (grammar.py)
  middle  leaves: HypergeometricPFQ[A, B, z] and MeijerG[{A1, A2}, {B1, B2}, z]   (cost 1 + lists + z)
  top     pairs:  leaf1 op leaf2, op in + - * /                                   (cost 1 + both leaves)
  glue    value * r * pi^(k/2): leaves r = +-p/q (p, q <= 4), k = -2..2; pairs r only.
          Applied to the targets (a sorted table), so it costs nothing to enumerate.

Leaves are complete up to KLEAF, pairs up to KPAIR <= KLEAF + 5 (the cheapest leaf costs 4).
Leaves are evaluated with mpmath at 15 digits in worker processes with a hard time limit per
evaluation; equal values (12 digits) are kept once, cheapest first; rational values are dropped.
Every match is re-evaluated at 40 digits; only verified matches count.

Usage: python meijerg_search.py KLEAF [KPAIR] [workers]
Output: meijerg_K<KLEAF>_<KPAIR>.log, meijerg_K<KLEAF>_<KPAIR>_matches.tsv (next to this file)
"""
import sys, os, time, math, queue
import multiprocessing as mpr
from fractions import Fraction as F
import numpy as np
import mpmath as mp
from grammar import Grammar, fmt

HERE = os.path.dirname(os.path.abspath(__file__))
V0 = os.path.join(HERE, "..", "..", "..", "benchmark", "data", "v0", "constants_v0.tsv")
TOL = 2e-13          # relative tolerance in machine precision
VERIFY_DPS = 40
VERIFY_OK = 30       # digits a match must keep at 40-digit precision
TIMEOUT = 2.0        # seconds per evaluation (15 digits); verification gets 10x
CHUNK = 32


# ---------------- evaluation ----------------
def mpq(x):
    return mp.mpf(x.numerator) / x.denominator

def evaluate(c, dps):
    mp.mp.dps = dps
    kw = dict(maxterms=20000, maxprec=600 if dps <= 15 else 2000)
    try:
        if c[0] == "PFQ":
            v = mp.hyper([mpq(x) for x in c[1]], [mpq(x) for x in c[2]], mpq(c[3]), **kw)
        else:
            v = mp.meijerg([[mpq(x) for x in c[1]], [mpq(x) for x in c[2]]],
                           [[mpq(x) for x in c[3]], [mpq(x) for x in c[4]]], mpq(c[5]), **kw)
    except Exception:
        return None
    if isinstance(v, mp.mpc):
        if abs(v.imag) > mp.mpf(10) ** (-dps + 3) * abs(v):
            return None
        v = v.real
    return v if mp.isfinite(v) else None

def task(item):
    c, dps = item
    v = evaluate(c, dps)
    if v is None:
        return None
    return float(v) if dps <= 15 else mp.nstr(v, dps)   # high precision travels as a string


# ---------------- worker pool with a hard per-item time limit ----------------
def worker_loop(wid, task_q, res_q, cur_idx, cur_t):
    while True:
        item = task_q.get()
        if item is None:
            return
        base, items = item
        out = []
        for j, it in enumerate(items):
            cur_t[wid] = time.time(); cur_idx[wid] = base + j
            out.append((base + j, task(it)))
        cur_idx[wid] = -1
        res_q.put(out)

class KillPool:
    """Like Pool.map, but an item running longer than the limit is abandoned: its worker
    process is killed and restarted, and the rest of its chunk is re-queued."""
    def __init__(self, n):
        self.n = n
        self.task_q = mpr.Queue(); self.res_q = mpr.Queue()
        self.cur_idx = mpr.Array("l", [-1] * n, lock=False)
        self.cur_t = mpr.Array("d", [0.0] * n, lock=False)
        self.procs = [self._start(w) for w in range(n)]
    def _start(self, w):
        self.cur_idx[w] = -1
        p = mpr.Process(target=worker_loop, args=(w, self.task_q, self.res_q, self.cur_idx, self.cur_t), daemon=True)
        p.start()
        return p
    def map(self, items, limit):
        res = [None] * len(items); got = [False] * len(items); done = 0; self.timeouts = 0
        chunks = {}
        for b in range(0, len(items), CHUNK):
            chunks[b] = min(CHUNK, len(items) - b); self.task_q.put((b, items[b:b + CHUNK]))
        while done < len(items):
            try:
                for i, v in self.res_q.get(timeout=0.2):
                    if not got[i]:
                        res[i] = v; got[i] = True; done += 1
            except queue.Empty:
                pass
            now = time.time()
            for w in range(self.n):
                i = self.cur_idx[w]
                if i >= 0 and now - self.cur_t[w] > limit and not got[i]:
                    self.procs[w].kill(); self.procs[w].join()
                    got[i] = True; done += 1; self.timeouts += 1
                    b = max(x for x in chunks if x <= i)
                    for j in range(b, b + chunks[b]):
                        if not got[j]:
                            chunks[j] = 1; self.task_q.put((j, [items[j]]))
                    self.procs[w] = self._start(w)
        return res
    def close(self):
        for _ in self.procs:
            self.task_q.put(None)
        for p in self.procs:
            p.join(timeout=1)
            if p.is_alive():
                p.kill()


# ---------------- targets and glue ----------------
def load_targets():
    out = []
    with open(V0, encoding="utf-8") as f:
        next(f)
        for line in f:
            p = line.rstrip("\n").split("\t")
            if int(p[3]) >= 17:                      # like the other tools: at least 17 digits
                out.append(("v0:" + p[0], p[1], p[4], p[2]))
    return out

def glue_factors(with_pi):
    rs = sorted({F(p, q) for p in range(1, 5) for q in range(1, 5)})
    return [(s * r, k) for r in rs for s in (1, -1) for k in (range(-2, 3) if with_pi else [0])]

def glue_value(g, dps=None):
    r, k = g
    if dps is None:
        return float(r) * math.pi ** (k / 2)
    return mp.mpf(r.numerator) / r.denominator * mp.pi ** (mp.mpf(k) / 2)

def glue_str(g):
    r, k = g
    s = str(r.numerator) if r.denominator == 1 else f"{r.numerator}/{r.denominator}"
    return s + ("" if k == 0 else f" Pi^({k}/2)")

class TargetTable:
    """Sorted array of target / glue, for vectorized matching."""
    def __init__(self, targets, glue):
        vals, ti, gi = [], [], []
        for i, t in enumerate(targets):
            tv = float(mp.mpf(t[3]))
            for j, g in enumerate(glue):
                vals.append(tv / glue_value(g)); ti.append(i); gi.append(j)
        order = np.argsort(vals)
        self.v = np.array(vals)[order]; self.ti = np.array(ti)[order]; self.gi = np.array(gi)[order]
        self.glue = glue
    def match(self, x):
        """Indices (into x) and table rows of all values within TOL."""
        x = np.asarray(x, dtype=float)
        lo = np.searchsorted(self.v, x - np.abs(x) * TOL, "left")
        hi = np.searchsorted(self.v, x + np.abs(x) * TOL, "right")
        hit = np.nonzero(hi > lo)[0]
        return [(i, r) for i in hit for r in range(lo[i], hi[i])]


# ---------------- search ----------------
def main():
    kleaf = int(sys.argv[1]) if len(sys.argv) > 1 else 12
    kpair = int(sys.argv[2]) if len(sys.argv) > 2 else kleaf + 5
    nproc = int(sys.argv[3]) if len(sys.argv) > 3 else 12
    kpair = min(kpair, kleaf + 5)
    tag = f"K{kleaf}_{kpair}"
    logf = open(os.path.join(HERE, f"meijerg_{tag}.log"), "w", encoding="utf-8")
    matf = open(os.path.join(HERE, f"meijerg_{tag}_matches.tsv"), "w", encoding="utf-8")
    matf.write("K\tkind\ttarget\tname\tknown_formula\tfound\tglue\tverified_digits\n")
    def log(*a):
        s = time.strftime("%H:%M:%S ") + " ".join(str(x) for x in a)
        print(s, flush=True); logf.write(s + "\n"); logf.flush()

    mp.mp.dps = 70                           # main process: parse targets with all their digits
    targets = load_targets()
    leaf_table = TargetTable(targets, glue_factors(with_pi=True))
    pair_table = TargetTable(targets, glue_factors(with_pi=False))
    tval = [mp.mpf(t[3]) for t in targets]   # parsed at 70 digits (v0 has up to 64)
    log(f"meijerg search: leaves up to cost {kleaf}, pairs up to {kpair}, {len(targets)} targets (v0, >= 17 digits), "
        f"glue {len(leaf_table.glue)} (leaves) / {len(pair_table.glue)} (pairs), tolerance {TOL}")

    pool = KillPool(nproc)
    hp = {}                                  # leaf -> 40-digit value (string) or None
    def high(cands):
        need = [c for c in dict.fromkeys(cands) if c not in hp]
        for c, v in zip(need, pool.map([(c, VERIFY_DPS) for c in need], 10 * TIMEOUT)):
            hp[c] = v
    found = {}
    def report(k, kind, ti, g, expr, hv):
        t = targets[ti]
        if hv is None:
            return
        mp.mp.dps = VERIFY_DPS + 10
        d = abs(hv * glue_value(g, VERIFY_DPS) - tval[ti])
        vd = VERIFY_DPS if d == 0 else int(-mp.log10(d / abs(tval[ti])))
        matf.write("\t".join(str(x) for x in (k, kind, t[0], t[1], t[2], expr, glue_str(g), vd)) + "\n"); matf.flush()
        if vd >= VERIFY_OK and t[0] not in found:
            found[t[0]] = (k, kind)
            log(f"  MATCH K={k} {kind} {t[0]} ({t[1][:60]}) = {glue_str(g)} * {expr}   ({vd} digits)")

    # ---- leaves ----
    g = Grammar(kleaf)
    seen = set()
    leaves = {}                              # cost -> (values array, candidates)
    t_all = time.time()
    for k in range(1, kleaf + 1):
        t0 = time.time()
        cands = list(g.candidates(k))
        vals = pool.map([(c, 15) for c in cands], TIMEOUT)
        keep_v, keep_c = [], []
        nfail = nrat = ndup = 0
        for c, v in zip(cands, vals):
            if v is None or v == 0 or not math.isfinite(v):
                nfail += 1; continue
            fr = F(v).limit_denominator(1000)
            if abs(float(fr) - v) <= 1e-13 * abs(v):
                nrat += 1; continue
            key = float(f"{v:.11e}")
            if key in seen:
                ndup += 1; continue
            seen.add(key); keep_v.append(v); keep_c.append(c)
        leaves[k] = (np.array(keep_v), keep_c)
        hits = leaf_table.match(keep_v)
        high([keep_c[i] for i, _ in hits])
        for i, r in hits:
            c = keep_c[i]
            mp.mp.dps = VERIFY_DPS + 10                  # parse the 40-digit string with all its digits
            report(k, "leaf", leaf_table.ti[r], leaf_table.glue[leaf_table.gi[r]], fmt(c),
                   None if hp[c] is None else mp.mpf(hp[c]))
        log(f"leaves K={k}: {len(cands)} candidates, {nfail} failed/complex, {nrat} rational, {ndup} duplicates, "
            f"{len(keep_v)} new values, {pool.timeouts} timeouts, {len(hits)} raw matches, {time.time() - t0:.1f} s")

    # ---- pairs: leaf1 op leaf2 ----
    ops = [("+", np.add, True), ("*", np.multiply, True), ("-", np.subtract, False), ("/", np.divide, False)]
    mpops = {"+": lambda a, b: a + b, "*": lambda a, b: a * b, "-": lambda a, b: a - b, "/": lambda a, b: a / b}
    costs = sorted(c for c in leaves if len(leaves[c][1]))
    for k in range(1, kpair + 1):
        t0 = time.time(); npairs = 0; nhits = 0
        for c1 in costs:
            c2 = k - 1 - c1
            if c2 not in leaves or not len(leaves[c2][1]):
                continue
            a, ca = leaves[c1]; b, cb = leaves[c2]
            for name, f, comm in ops:
                if comm and c1 > c2:
                    continue
                with np.errstate(all="ignore"):
                    x = f(a[:, None], b[None, :]).ravel()
                if comm and c1 == c2:
                    iu = np.triu_indices(len(a))
                    x = f(a[iu[0]], b[iu[1]]); idx = list(zip(iu[0], iu[1]))
                else:
                    idx = None
                npairs += len(x)
                ok = np.isfinite(x) & (x != 0)
                hits = [(i, r) for i, r in pair_table.match(np.where(ok, x, np.nan)) if ok[i]]
                if not hits:
                    continue
                def ij(i):
                    return idx[i] if idx is not None else divmod(i, len(b))
                high([ca[ij(i)[0]] for i, _ in hits] + [cb[ij(i)[1]] for i, _ in hits])
                for i, r in hits:
                    p, q = ij(i)
                    va, vb = hp[ca[p]], hp[cb[q]]
                    if va is None or vb is None:
                        continue
                    mp.mp.dps = VERIFY_DPS + 10
                    hv = mpops[name](mp.mpf(va), mp.mpf(vb))
                    fr = F(float(hv)).limit_denominator(1000)
                    if abs(hv - mp.mpf(fr.numerator) / fr.denominator) < mp.mpf(10) ** -30 * abs(hv):
                        continue                                  # a rational: says nothing
                    nhits += 1
                    report(k, "pair", pair_table.ti[r], pair_table.glue[pair_table.gi[r]],
                           f"({fmt(ca[p])}) {name} ({fmt(cb[q])})", hv)
        if npairs:
            log(f"pairs K={k}: {npairs} values, {nhits} raw matches, {time.time() - t0:.1f} s")
    pool.close()
    log(f"done in {time.time() - t_all:.0f} s: {len(found)} targets matched with >= {VERIFY_OK} verified digits "
        f"({sum(1 for v in found.values() if v[1] == 'leaf')} by a leaf, {sum(1 for v in found.values() if v[1] == 'pair')} by a pair)")

if __name__ == "__main__":
    main()
