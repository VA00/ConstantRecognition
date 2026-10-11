"""run_numberdb_v0.py - NumberDB (numberdb.org) as a lookup table over constants_v0.tsv, through its web API

Author: Andrzej Odrzywolek
Date: October 11, 2026
Code assist: Claude Opus 5.5

NumberDB (B. Matschke, https://numberdb.org, data CC BY-SA 4.0) is a collaborative database of numbers in
tables: families of numbers with a definition (values of K(m), zeros of Bessel functions, Clausen values, ...),
in October 2026 450 tables with 115647 real numbers, most known to 100 or more digits. Its GitHub repository
(numberdb-data) is out of date (tables T0-T107 only), so the site itself is asked, like Wolfram|Alpha:

  1. every constant with >= 17 digits: the input is its nearest double x, as for the other tools, sent as the
     real interval [x - 16 eps |x|, x + 16 eps |x|] (Constant Recognition's test) to /api/lookup, about 30
     numbers per request (the server takes request lines of up to 4094 characters). Every answer is appended at
     once to results/v0_numberdb_raw.jsonl, and constants already there are skipped, so an interrupted run
     resumes. A busy server (HTTP 429) is waited for as long as it asks.
  2. the answer: of the entries found, the nearest to x in whole eps; equally near ones (the same number in
     several tables): the one stored with the most digits, then the smallest table, then the lowest table
     number (Pi before "Zeros of Bessel functions", the 33-digit Riemann zeta zero before the same zero stored
     with 30 digits among the zeros of a Dedekind zeta function). It is the table's title with the entry's
     parameter, e.g. T29 "Rational multiples of pi", 1.
  3. score: NumberDB's own digits of that entry (its exact_text, mostly 100+ digits) against the 64-digit ground
     truth: exact (agrees to >= 30 digits, or to all digits of the constant, or to all 30 digits of an entry
     stored with 30, up to the last), false positive (fails beyond double precision), unverifiable (the entry
     has fewer digits than that, and agrees with all of them), not found.

Anonymous use of the API is limited to 60 units per hour, and a request costs about 1 unit plus 1/2 per number:
the run then takes about 12 hours of waiting. An API key (an account on numberdb.org) raises the limit to 1000
per hour, about 45 minutes; it is read, as by the numberdb package, from $NUMBERDB_API_KEY or from a line
NUMBERDB_API_KEY=... in ~/.config/numberdb/env.

Usage:  python run_numberdb_v0.py
Writes results/v0_numberdb.tsv and prints a summary.
"""
import csv
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from decimal import Decimal, getcontext

import mpmath as mp

mp.mp.dps = 80
getcontext().prec = 60
BENCH = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONSTANTS = os.path.join(BENCH, 'data', 'v0', 'constants_v0.tsv')
RESULTS = os.path.join(BENCH, 'results')
RAW = os.path.join(RESULTS, 'v0_numberdb_raw.jsonl')
URL = 'https://numberdb.org/'
BATCH = 100                 # the API's limit per request
MAX_URL = 4000              # characters: the server refuses request lines over 4094 (400, or 414)
EXACT = 30
EPS = 2.0 ** -52
TOL = Decimal(16) * Decimal(2) ** -52


def query(recs):
    return URL + 'api/lookup?' + urllib.parse.urlencode({'numbers': json.dumps(recs, separators=(',', ':'))})


def batches(xs):
    """the intervals for xs, in requests whose URL stays below MAX_URL characters (longer ones get HTTP 414)"""
    out, cur = [], []
    for x in xs:
        d = Decimal(x)
        w = abs(d) * TOL
        rec = {'kind': 'RIF', 'lower': f'{d - w:.19e}', 'upper': f'{d + w:.19e}'}   # 20 digits: 16 eps is ~4e-15
        if cur and (len(cur) == BATCH or len(query(cur + [rec])) > MAX_URL):
            out.append(cur)
            cur = []
        cur.append(rec)
    return out + [cur] if cur else out


def api_key():
    """as the numberdb package: $NUMBERDB_API_KEY, else NUMBERDB_API_KEY=... in ~/.config/numberdb/env"""
    if os.environ.get('NUMBERDB_API_KEY'):
        return os.environ['NUMBERDB_API_KEY']
    path = os.path.join(os.path.expanduser('~'), '.config', 'numberdb', 'env')
    if os.path.exists(path):
        for line in open(path, encoding='utf-8'):
            m = re.match(r'^\s*(?:export\s+)?NUMBERDB_API_KEY\s*=\s*["\']?([^"\'\s]+)', line)
            if m:
                return m.group(1)
    return None


