# Constant recognition benchmark

## v0: published real constants

`constants_v0.tsv`: 1383 real constants from published, hand-made lists. No generated or random
formulas, no complex constants. A proof of concept for a standard benchmark.

Limitation: v0 is public and consists of known constants, so a tool can score on it by storing them,
which Wolfram|Alpha partly does (it answers many constants with the named constants of its own
knowledgebase, one of the sources here). v0 measures the recognition of known constants, not search;
that needs a separate benchmark of formulas that cannot be stored in advance, such as random ones (to do).

Comparison runs, each writing `results/v0_<tool>.tsv` with the same verdicts (exact to >= 30 digits,
false positive, not found, ...): `run_benchmark_v0.py` (the C engine, CALC4, up to a given K),
`run_nsimplify_v0.py` (sympy), `run_maple_identify_v0.py` (Maple), `run_wolframalpha_v0.py` (Wolfram|Alpha
from Mathematica). On 1349 constants with >= 17 digits: engine K <= 7 417 exact and 6 wrong answers
claimed exact (65 min on 11 cores), Wolfram|Alpha 399 exact plus 231 agreeing to the 20 digits it shows,
and 691 wrong (1 h of queries), Maple 332 and 6, nsimplify 212 and 1137.

| Column | Meaning |
|---|---|
| `id` | row number, constants sorted by value |
| `name` | name from the first source in the order Wikipedia, Wolfram, GSL, Bronstein, Boost, Abramowitz & Stegun, OEIS, Plouffe |
| `value` | the ground truth as a decimal string |
| `digits` | significant digits of `value` that are reliable: 64, or fewer when only fewer published digits exist |
| `formula` | Mathematica formula, empty when no closed form is known |
| `class` | `rational`, `algebraic`, `elementary` (exp, log, powers, trigonometric and hyperbolic functions and their inverses of pi, e and integers), `special` (Gamma, zeta, Catalan, sums, integrals, ...), `none` (no closed form) |
| `sources` | every source that lists the constant, with the number of digits it publishes |
| `check` | `ok`: every source agrees with `value` within one unit of its last digit |
| `notes` | how the value was obtained when not from the formula, errata of a source |

Classes: 402 elementary, 408 special, 133 algebraic, 13 rational, 427 without closed form (in the sources used).

### Sources

| Source | Constants | Digits |
|---|---|---|
| GSL `gsl_math.h`, https://git.savannah.gnu.org/cgit/gsl.git/plain/gsl_math.h (fetched 2026-09-29) | 17 | 30 |
| Boost.Math `constants.hpp`, https://github.com/boostorg/math/blob/develop/include/boost/math/constants/constants.hpp (fetched 2026-09-29) | 79 | 100+ |
| Wikipedia, List of mathematical constants, as collected in `Mathematica/SyntheticBenchmark.nb` | 100 | 20 |
| Bronstein, Taschenbuch der Mathematik, Table A.1, as collected in `synthetic_benchmark/BronsteinConstants.nb` | 104 | 5-7 |
| Wolfram Knowledgebase, `EntityList["MathematicalConstant"]` (Mathematica 15.0.1, fetched 2026-09-30) | 352 | 200 for most, 2-12 for some |
| Abramowitz & Stegun, Handbook of Mathematical Functions, Table 1.1, 10th printing (1972), scan https://archive.org/details/AandS-mono600 | 251 | 15-26 |
| OEIS decimal expansions with keyword `nice` or `core`, https://oeis.org (fetched 2026-09-30) | 52 | 5-210 |
| Plouffe, Miscellaneous Mathematical Constants, Project Gutenberg #634 (1996), https://www.gutenberg.org/ebooks/634 | 109 | 17-256 (truncated) |
| OEIS decimal expansions citing Finch, Mathematical Constants (2003) or Mathematical Constants II (2018), from https://github.com/oeis/oeisdata (2026-09-30) | 897 | 5-120 |
| MESearch 2.0 predefined constants (J. Zurutuza Salsamendi, 2013), names only, digits from OEIS | 6 | 22-106 |

