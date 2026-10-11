"""fetch_oeis_v1.py - the OEIS entries of benchmark v1 and their b-files, for import_oeis_v1.py

Author: Andrzej Odrzywolek
Date: October 11, 2026
Code assist: Claude Opus 5.5

Fills a work directory outside the repository (about 400 MB). It can be rerun after an interruption:
each step keeps what is already there.

  <work>/names.gz, stripped.gz     names and terms of all OEIS entries, from oeis.org
  <work>/seq_paths.txt             the candidates: every entry whose name contains "decimal expansion",
                                   and the entries with >= 17 single-digit terms whose name looks like a
                                   constant (decimal, digits of, value of, constant, root of, ...)
  <work>/oeisdata/                 a sparse clone of https://github.com/oeis/oeisdata with their .seq
                                   files (import_oeis_v1.select then keeps the v1 entries)
  <work>/bfiles/A000/b000796.txt   the b-files of the v1 entries

The b-files are not checked out of the clone. In the OEIS data repository they are Git LFS objects
stored by oeis.org, and adding 5228 of them to the sparse checkout stalled for hours (2026-10-11).
Instead each b-file's LFS pointer is read from raw.githubusercontent.com at the clone's commit,
oeis.org/lfs gives the download addresses (100 per request), and every file is checked against the
SHA-256 and size of its pointer.

Needs Python 3 and git (not git-lfs).

Usage:  python fetch_oeis_v1.py <work dir> [--threads 8]
Then:   python import_oeis_v1.py <work dir>/oeisdata --bfiles <work dir>/bfiles
"""
import argparse
import concurrent.futures
import gzip
import hashlib
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request

from import_oeis_v1 import has_bfile, select

UA = {'User-Agent': 'ConstantRecognition benchmark v1 (https://github.com/VA00/ConstantRecognition)'}
LFS = {'Accept': 'application/vnd.git-lfs+json', 'Content-Type': 'application/vnd.git-lfs+json'}
CONSTANT_NAME = re.compile(r'decimal|digits of|value of|constant|expansion|root of|zero of|solution of|'
                           r'sum_|product_|integral|limit', re.I)


def get(url, data=None, headers=None, tries=6):
    """the body of url (POST when data is given), retried with growing waits on errors and rate limits"""
    for i in range(tries):
        try:
            req = urllib.request.Request(url, data=data, headers=dict(UA, **(headers or {})))
            with urllib.request.urlopen(req, timeout=300) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code in (403, 404) or i == tries - 1:
                raise
            wait = int(e.headers.get('Retry-After') or 0) or 5 * 2 ** i
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            if i == tries - 1:
                raise
            wait = 5 * 2 ** i
        time.sleep(wait)


def save(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path + '.part', 'wb') as f:
        f.write(data)
    os.replace(path + '.part', path)


def candidates(work):
    for f in ('names.gz', 'stripped.gz'):
        if not os.path.exists(os.path.join(work, f)):
            print(f'downloading oeis.org/{f}')
            save(os.path.join(work, f), get(f'https://oeis.org/{f}'))
    names = {}
    for line in gzip.open(os.path.join(work, 'names.gz'), 'rt', encoding='utf-8'):
        if line.startswith('A'):
            a, n = line.rstrip('\n').split(' ', 1)
            names[a] = n
    sel = {a for a, n in names.items() if 'decimal expansion' in n.lower()}
    for line in gzip.open(os.path.join(work, 'stripped.gz'), 'rt', encoding='utf-8'):
        if line.startswith('A'):
            a, t = line.split(' ', 1)
            v = t.strip().strip(',').split(',')
            if len(v) >= 17 and all(x.isdigit() and len(x) == 1 for x in v) and CONSTANT_NAME.search(names.get(a, '')):
                sel.add(a)
    return sorted(sel)


def clone(work, paths_file):
    """the sparse clone with the candidates' .seq files; returns its commit"""
    d = os.path.join(work, 'oeisdata')
    env = dict(os.environ, GIT_LFS_SKIP_SMUDGE='1')
    git = lambda *a, **kw: subprocess.run(['git', '-C', d, *a], check=True, env=env, **kw)
    if not os.path.isdir(os.path.join(d, '.git')):
        subprocess.run(['git', 'clone', '--depth', '1', '--filter=blob:none', '--no-checkout',
                        'https://github.com/oeis/oeisdata.git', d], check=True, env=env)
        git('sparse-checkout', 'init', '--no-cone')
    with open(paths_file) as f:
        git('sparse-checkout', 'set', '--stdin', stdin=f)
    git('checkout', 'main')
    return git('rev-parse', 'HEAD', capture_output=True, text=True).stdout.strip()


