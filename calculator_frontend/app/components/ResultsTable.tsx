import { SearchResult, Filters } from '../lib/types';
import { evaluateRPN, rpnToMathematica, createWolframLink } from '../lib/rpn';

interface ResultsTableProps {
  results: SearchResult[];
  filters: Filters;
  setFilters: (filters: Filters) => void;
  tableSearch: string;
  setTableSearch: (value: string) => void;
  showEntries: number;
  setShowEntries: (value: number) => void;
  currentPage: number;
  setCurrentPage: (value: number) => void;
  inputValue: string;
}

export default function ResultsTable({
  results,
  filters,
  setFilters,
  tableSearch,
  setTableSearch,
  showEntries,
  setShowEntries,
  currentPage,
  setCurrentPage,
  inputValue
}: ResultsTableProps) {
  if (results.length === 0) return null;

  const filterResults = (resultsToFilter: SearchResult[]) => {
    let filtered = resultsToFilter.filter(r => {
      const isSuccess = r.result === 'SUCCESS';
      const isBestSoFar = r.status === 'BEST_SO_FAR';
      const isBestForK = r.status === 'BEST_FOR_K';
      const isRunning = r.status === 'RUNNING' || r.status === 'INTERMEDIATE';
      const isAborted = r.status === 'ABORTED' || r.status === 'POINTLESS';
      
      const anyFilterActive = filters.successfullyIdentified || filters.bestSoFar || 
        filters.bestForLengthK || filters.runningIntermediate || filters.abortedPointless;
      
      if (!anyFilterActive) return true;
      
      if (filters.successfullyIdentified && isSuccess) return true;
      if (filters.bestSoFar && isBestSoFar) return true;
      if (filters.bestForLengthK && isBestForK) return true;
      if (filters.runningIntermediate && isRunning) return true;
      if (filters.abortedPointless && isAborted) return true;
      
      return false;
    });
    
    if (tableSearch) {
      const search = tableSearch.toLowerCase();
      filtered = filtered.filter(r => 
        r.RPN?.toLowerCase().includes(search) ||
        r.result?.toLowerCase().includes(search) ||
        r.status?.toLowerCase().includes(search) ||
        String(r.K).includes(search) ||
        String(r.cpuId).includes(search)
      );
    }
    
    return filtered;
  };

  const filtered = filterResults(results);
  const startIdx = (currentPage - 1) * showEntries;
  const paginated = filtered.slice(startIdx, startIdx + showEntries);

  const clearFilters = () => {
    setFilters({
      successfullyIdentified: false,
      bestSoFar: false,
      bestForLengthK: false,
      runningIntermediate: false,
      abortedPointless: false
    });
  };

  return (
    <div className="bg-white dark:bg-[#1a1a1d] rounded-lg border border-gray-200 dark:border-[#2a2a2e]">
      <div className="px-4 py-3 border-b border-gray-100 dark:border-[#2a2a2e]">
        <span className="text-sm font-medium text-gray-900 dark:text-white">Search intermediate results</span>
      </div>
      
      {/* Filters */}
      <div className="px-4 py-3 border-b border-gray-100 dark:border-[#2a2a2e] flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
          <input
            type="checkbox"
            checked={filters.successfullyIdentified}
            onChange={(e) => setFilters({...filters, successfullyIdentified: e.target.checked})}
            className="accent-[#0066cc]"
          />
          Successfully identified
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
          <input
            type="checkbox"
            checked={filters.bestSoFar}
            onChange={(e) => setFilters({...filters, bestSoFar: e.target.checked})}
            className="accent-[#0066cc]"
          />
          Best so far
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
          <input
            type="checkbox"
            checked={filters.bestForLengthK}
            onChange={(e) => setFilters({...filters, bestForLengthK: e.target.checked})}
            className="accent-[#0066cc]"
          />
          Best for length K
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
          <input
            type="checkbox"
            checked={filters.runningIntermediate}
            onChange={(e) => setFilters({...filters, runningIntermediate: e.target.checked})}
            className="accent-[#0066cc]"
          />
          Running intermediate result
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
          <input
            type="checkbox"
            checked={filters.abortedPointless}
            onChange={(e) => setFilters({...filters, abortedPointless: e.target.checked})}
            className="accent-[#0066cc]"
          />
          Aborted pointless search
        </label>
        <button
          onClick={clearFilters}
          className="px-3 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-100 dark:hover:bg-[#2a2a2e] transition-colors text-gray-700 dark:text-gray-300"
        >
          Clear Filters
        </button>
      </div>

      {/* Table controls */}
      <div className="px-4 py-3 flex items-center justify-between border-b border-gray-100 dark:border-[#2a2a2e]">
        <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
          Show
          <select
            value={showEntries}
            onChange={(e) => { setShowEntries(parseInt(e.target.value)); setCurrentPage(1); }}
            className="px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-[#111113] text-gray-900 dark:text-white"
          >
            <option value={10}>10</option>
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
          entries
        </div>
        <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
          Search:
          <input
            type="text"
            value={tableSearch}
            onChange={(e) => { setTableSearch(e.target.value); setCurrentPage(1); }}
            className="px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-[#111113] text-gray-900 dark:text-white w-48"
            placeholder="Filter results..."
          />
        </div>
      </div>
      
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 dark:bg-[#111113]">
              <th className="px-3 py-2 text-left text-[10px] font-medium text-gray-500 dark:text-gray-500 uppercase tracking-wider">CPU ID</th>
              <th className="px-3 py-2 text-left text-[10px] font-medium text-gray-500 dark:text-gray-500 uppercase tracking-wider">Komplexity</th>
              <th className="px-3 py-2 text-left text-[10px] font-medium text-gray-500 dark:text-gray-500 uppercase tracking-wider">Numeric result</th>
              <th className="px-3 py-2 text-left text-[10px] font-medium text-gray-500 dark:text-gray-500 uppercase tracking-wider">Mathematica</th>
              <th className="px-3 py-2 text-left text-[10px] font-medium text-gray-500 dark:text-gray-500 uppercase tracking-wider">Search status</th>
              <th className="px-3 py-2 text-left text-[10px] font-medium text-gray-500 dark:text-gray-500 uppercase tracking-wider">Relative error</th>
              <th className="px-3 py-2 text-left text-[10px] font-medium text-gray-500 dark:text-gray-500 uppercase tracking-wider">Compression ratio</th>
              <th className="px-3 py-2 text-left text-[10px] font-medium text-gray-500 dark:text-gray-500 uppercase tracking-wider">Hamming distance</th>
              <th className="px-3 py-2 text-left text-[10px] font-medium text-gray-500 dark:text-gray-500 uppercase tracking-wider">RPN code</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-[#2a2a2e]">
            {paginated.map((result, idx) => {
              const rpnArray = result.RPN ? result.RPN.split(', ') : [];
              const numericValue = rpnArray.length > 0 ? evaluateRPN(rpnArray) : NaN;
              const mathematica = rpnArray.length > 0 ? rpnToMathematica(rpnArray) : '-';
              const compressionRatio = result.K > 0 ? (inputValue.length / result.K).toFixed(2) : '-';
              
              return (
                <tr 
                  key={startIdx + idx}
                  className={`hover:bg-gray-50 dark:hover:bg-[#111113] ${result.result === 'SUCCESS' ? 'bg-green-50 dark:bg-green-900/10' : ''}`}
                >
                  <td className="px-3 py-2 font-mono text-gray-600 dark:text-gray-400">{result.cpuId}</td>
                  <td className="px-3 py-2 font-mono font-bold text-gray-900 dark:text-white">{result.K}</td>
                  <td className="px-3 py-2 font-mono text-gray-700 dark:text-gray-300 text-xs">
                    {!isNaN(numericValue) ? numericValue.toPrecision(12) : '-'}
                  </td>
                  <td className="px-3 py-2">
                    {mathematica !== '-' ? (
                      <a 
                        href={createWolframLink(mathematica)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-xs text-[#0066cc] hover:underline"
                      >
                        {mathematica}
                      </a>
                    ) : (
                      <span className="text-gray-400">-</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium
                      ${result.result === 'SUCCESS' 
                        ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' 
                        : result.status === 'RUNNING' || result.status === 'INTERMEDIATE'
                        ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'
                        : result.status === 'ABORTED' || result.status === 'POINTLESS'
                        ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'}`}>
                      {result.result || result.status || 'SEARCHING'}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-gray-500 dark:text-gray-500">{result.REL_ERR || '-'}</td>
                  <td className="px-3 py-2 font-mono text-xs text-gray-500 dark:text-gray-500">{compressionRatio}</td>
                  <td className="px-3 py-2 font-mono text-xs text-gray-500 dark:text-gray-500">{result.HAMMING_DISTANCE ?? '-'}</td>
                  <td className="px-3 py-2 font-mono text-xs text-gray-500 dark:text-gray-500 max-w-[200px] truncate" title={result.RPN}>{result.RPN || '-'}</td>
                </tr>
              );
            })}
            {paginated.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-gray-500 dark:text-gray-500">
                  No matching records found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      
      {/* Pagination */}
      <div className="px-4 py-3 border-t border-gray-100 dark:border-[#2a2a2e] flex items-center justify-between text-sm text-gray-600 dark:text-gray-400">
        <div>
          {(() => {
            const start = filtered.length > 0 ? (currentPage - 1) * showEntries + 1 : 0;
            const end = Math.min(currentPage * showEntries, filtered.length);
            return `Showing ${start} to ${end} of ${filtered.length} entries${filtered.length !== results.length ? ` (filtered from ${results.length} total entries)` : ''}`;
          })()}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
            disabled={currentPage === 1}
            className="px-3 py-1 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-100 dark:hover:bg-[#2a2a2e] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Previous
          </button>
          <button
            onClick={() => setCurrentPage(currentPage + 1)}
            disabled={currentPage * showEntries >= filtered.length}
            className="px-3 py-1 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-100 dark:hover:bg-[#2a2a2e] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
