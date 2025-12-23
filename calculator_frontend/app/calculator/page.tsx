'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { SearchResult, Filters, Precision, ActiveWorker, defaultFilters, ErrorMode } from './lib/types';
import { extractPrecision, evaluateRPN } from './lib/rpn';
import { Sidebar, InputBar, ResultCard, ResultsTable, EmptyState } from './components';

// Ensures that all worker/WASM fetches include the configured base path (if any).
// - Trailing slashes are removed so "//" never appears in URLs.
// - A leading "/" is added when needed so a value like "~user/app" becomes "/~user/app".
// - In the browser we return an absolute URL using window.location.origin; on the server we
//   return a path that Next.js can understand during static export.
const withBasePath = (path: string) => {
  const base = process.env.NEXT_PUBLIC_BASE_PATH?.replace(/\/+$/g, '') ?? '';
  const normalizedBase = base ? (base.startsWith('/') ? base : `/${base}`) : '';
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  if (typeof window === 'undefined') return `${normalizedBase}${normalizedPath}`;
  return new URL(`${normalizedBase}${normalizedPath}`, window.location.origin).toString();
};


export default function CalculatorPage() {
  const [inputValue, setInputValue] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [wasmLoaded, setWasmLoaded] = useState(false);
  const [isCalculating, setIsCalculating] = useState(false);
  const [searchDepth, setSearchDepth] = useState(7);
  const [threadCount, setThreadCount] = useState(4);
  const [autoThreads, setAutoThreads] = useState(true);
  const [detectedCPUs, setDetectedCPUs] = useState(4);
  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [currentPage, setCurrentPage] = useState(1);
  const [precision, setPrecision] = useState<Precision>({});
  const [activeWorkers, setActiveWorkers] = useState<ActiveWorker[]>([]);
  const [sortColumn, setSortColumn] = useState<'K' | 'REL_ERR' | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [searchFinished, setSearchFinished] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [errorMode, setErrorMode] = useState<ErrorMode>('automatic');
  const [manualError, setManualError] = useState('');
  const itemsPerPage = 20;
  
  const workersRef = useRef<Worker[]>([]);
  const isAbortedRef = useRef(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const startTimeRef = useRef<number>(0);
  
  // Best result = lowest REL_ERR from final results only (not intermediate K_BEST)
  const bestResult = useMemo(() => {
    const finalResults = results.filter(r => r.status === 'SUCCESS' || r.status === 'FAILURE' || r.status === 'ABORTED');
    if (finalResults.length === 0) return null;
    return [...finalResults].sort((a, b) => a.REL_ERR - b.REL_ERR)[0];
  }, [results]);

  // Check for WASM support and detect CPUs
  useEffect(() => {
    const checkWasm = async () => {
      try {
        //const response = await fetch('/wasm/rpn_function.wasm');
        //const response = await fetch(withBasePath('/wasm/rpn_function.wasm'));
        const response = await fetch(withBasePath('/wasm/vsearch.wasm'));
        setWasmLoaded(response.ok);
      } catch {
        setWasmLoaded(false);
      }
    };
    checkWasm();
    
    const cpus = navigator.hardwareConcurrency || 4;
    setDetectedCPUs(cpus);
    setThreadCount(cpus);
  }, []);


  const handleWorkerMessage = (cpuId: number, e: MessageEvent, onComplete?: () => void) => {
    const data = e.data;
    
    // Skip ready message
    if (data.type === 'ready') return;
    
    // Collect all results in one batch to avoid multiple re-renders
    const newResults: SearchResult[] = [];
    
    // Worker completed with results array
    if (data.results && Array.isArray(data.results)) {
      data.results.forEach((r: { K: number; RPN: string; result: string; REL_ERR: number; status?: string; cpuId?: number; COMPRESSION_RATIO?: number }) => {
        // Calculate numeric value from RPN
        let numericValue: string;
        try {
          numericValue = evaluateRPN(r.RPN).toString();
        } catch {
          numericValue = 'N/A';
        }
        
        newResults.push({
          cpuId: r.cpuId || data.cpuId || cpuId,
          K: r.K,
          RPN: r.RPN,
          result: numericValue,
          REL_ERR: r.REL_ERR,
          status: r.result === 'INTERMEDIATE' ? 'SEARCHING' : (r.result || r.status || 'K_BEST'),
          compressionRatio: r.COMPRESSION_RATIO
        });
      });
      
      // Handle final result (SUCCESS/FAILURE/ABORTED) from top-level data
      if (data.result && data.RPN) {
        let numericValue: string;
        try {
          numericValue = evaluateRPN(data.RPN).toString();
        } catch {
          numericValue = 'N/A';
        }
        
        newResults.push({
          cpuId: data.cpuId || cpuId,
          K: data.K,
          RPN: data.RPN,
          result: numericValue,
          REL_ERR: data.REL_ERR,
          status: data.result, // SUCCESS, FAILURE, ABORTED
          compressionRatio: data.COMPRESSION_RATIO
        });
      }
      
      // Update state once with all results from this worker
      if (newResults.length > 0) {
        setResults(prev => [...prev, ...newResults]);
      }
      
      // Worker finished
      setActiveWorkers(prev => prev.filter(w => w.id !== cpuId));
      
      // Notify completion
      if (onComplete) onComplete();
    }
  };

  const handleWorkerError = (cpuId: number, error: ErrorEvent) => {
    console.error(`Worker ${cpuId} error:`, error.message || error);
    setActiveWorkers(prev => prev.filter(w => w.id !== cpuId));
    setIsCalculating(false);
  };

  const calculate = async () => {
    if (!inputValue) return;
    
    setIsCalculating(true);
    setResults([]);
    setCurrentPage(1);
    setSearchFinished(false);
    isAbortedRef.current = false;
    
    // Start timer (update every 500ms to reduce re-renders)
    setElapsedTime(0);
    startTimeRef.current = Date.now();
    timerRef.current = setInterval(() => {
      setElapsedTime(Date.now() - startTimeRef.current);
    }, 500);
    
    // Calculate precision based on error mode
    let deltaZNum: number;
    const zNum = parseFloat(inputValue);
    
    if (errorMode === 'zero') {
      deltaZNum = 0;
    } else if (errorMode === 'manual' && manualError) {
      deltaZNum = parseFloat(manualError) || 0;
    } else {
      // automatic mode - use extractPrecision
      const autoPrecision = extractPrecision(inputValue);
      deltaZNum = parseFloat(autoPrecision.deltaZ || '0.5');
    }
    
    // Update precision display
    const relDeltaZ = zNum !== 0 ? deltaZNum / Math.abs(zNum) : 0;
    setPrecision({
      z: inputValue,
      deltaZ: deltaZNum === 0 ? '0' : deltaZNum.toExponential(2),
      relDeltaZ: relDeltaZ === 0 ? '0' : relDeltaZ.toExponential(2)
    });

    // CPU/WASM computation
    const effectiveThreads = autoThreads ? detectedCPUs : threadCount;
    
    // Terminate existing workers
    workersRef.current.forEach(w => w.terminate());
    workersRef.current = [];
    
    // Create new workers with completion tracking
    const workers: Worker[] = [];
    const initialActiveWorkers: ActiveWorker[] = [];
    let completedCount = 0;
    let resolveAll: () => void;
    const allComplete = new Promise<void>(resolve => { resolveAll = resolve; });
    
    for (let i = 0; i < effectiveThreads; i++) {
      //const worker = new Worker('/wasm/worker.js');
      const worker = new Worker(withBasePath('/wasm/worker.js'));
      const cpuId = i + 1;
      
      const onComplete = () => {
        completedCount++;
        if (completedCount >= effectiveThreads) {
          resolveAll();
        }
      };
      
      worker.onmessage = (e) => handleWorkerMessage(cpuId, e, onComplete);
      worker.onerror = (e) => handleWorkerError(cpuId, e);
      
      workers.push(worker);
      initialActiveWorkers.push({ id: cpuId, status: 'running', currentK: 1 });
    }
    
    workersRef.current = workers;
    setActiveWorkers(initialActiveWorkers);
    
    // Start computation on each worker
    workers.forEach((worker, i) => {
      worker.postMessage({
        initDelay: 0,
        z: parseFloat(inputValue),
        inputPrecision: deltaZNum,
        MinCodeLength: 1,
        MaxCodeLength: searchDepth,
        cpuId: i + 1,
        ncpus: effectiveThreads
      });
    });
    
    // Wait for all workers to complete
    await allComplete;
    
    // Stop timer
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setElapsedTime(Date.now() - startTimeRef.current);
    
    setIsCalculating(false);
    setSearchFinished(true);
  };

  const handleAbort = () => {
    isAbortedRef.current = true;
    workersRef.current.forEach(w => w.terminate());
    workersRef.current = [];
    setActiveWorkers([]);
    // Stop timer
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setElapsedTime(Date.now() - startTimeRef.current);
    setIsCalculating(false);
  };

  const handleReset = () => {
    handleAbort();
    setInputValue('');
    setResults([]);
    setPrecision({});
    setCurrentPage(1);
    setSortColumn(null);
    setSortDirection('asc');
    setFilters(defaultFilters);
    setSearchFinished(false);
    setElapsedTime(0);
  };

  const handleExampleClick = (value: string) => {
    setInputValue(value);
  };

  return (
    <div className="flex h-screen w-screen bg-gray-50 dark:bg-[#1a1a1d] overflow-hidden">
      {/* Sidebar */}
      <Sidebar
        wasmLoaded={wasmLoaded}
        detectedCPUs={detectedCPUs}
        searchDepth={searchDepth}
        setSearchDepth={setSearchDepth}
        threadCount={threadCount}
        setThreadCount={setThreadCount}
        autoThreads={autoThreads}
        setAutoThreads={setAutoThreads}
        precision={precision}
        activeWorkers={activeWorkers}
        isCalculating={isCalculating}
        onAbort={handleAbort}
        onReset={handleReset}
        isOpen={!sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
        errorMode={errorMode}
        setErrorMode={setErrorMode}
        manualError={manualError}
        setManualError={setManualError}
      />

      {/* Main content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        <InputBar
          inputValue={inputValue}
          setInputValue={setInputValue}
          isCalculating={isCalculating}
          onCalculate={calculate}
          onReset={handleReset}
          onAbort={handleAbort}
        />

        {/* Search Status */}
        {isCalculating && (
          <div className="bg-blue-500 text-white py-3 px-4 text-center flex items-center justify-center gap-4">
            <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            <span className="font-bold">Searching for formulas...</span>
            <span className="font-mono">{(elapsedTime / 1000).toFixed(1)}s</span>
            {precision.deltaZ && (
              <span className="text-sm opacity-75">(±{precision.deltaZ})</span>
            )}
          </div>
        )}

        {results.length > 0 && bestResult ? (
          <div className="flex-1 flex flex-col bg-white dark:bg-[#1a1a1d]">
            {/* Success banner */}
            {searchFinished && !isCalculating && (
              <div className="bg-green-500 text-white py-2 px-4 text-center text-sm">
                ✓ Found {results.filter(r => r.status === 'SUCCESS' || r.status === 'FAILURE' || r.status === 'ABORTED').length} formula{results.filter(r => r.status === 'SUCCESS' || r.status === 'FAILURE' || r.status === 'ABORTED').length !== 1 ? 's' : ''} in {(elapsedTime / 1000).toFixed(2)}s
              </div>
            )}
            {/* Best result card */}
            <ResultCard result={bestResult} />
            {/* Results table */}
            <ResultsTable
              results={results.filter(r => r.status === 'SUCCESS' || r.status === 'FAILURE' || r.status === 'ABORTED')}
              filters={filters}
              setFilters={setFilters}
              sortColumn={sortColumn}
              setSortColumn={setSortColumn}
              sortDirection={sortDirection}
              setSortDirection={setSortDirection}
              currentPage={currentPage}
              setCurrentPage={setCurrentPage}
              itemsPerPage={itemsPerPage}
            />
          </div>
        ) : (
          <EmptyState onExampleClick={handleExampleClick} />
        )}
      </main>
    </div>
  );
}
