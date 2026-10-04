'use client';

// Results of the equation search, laid out as the calculator page's ResultCard and ResultsTable. The engine finds
// equations L(x) = R; when x occurs once in L (always, with "x appears once") the page solves the equation for x and
// shows the formula, otherwise the equation itself. Wolfram|Alpha always gets the bare equation: it solves it anyway.
// No explanatory notes next to the results: an implicit equation is recognisable as it is.

import { useState } from 'react';
import { Latex } from '../../calculator/components/Latex';
import { rpnToLatex, rpnToMathematica, createWolframLink } from '../../calculator/lib/rpn';
import { copyTextToClipboard } from '../../calculator/lib/clipboard';
import {
  Equation, equationLatex, equationMathematica, equationWolframQuery, explicitFormula, evalRPN, equationCR, equationChance,
} from '../lib/mitm';

export interface MitmRow extends Equation {
  status: 'MATCH' | 'APPROX';
  explicit: string[] | null;   // x = F, RPN tokens
  value: number;               // x: the value of the formula, or the root of the equation
  cr: number;
  chance: number;              // probability of an equation this close by chance (equationChance)
}

// A compression ratio above 1: the agreement is unlikely to be chance among the equations compared
export const CR_THRESHOLD = 1;

export function buildRows(matches: Equation[], approx: Equation[], T: number, relDelta: number, nL: number[], nR: number[]): MitmRow[] {
  const row = (e: Equation, status: MitmRow['status']): MitmRow => {
    const explicit = explicitFormula(e, T, status === 'MATCH');
    const value = explicit ? evalRPN(explicit, 0) : (e.x ?? NaN);
    return {
      ...e, status, explicit, value, cr: equationCR(e, relDelta, nL, nR), chance: equationChance(e, relDelta, nL, nR),
    };
  };
  const seen = new Set(matches.map(e => `${e.lhs}|${e.rhs}`));
  return [
    ...matches.map(e => row(e, 'MATCH')),
    ...approx.filter(e => !seen.has(`${e.lhs}|${e.rhs}`)).map(e => row(e, 'APPROX')),
  ].sort((a, b) => (a.total - b.total) || (a.status === b.status ? a.err - b.err : a.status === 'MATCH' ? -1 : 1));
}

const rowKey = (r: Equation) => `${r.lhs}|${r.rhs}`;
const formatValue = (v: number) => (Number.isFinite(v) ? String(Number(v.toPrecision(16))) : '—');
const formatProbability = (p: number) => (p >= 0.01 ? p.toFixed(2) : p.toExponential(0));
// the formula if the equation was solved for x, otherwise the equation
const formulaLatex = (r: MitmRow) => (r.explicit ? rpnToLatex(r.explicit) : equationLatex(r));
// the equation adds something only if L is more than x itself
const showsEquation = (r: MitmRow) => r.explicit !== null && r.lhs.trim() !== 'x';

// Jump = the error at least 100 times smaller than the best of the next shorter length (as on the calculator page)
function hasAccuracyJump(row: MitmRow, rows: MitmRow[]): boolean {
  const bestByLength = new Map<number, number>();
  rows.forEach(r => {
    const cur = bestByLength.get(r.total);
    if (cur === undefined || r.err < cur) bestByLength.set(r.total, r.err);
  });
  const shorter = Array.from(bestByLength.keys()).filter(n => n < row.total);
  if (shorter.length === 0) return false;
  const prevErr = bestByLength.get(Math.max(...shorter)) ?? 1;
  return prevErr / Math.max(row.err, 1e-300) >= 100;
}

const LABEL = 'text-[10px] sm:text-xs font-medium text-gray-500 dark:text-gray-500 uppercase tracking-wider';

function Criterion({ passed, label, value }: { passed: boolean | null; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      {passed !== null && (
        <div className={`w-2 h-2 rounded-full transition-all ${
          passed ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]' : 'bg-gray-300 dark:bg-gray-600'
        }`} />
      )}
      <div className="flex flex-col">
        <span className={`text-[10px] uppercase tracking-wide font-medium ${
          passed ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-400 dark:text-gray-500'
        }`}>
          {label}
        </span>
        <span className={`text-xs font-mono ${
          passed ? 'text-emerald-700 dark:text-emerald-300' : passed === null ? 'text-gray-700 dark:text-gray-300' : 'text-gray-500 dark:text-gray-400'
        }`}>
          {value}
        </span>
      </div>
    </div>
  );
}

