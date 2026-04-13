'use client';

import { useEffect, useRef, useState } from 'react';
import { SearchResult, Filters } from '../lib/types';
import { rpnToMathematica, createWolframLink, rpnToLatex } from '../lib/rpn';
import { copyTextToClipboard } from '../lib/clipboard';
import { Latex } from './Latex';

interface ResultsTableProps {
  results: SearchResult[];
  filters: Filters;
  setFilters: (filters: Filters) => void;
  sortColumn: 'K' | 'REL_ERR' | 'CR' | null;
  setSortColumn: (column: 'K' | 'REL_ERR' | 'CR' | null) => void;
  sortDirection: 'asc' | 'desc';
  setSortDirection: (direction: 'asc' | 'desc') => void;
}

function renderSortIcon(
  column: 'K' | 'REL_ERR' | 'CR',
  sortColumn: 'K' | 'REL_ERR' | 'CR' | null,
  sortDirection: 'asc' | 'desc'
) {
  if (sortColumn !== column) {
    return <span className="text-gray-400 ml-1">↕</span>;
  }
  return <span className="text-[#0066cc] ml-1">{sortDirection === 'asc' ? '↑' : '↓'}</span>;
}

export function ResultsTable({
  results,
  filters,
  setFilters,
  sortColumn,
  setSortColumn,
  sortDirection,
  setSortDirection,
}: ResultsTableProps) {
  const [copyFeedback, setCopyFeedback] = useState<{ id: string; state: 'copied' | 'failed' } | null>(null);
  const copyFeedbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyFeedbackTimeoutRef.current) {
        clearTimeout(copyFeedbackTimeoutRef.current);
      }
    };
  }, []);

  // Calculate compression ratio for a result
  const getCompressionRatio = (r: SearchResult): number => {
    if (typeof r.REL_ERR === 'number' && r.K > 0 && Number.isFinite(r.REL_ERR) && r.REL_ERR === 0) {
      return 16.0 / r.K / Math.log10(36);
    }
    if (r.compressionRatio !== undefined && r.compressionRatio !== null) {
      return Math.max(0, Number.isFinite(r.compressionRatio) ? r.compressionRatio : 0);
    }
    if (typeof r.REL_ERR === 'number' && r.K > 0 && Number.isFinite(r.REL_ERR) && r.REL_ERR < 1.0) {
      const numerator = r.REL_ERR === 0 ? 16.0 : -Math.log10(r.REL_ERR);
      return Math.max(0, numerator / r.K / Math.log10(36));
    }
    return 0;
  };

  const getStatusPriority = (status: string): number => {
    switch (status) {
      case 'SUCCESS':
        return 0;
      case 'SEARCHING':
      case 'RUNNING':
      case 'INTERMEDIATE':
      case 'K_BEST':
        return 1;
      case 'ABORTED':
        return 2;
      case 'FAILURE':
      default:
        return 3;
    }
  };

  // Find max CR among all results (for highlighting best match)
  const maxCR = results.length > 0 
    ? Math.max(...results.map(r => getCompressionRatio(r)))
    : 0;

  // Filter and sort logic
  const filteredAndSortedResults = results
    .filter(r => {
      // Status filters
      if (!filters.showSuccess && r.status === 'SUCCESS') return false;
      if (!filters.showFailure && (r.status === 'FAILURE' || r.status === 'INTERMEDIATE' || r.status === 'K_BEST' || r.status === 'SEARCHING' || r.status === 'RUNNING')) return false;
      if (!filters.showAborted && r.status === 'ABORTED') return false;
      
      // Max relative error filter
      if (filters.maxRelErr !== null && r.REL_ERR > filters.maxRelErr) return false;
      
      // Min CR filter
      if (filters.minCR !== null && getCompressionRatio(r) < filters.minCR) return false;
      
      // Search query filter (search in RPN)
      if (filters.searchQuery) {
        const query = filters.searchQuery.toLowerCase();
        const matchRPN = r.RPN.toLowerCase().includes(query);
        const matchResult = r.result?.toLowerCase().includes(query);
        if (!matchRPN && !matchResult) return false;
      }
      
      return true;
    })
    .sort((a, b) => {
      const statusDiff = getStatusPriority(a.status) - getStatusPriority(b.status);
      if (statusDiff !== 0) return statusDiff;
      if (!sortColumn) return 0;
      let aVal: number, bVal: number;
      if (sortColumn === 'CR') {
        aVal = getCompressionRatio(a);
        bVal = getCompressionRatio(b);
      } else {
        aVal = a[sortColumn] as number;
        bVal = b[sortColumn] as number;
      }
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        const metricDiff = sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
        if (metricDiff !== 0) return metricDiff;
        if (sortColumn === 'CR') return a.REL_ERR - b.REL_ERR;
        return getCompressionRatio(b) - getCompressionRatio(a);
      }
      return 0;
    });

  // Show all results (no pagination)

  const handleSort = (column: 'K' | 'REL_ERR' | 'CR') => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      // Default descending for CR (we want max first)
      setSortDirection(column === 'CR' ? 'desc' : 'asc');
    }
  };

  const clearFilters = () => {
    setFilters({
      maxRelErr: 1.0,
      minCR: 0.0,
      searchQuery: '',
      showSuccess: true,
      showFailure: true,
      showAborted: true,
    });
  };

  const showCopyFeedback = (id: string, state: 'copied' | 'failed') => {
    setCopyFeedback({ id, state });
    if (copyFeedbackTimeoutRef.current) {
      clearTimeout(copyFeedbackTimeoutRef.current);
    }
    copyFeedbackTimeoutRef.current = setTimeout(() => {
      setCopyFeedback(current => (current?.id === id ? null : current));
    }, 1500);
  };

  const handleCopyRpn = async (id: string, rpn: string) => {
    const copied = await copyTextToClipboard(rpn);
    showCopyFeedback(id, copied ? 'copied' : 'failed');
  };

  return (
    <div className="flex-1 min-h-0 overflow-hidden flex flex-col bg-white dark:bg-[#1a1a1d] w-full max-w-full">
      {/* Filters Row */}
      <div className="p-3 sm:p-4 border-b border-gray-200 dark:border-[#2a2a2e] bg-white dark:bg-[#1a1a1d] space-y-3">
        {/* Top row: Status filters and search */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-4 flex-wrap">
            <span className="text-xs text-gray-500 dark:text-gray-500 font-medium uppercase">Status:</span>
            {[
              { key: 'showSuccess', label: 'Success', color: 'text-green-600 dark:text-green-400' },
              { key: 'showFailure', label: 'Failure', color: 'text-gray-600 dark:text-gray-400' },
              { key: 'showAborted', label: 'Aborted', color: 'text-red-600 dark:text-red-400' }
            ].map(f => (
              <label key={f.key} className={`flex items-center gap-1.5 text-xs cursor-pointer ${f.color}`}>
                <input
                  type="checkbox"
                  checked={filters[f.key as keyof Filters] as boolean}
                  onChange={(e) => setFilters({ ...filters, [f.key]: e.target.checked })}
                  className="accent-[#0066cc]"
                />
                {f.label}
              </label>
            ))}
          </div>
          
          {/* Search input */}
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
        
        {/* Bottom row: error filter, entries, clear */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-4 flex-wrap">
            {/* Max error filter */}
            <div className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
              <span>Max Error:</span>
              <select
                value={filters.maxRelErr ?? 1.0}
                onChange={(e) => setFilters({ ...filters, maxRelErr: parseFloat(e.target.value) })}
                className="px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-[#111113] text-gray-900 dark:text-white text-xs"
              >
                <option value="1">10⁰</option>
                <option value="1e-3">10⁻³</option>
                <option value="1e-6">10⁻⁶</option>
                <option value="1e-9">10⁻⁹</option>
                <option value="1e-12">10⁻¹²</option>
                <option value="1e-15">10⁻¹⁵</option>
              </select>
            </div>

            {/* Min CR filter */}
            <div className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
              <span>Min CR:</span>
              <select
                value={filters.minCR ?? 0.0}
                onChange={(e) => setFilters({ ...filters, minCR: parseFloat(e.target.value) })}
                className="px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-[#111113] text-gray-900 dark:text-white text-xs"
              >
                <option value="0">0.0</option>
                <option value="0.5">0.5</option>
                <option value="0.7">0.7</option>
                <option value="0.8">0.8</option>
                <option value="0.9">0.9</option>
                <option value="1.0">1.0</option>
              </select>
            </div>

            {/* Clear filters button */}
            <button
              onClick={clearFilters}
              className="px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-100 dark:hover:bg-[#2a2a2e] transition-colors text-gray-600 dark:text-gray-400"
            >
              Clear
            </button>
          </div>
          
          {/* Results count */}
          <div className="text-xs text-gray-500 dark:text-gray-500">
            {filteredAndSortedResults.length === results.length 
              ? `${results.length} results`
              : `${filteredAndSortedResults.length} of ${results.length} results`
            }
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto bg-white dark:bg-[#1a1a1d] max-w-full">
        <table className="w-full table-fixed">
          <thead className="bg-gray-50 dark:bg-[#111113] sticky top-0">
            <tr className="text-[10px] font-medium text-gray-500 dark:text-gray-500 uppercase tracking-wider text-left">
              <th className="p-3 w-16">CPU</th>
              <th 
                className="p-3 w-20 cursor-pointer hover:text-[#0066cc] select-none"
                onClick={() => handleSort('K')}
              >
                K{renderSortIcon('K', sortColumn, sortDirection)}
              </th>
              <th className="p-3">Formula</th>
              <th className="p-3 w-32">Result</th>
              <th className="p-3 w-24">Status</th>
              <th 
                className="p-3 w-28 cursor-pointer hover:text-[#0066cc] select-none"
                onClick={() => handleSort('REL_ERR')}
              >
                Rel. Error{renderSortIcon('REL_ERR', sortColumn, sortDirection)}
              </th>
              <th 
                className="p-3 w-20 cursor-pointer hover:text-[#0066cc] select-none"
                onClick={() => handleSort('CR')}
              >
                CR{renderSortIcon('CR', sortColumn, sortDirection)}
              </th>
              <th className="p-3 w-40">RPN</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-[#2a2a2e]">
            {filteredAndSortedResults.map((r, i) => {
              const cr = getCompressionRatio(r);
              const isBestMatch = maxCR > 0 && Math.abs(cr - maxCR) < 0.001;
              const copyId = `${r.cpuId ?? 'cpu'}-${r.K}-${r.RPN}`;
              const copyState = copyFeedback?.id === copyId ? copyFeedback.state : null;
              return (
              <tr 
                key={i} 
                className={`hover:bg-gray-50 dark:hover:bg-[#111113] text-sm ${
                  isBestMatch 
                    ? 'bg-amber-100 dark:bg-amber-900/30 border-l-4 border-amber-500' 
                    : r.status === 'SUCCESS' 
                      ? 'bg-green-50/50 dark:bg-green-900/10' 
                      : ''
                }`}
              >
                <td className="p-3 font-mono text-gray-500 dark:text-gray-500">{r.cpuId}</td>
                <td className="p-3 font-mono font-medium text-gray-900 dark:text-white">{r.K}</td>
                <td className="p-3">
                  <a 
                    href={createWolframLink(rpnToMathematica(r.RPN))}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-gray-900 dark:text-white hover:text-[#0066cc]"
                    title="Open in Wolfram Alpha"
                  >
                    <Latex formula={rpnToLatex(r.RPN)} />
                  </a>
                </td>
                <td className="p-3 font-mono text-xs text-gray-600 dark:text-gray-400 truncate" title={r.result}>
                  {r.result}
                </td>
                <td className="p-3">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                    r.status === 'SUCCESS' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                    r.status === 'FAILURE' ? 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400' :
                    r.status === 'ABORTED' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' :
                    'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                  }`}>
                    {r.status}
                  </span>
                </td>
                <td className="p-3 font-mono text-xs text-gray-600 dark:text-gray-400">
                  {typeof r.REL_ERR === 'number' ? r.REL_ERR.toExponential(2) : r.REL_ERR}
                </td>
                <td className={`p-3 font-mono text-xs ${isBestMatch ? 'text-amber-700 dark:text-amber-400 font-bold' : 'text-gray-600 dark:text-gray-400'}`}>
                  {cr.toFixed(2)}{isBestMatch && ' (best)'}
                </td>
                <td className="p-3">
                  <button
                    type="button"
                    onClick={() => handleCopyRpn(copyId, r.RPN)}
                    className="group flex w-full items-center gap-2 text-left"
                    title={`${r.RPN} | Click to copy full RPN`}
                    aria-label={`Copy full RPN code: ${r.RPN}`}
                  >
                    <span className="min-w-0 flex-1 truncate font-mono text-xs text-gray-500 dark:text-gray-500">
                      {r.RPN}
                    </span>
                    <span
                      className={`shrink-0 text-[10px] font-semibold uppercase tracking-wide ${
                        copyState === 'copied'
                          ? 'text-green-600 dark:text-green-400 opacity-100'
                          : copyState === 'failed'
                            ? 'text-red-600 dark:text-red-400 opacity-100'
                            : 'text-[#0066cc] opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100'
                      }`}
                    >
                      {copyState === 'copied' ? 'Copied' : copyState === 'failed' ? 'Failed' : 'Copy'}
                    </span>
                  </button>
                </td>
              </tr>
            );})}
            {filteredAndSortedResults.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-gray-500 dark:text-gray-500">
                  No matching results found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Footer with results count */}
      <div className="p-3 sm:p-4 border-t border-gray-200 dark:border-[#2a2a2e] bg-white dark:bg-[#1a1a1d] text-sm">
        <div className="text-xs text-gray-500 dark:text-gray-500">
          {filteredAndSortedResults.length > 0 
            ? `Showing ${filteredAndSortedResults.length} result${filteredAndSortedResults.length !== 1 ? 's' : ''}`
            : 'No results'
          }
        </div>
      </div>
    </div>
  );
}
