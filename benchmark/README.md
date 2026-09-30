# Constant recognition benchmark

## v0: published real constants

`constants_v0.tsv`: 679 real constants from published, hand-made lists. No generated or random
formulas, no complex constants. A proof of concept for a standard benchmark; recognition runs over it
are done by hand, not automated.

| Column | Meaning |
|---|---|
| `id` | row number, constants sorted by value |
| `name` | name from the first source in the order Wikipedia, Wolfram, GSL, Bronstein, Boost, Abramowitz & Stegun |
| `value` | the ground truth as a decimal string |
| `digits` | significant digits of `value` that are reliable: 64, or fewer when only fewer published digits exist |
| `formula` | Mathematica formula, empty when no closed form is known |
| `class` | `rational`, `algebraic`, `elementary` (exp, log, powers, trigonometric and hyperbolic functions and their inverses of pi, e and integers), `special` (Gamma, zeta, Catalan, sums, integrals, ...), `none` (no closed form) |
| `sources` | every source that lists the constant, with the number of digits it publishes |
| `check` | `ok`: every source agrees with `value` within one unit of its last digit |
| `notes` | how the value was obtained when not from the formula, errata of a source |

Classes: 312 elementary, 254 special, 80 algebraic, 12 rational, 21 without closed form.

### Sources

| Source | Constants | Digits |
|---|---|---|
| GSL `gsl_math.h`, https://git.savannah.gnu.org/cgit/gsl.git/plain/gsl_math.h (fetched 2026-09-29) | 17 | 30 |
| Boost.Math `constants.hpp`, https://github.com/boostorg/math/blob/develop/include/boost/math/constants/constants.hpp (fetched 2026-09-29) | 79 | 100+ |
| Wikipedia, List of mathematical constants, as collected in `Mathematica/SyntheticBenchmark.nb` | 100 | 20 |
| Bronstein, Taschenbuch der Mathematik, Table A.1, as collected in `synthetic_benchmark/BronsteinConstants.nb` | 104 | 5-7 |
| Wolfram Knowledgebase, `EntityList["MathematicalConstant"]` (Mathematica 15.0.1, fetched 2026-09-30) | 352 | 200 for most, 2-12 for some |
| Abramowitz & Stegun, Handbook of Mathematical Functions, Table 1.1, 10th printing (1972), scan https://archive.org/details/AandS-mono600 | 251 | 15-26 |

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

Because precision can be claimed wrongly, `check_constants_v0.py` recomputes every value with a second,
independent tool, mpmath, from the same formulas (translated to mpmath, or hand-written for sums,
products, integrals and roots with a seed): 513 of 679 values agree to all their digits. The other 166
(no closed form, sums over primes, functions mpmath lacks, most Wolfram sums) are each confirmed by
published digits: the value is published digits, or a source publishes 64 digits or more and the build
checks it against the value. The checker fails when a value rests on Mathematica's N[] alone.

Errata found in the collected lists, kept in the sources with a note:

- Conway's constant: digits `1.3035771269...` have an extra 1, correct `1.303577269...`
- universal parabolic constant: digits `2.2955871493392...` are garbled, correct `2.2955871493926...`
- Lochs constant: the formula was `0`, now `6 Log[2] Log[10]/Pi^2`
- Abramowitz & Stegun Table 1.1, last digit off by more than one unit: 10^(1/3) `2.1544346900318837219`
  (correct ...218), 100^(1/5) `2.5118864315095801112` (...111), ln sqrt(2 pi) `0.9189385332046727417803296`
  (...297)
- Wolfram infinite product constant: the DefiningFormula is prod_{k>=1} (1+1/k)^(1/k) = 3.5174872559...,
  the published digits 1.7587436... are the product from k = 2, half of it. The value comes from the
  series 2 exp(sum_n (-1)^(n+1) (zeta(n+1)-1)/n)

### Rebuild and check

```
wolframscript -file import_wolfram_constants.wls   # only to refresh the Wolfram rows
python import_aands_table_1_1.py                   # only to refresh the A&S rows (fetches the OCR)
wolframscript -file build_constants_v0.wls         # writes constants_v0.tsv, prints mismatches
python check_constants_v0.py                       # mpmath: needs mpmath (pip install mpmath)
```

The build keeps the N[] values of all formulas in `formula_values_cache.wl` (not in the repository),
per Mathematica version: the first build evaluates them on all kernels (up to 60 s each), later ones take seconds.

Both must report no mismatch and no constant below its stated digits. To add a constant, add a row per
source to `constants_v0_sources.tsv`, rebuild and check; a new sum, product, integral or root with a seed
also needs a hand-written mpmath expression in `MANUAL` of the checker.

### Candidate sources for later versions

Not used yet: Finch, Mathematical Constants; OEIS decimal expansions
(with b-files for many digits); MathWorld; Plouffe's tables.