def lookup(recs):
    """the entries NumberDB holds in each interval: {position: [record, ...]}"""
    headers = {'Accept': 'application/json',
               'User-Agent': 'ConstantRecognition benchmark (https://github.com/VA00/ConstantRecognition)'}
    key = api_key()
    if key:
        headers['Authorization'] = 'Bearer ' + key
    url = query(recs)
    while True:
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=120) as r:
                payload = json.loads(r.read())
            break
        except urllib.error.HTTPError as e:
            if e.code not in (429, 502, 503, 504):
                raise
            wait = int(e.headers.get('Retry-After') or 60)
            print(f'  HTTP {e.code}: waiting {wait} s', flush=True)
            time.sleep(wait + 1)
    found = {i: [] for i in range(len(recs))}
    for rec in payload.get('results') or []:
        n, t = rec.get('number') or {}, rec.get('table') or {}
        found.setdefault(int(rec.get('index', -1)), []).append({
            'tid': t.get('tid'), 'title': t.get('title'), 'url': t.get('url'), 'table_size': t.get('number_count'),
            'param': n.get('param'), 'text': (n.get('exact_text') or n.get('str_short') or '')[:120]})   # >= 100 digits
    return found


def value_of(text):
    """(value, significant digits) of NumberDB's exact_text (its real part), or None"""
    s = text.strip()
    m = re.match(r'^([-+]?\d+)/(\d+)(?![\d.])', s)
    if m:
        return mp.mpf(m.group(1)) / mp.mpf(m.group(2)), 999
    m = re.match(r'^([-+]?)(\d*)\.?(\d*)(?:[eE]([-+]?\d+))?', s)
    if not m or not (m.group(2) or m.group(3)):
        return None
    tok = m.group(0)
    sig = len((m.group(2) + m.group(3)).lstrip('0')) if '.' in tok else 999     # an integer is exact
    return mp.mpf(tok), sig


def agree(v, ref, digits):
    if v == ref:
        return float(digits)
    return float(min(-mp.log10(abs(v - ref) / abs(ref)) if ref != 0 else -mp.log10(abs(v)), digits))


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    bench = [r for r in csv.DictReader(open(CONSTANTS, encoding='utf-8'), delimiter='\t') if int(r['digits']) >= 17]
    raw = {}
    if os.path.exists(RAW):
        for line in open(RAW, encoding='utf-8'):
            if line.strip():
                d = json.loads(line)
                raw[d['id']] = d
    todo = [b for b in bench if b['id'] not in raw]
    print(f'{len(bench)} constants, {len(raw)} already looked up, {len(todo)} to look up')
    t0, done = time.time(), 0
    for recs in batches([float(b['value']) for b in todo]):
        part = todo[done:done + len(recs)]
        t1 = time.time()
        found = lookup(recs)
        with open(RAW, 'a', encoding='utf-8', newline='\n') as fo:
            for j, b in enumerate(part):
                d = {'id': b['id'], 'x': repr(float(b['value'])), 'matches': found.get(j, [])}
                raw[b['id']] = d
                fo.write(json.dumps(d, ensure_ascii=False) + '\n')
        done += len(recs)
        print(f'  {done} of {len(todo)}: {sum(1 for j in range(len(part)) if found.get(j))} of {len(part)} found, '
              f'{time.time() - t1:.1f} s', flush=True)
        time.sleep(2)
    if todo:
        print(f'lookups: {time.time() - t0:.0f} s')

    fields = ['id', 'name', 'class', 'digits', 'verdict', 'numberdb', 'tid', 'param', 'url', 'matches', 'agree',
              'entry_digits', 'formula']
    counts = {}
    with open(os.path.join(RESULTS, 'v0_numberdb.tsv'), 'w', encoding='utf-8', newline='') as fo:
        w = csv.DictWriter(fo, fieldnames=fields, delimiter='\t', lineterminator='\n')
        w.writeheader()
        for b in bench:
            d, x = raw[b['id']], mp.mpf(raw[b['id']]['x'])
            row = {'id': b['id'], 'name': b['name'], 'class': b['class'], 'digits': b['digits'], 'formula': b['formula'],
                   'matches': len(d['matches'])}
            cand = [(m, value_of(m['text'])) for m in d['matches']]
            cand.sort(key=lambda mv: (int(abs(mv[1][0] - x) / ((abs(x) or 1) * EPS)) if mv[1] else 10 ** 9,
                                      -mv[1][1] if mv[1] else 0, mv[0]['table_size'] or 10 ** 9,
                                      int((mv[0]['tid'] or 'T999999')[1:])))
            if not cand:
                verdict = 'not found'
            else:
                m, v = cand[0]
                digits = int(b['digits'])
                if v is None:
                    verdict, a = 'unverifiable', None
                else:
                    a = agree(v[0], mp.mpf(b['value']), min(digits, v[1]))
                    need = min(EXACT, digits - 1)
                    if v[1] >= need:            # an entry of exactly 30 digits: all of them, up to the last
                        verdict = 'exact' if a >= min(need, v[1] - 1) else 'false positive'
                    else:
                        verdict = 'unverifiable' if a >= v[1] - 1 else 'false positive'
                row.update({'numberdb': m['title'] + (f' [{m["param"]}]' if m['param'] else ''), 'tid': m['tid'],
                            'param': m['param'], 'url': URL + (m['url'] or ''), 'agree': '' if a is None else f'{a:.1f}',
                            'entry_digits': '' if v is None else v[1]})
            row['verdict'] = verdict
            counts[verdict] = counts.get(verdict, 0) + 1
            w.writerow(row)
    print(f'{len(bench)} constants:', ', '.join(f'{k} {n}' for k, n in sorted(counts.items())))


if __name__ == '__main__':
    main()
