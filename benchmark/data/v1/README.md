# Benchmark v1: all OEIS decimal expansions

`constants_v1.tsv`: every decimal expansion of a constant in the OEIS (https://oeis.org), NN entries
from the OEIS data repository as of 2026-09-30 (oeisdata 14eb04df), NN of them with at least 17 digits.
`suspicious_v1.tsv`: the NN entries whose check found a problem (also marked in `constants_v1.tsv`).

v1 is ten times v0 and has a single source. It complements v0 rather than replacing it:

- One source: unlike v0, where most constants are published by several sources that check each
  other, here the OEIS digits are the only digits, so a typo is found only when the entry's b-file or
  its formula disagrees with its terms (see the checks below).
- Public and known: the OEIS is a source of AskConstants (which knows many entries by their A-number),
  of Wolfram|Alpha and of the training data of language models, so storing the constants pays even more
  than on v0. It measures the recognition of the constants that mathematicians record, not search.
- OEIS gives the digits of |x|: the sign of a negative constant is lost (the name often says "negated").
- Included as they are in the OEIS: physical constants, approximations, constructed constants
  (Champernowne, prime constant), and some near-identities (pi and Ramanujan's approximation).

The scripts that build these files are in `../../build/`; `../../build/BUILD_v1.md` has the steps.

| Column | Meaning |
|---|---|
| `id` | the A-number |
| `name` | the OEIS name, without "Decimal expansion of (the)" |
| `value` | the ground truth as a decimal string (of \|x\|, as the OEIS gives it) |
| `digits` | significant digits of `value` that are reliable: 64, or fewer when the OEIS has fewer |
| `formula` | Mathematica formula from the entry's Mathematica line, empty when there is none we can use |
| `class` | as in v0: `rational`, `algebraic`, `elementary`, `special`, `none` (no formula taken) |
| `keywords` | the entry's OEIS keywords, without `cons` and `nonn` (`nice`, `core`, `easy`, `hard`, `base`, ...) |
| `sources` | the digits used: the terms, the b-file, how many digits each has |
| `check` | `ok`, or why the entry is suspicious |
| `notes` | b-file and formula notes (last term rounded, formula negated, formula not trusted, same digits as another entry) |
| `v0` | id of the same constant in `../v0/constants_v0.tsv`, when it is there |

## Selection

The entries with keyword `cons` (decimal expansion of a constant), not `dead`, whose terms are single
digits, and whose name says "decimal expansion" or that lack keyword `base`. Expansions in other bases
have `base`; so does Champernowne's decimal constant, hence the name test. Some constants are named
otherwise ("Apéry's number or Apéry's constant zeta(3). Decimal expansion of ...", "The Reuleaux
triangle constant", "Fill's first logarithmic constant"), so the keyword decides, not the name.

The entries come from a sparse clone of https://github.com/oeis/oeisdata: every entry whose name
contains "decimal expansion" (oeis.org/names.gz), and the entries with at least 17 single-digit terms
(oeis.org/stripped.gz) whose name looks like a constant (decimal, digits of, value of, constant,
expansion, root of, sum, product, integral, limit, ...), 2577 more, of which 287 have `cons`. OEIS
lists 453 entries with `cons` and a name without "decimal expansion"; the about 160 not found this way
are, judging by the 100 that oeis.org shows without an account, periodic sequences and expansions in other
bases. Skipped: NN dead, NN in another base, NN whose terms are not digits.

## Ground truth and checks

The digits are the terms; with a b-file, the b-file's digits (usually many more). Each entry with a
b-file (NN) is checked against it digit by digit, at the same index n:

- **b-file differs from the terms**: the value keeps only the digits both agree on; suspicious.
- **b-file starts at another index** than the terms, or is **malformed** (indices not consecutive, a
  term that is not a digit): the terms are used; suspicious.
- A last term that is the b-file's digit rounded up is noted, not suspicious ("last term rounded").

Formulas: the expression inside `RealDigits[...]` of the entry's first Mathematica line, when it is plain
mathematics (a whitelist of functions, no assignments, no code; as `import_oeis_finch.py` for v0), NN
entries. They are computed with the rules of v0: trusted only when `N[formula, 96]` reports Precision >= 80
and the formula has no `Sum`, `Product`, `Integrate` or `Limit`. A trusted formula must agree with the
digits within one unit of their last digit:

- it does: the value is the formula's, with 64 significant digits (NN entries);
- it agrees with minus the digits: the formula is negated (the OEIS gives |x|), noted (NN);
- it does not: **formula differs from the digits**; suspicious (NN).

Other entries take the OEIS digits, rounded to 64 when there are more.

**Near duplicates**: two entries that agree to at least 10 digits but not to all the digits both have.
By chance this is very unlikely; it is a typo in one of them or a genuine near-identity (pi and
Ramanujan's approximation). Both are marked suspicious (NN pairs). Entries with the same digits (the same
constant twice in the OEIS) are noted only (NN).

## Terms

The data are from the OEIS, under CC BY-SA 4.0 (the OEIS End-User License Agreement); whoever
redistributes these files should keep the attribution and the license.
