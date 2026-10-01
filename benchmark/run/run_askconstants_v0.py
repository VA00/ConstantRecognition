"""run_askconstants_v0.py - AskConstants 5.0 (Propose) over constants_v0.tsv

Author: Andrzej Odrzywolek
Date: September 30, 2026
Code assist: Claude Opus 5.5

AskConstants (D. R. Stoutemyer, MIT license, https://math.hawaii.edu/~dale/AskConstants/)
is a Mathematica package: Propose [x] combines lookup tables of about 15
million expressions (and 5 million inverse functions of x, a meet-in-the-middle
search) with integer relation models, and accepts a candidate only if its
margin, agreement minus complexity (entropy) in digits, is large enough.

For comparison with Constant Recognition (the C engine), nsimplify, Maple identify and Wolfram|Alpha.
For every constant with at least 17 known digits, Propose [x, VerboseQ -> False]
with its default options, and MaxSearchSec as given, gets the nearest double x
(the digits that round-trip), the same input as the others. Its best candidate
is evaluated with 80 digits and compared with the 64-digit ground truth:

  exact              agrees to >= 30 digits (or to all digits of the value)
  false positive     a symbolic answer that fails beyond double precision
  rational fallback  a rational p/q that fails beyond double precision
  not found          no candidate (Propose rejects all below its margin),
                     an error, or a timeout

Needs AskConstants 5.0 unpacked, with its tables installed as .mx files (its
INSTALL.nb, or the equivalent install.wls). The constants are split over
--jobs Mathematica processes; each loads the tables (several GB of RAM) and
appends every answer to its own raw file at once, so an interrupted run resumes.

Usage:
  python run_askconstants_v0.py --askconstants <directory AskConstants5.0> [--jobs 4] [--maxsec 120]
Writes results/v0_askconstants.tsv and prints a summary and the comparisons.
"""
import argparse
import collections
import concurrent.futures
import csv
import glob
import os
import subprocess
import sys
import tempfile

import mpmath as mp

BENCH = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONSTANTS = os.path.join(BENCH, 'data', 'v0', 'constants_v0.tsv')
RESULTS = os.path.join(BENCH, 'results')

mp.mp.dps = 80
RAW = os.path.join(RESULTS, 'v0_askconstants_raw_{}.tsv')

WLS = r'''
dir = "%(dir)s";
SetDirectory[dir];
Do[Get[FileNameJoin[{dir, p <> ".m"}]], {p, {"Zeros", "InfimaAndSuprema", "RealInverseFunctions", "PrePropose", "Propose"}}];
ToExpression[First[Names["*`$AskConstantsDirectory"]] <> " = \"" <> dir <> "\""];
in = Import["%(inputs)s", "TSV", "Numeric" -> False];
out = "%(out)s";
(* constants answered by any job, so that a resumed run may use another number of jobs *)
done = Flatten[If[FileByteCount[#] > 0, Import[#, "TSV", "Numeric" -> False][[All, 1]], {}] & /@ FileNames["v0_askconstants_raw_*.tsv", DirectoryName[out]]];
str = OpenAppend[out, CharacterEncoding -> "UTF-8"];
clean[s_String] := StringReplace[s, {"\t" -> " ", "\n" -> " ", "\r" -> ""}];
Do[
  If[MemberQ[done, row[[1]]], Continue[]];
  {t, r} = AbsoluteTiming[Quiet@TimeConstrained[Propose[ToExpression[row[[2]]], VerboseQ -> False, MaxSearchSec -> %(maxsec)s], %(maxsec)s + 120, $TimedOut]];
  {kind, expr, v80, ag, en, ma} = Which[
    r === $TimedOut, {"TIMEOUT", "", "", "", "", ""},
    !ListQ[r] || r === {} || !ListQ[First[r]] || First[r] === {}, {"NONE", "", "", "", "", ""},
    True, Module[{c = First[First[r]], n},
      n = Quiet@TimeConstrained[N[c[[1]], 80], 60, $Failed];
      {If[MatchQ[c[[1]], _Rational | _Integer], "RATIONAL", "SYMBOLIC"], ToString[c[[1]], InputForm],
       If[NumericQ[n] && Im[n] == 0, ToString[CForm[N[n, 80]]], ""], ToString[c[[2]]], ToString[c[[3]]], ToString[c[[4]]]}]];
  WriteString[str, StringRiffle[clean /@ {row[[1]], kind, expr, v80, ag, en, ma, ToString[NumberForm[t, {7, 2}]]}, "\t"] <> "\n"],
  {row, in}];
Close[str];
'''