const Divider = () => <div className="w-px h-8 bg-gray-200 dark:bg-gray-700 hidden sm:block" />;

export function MitmResultCard({ row, rows }: { row: MitmRow; rows: MitmRow[] }) {
  const mma = equationMathematica(row);
  const probability = row.chance;
  const jumpPassed = hasAccuracyJump(row, rows);
  const crPassed = row.cr >= CR_THRESHOLD;
  const probPassed = probability < 1e-6;
  const allPassed = jumpPassed && crPassed && probPassed;
  const passedCount = [jumpPassed, crPassed, probPassed].filter(Boolean).length;
  const badge = row.status !== 'MATCH'
    ? { text: 'Outside tolerance', cls: 'bg-gray-500/20 text-gray-500 dark:text-gray-400' }
    : allPassed ? { text: 'Confirmed', cls: 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400' }
    : passedCount >= 2 ? { text: 'Likely', cls: 'bg-amber-500/20 text-amber-600 dark:text-amber-400' }
    : { text: 'Uncertain', cls: 'bg-gray-500/20 text-gray-500 dark:text-gray-400' };

  return (
    <div className="p-4 sm:p-6 bg-linear-to-r from-[#0066cc]/5 to-transparent dark:from-[#0066cc]/10 border-b border-gray-200 dark:border-[#2a2a2e] overflow-hidden">
      <div className="max-w-6xl mx-auto">
        {/* Main result info */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 mb-5">
          <div className="col-span-1 sm:col-span-2 lg:col-span-1 overflow-hidden">
            <label className={LABEL}>Best Match</label>
            <div className="text-lg sm:text-xl text-gray-900 dark:text-white mt-1 overflow-x-auto overflow-y-hidden">
              <Latex formula={formulaLatex(row)} />
            </div>
          </div>
          <div>
            <label className={LABEL}>Numeric Value</label>
            <div className="text-base sm:text-lg font-mono text-gray-700 dark:text-gray-300 mt-1 break-all">{formatValue(row.value)}</div>
          </div>
          <div>
            <label className={LABEL}>Mathematica</label>
            <a
              href={createWolframLink(equationWolframQuery(row))}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-mono text-[#0066cc] hover:underline mt-1 block break-all"
            >
              {mma}
            </a>
          </div>
          <div>
            <label className={LABEL}>Relative Error</label>
            <div className="text-sm font-mono text-gray-500 dark:text-gray-500 mt-1">{row.err.toExponential(2)}</div>
          </div>
        </div>

        {/* Identification */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 pt-4 border-t border-gray-200/50 dark:border-[#2a2a2e]/50">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest">Identification</span>
            <div className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide ${badge.cls}`}>{badge.text}</div>
          </div>

          <div className="flex items-center gap-3 sm:gap-4 flex-wrap">
            <Criterion passed={null} label="Length L + R" value={`${row.a} + ${row.b} = ${row.total}`} />
            <Divider />
            <Criterion passed={jumpPassed} label="Accuracy Jump" value={jumpPassed ? '>100x' : '—'} />
            <Divider />
            <Criterion passed={crPassed} label="Compression" value={`CR=${row.cr.toFixed(2)} / ${CR_THRESHOLD.toFixed(2)}`} />
            <Divider />
            <Criterion passed={probPassed} label="Probability" value={`P=${formatProbability(probability)}`} />
          </div>
        </div>
      </div>
    </div>
  );
}

type SortColumn = 'LENGTH' | 'REL_ERR' | 'CR';

interface MitmFilters {
  showMatch: boolean;
  showClosest: boolean;
  maxRelErr: number;
  minCR: number;
  searchQuery: string;
}

const NO_FILTERS: MitmFilters = { showMatch: true, showClosest: true, maxRelErr: 1, minCR: 0, searchQuery: '' };

function renderSortIcon(column: SortColumn, sortColumn: SortColumn | null, sortDirection: 'asc' | 'desc') {
  if (sortColumn !== column) return <span className="text-gray-400 ml-1">↕</span>;
  return <span className="text-[#0066cc] ml-1">{sortDirection === 'asc' ? '↑' : '↓'}</span>;
}

const SELECT = 'px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-[#111113] text-gray-900 dark:text-white text-xs';

export function MitmResultsTable({ rows, best }: { rows: MitmRow[]; best: MitmRow | null }) {
  const [copied, setCopied] = useState<string | null>(null);
  const [filters, setFilters] = useState<MitmFilters>(NO_FILTERS);
  const [sortColumn, setSortColumn] = useState<SortColumn | null>('CR');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  const copy = async (id: string, text: string) => {
    if (await copyTextToClipboard(text)) {
      setCopied(id);
      setTimeout(() => setCopied(c => (c === id ? null : c)), 1500);
    }
  };

  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection(column === 'CR' ? 'desc' : 'asc');   // the highest CR first
    }
  };

  const metric = (r: MitmRow, c: SortColumn) => (c === 'CR' ? r.cr : c === 'REL_ERR' ? r.err : r.total);
  const query = filters.searchQuery.toLowerCase();
  const shown = rows
    .filter(r => {
      if (!filters.showMatch && r.status === 'MATCH') return false;
      if (!filters.showClosest && r.status === 'APPROX') return false;
      if (r.err > filters.maxRelErr) return false;
      if (r.cr < filters.minCR) return false;
      if (query) {
        const text = `${r.lhs} = ${r.rhs} ${equationMathematica(r)} ${r.explicit ? rpnToMathematica(r.explicit) : ''} ${formatValue(r.value)}`;
        if (!text.toLowerCase().includes(query)) return false;
      }
      return true;
    })
    .sort((a, b) => {
      const statusDiff = (a.status === 'MATCH' ? 0 : 1) - (b.status === 'MATCH' ? 0 : 1);   // matches first
      if (statusDiff !== 0) return statusDiff;
      if (!sortColumn) return 0;
      const d = sortDirection === 'asc' ? metric(a, sortColumn) - metric(b, sortColumn) : metric(b, sortColumn) - metric(a, sortColumn);
      if (d !== 0) return d;
      return sortColumn === 'CR' ? a.err - b.err : b.cr - a.cr;
    });
  const bestKey = best ? rowKey(best) : null;

  const th = 'p-3 cursor-pointer hover:text-[#0066cc] select-none';
  return (
    <div className="flex-1 min-h-0 overflow-hidden flex flex-col bg-white dark:bg-[#1a1a1d] w-full max-w-full">
      {/* Filters */}
      <div className="p-3 sm:p-4 border-b border-gray-200 dark:border-[#2a2a2e] bg-white dark:bg-[#1a1a1d] space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-4 flex-wrap">
            <span className="text-xs text-gray-500 dark:text-gray-500 font-medium uppercase">Status:</span>
            {([
              { key: 'showMatch', label: 'Match', color: 'text-green-600 dark:text-green-400' },
              { key: 'showClosest', label: 'Closest', color: 'text-blue-600 dark:text-blue-400' },
            ] as const).map(f => (
              <label key={f.key} className={`flex items-center gap-1.5 text-xs cursor-pointer ${f.color}`}>
                <input
                  type="checkbox"
                  checked={filters[f.key]}
                  onChange={(e) => setFilters({ ...filters, [f.key]: e.target.checked })}
                  className="accent-[#0066cc]"
                />
                {f.label}
              </label>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500 dark:text-gray-500">Search:</span>
            <input
              type="text"
              value={filters.searchQuery}
              onChange={(e) => setFilters({ ...filters, searchQuery: e.target.value })}
              placeholder="Filter results..."
              className="px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-[#111113] text-gray-900 dark:text-white w-40 sm:w-48"
            />
          </div>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
              <span>Max Error:</span>
              <select value={filters.maxRelErr} onChange={(e) => setFilters({ ...filters, maxRelErr: parseFloat(e.target.value) })} className={SELECT}>
                <option value="1">10⁰</option>
                <option value="1e-3">10⁻³</option>
                <option value="1e-6">10⁻⁶</option>
                <option value="1e-9">10⁻⁹</option>
                <option value="1e-12">10⁻¹²</option>
                <option value="1e-15">10⁻¹⁵</option>
              </select>
            </div>
            <div className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
              <span>Min CR:</span>
              <select value={filters.minCR} onChange={(e) => setFilters({ ...filters, minCR: parseFloat(e.target.value) })} className={SELECT}>
                <option value="0">0.0</option>
                <option value="0.5">0.5</option>
                <option value="0.7">0.7</option>
                <option value="0.8">0.8</option>
                <option value="0.9">0.9</option>
                <option value="1">1.0</option>
              </select>
            </div>
            <button
              onClick={() => setFilters(NO_FILTERS)}
              className="px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-100 dark:hover:bg-[#2a2a2e] transition-colors text-gray-600 dark:text-gray-400"
            >
              Clear
            </button>
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-500">
            {shown.length === rows.length ? `${rows.length} results` : `${shown.length} of ${rows.length} results`}
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto bg-white dark:bg-[#1a1a1d] max-w-full">
        <table className="w-full min-w-[66rem] table-fixed">
          <thead className="bg-gray-50 dark:bg-[#111113] sticky top-0">
            <tr className="text-[10px] font-medium text-gray-500 dark:text-gray-500 uppercase tracking-wider text-left">
              <th className={`${th} w-24`} onClick={() => handleSort('LENGTH')}>
                Length{renderSortIcon('LENGTH', sortColumn, sortDirection)}
              </th>
              <th className="p-3">Formula</th>
              <th className="p-3">Equation</th>
              <th className="p-3 w-44">Result</th>
              <th className="p-3 w-24">Status</th>
              <th className={`${th} w-28`} onClick={() => handleSort('REL_ERR')}>
                Rel. Error{renderSortIcon('REL_ERR', sortColumn, sortDirection)}
              </th>
              <th className={`${th} w-24`} onClick={() => handleSort('CR')}>
                CR{renderSortIcon('CR', sortColumn, sortDirection)}
              </th>
              <th className="p-3 w-40">RPN</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-[#2a2a2e]">
            {shown.map(r => {
              const id = rowKey(r);
              const isBest = id === bestKey;
              const rpnText = `${r.lhs} = ${r.rhs}`;
              return (
                <tr key={id} className={`text-sm hover:bg-gray-50 dark:hover:bg-[#111113] ${
                  isBest ? 'bg-amber-100 dark:bg-amber-900/30 border-l-4 border-amber-500'
                    : r.status === 'MATCH' ? 'bg-green-50/50 dark:bg-green-900/10' : ''
                }`}>
                  <td className="p-3 font-mono font-medium text-gray-900 dark:text-white">
                    {r.total} <span className="text-xs font-normal text-gray-400">({r.a}+{r.b})</span>
                  </td>
                  <td className="p-3 overflow-x-auto overflow-y-hidden">
                    <a href={createWolframLink(r.explicit ? rpnToMathematica(r.explicit) : equationWolframQuery(r))}
                       target="_blank" rel="noopener noreferrer"
                       className="text-gray-900 dark:text-white hover:text-[#0066cc]" title="Open in Wolfram Alpha">
                      <Latex formula={formulaLatex(r)} />
                    </a>
                  </td>
                  <td className="p-3 overflow-x-auto overflow-y-hidden text-gray-600 dark:text-gray-400">
                    {showsEquation(r) ? (
                      <a href={createWolframLink(equationWolframQuery(r))} target="_blank" rel="noopener noreferrer"
                         className="hover:text-[#0066cc]" title="Open in Wolfram Alpha">
                        <Latex formula={equationLatex(r)} />
                      </a>
                    ) : <span className="text-gray-400">—</span>}
                  </td>
                  <td className="p-3 font-mono text-xs text-gray-600 dark:text-gray-400 truncate" title={formatValue(r.value)}>
                    {formatValue(r.value)}
                  </td>
                  <td className="p-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${r.status === 'MATCH'
                      ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                      : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'}`}>
                      {r.status === 'MATCH' ? 'MATCH' : 'CLOSEST'}
                    </span>
                  </td>
                  <td className="p-3 font-mono text-xs text-gray-600 dark:text-gray-400">{r.err.toExponential(2)}</td>
                  <td className={`p-3 font-mono text-xs ${isBest ? 'text-amber-700 dark:text-amber-400 font-bold' : 'text-gray-600 dark:text-gray-400'}`}>
                    {r.cr.toFixed(2)}{isBest && ' (best)'}
                  </td>
                  <td className="p-3">
                    <button type="button" onClick={() => copy(id, rpnText)} className="group flex w-full items-center gap-2 text-left" title={`${rpnText} | click to copy`}>
                      <span className="min-w-0 flex-1 truncate font-mono text-xs text-gray-500">{rpnText}</span>
                      <span className={`shrink-0 text-[10px] font-semibold uppercase ${copied === id ? 'text-green-600' : 'text-[#0066cc] opacity-0 group-hover:opacity-100'}`}>
                        {copied === id ? 'Copied' : 'Copy'}
                      </span>
                    </button>
                  </td>
                </tr>
              );
            })}
            {shown.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-gray-500 dark:text-gray-500">No matching results found</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
