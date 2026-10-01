"""compare_results_v0.py - all recognition runs over constants_v0.tsv side by side

Author: Andrzej Odrzywolek
Date: September 30, 2026
Code assist: Claude Opus 5.5

Reads the scored result tables written by the run_*_v0.py scripts (results/v0_*.tsv,
one row per constant with >= 17 digits, column "verdict") and prints, per tool: exact
recognitions (formula checked to >= 30 digits), answers presented as exact that are wrong
beyond double precision, and not found; then per constant class, the overlaps between the
tools, and how many constants no tool recognizes. Wolfram|Alpha's "likely exact" (agreeing
to all ~20 digits it shows, without an expression to check) is listed separately.

Usage (from this directory):  python compare_results_v0.py
"""
import collections
import csv
import os
import sys

TOOLS = [  # label, results file
    ('Constant Recognition K<=5', 'results/v0_K5.tsv'),
    ('Constant Recognition K<=6', 'results/v0_K6.tsv'),
    ('Constant Recognition K<=7', 'results/v0_K7.tsv'),
    ('CR GPU K<=7', 'results/v0_cuda_K7.tsv'),
    ('CR GPU K<=8', 'results/v0_cuda_K8.tsv'),
    ('nsimplify', 'results/v0_nsimplify.tsv'),
    ('Maple identify', 'results/v0_maple_identify.tsv'),
    ('Wolfram|Alpha', 'results/v0_wolframalpha.tsv'),
    ('AskConstants', 'results/v0_askconstants.tsv'),
]
WRONG = ('false positive', 'rational fallback')


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    consts = {r['id']: r for r in csv.DictReader(open('constants_v0.tsv', encoding='utf-8'), delimiter='\t') if int(r['digits']) >= 17}
    runs = {}
    for label, path in TOOLS:
        if os.path.exists(path):
            v = {r['id']: r['verdict'] for r in csv.DictReader(open(path, encoding='utf-8'), delimiter='\t')}
            missing = set(consts) - set(v)
            if missing:
                print(f'warning: {path} lacks {len(missing)} constants (another benchmark version?)')
            runs[label] = {i: v.get(i, 'missing') for i in consts}
    n = len(consts)
    print(f'{n} constants with >= 17 digits\n')
    print(f'{"tool":26s} {"exact":>7s} {"likely":>7s} {"wrong":>7s} {"not found":>10s}   exact by class (rational/algebraic/elementary/special/none)')
    classes = ('rational', 'algebraic', 'elementary', 'special', 'none')
    for label, v in runs.items():
        t = collections.Counter(v.values())
        bycls = '/'.join(str(sum(1 for i in consts if consts[i]['class'] == c and v[i] == 'exact')) for c in classes)
        print(f'{label:26s} {t["exact"]:7d} {t["likely exact"]:7d} {sum(t[w] for w in WRONG):7d} {t["not found"] + t["unverifiable"]:10d}   {bycls}')
    print('\nconstants recognized exactly by the row tool but not by the column tool:')
    labels = [l for l in runs]
    print('(columns: CR = Constant Recognition)')
    print(' ' * 27 + ''.join(f'{l.replace("Constant Recognition", "CR")[:15]:>16s}' for l in labels))
    for a in labels:
        cells = ''.join(f'{sum(1 for i in consts if runs[a][i] == "exact" and runs[b][i] != "exact"):16d}' for b in labels)
        print(f'{a:26s} {cells}')
    # one run per tool for the union: of the Constant Recognition runs (CPU and GPU, several K), the one with most exact
    family = lambda l: 'CR' if l.startswith(('Constant Recognition', 'CR ')) else l
    exact_count = {l: sum(1 for i in consts if runs[l][i] == 'exact') for l in labels}
    best = [l for l in labels if exact_count[l] == max(exact_count[x] for x in labels if family(x) == family(l))
            and l == next(x for x in labels if family(x) == family(l) and exact_count[x] == exact_count[l])]
    union = {i for i in consts if any(runs[l][i] == 'exact' for l in best)}
    print(f'\nunion of {", ".join(best)}: {len(union)} exact ({100 * len(union) / n:.1f}%); '
          f'recognized by no tool: {n - len(union)}')
    only = collections.Counter()
    for i in consts:
        hits = [l for l in best if runs[l][i] == 'exact']
        if len(hits) == 1:
            only[hits[0]] += 1
    print('recognized by one tool only:', dict(only))


if __name__ == '__main__':
    main()
