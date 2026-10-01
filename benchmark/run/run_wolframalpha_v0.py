"""run_wolframalpha_v0.py - Wolfram|Alpha "Possible closed forms" over constants_v0.tsv

Author: Andrzej Odrzywolek
Date: September 30, 2026
Code assist: Claude Opus 5.5

For comparison with Constant Recognition (the C engine), nsimplify and Maple identify. For every
constant with at least 17 known digits, Mathematica's WolframAlpha[x, {All,
"ComputableData"}] gets the nearest double x (the digits that round-trip), the
same input as the others. The first candidate of the PossibleClosedForm pod
(Hold[expr ~~ value]) is evaluated with 80 digits and compared with the
64-digit ground truth:

  exact              agrees to >= 30 digits (or to all digits of the value)
  likely exact       no Mathematica expression (ComputableData is
                     Missing["NoRawData"]), but the value Alpha shows (about
                     20 digits, in the plaintext of the pod) agrees to all its
                     digits: more than the 16 of the input, fewer than our 30
  false positive     a symbolic answer that fails beyond double precision
  rational fallback  a rational p/q that fails beyond double precision
  unverifiable       no expression, and the shown value is not decisive
  not found          no PossibleClosedForm pod, an error, or a timeout

One query at a time, one kernel (Wolfram|Alpha is a web service; each query
takes seconds). Every answer is appended to results/v0_wolframalpha_raw.tsv at
once, and constants already there are skipped, so an interrupted run resumes.
Answers without an expression are asked again for the plaintext of the pod
(results/v0_wolframalpha_plain.tsv, also resumable).

Usage:
  python run_wolframalpha_v0.py [--wolframscript <path>] [--compare results/v0_K6.tsv]
Writes results/v0_wolframalpha.tsv and prints a summary and the comparisons.
"""
import argparse
import collections
import csv
import decimal
import os
import re
import subprocess
import sys
import tempfile

import mpmath as mp

BENCH = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONSTANTS = os.path.join(BENCH, 'data', 'v0', 'constants_v0.tsv')
RESULTS = os.path.join(BENCH, 'results')

mp.mp.dps = 80
RAW = os.path.join(RESULTS, 'v0_wolframalpha_raw.tsv')
PLAIN = os.path.join(RESULTS, 'v0_wolframalpha_plain.tsv')

WLS = r'''
in = Import["%(inputs)s", "TSV", "Numeric" -> False];
out = "%(out)s";
done = If[FileExistsQ[out], Import[out, "TSV", "Numeric" -> False][[All, 1]], {}];
str = OpenAppend[out, CharacterEncoding -> "UTF-8"];
clean[s_String] := StringReplace[s, {"\t" -> " ", "\n" -> " ", "\r" -> ""}];
Do[
  If[MemberQ[done, row[[1]]], Continue[]];
  t = AbsoluteTime[];
  r = Quiet@TimeConstrained[WolframAlpha[row[[2]], {All, "ComputableData"}], 120, $TimedOut];
  t = AbsoluteTime[] - t;
  cf = If[ListQ[r], Lookup[Association[Cases[r, HoldPattern[{{"PossibleClosedForm", k_}, _} -> v_] :> (k -> v)]], 1, Missing[]], Missing[]];
  {kind, expr, v80} = Which[
    r === $TimedOut, {"TIMEOUT", "", ""},
    MissingQ[cf], {"NONE", "", ""},
    True, Module[{e = cf /. Hold[TildeTilde[a_, _]] :> Hold[a], n},
      n = Quiet@TimeConstrained[N[ReleaseHold[e], 80], 60, $Failed];
      {If[MatchQ[e, Hold[_Rational | _Integer]], "RATIONAL", "SYMBOLIC"],
       ToString[e, InputForm],
       If[NumericQ[n] && Im[n] == 0, ToString[CForm[N[n, 80]]], ""]}]];
  WriteString[str, StringRiffle[clean /@ {row[[1]], kind, expr, v80, ToString[NumberForm[t, {6, 2}]]}, "\t"] <> "\n"];
  If[Mod[row[[1]] // ToExpression, 50] == 0, Print[DateString[], "  id ", row[[1]]]],
  {row, in}];
Close[str];
'''