def mathematica_real(x):
    """The shortest round-trip digits of a double in Mathematica syntax: 6.5e-09 -> 6.5*^-9
    (ToExpression reads 6.5e-09 as 6.5*e - 9, with e a symbol)."""
    s = repr(x)
    if 'e' in s:
        mantissa, exponent = s.split('e')
        if '.' not in mantissa:
            mantissa += '.'     # 1*^20 would be an exact integer
        s = f'{mantissa}*^{int(exponent)}'
    return s


def run_job(wolframscript, askdir, maxsec, rows, out):
    if not rows:
        return
    with tempfile.NamedTemporaryFile('w', suffix='.tsv', delete=False, encoding='ascii', newline='') as f:
        for r in rows:
            f.write(f'{r["id"]}\t{mathematica_real(float(r["value"]))}\n')
        inputs = f.name
    with tempfile.NamedTemporaryFile('w', suffix='.wls', delete=False, encoding='utf-8') as f:
        f.write(WLS % {'dir': os.path.abspath(askdir).replace('\\', '/'), 'inputs': inputs.replace('\\', '/'),
                       'out': os.path.abspath(out).replace('\\', '/'), 'maxsec': maxsec})
        script = f.name
    # the table loading messages go to a log; errors in it would otherwise be lost
    with open(out + '.log', 'a', encoding='utf-8') as log:
        subprocess.run([wolframscript, '-file', script], stdout=log, stderr=subprocess.STDOUT)
    os.unlink(inputs)
    os.unlink(script)


