"""RIES on alpha in the common grammar, levels 3..7, two-sided and one-sided, tolerance 5 sigma.
Usage: RIES=<path to ries> python ries_common_runs.py   (needs psutil; about 25 min)"""
import subprocess, sys, time, json, os
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "depth"))
import monitor

RIES = os.environ.get("RIES", "ries")          # path to the ries executable
T = "0.0072973525643"
base = ["-S123456789pefrqslE+-*/^", "-F3", "-x", "--no-refinement", "--no-slow-messages", "-n100000000",
        "--max-match-distance", "-7.5e-10", "--max-memory", "12e9"]
log = open(os.path.join(HERE, "ries_common_runs.jsonl"), "w")
for mode, extra in (("two-sided", []), ("one-sided", ["--one-sided"])):
    for level in range(3, 8):
        out = os.path.join(HERE, f"ries_common_{mode}_l{level}.txt")
        r = monitor.run([RIES, f"-l{level}", *base, *extra, T], time_limit=1200, mem_cap_gb=12)
        open(out, "w").write(r["stdout"])
        n = sum(1 for l in r["stdout"].splitlines() if "for x =" in l)
        d = {"mode": mode, "level": level, "matches": n, "seconds": round(r["seconds"], 1),
             "peak_gb": round(r["peak_gb"], 2), "probe_max_s": r["probe_max_s"], "killed": r["killed"]}
        log.write(json.dumps(d) + "\n"); log.flush(); print(d, flush=True)
        if r["killed"] or r["seconds"] > 600:
            break
