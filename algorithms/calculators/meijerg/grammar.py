"""Minimal grammar for FireEverything: rational atoms feeding HypergeometricPFQ and MeijerG.

Cost model (every node >= 1, so each cost level is finite and the search is exhaustive):
  rational atom p/q : depth in the Stern-Brocot tree (sum of continued-fraction terms);
                      negative +1, zero costs 1.  1/2 -> 2, 1/3 -> 3, 2/3 -> 3, 3 -> 3, 1/4 -> 4
  list              : 1 + sum of its atoms (a multiset: the functions are symmetric in each list)
  PFQ[A, B, z]      : 1 + list A + list B + atom z
  MeijerG[{A1, A2}, {B1, B2}, z] : 1 + four lists + atom z     (Mathematica's convention)

Canonical forms (identities that make a candidate redundant are filtered before evaluation):
  PFQ  - no parameter is a non-positive integer (an a: terminating series = rational value;
         a b: pole); no parameter common to A and B (cancels to a cheaper PFQ); p <= q + 1;
         for p = q + 1: |z| <= 1, at z = 1 convergence sum(B) > sum(A).
  G    - m + n >= 1 (else G = 0); no a in A1 and b in B1 with a - b a positive integer (undefined);
         no common parameter in A1 and B2 or in A2 and B1 (cancels to a lower order);
         inversion G(1/z | a; b) = G(z | 1-b; 1-a) with (m,n,p,q) -> (n,m,q,p): keep p < q (any z)
         or p == q with |z| <= 1; z^c G(z | a; b) = G(z | a+c; b+c): at z = 1 keep min(B1) = 0.
"""
from fractions import Fraction as F
from collections import defaultdict
import itertools


def sb_cost(x):
    x = F(x)
    if x == 0:
        return 1
    if x < 0:
        return sb_cost(-x) + 1
    total = 0
    while True:
        a = x.numerator // x.denominator
        total += a
        x -= a
        if x == 0:
            return total
        x = 1 / x


def rationals(maxcost):
    """All rationals with cost <= maxcost, grouped by cost."""
    by = defaultdict(list)
    by[1].append(F(0))
    level = [(F(1), 1)]
    while level:
        nxt = []
        for x, d in level:
            by[d].append(x)
            if d + 1 <= maxcost:
                by[d + 1].append(-x)
                nxt += [(x + 1, d + 1), (x / (1 + x), d + 1)]
        level = nxt
    return {c: sorted(v) for c, v in by.items() if c <= maxcost}


class Grammar:
    def __init__(self, kmax):
        self.kmax = kmax
        self.atoms = rationals(kmax)
        self._ms = {0: [()]}

    def multisets(self, s):
        """Sorted tuples of atoms with total cost exactly s."""
        if s in self._ms:
            return self._ms[s]
        out = []
        # choose the largest-cost part first to get each multiset once: parts (cost, atom) non-increasing
        flat = [(c, x) for c in sorted(self.atoms) for x in self.atoms[c]]
        def rec(rem, maxidx, acc):
            if rem == 0:
                out.append(tuple(sorted(acc)))
                return
            for i in range(maxidx, -1, -1):
                c, x = flat[i]
                if c <= rem:
                    rec(rem - c, i, acc + [x])
        rec(s, len(flat) - 1, [])
        self._ms[s] = out
        return out

    def lists(self, lcost):
        """Lists whose cost (1 + atoms) is lcost."""
        return self.multisets(lcost - 1) if lcost >= 1 else []

    # ---------------- PFQ ----------------
    @staticmethod
    def pfq_ok(a, b, z):
        if z == 0:
            return False
        if any(x <= 0 and x.denominator == 1 for x in a + b):
            return False
        if set(a) & set(b):
            return False
        p, q = len(a), len(b)
        if p > q + 1:
            return False
        if p == q + 1:
            if abs(z) > 1:
                return False
            if z == 1 and not sum(b) > sum(a):
                return False
        return True

    def pfq(self, k):
        """All canonical PFQ candidates of total cost k."""
        rem = k - 1
        for cz in range(1, rem - 1):
            for la in range(1, rem - cz):
                lb = rem - cz - la
                if lb < 1:
                    continue
                for z in self.atoms.get(cz, []):
                    for a in self.lists(la):
                        for b in self.lists(lb):
                            if self.pfq_ok(a, b, z):
                                yield ("PFQ", a, b, z)

    # ---------------- MeijerG ----------------
    @staticmethod
    def g_ok(a1, a2, b1, b2, z):
        m, n, p, q = len(b1), len(a1), len(a1) + len(a2), len(b1) + len(b2)
        if m + n == 0 or z == 0:
            return False
        if p > q or (p == q and abs(z) > 1):
            return False
        for x in a1:
            for y in b1:
                d = x - y
                if d > 0 and d.denominator == 1:
                    return False
        if set(a1) & set(b2) or set(a2) & set(b1):
            return False
        if z == 1 and m >= 1 and min(b1) != 0:
            return False
        return True

    def meijerg(self, k):
        rem = k - 1
        for cz in range(1, rem - 3):
            r4 = rem - cz
            for l1 in range(1, r4 - 2):
                for l2 in range(1, r4 - l1 - 1):
                    for l3 in range(1, r4 - l1 - l2):
                        l4 = r4 - l1 - l2 - l3
                        if l4 < 1:
                            continue
                        for z in self.atoms.get(cz, []):
                            for a1 in self.lists(l1):
                                for a2 in self.lists(l2):
                                    for b1 in self.lists(l3):
                                        for b2 in self.lists(l4):
                                            if self.g_ok(a1, a2, b1, b2, z):
                                                yield ("G", a1, a2, b1, b2, z)

    def candidates(self, k):
        yield from self.pfq(k)
        yield from self.meijerg(k)


def fmt(c):
    def r(x):
        return str(x.numerator) if x.denominator == 1 else f"{x.numerator}/{x.denominator}"
    def l(t):
        return "{" + ", ".join(r(x) for x in t) + "}"
    if c[0] == "PFQ":
        return f"HypergeometricPFQ[{l(c[1])}, {l(c[2])}, {r(c[3])}]"
    return f"MeijerG[{{{l(c[1])}, {l(c[2])}}}, {{{l(c[3])}, {l(c[4])}}}, {r(c[5])}]"


if __name__ == "__main__":
    import sys
    kmax = int(sys.argv[1]) if len(sys.argv) > 1 else 14
    g = Grammar(kmax)
    tp = tg = 0
    print(" K   PFQ (canonical)   MeijerG (canonical)   cumulative")
    for k in range(1, kmax + 1):
        np_ = sum(1 for _ in g.pfq(k)); ng = sum(1 for _ in g.meijerg(k))
        tp += np_; tg += ng
        print(f"{k:2d} {np_:12d} {ng:18d} {tp + tg:16d}")