# the plaintext of the first PossibleClosedForm candidate, for answers without an expression
WLS_PLAIN = r'''
in = Import["%(inputs)s", "TSV", "Numeric" -> False];
out = "%(out)s";
done = If[FileExistsQ[out], Import[out, "TSV", "Numeric" -> False][[All, 1]], {}];
str = OpenAppend[out, CharacterEncoding -> "UTF-8"];
clean[s_String] := StringReplace[s, {"\t" -> " ", "\n" -> " ", "\r" -> ""}];
Do[
  If[MemberQ[done, row[[1]]], Continue[]];
  r = Quiet@TimeConstrained[WolframAlpha[row[[2]], {{"PossibleClosedForm", 1}, "Plaintext"}], 120, $TimedOut];
  WriteString[str, row[[1]] <> "\t" <> clean[If[StringQ[r], r, ""]] <> "\n"],
  {row, in}];
Close[str];
'''


def alpha_real(x):
    """The shortest round-trip digits of a double in positional notation: 6.5e-09 -> 0.0000000065.
    For 6.5e-09 or 6.5*10^-9, Wolfram|Alpha computes a result and proposes no closed forms."""
    s = repr(x)
    if 'e' in s:
        s = format(decimal.Decimal(s), 'f')
    return s


def run_wls(wolframscript, template, rows, out):
    """Run a query template over rows (id, nearest double), appending to out."""
    if not rows:
        return
    with tempfile.NamedTemporaryFile('w', suffix='.tsv', delete=False, encoding='ascii', newline='') as f:
        for r in rows:
            f.write(f'{r["id"]}\t{alpha_real(float(r["value"]))}\n')
        inputs = f.name
    with tempfile.NamedTemporaryFile('w', suffix='.wls', delete=False, encoding='utf-8') as f:
        f.write(template % {'inputs': inputs.replace('\\', '/'), 'out': os.path.abspath(out).replace('\\', '/')})
        script = f.name
    subprocess.run([wolframscript, '-file', script])
    os.unlink(inputs)
    os.unlink(script)