The Wolfram constants are imported by `import_wolfram_constants.wls` (needs internet access): the
DefiningFormula, the NumericalApproximation with the digits its precision claims, and every
AlternateDefinitions entry as one more row (key `<name>/alt<i>`, no digits), so that the definitions
are checked against each other. Of the 436 entities, 5 with complex values are skipped, and 79 with
neither a value nor a formula (among them EulerGamma, Khinchin and Feigenbaum, present from other
sources). Notes written by hand on Wolfram rows survive a re-import.

Abramowitz & Stegun Table 1.1 (roots, powers of e and pi, logarithms, fractions of pi, gamma, Gamma at
rationals) is imported by `import_aands_table_1_1.py` from archive.org's OCR of the public-domain scan:
the words of each printed line are joined by their positions on the page, and the formulas are assigned
in the order of the table (read from the page images). All 251 values agree with their formulas within
1.4 units of their last digit. Values marked with an asterisk in the book (corrected since the first
printing) have a note.

OEIS has about 15,000 decimal expansions of constants (keyword `cons`, about 4% of its 400,000
sequences). They are too many for this hand-made set and are left for a separate, larger benchmark.
`import_oeis_nice_core.py` takes only those the editors marked `nice` or `core`: the digits are the
terms of the sequence, the formulas are written in the script from the entry. Left out: sequences that
are not constants (all 1s, n mod 2, ...), physical measurements (proton mass), the order of the Monster
group, a binary expansion, and Brun's constant with 9 digits (a duplicate that has too few digits to be
merged by value).

Plouffe's Miscellaneous Mathematical Constants (1996, not the Inverse Symbolic Calculator tables) is
imported by `import_plouffe_constants.py`: the text is split into its sections, each checked by its
title, and the formula of each section is written in the script. Its digits (1000-170000 for most,
truncated here to 256) were computed in Maple and elsewhere, independently of Mathematica, and are a
second source for about 80 constants. The last sections are identification requests sent to the ISC
in 1995-1996; the ones that remain unidentified are left out, and so is one whose proposed answer,
-Integrate[Sqrt[x]/Log[1 - x], {x, 0, 1}], agrees with the number to 16 of its 24 digits only.

Finch's two books are the most complete hand-made collections of constants; the books themselves are a
source for the larger benchmark. Here are the about 900 OEIS decimal expansions whose references cite
either book, imported by `import_oeis_finch.py` from a checkout of the OEIS data repository (a sparse
clone of the decimal expansions, about 70 MB; see the script). OEIS shows only the first 100 search
results without an account, so the repository is the way to get all of them. The digits are the terms;
the formula is the expression inside `RealDigits[...]` of the entry's Mathematica line, taken only when
it is plain mathematics (a whitelist of functions, no assignments, no code), because the build runs it;
363 rows have one. For 16 the digits are of minus the value of that expression (`RealDigits` drops the
sign). Constants that sources give with fewer than 12 digits cannot be merged by value; the build links
six such pairs by key (Gaussian twin prime, Shanks, Brun, Brun quadruple, de Bruijn, John).

