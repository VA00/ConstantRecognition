# Constant recognition benchmark

## v0: published real constants

`constants_v0.tsv`: 228 real constants from published, hand-made lists. No generated or random
formulas, no complex constants. A proof of concept for a standard benchmark; recognition runs over it
are done by hand, not automated.

| Column | Meaning |
|---|---|
| `id` | row number, constants sorted by value |
| `name` | name from the first source in the order Wikipedia, GSL, Bronstein, Boost |
| `value` | the ground truth as a decimal string |
| `digits` | significant digits of `value` that are reliable: 64, or fewer when only fewer published digits exist |
| `formula` | Mathematica formula, empty when no closed form is known |
| `class` | `rational`, `algebraic`, `elementary` (exp, log, powers, trigonometric and hyperbolic functions and their inverses of pi, e and integers), `special` (Gamma, zeta, Catalan, sums, integrals, ...), `none` (no closed form) |
| `sources` | every source that lists the constant, with the number of digits it publishes |
| `check` | `ok`: every source agrees with `value` within one unit of its last digit |
| `notes` | how the value was obtained when not from the formula, errata of a source |

Classes: 138 elementary, 44 special, 21 algebraic, 9 rational, 16 without closed form.

### Sources

| Source | Constants | Digits |
|---|---|---|
| GSL `gsl_math.h`, https://git.savannah.gnu.org/cgit/gsl.git/plain/gsl_math.h (fetched 2026-09-29) | 17 | 30 |
| Boost.Math `constants.hpp`, https://github.com/boostorg/math/blob/develop/include/boost/math/constants/constants.hpp (fetched 2026-09-29) | 79 | 100+ |
| Wikipedia, List of mathematical constants, as collected in `Mathematica/SyntheticBenchmark.nb` | 100 | 20 |
| Bronstein, Taschenbuch der Mathematik, Table A.1, as collected in `synthetic_benchmark/BronsteinConstants.nb` | 104 | 5-7 |

`constants_v0_sources.tsv` holds one row per constant per source: source, key, name, formula, the digits
exactly as published (copied from the files by a script, never typed), and a note. It is the file to edit;
`constants_v0.tsv` is generated from it.

### Ground truth

`build_constants_v0.wls` (Mathematica) computes every formula with `N[formula, 96]` and trusts it only
when Mathematica reports Precision >= 80; otherwise the longest published digits are the value. Values
are written with 64 significant digits (a power of two, to avoid a base-10 bias; published-only values
longer than that are rounded to 64). Every published digit string must agree with the value within one
unit of its last digit, or as far as the computed value reaches when a source publishes more digits.

Precision is not proof. For two constants Mathematica reports Precision 80 and is wrong:

- Kepler-Bouwkamp, `Product[Cos[Pi/n], {n, 3, Infinity}]`: wrong after 26.8 digits
- asymptotic Lebesgue constant, with `Sum[Log[k]/(4k^2 - 1), {k, 1, Infinity}]`: wrong after 29 digits

Their defining formulas are marked `N-unreliable` in the sources and kept for their meaning; the values
come from geometrically converging series, computed in Mathematica with numeric arguments (source rows
"fast-converging series, computed"): log K = -sum_k (4^k-1) zeta(2k) zeta(2k,3)/k, and
sum_k log(k)/(4k^2-1) = -sum_j 4^-j zeta'(2j). With an exact 3, Mathematica rewrites `HurwitzZeta[2k, 3]`
into the cancelling zeta(2k) - 1 - 4^-k, so the arguments must be numeric.

Because precision can be claimed wrongly, `check_constants_v0.py` recomputes every value with a second,
independent tool, mpmath, from the same formulas (translated to mpmath, or hand-written for sums,
products, integrals and roots with a seed): 207 of 228 values agree to all their digits. Not checked
independently: 15 constants without closed form and 6 products or sums over primes (Artin, Stephens,
Feller-Tornier, Taniguchi, Heath-Brown-Moroz, prime constant), whose values are the published digits.

Errata found in the collected lists, kept in the sources with a note:

- Conway's constant: digits `1.3035771269...` have an extra 1, correct `1.303577269...`
- universal parabolic constant: digits `2.2955871493392...` are garbled, correct `2.2955871493926...`
- Lochs constant: the formula was `0`, now `6 Log[2] Log[10]/Pi^2`

### Rebuild and check

```
wolframscript -file build_constants_v0.wls   # writes constants_v0.tsv, prints mismatches
python check_constants_v0.py                 # mpmath: needs mpmath (pip install mpmath)
```

Both must report no mismatch and no constant below its stated digits. To add a constant, add a row per
source to `constants_v0_sources.tsv`, rebuild and check; a new sum, product, integral or root with a seed
also needs a hand-written mpmath expression in `MANUAL` of the checker.

### Candidate sources for later versions

Not used yet: Abramowitz & Stegun Table 1.1; Finch, Mathematical Constants; OEIS decimal expansions
(with b-files for many digits); the Wolfram Knowledgebase (`EntityList["MathematicalConstant"]`);
MathWorld; Plouffe's tables.