def agree(v, ref, digits):
    if v == ref:
        return float(digits)
    return float(min(-mp.log10(abs(v - ref) / abs(ref)) if ref != 0 else -mp.log10(abs(v)), digits))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--wolframscript', default=r'C:\Program Files\Wolfram Research\WolframScript\wolframscript.exe')
    ap.add_argument('--compare', default=os.path.join(RESULTS, 'v0_K6.tsv'), help='engine results of run_benchmark_v0.py')
    ap.add_argument('--limit', type=int, default=0, help='only the first N constants (a test)')
    a = ap.parse_args()
    sys.stdout.reconfigure(encoding='utf-8')
    rows = [r for r in csv.DictReader(open(CONSTANTS, encoding='utf-8'), delimiter='\t') if int(r['digits']) >= 17]
    if a.limit:
        rows = rows[:a.limit]
    os.makedirs(RESULTS, exist_ok=True)

    run_wls(a.wolframscript, WLS, rows, RAW)
    raw = {}
    for line in open(RAW, encoding='utf-8'):
        p = line.rstrip('\n').split('\t')
        if len(p) == 5:
            raw[p[0]] = {'kind': p[1], 'wolframalpha': p[2], 'v80': p[3], 'time': float(p[4]) if p[4] else float('nan')}
    noexpr = [r for r in rows if r['id'] in raw and raw[r['id']]['kind'] == 'SYMBOLIC' and not raw[r['id']]['v80']]
    run_wls(a.wolframscript, WLS_PLAIN, noexpr, PLAIN)
    plain = {}
    if os.path.exists(PLAIN):
        for line in open(PLAIN, encoding='utf-8'):
            p = line.rstrip('\r\n').split('\t')
            if len(p) == 2:
                plain[p[0]] = p[1]

    results = []
    for r in rows:
        o = raw.get(r['id'], {'kind': 'NONE', 'wolframalpha': '', 'v80': '', 'time': float('nan')})
        ref, digits = mp.mpf(r['value']), int(r['digits'])
        d = float('nan')
        shown = 0
        if o['v80']:
            d = agree(mp.mpf(o['v80'].replace('*^', 'e')), ref, digits)
        elif o['kind'] == 'SYMBOLIC' and plain.get(r['id']):
            # "formula ≈ 0.57721566490153286060" (or ~~): the value Alpha shows for its candidate
            text = plain[r['id']]
            o = {**o, 'wolframalpha': text}
            m = re.search(r'(?:~~|≈)\s*(-?\d*\.?\d+)', text)
            if m:
                sv = m.group(1)
                shown = len(sv.replace('-', '').replace('.', '').lstrip('0'))
                d = agree(mp.mpf(sv), ref, digits)
        if o['kind'] in ('NONE', 'TIMEOUT'):
            verdict = 'not found'
        elif shown:
            if shown >= 18 and d >= min(shown, digits) - 1:
                verdict = 'likely exact'
            elif d < 16.5:
                verdict = 'false positive'
            else:
                verdict = 'unverifiable'
        elif d != d:
            verdict = 'unverifiable'
        elif d >= min(30, digits - 1):
            verdict = 'exact'
        else:
            verdict = 'rational fallback' if o['kind'] == 'RATIONAL' else 'false positive'
        results.append({**r, **o, 'agree': d, 'verdict': verdict})
    with open(os.path.join(RESULTS, 'v0_wolframalpha.tsv'), 'w', encoding='utf-8', newline='') as f:
        cols = ['id', 'name', 'class', 'digits', 'verdict', 'wolframalpha', 'agree', 'time', 'formula']
        f.write('\t'.join(cols) + '\n')
        for x in results:
            f.write('\t'.join(f'{x[c]:.1f}' if c == 'agree' else f'{x[c]:.2f}' if c == 'time' else str(x[c]) for c in cols) + '\n')

    n = len(results)
    tally = collections.Counter(x['verdict'] for x in results)
    times = sorted(x['time'] for x in results if x['time'] == x['time'])
    print(f'\n{n} constants with >= 17 digits, Wolfram|Alpha PossibleClosedForm (first candidate), '
          f'{sum(times) / 3600:.1f} h of queries, median {times[len(times) // 2]:.1f} s; written results/v0_wolframalpha.tsv\n')
    for v in ('exact', 'likely exact', 'false positive', 'rational fallback', 'unverifiable', 'not found'):
        print(f'  {v:18s} {tally[v]:5d}  ({100 * tally[v] / n:.1f}%)')
    print(f'  (timeouts: {sum(1 for x in results if x["kind"] == "TIMEOUT")})')
    print('\nby class:           n   exact  likely  false+  rational  unverif.  not found')
    for c in ('rational', 'algebraic', 'elementary', 'special', 'none'):
        t = collections.Counter(x['verdict'] for x in results if x['class'] == c)
        print(f'  {c:12s} {sum(t.values()):6d} {t["exact"]:7d} {t["likely exact"]:7d} {t["false positive"]:7d} '
              f'{t["rational fallback"]:9d} {t["unverifiable"]:9d} {t["not found"]:10d}')
    ok = ('exact', 'likely exact')
    for label, path in {'Constant Recognition': a.compare, 'Maple': os.path.join(RESULTS, 'v0_maple_identify.tsv'), 'nsimplify': os.path.join(RESULTS, 'v0_nsimplify.tsv')}.items():
        if not os.path.exists(path):
            continue
        o = {r['id']: r['verdict'] for r in csv.DictReader(open(path, encoding='utf-8'), delimiter='\t')}
        both = collections.Counter((o.get(x['id']) == 'exact', x['verdict'] in ok) for x in results)
        wrong = sum(1 for v in o.values() if v in ('false positive', 'rational fallback'))
        print(f'\ncompared with {label} ({path}), counting likely exact as exact:  exact in both {both[(True, True)]}, '
              f'{label} only {both[(True, False)]}, Wolfram|Alpha only {both[(False, True)]}, neither {both[(False, False)]}')
        print(f'  wrong answers claimed exact: {label} {wrong}, Wolfram|Alpha {tally["false positive"] + tally["rational fallback"]}')


if __name__ == '__main__':
    main()
