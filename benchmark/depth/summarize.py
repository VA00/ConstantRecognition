"""Tables from depth_results.jsonl."""
import json, os, collections
HERE = os.path.dirname(os.path.abspath(__file__))
rows = [json.loads(l) for l in open(os.path.join(HERE, "depth_results.jsonl"), encoding="utf-8")]

print("Part A, CR GPU (memoryless): planted CALC4 formulas, search up to the planted length")
print("  K  retrieved  found at K  max s/target  peak GB  probe max s")
for K in sorted({r["K"] for r in rows if r["part"] == "A" and r["tool"] == "CR GPU"}):
    rs = [r for r in rows if r["part"] == "A" and r["tool"] == "CR GPU" and r["K"] == K]
    print(f"  {K}  {sum(r['retrieved'] for r in rs)}/{len(rs)}        {','.join(str(r['found_K']) for r in rs):9s}"
          f"  {max(r['seconds'] for r in rs):10.2f}  {max(r['peak_gb'] for r in rs):7.2f}  {max(r['probe_max_s'] or 0 for r in rs):8.2f}")

print("\nPart A, RIES: planted RIES formulas, levels 1..7 until retrieved (cap 150 s per formula)")
print("  K  planted                 retrieved at level   s (that level)  peak GB  probe max s")
last = collections.OrderedDict()
for r in rows:
    if r["part"] == "A" and r["tool"] == "RIES":
        last[(r["K"], r["planted"])] = r
for (K, code), r in last.items():
    lvl = f"-l{r['level']}" if r["retrieved"] else f"no (stopped after -l{r['level']}{', ' + r['killed'] if r.get('killed') else ''})"
    print(f"  {K}  {code:22s}  {lvl:19s}  {r['seconds']:13.2f}  {r['peak_gb']:7.2f}  {r['probe_max_s'] or 0:8.2f}")
print("  RIES time and memory by level (all runs):")
bylevel = collections.defaultdict(list)
for r in rows:
    if r["part"] == "A" and r["tool"] == "RIES" and not r.get("killed"):
        bylevel[r["level"]].append(r)
for L in sorted(bylevel):
    rs = bylevel[L]
    print(f"    -l{L}: median {sorted(x['seconds'] for x in rs)[len(rs) // 2]:7.2f} s, peak {max(x['peak_gb'] for x in rs):6.2f} GB, n={len(rs)}")

print("\nPart B, error bars: matches within delta, planted formula among them?")
print("  tool    delta  K  matches   planted found")
for r in rows:
    if r["part"] == "B":
        print(f"  {r['tool']:6s}  {r['delta']:.0e}  {r['K']}  {r['matches']:7d}   {r['planted_found']}"
              + (f" (level -l{r['level']}, {r['seconds']:.0f} s)" if r["tool"] == "RIES" else ""))
