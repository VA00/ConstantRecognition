"""Compare a meijerg_search.py run with the other v0 results.
Usage: python compare.py meijerg_K14_19_matches.tsv"""
import sys, os, csv
HERE = os.path.dirname(os.path.abspath(__file__))
BENCH = os.path.join(HERE, "..", "..", "..", "benchmark")
TOOLS = {"CR GPU K<=8": "v0_cuda_K8.tsv", "AskConstants": "v0_askconstants.tsv", "RIES -l5": "v0_ries_l5.tsv",
         "Maple identify": "v0_maple_identify.tsv", "Wolfram|Alpha": "v0_wolframalpha.tsv", "nsimplify": "v0_nsimplify.tsv"}

exact = {}
for t, f in TOOLS.items():
    with open(os.path.join(BENCH, "results", f), encoding="utf-8") as fh:
        exact[t] = {r["id"] for r in csv.DictReader(fh, delimiter="\t") if r["verdict"] == "exact"}
with open(os.path.join(BENCH, "data", "v0", "constants_v0.tsv"), encoding="utf-8") as fh:
    eligible = {r["id"] for r in csv.DictReader(fh, delimiter="\t") if int(r["digits"]) >= 17}

best = {}
with open(sys.argv[1], encoding="utf-8") as fh:
    for r in csv.DictReader(fh, delimiter="\t"):
        i = r["target"][3:]
        if i in eligible and r["verified_digits"].isdigit() and int(r["verified_digits"]) >= 30:
            if i not in best or int(r["K"]) < int(best[i]["K"]):
                best[i] = r
out = sys.argv[1].replace("_matches.tsv", "_best.tsv")
with open(out, "w", encoding="utf-8", newline="") as fh:
    w = csv.writer(fh, delimiter="\t", lineterminator="\n")
    w.writerow(["id", "K", "kind", "name", "known_formula", "found", "glue", "verified_digits"])
    for i in sorted(best, key=int):
        r = best[i]
        w.writerow([i, r["K"], r["kind"], r["name"], r["known_formula"], r["found"], r["glue"], r["verified_digits"]])
union = set().union(*exact.values())
cr = exact["CR GPU K<=8"]
print(f"identified: {len(best)} of {len(eligible)} v0 constants with >= 17 digits "
      f"({sum(r['kind'] == 'leaf' for r in best.values())} by a leaf, {sum(r['kind'] == 'pair' for r in best.values())} by a pair)")
for t in TOOLS:
    print(f"  also exact in {t:15s} {len(set(best) & exact[t]):4d}   (that tool alone: {len(exact[t] & eligible)})")
print(f"  not found by CR GPU K<=8: {len(set(best) - cr)}")
print(f"  not found by any other tool: {len(set(best) - union)}")
for i in sorted(set(best) - union, key=lambda i: int(best[i]["K"])):
    r = best[i]
    print(f"    K={r['K']:>2} v0:{i:>4} {r['name'][:55]:55s} = {r['glue']} * {r['found']}")
