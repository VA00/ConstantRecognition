"""Small-scale depth test: how deep do a memoryless (CR on the GPU) and a memory-heavy (RIES) search
get, on formulas planted from their own grammars?

Part A (high precision): the target is the planted value in double precision. Retrieved = the tool
reports a formula that agrees with the planted value to >= 30 digits (checked at 50-80 digits).
Part B (error bars): the target is the planted value times (1 + delta u), |u| < 0.9, with relative
error bar delta. Reported: number of formulas within the error bar, and whether the planted formula
(or one equal to it to 30 digits) is among them.

Usage: python depth_test.py [--seed 1]   (needs psutil, mpmath; paths below)
"""
import argparse, json, os, random, re, sys, time
import mpmath as mp
import grammars as G
import monitor

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.join(HERE, "..", "..")
GPU = os.path.join(REPO, "algorithms", "methods", "gpu_cuda", "constant_gpu_benchmark.exe")
RIES = os.environ.get("RIES", "ries")              # path to the ries executable
sys.path.insert(0, os.path.join(REPO, "benchmark", "run"))
import run_ries_v0 as R   # RIES -F3 parser and 80-digit solver

FLT_EPS = 1.1920929e-07


def agree(a, b):
    if a is None or b is None:
        return 0
    mp.mp.dps = 80
    if a == b:
        return 50
    return int(min(50, -mp.log10(abs(a - b) / abs(b))))


def gpu_value(rpn):
    try:
        mp.mp.dps = 60
        return G.evaluate(G.CALC4, [t.strip() for t in rpn.split(",")])
    except Exception:
        return None


def gpu_run(targets, maxk, delta=0.0):
    thr = max(64.0, 3 * delta / FLT_EPS)
    args = [GPU, str(maxk), f"{thr:.1f}"] + ([repr(delta)] if delta else [])
    stdin = "".join(f"{i} {repr(float(t))}\n" for i, t in targets)
    r = monitor.run(args, stdin, time_limit=1800)
    res, matches = {}, {}
    for line in r["stdout"].splitlines():
        p = line.split("\t")
        if p[0] == "#MATCH":
            matches.setdefault(p[1], []).append((int(p[2]), p[3]))
        elif len(p) >= 8:
            res[p[0]] = {"status": p[1], "K": int(p[2]), "rpn": p[3], "ms": float(p[7])}
    return r, res, matches


def ries_eqs(target, level, extra=(), time_limit=300):
    r = monitor.run([RIES, "-F3", "-x", f"-l{level}", "--max-memory", "12e9", *extra, repr(float(target))],
                    time_limit=time_limit)
    return r, R.parse(r["stdout"])


def ries_has(eqs, v):
    """Some reported equation has a root equal to v (30 digits)."""
    vf = float(v)
    for e in eqs:
        try:
            root = float(e["root"]) if e["root"] else None
        except ValueError:
            root = None
        if root is not None and abs(root - vf) > 1e-9 * abs(vf):
            continue
        mp.mp.dps = 80
        x = R.solve(e, root if root is not None else vf)
        if x is not None and agree(x, v) >= 30:
            return e["text"]
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=1)
    a = ap.parse_args()
    rng = random.Random(a.seed)
    out = open(os.path.join(HERE, "depth_results.jsonl"), "w", encoding="utf-8")
    def rec(d):
        out.write(json.dumps(d) + "\n"); out.flush()
        print(json.dumps(d), flush=True)
    t_start = time.time()

    # ---------- part A, GPU (memoryless), CALC4 planted K = 3..9, 3 per K ----------
    for K in range(3, 10):
        tg = [(f"A{K}_{j}", *G.planted(G.CALC4, K, rng)) for j in range(3)]
        r, res, _ = gpu_run([(i, v) for i, _, v in tg], K)
        for i, code, v in tg:
            x = res.get(i, {})
            d = agree(gpu_value(x.get("rpn", "")), v) if x else 0
            rec({"part": "A", "tool": "CR GPU", "K": K, "planted": " ".join(code), "found_K": x.get("K"),
                 "found": x.get("rpn"), "digits": d, "retrieved": x.get("status") == "SUCCESS" and d >= 30,
                 "seconds": x.get("ms", 0) / 1000, "peak_gb": round(r["peak_gb"], 3), "probe_max_s": r["probe_max_s"]})

    # ---------- part A, RIES (memory-heavy), RIES planted K = 3..8, 2 per K, levels 1..7 ----------
    for K in range(3, 9):
        for j in range(2):
            code, v = G.planted(G.RIES, K, rng)
            spent = 0.0; got = None
            for level in range(1, 8):
                r, eqs = ries_eqs(v, level, time_limit=max(10, 150 - spent))
                spent += r["seconds"]
                got = ries_has(eqs, v)
                rec({"part": "A", "tool": "RIES", "K": K, "planted": " ".join(code), "level": level,
                     "retrieved": bool(got), "found": got, "seconds": round(r["seconds"], 2),
                     "peak_gb": round(r["peak_gb"], 3), "probe_max_s": r["probe_max_s"], "killed": r["killed"]})
                if got or r["killed"] or spent > 120:
                    break

    # ---------- part B: error bars ----------
    for delta in (1e-6, 1e-9):
        for K in range(5, 9):
            tg = []
            for j in range(2):
                code, v = G.planted(G.CALC4, K, rng)
                tg.append((f"B{K}_{j}", code, v, v * (1 + delta * rng.uniform(-0.9, 0.9))))
            r, res, matches = gpu_run([(i, t) for i, _, _, t in tg], K, delta)
            for i, code, v, t in tg:
                ms = matches.get(i, [])
                hit = next(((k, s) for k, s in ms if agree(gpu_value(s), v) >= 30), None)
                rec({"part": "B", "tool": "CR GPU", "delta": delta, "K": K, "planted": " ".join(code),
                     "matches": len(ms), "planted_found": hit is not None, "found_K": hit[0] if hit else None,
                     "seconds": res.get(i, {}).get("ms", 0) / 1000, "peak_gb": round(r["peak_gb"], 3)})
        for K in range(4, 8):
            for j in range(2):
                code, v = G.planted(G.RIES, K, rng)
                t = v * (1 + delta * rng.uniform(-0.9, 0.9))
                spent = 0.0
                for level in range(2, 6):
                    r, eqs = ries_eqs(t, level, ("--max-match-distance", repr(-delta), "--no-refinement", "-n1000000"),
                                      time_limit=max(10, 60 - spent))
                    spent += r["seconds"]
                    got = ries_has(eqs, v)
                    if got or r["killed"] or spent > 45 or level == 5:
                        rec({"part": "B", "tool": "RIES", "delta": delta, "K": K, "planted": " ".join(code),
                             "level": level, "matches": len(eqs), "planted_found": bool(got),
                             "seconds": round(spent, 2), "peak_gb": round(r["peak_gb"], 3), "killed": r["killed"]})
                        break
    print(f"total {time.time() - t_start:.0f} s")


if __name__ == "__main__":
    main()
