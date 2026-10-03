# Depth test (small scale, 2026-10-03)

How deep do a memoryless search (Constant Recognition on the GPU) and a memory-heavy search (RIES)
get on formulas planted from their own grammars, and what does each cost in time, memory and machine
responsiveness?

- `grammars.py`: uniform random postfix codes of exact length K (CALC4 and RIES default symbols);
  values at 50 digits, ill-conditioned ones rejected by a 100-digit check.
- `monitor.py`: runs a command with peak memory (process and children), a responsiveness probe (time
  to start a trivial process, every 2 s), a memory cap and a time limit.
- `depth_test.py`: part A (precise targets: is the planted formula retrieved?) and part B (targets with
  relative error bars 1e-6, 1e-9: is it among the matches, how many matches?).
  `RIES=<path to ries> python depth_test.py`; results in `depth_results.jsonl`, tables by `summarize.py`.

Result of the first run (8 min): the GPU retrieved all valid planted CALC4 formulas up to K = 9 at
0.13-0.17 GB (time x31 per level: K = 9 74 s); RIES retrieved 11 of 12 planted formulas of length <= 8,
mostly at -l1/-l2, with memory x3.4 and time x5 per level (-l6: 1.9 GB). Responsiveness was never
affected (probe <= 20 ms). One K = 3 "miss" was an invalid target (artanh(1)); the generator now
rejects such values. A direct comparison on one grammar is in `../ries_vs_cr`.