def fetch_bfiles(work, paths, commit, threads):
    """paths: A000/b000796.txt, ...; returns the paths that failed, with the reason"""
    out = os.path.join(work, 'bfiles')
    todo = sorted({p for p in paths if not os.path.exists(os.path.join(out, p))})
    print(f'b-files: {len(paths)}, already here {len(paths) - len(todo)}, to fetch {len(todo)}')
    failed, pointers, t0 = {}, {}, time.time()

    def pointer(p):
        try:
            return p, get(f'https://raw.githubusercontent.com/oeis/oeisdata/{commit}/files/{p}')
        except Exception as e:
            return p, e

    with concurrent.futures.ThreadPoolExecutor(threads) as ex:
        for k, (p, b) in enumerate(ex.map(pointer, todo), 1):
            if isinstance(b, Exception):
                failed[p] = f'pointer: {b}'
                continue
            m = re.match(rb'version https://git-lfs\S*\noid sha256:([0-9a-f]{64})\nsize (\d+)', b)
            if m:
                pointers[p] = (m.group(1).decode(), int(m.group(2)))
            else:
                save(os.path.join(out, p), b)       # a b-file stored in git itself
            if k % 1000 == 0:
                print(f'  {k} pointers read, {time.time() - t0:.0f} s')
    total = sum(s for _, s in pointers.values())
    print(f'{len(pointers)} b-files in LFS, {total / 1e6:.0f} MB; {len(todo) - len(pointers) - len(failed)} stored in git')

    def download(item, href):
        p, (oid, size) = item
        if oid not in href:
            return p, 'oeis.org/lfs gave no download address'
        url, headers = href[oid]
        try:
            b = get(url, headers=headers)
        except Exception as e:
            return p, f'download: {e}'
        if len(b) != size or hashlib.sha256(b).hexdigest() != oid:
            return p, 'SHA-256 or size differs from the pointer'
        save(os.path.join(out, p), b)
        return p, ''

    items, done = sorted(pointers.items()), 0
    for i in range(0, len(items), 100):
        chunk = items[i:i + 100]
        req = {'operation': 'download', 'transfers': ['basic'],
               'objects': [{'oid': oid, 'size': size} for _, (oid, size) in chunk]}
        resp = json.loads(get('https://oeis.org/lfs/objects/batch', json.dumps(req).encode(), LFS))
        href = {o['oid']: (o['actions']['download']['href'], o['actions']['download'].get('header', {}))
                for o in resp.get('objects', []) if 'download' in o.get('actions', {})}
        with concurrent.futures.ThreadPoolExecutor(threads) as ex:
            for p, err in ex.map(lambda it: download(it, href), chunk):
                if err:
                    failed[p] = err
        done += sum(s for _, (_, s) in chunk)
        print(f'  {min(i + 100, len(items))} of {len(items)} b-files, {done / 1e6:.0f} of {total / 1e6:.0f} MB, '
              f'{time.time() - t0:.0f} s')
    return failed


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    ap = argparse.ArgumentParser()
    ap.add_argument('work', help='work directory, outside the repository')
    ap.add_argument('--threads', type=int, default=8)
    args = ap.parse_args()
    work = os.path.abspath(args.work)
    os.makedirs(work, exist_ok=True)

    seq = candidates(work)
    paths_file = os.path.join(work, 'seq_paths.txt')
    with open(paths_file, 'w', newline='\n') as f:
        f.write(''.join(f'seq/{a[:4]}/{a}.seq\n' for a in seq))
    print(f'{len(seq)} candidate entries')

    commit = clone(work, paths_file)
    entries, skipped = select(os.path.join(work, 'oeisdata'))
    paths = [f'{a[:4]}/b{a[1:]}.txt' for a, e, *_ in entries if has_bfile(a, e)]
    print(f'oeisdata {commit[:8]}: {len(entries)} v1 entries, {len(paths)} with a b-file; skipped: {dict(skipped)}')

    failed = fetch_bfiles(work, paths, commit, args.threads)
    for p, err in sorted(failed.items()):
        print(f'  failed {p}: {err}')
    print(f'done: {len(paths) - len(failed)} of {len(paths)} b-files in {os.path.join(work, "bfiles")}'
          + (f'; {len(failed)} failed (rerun to retry)' if failed else ''))


if __name__ == '__main__':
    main()
