'use client';

import { SearchResult, Filters } from '../lib/types';
import { rpnToMathematica, createWolframLink, rpnToLatex } from '../lib/rpn';
import { Latex } from './Latex';

interface ResultsTableProps {
  results: SearchResult[];
  filters: Filters;
  setFilters: (filters: Filters) => void;
  sortColumn: 'K' | 'REL_ERR' | null;
  setSortColumn: (column: 'K' | 'REL_ERR' | null) => void;
  sortDirection: 'asc' | 'desc';
  setSortDirection: (direction: 'asc' | 'desc') => void;
  currentPage: number;
  setCurrentPage: (page: number) => void;
  itemsPerPage: number;
}

export function ResultsTable({
  results,
  filters,
  setFilters,
  sortColumn,
  setSortColumn,
  sortDirection,
  setSortDirection,
  currentPage,
  setCurrentPage,
  itemsPerPage
}: ResultsTableProps) {
  // Filter and sort logic
  const filteredAndSortedResults = results
    .filter(r => {
      if (!filters.showSin && r.RPN.includes('SIN')) return false;
      if (!filters.showCos && r.RPN.includes('COS')) return false;
      if (!filters.showExp && r.RPN.includes('EXP')) return false;
      if (!filters.showLn && r.RPN.includes('LOG')) return false;
      if (!filters.showSqrt && r.RPN.includes('SQRT')) return false;
      if (filters.kFilter !== null && r.K !== filters.kFilter) return false;
      return true;
    })
    .sort((a, b) => {
      if (!sortColumn) return 0;
      const aVal = a[sortColumn];
      const bVal = b[sortColumn];
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
      }
      return 0;
    });

  const totalPages = Math.ceil(filteredAndSortedResults.length / itemsPerPage);
  const paginatedResults = filteredAndSortedResults.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  const handleSort = (column: 'K' | 'REL_ERR') => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
  };

  const SortIcon = ({ column }: { column: 'K' | 'REL_ERR' }) => {
    if (sortColumn !== column) {
      return <span className="text-gray-400 ml-1">↕</span>;
    }
    return <span className="text-[#0066cc] ml-1">{sortDirection === 'asc' ? '↑' : '↓'}</span>;
  };

  // Get unique K values from results for the filter dropdown
  const uniqueKValues = [...new Set(results.map(r => r.K))].sort((a, b) => a - b);

  return (
    <div className="flex-1 overflow-hidden flex flex-col bg-white dark:bg-[#1a1a1d] w-full max-w-full">
      
      
      {/* Filters */}
      <div className="p-3 sm:p-4 border-b border-gray-200 dark:border-[#2a2a2e] bg-white dark:bg-[#1a1a1d] flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-2 overflow-hidden">
        <div className="flex items-center gap-2 sm:gap-4 flex-wrap">
          <span className="text-xs text-gray-500 dark:text-gray-500 font-medium">Filter:</span>
          {[
            { key: 'showSin', label: 'sin' },
            { key: 'showCos', label: 'cos' },
            { key: 'showExp', label: 'exp' },
            { key: 'showLn', label: 'ln' },
            { key: 'showSqrt', label: '√' }
          ].map(f => (
            <label key={f.key} className="flex items-center gap-1 text-xs text-gray-600 dark:text-gray-400 cursor-pointer">
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
        <div className="text-xs text-gray-500 dark:text-gray-500">
          Showing {filteredAndSortedResults.length} of {results.length} results
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto bg-white dark:bg-[#1a1a1d] max-w-full">
        <table className="w-full table-fixed">
          <thead className="bg-gray-50 dark:bg-[#111113] sticky top-0">
            <tr className="text-[10px] font-medium text-gray-500 dark:text-gray-500 uppercase tracking-wider text-left">
              <th className="p-3">CPU ID</th>
              <th 
                className="p-3 cursor-pointer hover:text-[#0066cc] select-none"
                onClick={() => handleSort('K')}
              >
                Komplexity<SortIcon column="K" />
              </th>
              <th className="p-3">Formula</th>
              <th className="p-3">Numeric result</th>
              <th className="p-3">Status</th>
              <th 
                className="p-3 cursor-pointer hover:text-[#0066cc] select-none"
                onClick={() => handleSort('REL_ERR')}
              >
                Relative error<SortIcon column="REL_ERR" />
              </th>
              <th className="p-3">Compression ratio</th>
              <th className="p-3">RPN code</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-[#2a2a2e]">
            {paginatedResults.map((r, i) => {
              // Calculate compression ratio if not provided by WASM
              // Formula: -log10(REL_ERR) / K / log10(36)
              // This measures how many "base-36 digits" of precision per symbol in RPN code
              const calcCompressionRatio = () => {
                if (r.compressionRatio !== undefined && r.compressionRatio !== null) {
                  return r.compressionRatio.toFixed(2);
                }
                if (typeof r.REL_ERR === 'number' && r.K > 0) {
                  let numerator;
                  if (r.REL_ERR === 0){
                    numerator = 16.0;
                  }else {
                    numerator = -Math.log10(r.REL_ERR);
                  }
                  const ratio = numerator / r.K / Math.log10(36);
                  return ratio.toFixed(2);
                }
                return '-';
              };
              
              return (
              <tr key={i} className="hover:bg-gray-50 dark:hover:bg-[#111113] text-sm">
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
                <td className="p-3 font-mono text-gray-600 dark:text-gray-400 truncate max-w-[150px]" title={r.result}>{r.result}</td>
                <td className="p-3">
                  <span className={`px-2 py-1 rounded text-xs font-medium ${
                    r.status === 'FINISHED' ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' :
                    r.status === 'RUNNING' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' :
                    r.status === 'ABORTED' ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200' :
                    'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200'
                  }`}>
                    {r.status || 'K_BEST'}
                  </span>
                </td>
                <td className="p-3 font-mono text-gray-600 dark:text-gray-400">{typeof r.REL_ERR === 'number' ? r.REL_ERR.toExponential(2) : r.REL_ERR}</td>
                <td className="p-3 font-mono text-gray-600 dark:text-gray-400">{calcCompressionRatio()}</td>
                <td className="p-3 font-mono text-xs text-gray-500 dark:text-gray-500 max-w-[200px] truncate" title={r.RPN}>{r.RPN}</td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="p-3 sm:p-4 border-t border-gray-200 dark:border-[#2a2a2e] bg-white dark:bg-[#1a1a1d] flex items-center justify-center gap-1 sm:gap-2 flex-wrap">
          <button
            onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
            disabled={currentPage === 1}
            className="px-3 py-1 text-sm text-gray-600 dark:text-gray-400 hover:text-[#0066cc] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            ← Prev
          </button>
          {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
            const page = currentPage <= 3 ? i + 1 : currentPage + i - 2;
            if (page > totalPages) return null;
            return (
              <button
                key={page}
                onClick={() => setCurrentPage(page)}
                className={`px-3 py-1 text-sm rounded ${
                  currentPage === page
                    ? 'bg-[#0066cc] text-white'
                    : 'text-gray-600 dark:text-gray-400 hover:text-[#0066cc]'
                }`}
              >
                {page}
              </button>
            );
          })}
          <button
            onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
            disabled={currentPage === totalPages}
            className="px-3 py-1 text-sm text-gray-600 dark:text-gray-400 hover:text-[#0066cc] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
