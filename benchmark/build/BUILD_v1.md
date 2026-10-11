# Building benchmark v1 (all OEIS decimal expansions)

**Status, 2026-10-11:** the scripts are written and tested (selection, b-file fetch on 20 b-files,
import), but v1 has not been built yet. Still to do: steps 1-4 below on a machine with enough memory,
then fill in the `NN` numbers of `../data/v1/README.md`. Delete this paragraph once v1 is built.

## What v1 is (decided 2026-10-11)

- **OEIS only.** Finch's books are not part of v1.
- **Every OEIS decimal expansion**, including the about 1200 constants already in v0. The `v0` column
  gives the id of the same constant in `constants_v0.tsv`.
- **Checked, and suspicious entries kept.** An entry is suspicious when its b-file disagrees with its
  terms, when its Mathematica formula disagrees with its digits, or when a near duplicate disagrees.
  Such an entry stays in `constants_v1.tsv` with the reason in `check`, and is also listed in
  `suspicious_v1.tsv`.
- **Selection:** keyword `cons`, not `dead`, single-digit terms, and either the name says "decimal
  expansion" or the entry has no keyword `base`. See `../data/v1/README.md`.

v1 has known limits: one source only, public data, and the sign of x is lost (the OEIS gives |x|).
v1 is wanted anyway, because the OEIS is a reference everyone knows.

## Requirements

- **Python 3**, standard library only.
- **git.** git-lfs is not needed.
- **Mathematica**, or wolframscript, for step 3. Tested with 15.0.
- **About 500 MB of disk** for the work directory, outside the repository.
- **Memory:** about 2 GB per Mathematica kernel, see step 3.

## Steps

From `benchmark/`. `<work>` is any directory outside the repository, for example `../../oeis_v1`.

**1. Fetch the entries and their b-files** (network; about 20 min; it can be rerun and continues
where it stopped):

```
python build/fetch_oeis_v1.py <work>
```

The script runs these steps:
1. downloads `oeis.org/names.gz` and `stripped.gz` (42 MB);
2. chooses the candidates (19,330 in September 2026);
3. makes a sparse clone of https://github.com/oeis/oeisdata with their `.seq` files;
4. keeps the v1 entries (15,097, of which 5,228 have a b-file);
5. fetches those b-files (about 290 MB), each one checked against the SHA-256 of its Git LFS pointer.

At the end it should report `done: N of N b-files` with no failures. If some failed, run it again.

Do not check the b-files out through git (`git lfs pull`, or adding `files/...` to the sparse
checkout). On 2026-10-11 that stalled for hours, and `files/**` would mean every b-file of the OEIS.
The script takes them from raw.githubusercontent.com and oeis.org/lfs directly.

**2. Import** (about 5 s):

```
python build/import_oeis_v1.py <work>/oeisdata --bfiles <work>/bfiles
```

This writes `data/v1/constants_v1_sources.tsv`. Check the printed counts:
- `b-file missing` should be 0, or only the b-files that step 1 reported as failed;
- `b-file` should be about 5,228.

The last line lists the suspicious entries by reason.

**3. Evaluate the formulas and write the benchmark** (Mathematica):

```
wolframscript -file build/build_constants_v1.wls 16      # number of parallel kernels, default 6
```

- **Formulas:** about 8,400 distinct ones, each run with `N[formula, 96]`, at most 60 s and 2 GB each.
  - The total time hasn't been measured.
  - A partial run on the first PC finished about 5,500 formulas, and only 22 of them failed or reached
    60 s.
  - Expect minutes to an hour on 16 kernels. Sums, integrals and hard special functions can each take
    the full 60 s.
- **Choosing the number of kernels:** at most (free RAM - 4 GB) / 2 GB, and at most the number of
  cores. On a 32 GB PC, 12 kernels without the 2 GB limit ran out of memory and the job was killed.
- **Cache:** the values go to `build/formula_values_cache_v1.wl` after every 400 formulas, per
  Mathematica version. The file is not in the repository.
  - An interrupted run continues where it stopped.
  - A rerun after editing the sources or the checks takes seconds.
- **Output:** writes `data/v1/constants_v1.tsv` and `suspicious_v1.tsv`, and prints:
  - the counts (entries, checked formulas, classes, suspicious entries by kind);
  - every entry whose formula differs from its digits.

**4. Inspect and document:**

- **Formulas that differ from the digits.** For each one, find out whether it is:
  - a typo in the OEIS digits;
  - a formula for something else (the Mathematica line may compute a related number);
  - a precision problem.

  Note the cases in the README.
- **Near duplicates.** Look at a sample. Most should be genuine near-identities (pi and Ramanujan's
  approximation) or truncated variants.
- **Fill in the README.** Replace every `NN` in `data/v1/README.md` with the printed counts, together
  with the oeisdata commit and its date.

## What goes into the repository

**Commit:**
- `data/v1/constants_v1.tsv`
- `suspicious_v1.tsv`
- `constants_v1_sources.tsv`
- the README

**Do not commit:**
- `<work>`
- `build/formula_values_cache_v1.wl`

Mind the license: the OEIS data are CC BY-SA 4.0, and `data/v1/README.md` says so.

## After the build (not started)

Running the recognition tools on v1. The run scripts in `run/` read v0 only. v1 has 15,097 entries, ten
times v0, so the slower tools need a sample or a long run:
- AskConstants: 4.8 h on v0;
- MESearch: 1.7 h on v0, and it is GUI-driven.