MESearch 2.0, a constant recognition program by J. Zurutuza Salsamendi (2013, mirrored at
https://tilde.green/~danny12/MESearch/), has 158 predefined named constants in the order of Finch's
book, which its User Guide names as its reference. Only their names are used (its values are compiled
into the program, whose license forbids decompiling): all but six are already in the benchmark, and
`import_mesearch_names.py` adds those six with the digits of their OEIS entries (Wagon, maximal unitary
square-free divisor sum, Quinn-Rand-Strogatz c2, series-parallel networks, rumor, Otter's xi). Without an
OEIS entry, and left out: Smarandache, Fill's logarithmic, quadratic residues, Stolarsky-Harborth,
Quinn-Rand-Strogatz c1, c3, c4 and C, abelian group enumeration A2 and A3.

`constants_v0_sources.tsv` holds one row per constant per source: source, key, name, formula, the digits
exactly as published (copied from the files by a script, never typed), and a note. It is the file to edit;
`constants_v0.tsv` is generated from it.

### Ground truth

`build_constants_v0.wls` (Mathematica) computes every formula with `N[formula, 96]` and trusts it only
when Mathematica reports Precision >= 80; otherwise the longest published digits are the value. Values
are written with 64 significant digits (a power of two, to avoid a base-10 bias; published-only values
longer than that are rounded to 64). Every published digit string must agree with the value within one
unit of its last digit, or as far as the computed value reaches when a source publishes more digits.

Precision is not proof. For numerical sums, products, integrals and limits Mathematica reports
Precision 80 or more and is often wrong, for example:

- Kepler-Bouwkamp, `Product[Cos[Pi/n], {n, 3, Infinity}]`: wrong after 26.8 digits
- asymptotic Lebesgue constant, with `Sum[Log[k]/(4k^2 - 1), {k, 1, Infinity}]`: wrong after 29 digits
- Alladi-Grinstead, spiral of Theodorus, Khinchin-Levy sum, Lueroth: wrong after about 27 digits;
  Renyi parking after 43; rabbit constant `Sum[2^-Floor[k GoldenRatio], ...]` after 8
- Brun quadruple, Gaussian twin prime and Shanks constants (products over primes with `Piecewise`):
  wrong after 1-3 digits

In all of these the published digits are right (checked with mpmath to 90 digits where possible). So a
formula with `Sum`, `Product`, `Integrate` or `Limit` is never trusted, and its constant takes the
published digits. Its N[] value only helps to find the constant it belongs to (as if it had 20 digits),
and the build prints how far each such N[] value agrees with the constant's value, as evidence, not as
a check. Exceptions are the rows of source "fast-converging series, computed", sums written by hand to
converge geometrically, with numeric arguments.

The Wikipedia formulas for Kepler-Bouwkamp and the Lebesgue constant are also marked `N-unreliable`;
their values come from geometrically converging series, computed in Mathematica with numeric arguments (source rows
"fast-converging series, computed"): log K = -sum_k (4^k-1) zeta(2k) zeta(2k,3)/k, and
sum_k log(k)/(4k^2-1) = -sum_j 4^-j zeta'(2j). With an exact 3, Mathematica rewrites `HurwitzZeta[2k, 3]`
into the cancelling zeta(2k) - 1 - 4^-k, so the arguments must be numeric.

A near-identity found by the engine, recorded the same way: the digital tree insertion constant (OEIS
A086312, Finch) c = 1/12 + pi^2/(6 ln^2 2) - alpha - beta, with alpha + beta = sum sigma(n)/2^n the
Eisenstein series E2 at q = 1/2. Its quasi-modular transformation gives
c = 1/ln 4 + 1/24 + (4 pi^2/ln^2 2) sum sigma(n) exp(-4 pi^2 n/ln 2), where the first correction is 1.5e-23:
1/ln 4 + 1/24 alone agrees with c to 22.7 digits, which the engine at K = 7 reports as exact in double
precision. The identity is checked to 100 digits with mpmath, and the checker evaluates the defining series.

Because precision can be claimed wrongly, `check_constants_v0.py` recomputes every value with a second,
independent tool, mpmath, from the same formulas (translated to mpmath, or hand-written for sums,
products, integrals and roots with a seed): 812 of 1383 values agree to all their digits. The other 571
(no closed form, sums over primes, functions mpmath lacks, most Wolfram sums) are each confirmed by
published digits: the value is published digits, or a source publishes 64 digits or more and the build
checks it against the value. The checker fails when a value rests on Mathematica's N[] alone.

Published digits are not proof either: the Wolfram Knowledgebase digits of two Lueroth constants are
wrong after 27 digits, like Mathematica's N[] of their sums (see errata). So every constant whose only
long source is Wolfram and whose definition is a sum, product, integral or limit is recomputed in the
checker by a method that converges geometrically:

- Euler products over primes with a rational factor, prod_p F(1/p) (Artin, Feller-Tornier, Taniguchi,
  carefree, strongly carefree, inverse carefree, Sarnak, quadratic class number, totient product,
  totient sum_n 1/(n phi(n)), Barban): the first 200 primes directly, the rest as
  exp(sum_k a_k (P(k) - sum_{p <= 1223} p^-k)), with the exact power series coefficients a_k of
  log F and the prime zeta function P, the standard method for such constants (H. Cohen, P. Moree).
  The naive product converges like 1/N and cannot give these digits.
- double-exponentially converging products and sums (Thue-Morse, prod (1 - 2^-2^k), sum 2^-p), closed
  forms (the power tower of i), and geometric zeta series (spiral of Theodorus, infinite product).

All 18 agree with Wolfram's digits to 64 digits. Four constants are left out (note `excluded` in the
sources, dropped by the build): the second Backhouse, Grossman, Rutherford and Landau-Ramanujan
second-order constants. Their digits come from Wolfram alone, their definitions (an internal
`Extension` function, a limit of a recurrence, an integral of solutions of an ODE, a sum over primes with
cases) are ones that neither Mathematica's N[] nor our checker evaluates reliably, and no second source
publishes them. A benchmark value that cannot be confirmed independently is worse than none.

Errata found in the collected lists, kept in the sources with a note:

- Conway's constant: digits `1.3035771269...` have an extra 1, correct `1.303577269...`
- universal parabolic constant: digits `2.2955871493392...` are garbled, correct `2.2955871493926...`
- Lochs constant: the formula was `0`, now `6 Log[2] Log[10]/Pi^2`
- Abramowitz & Stegun Table 1.1, last digit off by more than one unit: 10^(1/3) `2.1544346900318837219`
  (correct ...218), 100^(1/5) `2.5118864315095801112` (...111), ln sqrt(2 pi) `0.9189385332046727417803296`
  (...297)
- Plouffe, Artin's constant: digit 27 is 5, correct 4 (`...0543465164...` vs `...0543464164...`)
- Plouffe, Renyi parking constant: wrong after 26 digits (`...094363652...` vs `...094383017...`)
- Wolfram Lueroth analog of the Levy constant: wrong after 27 digits (`...176154|02...`, correct
  `...176153|95...`, OEIS A244109 and mpmath); Lueroth analog of the Khinchin constant: wrong after 26
  digits (`...578|68...`, correct `...578|66...`, OEIS A245254 and mpmath)
- Wolfram infinite product constant: the DefiningFormula is prod_{k>=1} (1+1/k)^(1/k) = 3.5174872559...,
  the published digits 1.7587436... are the product from k = 2, half of it. The value comes from the
  series 2 exp(sum_n (-1)^(n+1) (zeta(n+1)-1)/n)

### Rebuild and check

```
wolframscript -file import_wolfram_constants.wls   # only to refresh the Wolfram rows
python import_aands_table_1_1.py                   # only to refresh the A&S rows (fetches the OCR)
python import_oeis_nice_core.py                    # only to refresh the OEIS rows
python import_plouffe_constants.py                 # only to refresh the Plouffe rows
python import_oeis_finch.py <oeisdata checkout>    # only to refresh the OEIS rows citing Finch
python import_mesearch_names.py <oeisdata checkout> # only to refresh the MESearch rows
wolframscript -file build_constants_v0.wls         # writes constants_v0.tsv, prints mismatches
python check_constants_v0.py                       # mpmath: needs mpmath (pip install mpmath)
```

The build keeps the N[] values of all formulas in `formula_values_cache.wl` (not in the repository),
per Mathematica version: the first build evaluates them on all kernels (up to 60 s each), later ones take seconds.

Both must report no mismatch and no constant below its stated digits. To add a constant, add a row per
source to `constants_v0_sources.tsv`, rebuild and check; a new sum, product, integral or root with a seed
also needs a hand-written mpmath expression in `MANUAL` of the checker.

### Candidate sources for later versions

For the larger, separate benchmark: Finch's two books themselves; the other OEIS decimal expansions
(about 14000, with b-files for many digits).

Not used: MathWorld. It is not independent of the Wolfram Knowledgebase (same editor; the
`MathematicalConstant` entities are its constant pages in structured form), its values are given in the
text to 10-20 digits, mostly computed in Mathematica or taken from OEIS, and it has no machine-readable
digits.
