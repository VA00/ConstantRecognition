# Phase 3 plan: a much deeper search for one constant

Written 2026-10-04 for a later session, on any machine with a large GPU (the plan's numbers assume an RTX PRO 6000
with 96 GB; most steps also run on an RTX 5080 with 16 GB). Read `PHASE2_RESULTS.md` first: it describes the GPU
search (`gpu/mitm_cuda.cu`) and the RIES-like programs `ries_cpu` and `ries_gpu` that this plan extends.

## The idea in short

Today the search stops at about 10^14 equations per constant. Not because of time or memory, but because double
precision cannot tell a true identity from a coincidence beyond that: with so many equations, some hold to 15 digits
by chance (Catalan's constant at -l7 gave such a coincidence at size 14, wrong in the 15th digit).

Use double precision only as a **sieve**: keep every equation that holds to a few units in the last place, and
decide afterwards with 30-50 digits. A true identity always passes the sieve; a coincidence fails the check with
more digits. The precision limit then moves from the search to the check, which is cheap per equation, and the
depth is limited only by time and memory again.

This needs the constant to many digits (30 or more), so it is for mathematical constants, not for physical
constants with error bars.

## How deep it could go (estimates from Phase 2's measurements, to be measured)

With RIES's symbols (`ries_gpu`'s default), for one constant:

| search | equations | memory | time (estimate) | today |
|---|---|---|---|---|
| left 7, right 7 symbols (today's -l7) | 5.6e14 | 0.4 GB table | 0.4-0.6 s | the limit of double precision |
| left 8, right 8, table in memory | ~1e17 | ~9 GB table | seconds | needs 64-bit ranks |
| left 8, right 9, right sides streamed | ~2e18 | ~5 GB (left sides) | about a minute | - |
| left 8, right 10, right sides streamed | ~5e19 | ~5 GB | tens of minutes | - |

For comparison: RIES -l7 tests 1e15 equations in 6 minutes on one core.

Chance candidates grow in proportion: about 360 per constant at 8e14 equations (Phase 2, 6/7 symbols, window
2 ulp), so about a million per constant at 2e18. They have to be checked quickly (two stages, below).

## Design

1. **Input**: the target as a string with all its digits. The double nearest to it feeds the sieve; the full
   string feeds the check.
2. **Sieve**: today's matching, with two changes. Keep **every** pair inside the window, not only the first per left
   value and the shortest per constant. Make the window wider than today's 16 ulp, scaled by the condition of the
   equation (long formulas amplify rounding; a too narrow window loses true identities). Choose the width by
   measurement (step 6).
3. **Larger tables**: ranks in 64 bits (more than 2^32 codes of length <= 8). With RIES's symbols the right sides up
   to 8 symbols are about 5e8 distinct values, 9 GB: comfortable on 96 GB, tight on 16 GB.
4. **Streaming, for one constant**: swap the roles of the two sides. Keep the left sides of this one constant in
   device memory (sorted values with derivatives and ranks; 8 symbols: about 2.5e8 values, 4-6 GB) and generate the
   right sides on the fly in chunks, sort each chunk, and merge it against the left sides. Nothing grows with the
   right-side length but the time. This is the "memoryless" half of the hybrid discussed in Phase 1.
5. **Check in two stages**:
   - double-double arithmetic (about 32 digits, a pair of doubles, like df64 is a pair of floats) re-evaluates every
     candidate on the GPU or the CPU, about a microsecond each; most coincidences fail here;
   - the few survivors are solved with 50 digits (mpmath, or Mathematica), as `run_mitm_v0.py` does today.
6. **Output**: the RIES-like list as today, but an 'exact' line only for equations verified to the digits given,
   with the number of digits shown.

## Steps, each with its check

0. 64-bit ranks. Check: results with right sides up to 7 symbols identical to today's.
1. "All candidates" mode on the GPU (today only `mitm_cr --list` has it). Check: candidate counts on v0 at 6/7
   close to Phase 2's.
2. Double-double evaluation of a code, on the host and in a kernel, with an accuracy test against mpmath like
   `test_df64.cpp`.
3. The check pipeline. Check: on v0, the verdicts after the check equal `run_mitm_v0.py`'s 80-digit
   classification, and no false positive is left.
4. Right sides up to 8 symbols with RIES's symbols (96 GB card). Check: time and memory; v0 results.
5. Streaming mode. Check: the same results as the table mode where both fit.
6. Depth test: planted formulas of 15-18 symbols, longer than anything found today (as `test_planted.py`), and
   the sieve window: how many true identities a window of 16, 64, 256 ulp loses. Time per constant against RIES
   at -l7 and -l8 on the same machine.

## Risks and open questions

- A true identity whose double-precision evaluation is off by more than the window is lost. Long formulas with
  ill-conditioned steps make this more likely; step 6 measures it.
- At 1e19-1e20 equations, millions of candidates per constant: the double-double stage must be fast, preferably on
  the GPU next to the sieve.
- The guards of Phase 1 (kappa, periodic arguments, zero derivatives) were tuned for double precision decisions;
  with a high-precision check some may be relaxed, and some deep pseudo-identities may need new ones.

## A Mathematica version (measured 2026-10-04, Mathematica 14.2)

Possible, at moderate depth, and attractive for special functions and for the high-precision check. It must work
on whole arrays of numbers (packed arrays), never on formulas one by one:

- distinct values by size, each size from the distinct values of the smaller sizes with `Outer` and functions
  applied to whole arrays, duplicates removed with `Union`: all right sides up to 6 symbols of RIES's common
  subset in 0.7 s (C++ on one core: 0.17 s), i.e. about 4 times slower than C++;
- matching with `Nearest`: 10^6 lookups in 0.17 s after 0.25 s of setup;
- special functions on arrays of 10^5 machine numbers: Zeta about 10 us per value, BesselJ 4 us, LogGamma almost
  free; so special functions can be applied to sets of 10^5-10^6 values, not to billions.

The test script is `mathematica_table_test.wls` (next to this file). What is still missing for a real version:
keeping, with every value, which operation and which smaller values produced it (index arrays), so that the formula
can be printed; derivatives for the window and the guards; and the left sides per target. Two ways to use it:

- a pure Mathematica search for interactive use with any special function, to moderate depth (right sides up to
  6-7 symbols, left sides up to 5-6);
- Mathematica as the front end and the checker, with `ries_gpu` / `mitm_gpu` doing the enumeration (called with
  `RunProcess`, or through LibraryLink later).
