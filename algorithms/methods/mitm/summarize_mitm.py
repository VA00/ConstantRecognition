"""summarize_mitm.py - one table of all mitm_cr runs on benchmark v0 (benchmark/results/v0_mitm_*.tsv)

Author: Andrzej Odrzywolek
Date: October 3, 2026
Code assist: Claude Opus 5.5

Reads every v0_mitm_<tag>.tsv with its process output v0_mitm_<tag>_raw.txt and prints a markdown table:
configuration, exact, false positives, false negatives, not found, wall time, CPU time, time of the right-side
table, median time per constant, peak memory, distinct right sides, distinct left values tested per constant
(after the early stop) and their product, the number of equations checked per constant.

Usage: python summarize_mitm.py [--tags kl5_kr6 kl6_kr6 ...]
"""
import argparse
import collections
import csv
import glob
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
RESULTS = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(HERE))), 'benchmark', 'results')


def row(tag):
    tsv = os.path.join(RESULTS, f'v0_mitm_{tag}.tsv')
    raw = os.path.join(RESULTS, f'v0_mitm_{tag}_raw.txt')
    rs = list(csv.DictReader(open(tsv, encoding='utf-8'), delimiter='\t'))
    t = collections.Counter(r['verdict'] for r in rs)
    head = ''.join(line for line in open(raw, encoding='utf-8') if line.startswith('#') and not line.startswith('#MATCH'))
    cmd = re.search(r'# command: (.*)', head).group(1)
    wall = float(re.search(r'# wall ([\d.]+) s', head).group(1))
    peak = float(re.search(r'peak memory ([\d.]+) GB, killed', head).group(1))
    cpu = re.search(r'CPU ([\d.]+) s \(right sides ([\d.]+) s\)', head)
    build = re.search(r'total build ([\d.]+) s', head)
    distinct = re.search(r'right sides: (\d+) distinct', head)
    lvals = re.search(r'(\d+) left values \((\d+) distinct per chunk', head)
    kl = re.search(r'--kl (\d+)', cmd).group(1)
    kr = re.search(r'--kr (\d+)', cmd).group(1)
    th = re.search(r'--threads (\d+)', cmd).group(1)
    extra = re.sub(r'.*--memcap \S+ ?', '', cmd)
    ms = sorted(float(r['ms']) for r in rs)
    return {'tag': tag, 'KL': int(kl), 'KR': int(kr), 'threads': int(th), 'extra': extra, 'n': len(rs),
            'exact': t['exact'], 'fp': t['false positive'], 'fn': t['false negative'], 'nf': t['not found'],
            'wall': wall, 'cpu': float(cpu.group(1)) if cpu else float('nan'),
            'build': float(build.group(1)) if build else float('nan'), 'median_ms': ms[len(ms) // 2],
            'peak': peak, 'distinct': int(distinct.group(1)) if distinct else 0,
            'L_per_constant': int(lvals.group(2)) / len(rs) if lvals else 0}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--tags', nargs='*')
    a = ap.parse_args()
    tags = a.tags or sorted(os.path.basename(p)[8:-4] for p in glob.glob(os.path.join(RESULTS, 'v0_mitm_*.tsv'))
                            if not p.endswith('_explicit.tsv'))
    rows = []
    for tag in tags:
        try:
            rows.append(row(tag))
        except (OSError, AttributeError) as e:
            print(f'skipped {tag}: {e}')
    rows.sort(key=lambda r: (r['extra'], r['threads'], r['KL'] + r['KR'], r['KL']))
    print('| config | KL | KR | threads | options | exact | false pos. | false neg. | not found | wall s | CPU s | '
          'table s | median ms per constant (time of one thread) | peak GB | distinct R | distinct L per constant | equations per constant |')
    print('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|')
    for r in rows:
        print(f'| {r["tag"]} | {r["KL"]} | {r["KR"]} | {r["threads"]} | {r["extra"] or "-"} | {r["exact"]} | {r["fp"]} | '
              f'{r["fn"]} | {r["nf"]} | {r["wall"]:.1f} | {r["cpu"]:.1f} | {r["build"]:.1f} | {r["median_ms"]:.1f} | '
              f'{r["peak"]:.2f} | {r["distinct"]:.3g} | {r["L_per_constant"]:.3g} | {r["L_per_constant"] * r["distinct"]:.2g} |')


if __name__ == '__main__':
    main()