def agree(v, ref, digits):
    if v == ref:
        return float(digits)
    return float(min(-mp.log10(abs(v - ref) / abs(ref)) if ref != 0 else -mp.log10(abs(v)), digits))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--askconstants', required=True, help='directory AskConstants5.0 with installed tables')
    ap.add_argument('--wolframscript', default=r'C:\Program Files\Wolfram Research\WolframScript\wolframscript.exe')
    ap.add_argument('--jobs', type=int, default=4)
    ap.add_argument('--maxsec', type=int, default=120, help='MaxSearchSec of Propose per constant')
    ap.add_argument('--limit', type=int, default=0, help='only the first N constants (a test)')
    ap.add_argument('--compare', default=os.path.join(RESULTS, 'v0_K7.tsv'), help='engine results of run_benchmark_v0.py')
    a = ap.parse_args()
    sys.stdout.reconfigure(encoding='utf-8')
    rows = [r for r in csv.DictReader(open(CONSTANTS, encoding='utf-8'), delimiter='\t') if int(r['digits']) >= 17]
    if a.limit:
        rows = rows[:a.limit]
    os.makedirs(RESULTS, exist_ok=True)
    with concurrent.futures.ThreadPoolExecutor(a.jobs) as pool:
        list(pool.map(lambda j: run_job(a.wolframscript, a.askconstants, a.maxsec, rows[j::a.jobs], RAW.format(j)), range(a.jobs)))

    raw = {}
    for path in glob.glob(RAW.format('*')):
        for line in open(path, encoding='utf-8'):
            p = line.rstrip('\r\n').split('\t')
            if len(p) == 8:
                raw[p[0]] = {'kind': p[1], 'askconstants': p[2], 'v80': p[3], 'agreement': p[4], 'entropy10': p[5],
                             'margin': p[6], 'time': float(p[7]) if p[7] else float('nan')}
    results = []
    for r in rows:
        o = raw.get(r['id'], {'kind': 'MISSING', 'askconstants': '', 'v80': '', 'agreement': '', 'entropy10': '', 'margin': '', 'time': float('nan')})
        ref, digits = mp.mpf(r['value']), int(r['digits'])
        d = agree(mp.mpf(o['v80'].replace('*^', 'e')), ref, digits) if o['v80'] else float('nan')
        if d != d:
            verdict = 'not found'
        elif d >= min(30, digits - 1):
            verdict = 'exact'
        else:
            verdict = 'rational fallback' if o['kind'] == 'RATIONAL' else 'false positive'
        results.append({**r, **o, 'agree': d, 'verdict': verdict})
    with open(os.path.join(RESULTS, 'v0_askconstants.tsv'), 'w', encoding='utf-8', newline='') as f:
        cols = ['id', 'name', 'class', 'digits', 'verdict', 'askconstants', 'agree', 'agreement', 'entropy10', 'margin', 'time', 'formula']
        f.write('\t'.join(cols) + '\n')
        for x in results:
            f.write('\t'.join(f'{x[c]:.1f}' if c == 'agree' else f'{x[c]:.2f}' if c == 'time' else str(x[c]) for c in cols) + '\n')

    n = len(results)
    tally = collections.Counter(x['verdict'] for x in results)
    kinds = collections.Counter(x['kind'] for x in results)
    times = sorted(x['time'] for x in results if x['time'] == x['time'])
    print(f'\n{n} constants with >= 17 digits, AskConstants 5.0 Propose (defaults, MaxSearchSec {a.maxsec}), '
          f'{sum(times) / 3600:.1f} h of searches on {a.jobs} jobs, median {times[len(times) // 2]:.1f} s; written results/v0_askconstants.tsv\n')
    for v in ('exact', 'false positive', 'rational fallback', 'not found'):
        print(f'  {v:18s} {tally[v]:5d}  ({100 * tally[v] / n:.1f}%)')
    print(f'  (no candidate {kinds["NONE"]}, timeouts {kinds["TIMEOUT"]}, missing {kinds["MISSING"]}, '
          f'candidates not numerically evaluable {sum(1 for x in results if x["kind"] in ("SYMBOLIC", "RATIONAL") and not x["v80"])})')
    print('\nby class:           n   exact  false+  rational  not found')
    for c in ('rational', 'algebraic', 'elementary', 'special', 'none'):
        t = collections.Counter(x['verdict'] for x in results if x['class'] == c)
        print(f'  {c:12s} {sum(t.values()):6d} {t["exact"]:7d} {t["false positive"]:7d} {t["rational fallback"]:9d} {t["not found"]:10d}')
    ok = ('exact', 'likely exact')
    for label, path in {'Constant Recognition': a.compare, 'Wolfram|Alpha': os.path.join(RESULTS, 'v0_wolframalpha.tsv'), 'Maple': os.path.join(RESULTS, 'v0_maple_identify.tsv'),
                        'nsimplify': os.path.join(RESULTS, 'v0_nsimplify.tsv')}.items():
        if not os.path.exists(path):
            continue
        o = {r['id']: r['verdict'] for r in csv.DictReader(open(path, encoding='utf-8'), delimiter='\t')}
        both = collections.Counter((o.get(x['id']) in ok, x['verdict'] == 'exact') for x in results)
        wrong = sum(1 for v in o.values() if v in ('false positive', 'rational fallback'))
        print(f'\ncompared with {label} ({path}):  exact in both {both[(True, True)]}, {label} only {both[(True, False)]}, '
              f'AskConstants only {both[(False, True)]}, neither {both[(False, False)]}')
        print(f'  wrong answers claimed exact: {label} {wrong}, AskConstants {tally["false positive"] + tally["rational fallback"]}')


if __name__ == '__main__':
    main()
