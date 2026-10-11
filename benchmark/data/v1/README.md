# Benchmark v1: all OEIS decimal expansions

`constants_v1.tsv`: every decimal expansion of a constant in the OEIS (https://oeis.org), 15,100 entries
from the OEIS data repository as of 2026-10-11 (oeisdata 67283234), 14,827 of them with at least 17 digits.
`suspicious_v1.tsv`: the 145 entries whose check found a problem (also marked in `constants_v1.tsv`).

v1 is ten times v0 and has a single source. It complements v0 rather than replacing it:

- One source: unlike v0, where most constants are published by several sources that check each
  other, here the OEIS digits are the only digits, so a typo is found only when the entry's b-file or
  its formula disagrees with its terms (see the checks below).
- Public and known: the OEIS is a source of AskConstants (which knows many entries by their A-number),
  of Wolfram|Alpha and of the training data of language models, so storing the constants pays even more
  than on v0. It measures the recognition of the constants that mathematicians record, not search.
- OEIS gives the digits of |x|: the sign of a negative constant is lost (the name often says "negated").
- Included as they are in the OEIS: physical constants, approximations, constructed constants
  (Champernowne, prime constant), some near-identities (pi and Ramanujan's approximation), the 902
  expansions of 1/n (A021xxx, A022xxx), and the leading digits of huge numbers (Mersenne primes, 9^9^9,
  Pi^Pi^Pi^Pi).
- Offsets: an OEIS entry places the decimal point by its offset, and a wrong offset makes the value
  wrong by a power of 10 without any check noticing, unless the entry has a formula. 16 such errors were
  found among the 8,410 entries with a formula and are corrected (see below); if they are as frequent
  among the 6,690 without one, about a dozen more are there.

The scripts that build these files are in `../../build/`; `../../build/BUILD_v1.md` has the steps.

| Column | Meaning |
|---|---|
| `id` | the A-number |
| `name` | the OEIS name, without "Decimal expansion of (the)" |
| `value` | the ground truth as a decimal string (of \|x\|, as the OEIS gives it): positional as in v0, with an exponent (`d.ddd...e<n>`) beyond 10^-64 .. 10^64 (56 entries, from 2^-1074 to Pi^Pi^Pi^Pi) |
| `digits` | significant digits of `value` that are reliable: 64, or fewer when the OEIS has fewer |
| `formula` | Mathematica formula from the entry's Mathematica line, empty when there is none we can use |
| `class` | as in v0: `rational`, `algebraic`, `elementary`, `special`, `none` (no formula taken) |
| `keywords` | the entry's OEIS keywords, without `cons` and `nonn` (`nice`, `core`, `easy`, `hard`, `base`, ...) |
| `sources` | the digits used: the terms, the b-file, how many digits each has |
| `check` | `ok`, or why the entry is suspicious |
| `notes` | b-file and formula notes (last term rounded, formula negated, formula not trusted, same digits as another entry) |
| `v0` | id of the same constant in `../v0/constants_v0.tsv`, when it is there (1,193 entries): the values agree to all the digits both have, within one unit of the last |

Classes: 2,956 elementary, 2,487 special, 2,022 algebraic, 945 rational, 6,690 without a formula.

## Selection

The entries with keyword `cons` (decimal expansion of a constant), not `dead`, not `tabl` (an array of
several expansions), whose terms are single digits, and whose name says "decimal expansion" or that lack
keyword `base`. Expansions in other bases
have `base`; so does Champernowne's decimal constant, hence the name test. Some constants are named
otherwise ("Apéry's number or Apéry's constant zeta(3). Decimal expansion of ...", "The Reuleaux
triangle constant", "Fill's first logarithmic constant"), so the keyword decides, not the name.

The entries come from a sparse clone of https://github.com/oeis/oeisdata: every entry whose name
contains "decimal expansion" (oeis.org/names.gz), and the entries with at least 17 single-digit terms
(oeis.org/stripped.gz) whose name looks like a constant (decimal, digits of, value of, constant,
expansion, root of, sum, product, integral, limit, ...), 2577 more, of which 287 have `cons`. OEIS
lists 453 entries with `cons` and a name without "decimal expansion"; the about 160 not found this way
are, judging by the 100 that oeis.org shows without an account, periodic sequences and expansions in other
bases. Of the 19,348 candidates, 15,100 are v1 entries. Skipped: 0 dead, 159 in another base, 9 arrays
(`tabl`, such as the digits of sqrt(n) for all n read by antidiagonals), 5 whose terms are not digits.

## Ground truth and checks

The digits are the terms; with a b-file, the b-file's digits (usually many more). Each entry with a
b-file (5,232) is checked against it digit by digit, at the same index n:

- **b-file differs from the terms**: the value keeps only the digits both agree on; suspicious.
- **b-file starts at another index** than the terms, or is **malformed** (indices not consecutive, a
  term that is not a digit): the terms are used; suspicious.
- A last term that is the b-file's digit rounded up is noted, not suspicious ("last term rounded").

None of the 5,232 b-files differs from its terms, starts at another index or is malformed, and no last
term is rounded (confirmed by a second script, independent of the import): the OEIS keeps its b-files
consistent with the terms. 5,225 b-files have more digits than the terms.

Formulas: the expression inside `RealDigits[...]` of the entry's first Mathematica line, when it is plain
mathematics (a whitelist of functions, no assignments, no code; as `import_oeis_finch.py` for v0), 8,410
entries (8,406 distinct formulas). A line that computes the value on an earlier line and ends in
`RealDigits[%]` gives no formula (239 entries, most of them A19xxxx). The formulas are computed with the
rules of v0: trusted only when `N[formula, 96]` reports Precision >= 80 and the formula has no `Sum`,
`Product`, `Integrate` or `Limit` (222 have one, 2 report Precision < 80). 14 have no real value: typos in
the Mathematica line (`Sqrt(5)` with round brackets, `Pi*[3-Sqrt[8]]`), sums and integrals that take over
60 s, and `ZetaZero[5]` for its imaginary part. A trusted formula must agree with the digits within one
unit of their last digit:

- it does: the value is the formula's, with 64 significant digits (8,001 entries);
- it agrees with minus the digits: the formula is negated (the OEIS gives |x|), noted (155);
- it does not: **formula differs from the digits**; suspicious (16).

**Wrong offsets in the OEIS** (16, corrected): the digits are right, but the decimal point is not, so the
OEIS value is off by a power of 10. The name, the formula and the entry's %e or %F line agree on the
corrected value. `import_oeis_v1.py` corrects the offset (`OFFSET_ERRATA`) and notes it; the formula then
agrees, gives the value, and the entry is not suspicious. A102521, A110993 (zeta(zeta(10)) = 1006.03...,
offset 1 instead of 4), A111513, A113272, A113477, A156547, A160205 (offset 11 instead of 1), A179449,
A242600, A245698, A246644, A301862, A301863, A301864 (probabilities given as 5.87, 6.78, 7.28), A319129,
A352527. They were found because the formula differed from the digits by a power of 10.

None of the 16 remaining formula differences is a typo in the digits or a precision problem:

- **The Mathematica line computes another number** (13), the digits are right: a power of 10 off in
  A021025 (the line prepends a 0 to the digits of 10/21), A126625, A228719 (6 Pi for 3 Pi/5), A229939
  (9 Pi for 9 Pi/10), A250023 (cube root of 1729030 for that of 1729.03), A376330 (k log 2 without the
  10^-29), A382105, A382106 (a factor 1/100 missing); typos in A194657 (Pi^2 zeta(7) for zeta(7)),
  A221363 (31441/524288 for 531441/524288), A392230 (Pi/2 for log(5/4)), A396931 ({3/2, 2} for {3/4, 2}
  of its own formula line); and A346929, whose name and Mathematica line both lack the factor 11*61 of
  its formula line, 11*61*73*Pi^10/(2^6*3^15*5) (the digits are those of the full product).
- **Constructed digit strings** (3): e and Pi interlaced (A104691), an erroneous Pi engraved in a tunnel
  (A247385), a digitwise product of e and Pi (A292101). The `RealDigits` of their lines is of an
  ingredient, not of the constant.

Other entries take the OEIS digits, rounded to 64 when there are more.

**Near duplicates**: two entries that agree to at least 10 digits but not to all the digits both have.
By chance this is very unlikely; it is a typo in one of them or a genuine near-identity (pi and
Ramanujan's approximation). Both are marked suspicious (81 pairs, 130 entries). Entries with the same
digits (the same constant twice in the OEIS) are noted only (1 pair: the proton-to-electron mass ratio
A005601, to its 13 digits, and the formula A395814 that reproduces them).

None of the 81 pairs looks like a typo, judging by the names: deliberate approximations (Ramanujan's
constant, Hoffman's and the A379xxx approximations of Pi, Fibonacci's sexagesimal root of
x^3 + 2x^2 + 10x - 20), near-identities (cot of one arcsecond and 206264.8..., arctan(10^50) and Pi/2, the
square-lattice connective constant and the root of 13x^4 - 7x^2 - 581), the products
prod (1 - exp(-k Pi n)), whose values differ from 1 by about exp(-k Pi), and 22 pairs of closed forms with
exp(k Pi), Gamma values and algebraic factors among A387545-A389013, agreeing to 10-14 digits (not
examined further).

## Terms

The data are from the OEIS, under CC BY-SA 4.0 (the OEIS End-User License Agreement); whoever
redistributes these files should keep the attribution and the license.
