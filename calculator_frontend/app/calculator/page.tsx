'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { SearchResult, Filters, Precision, ActiveWorker, defaultFilters } from './lib/types';
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
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0);
  const itemsPerPage = 20;
  
  const workersRef = useRef<Worker[]>([]);
  const isAbortedRef = useRef(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const startTimeRef = useRef<number>(0);
  
  // Best result = lowest REL_ERR
  const bestResult = useMemo(() => {
    if (results.length === 0) return null;
    return [...results].sort((a, b) => a.REL_ERR - b.REL_ERR)[0];
  }, [results]);

  // Check for WASM support and detect CPUs
  useEffect(() => {
    const checkWasm = async () => {
      try {
        //const response = await fetch('/wasm/rpn_function.wasm');
        const response = await fetch(withBasePath('/wasm/rpn_function.wasm'));
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

  // Close sidebar when clicking outside on mobile
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 1024) {
        setSidebarOpen(false);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
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
    setSidebarOpen(false); // Close sidebar on mobile when calculating
    
    // Start timer (update every 500ms to reduce re-renders)
    setElapsedTime(0);
    startTimeRef.current = Date.now();
    timerRef.current = setInterval(() => {
      setElapsedTime(Date.now() - startTimeRef.current);
    }, 500);
    
    const precisionInfo = extractPrecision(inputValue);
    setPrecision(precisionInfo);
    const deltaZNum = parseFloat(precisionInfo.deltaZ || '0.5');

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

  const toggleSidebar = () => {
    setSidebarOpen(prev => !prev);
  };

  return (
    <div className="flex h-screen w-screen max-w-full bg-gray-50 dark:bg-[#1a1a1d] overflow-hidden">
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
        isOpen={sidebarOpen}
        onToggle={toggleSidebar}
      />

      <main className="flex-1 min-w-0 flex flex-col overflow-hidden pt-14 lg:pt-0 bg-white dark:bg-[#1a1a1d]">
        <InputBar
          inputValue={inputValue}
          setInputValue={setInputValue}
          isCalculating={isCalculating}
          onCalculate={calculate}
        />

        {results.length > 0 && bestResult ? (
          <>
            {/* Timer / Search Status Banner */}
            {isCalculating ? (
              <div className="bg-blue-500 text-white py-2 sm:py-3 px-4 sm:px-6 text-center flex items-center justify-center gap-4">
                <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                <span className="text-base sm:text-lg font-bold">SEARCHING...</span>
                <span className="font-mono text-lg">{(elapsedTime / 1000).toFixed(1)}s</span>
              </div>
            ) : searchFinished && (
              <div className="bg-green-500 text-white py-2 sm:py-3 px-4 sm:px-6 text-center">
                <span className="text-base sm:text-lg font-bold">✓ SEARCH FINISHED!</span>
                <span className="ml-2 sm:ml-4 text-xs sm:text-sm opacity-90">Found {results.filter(r => r.status === 'SUCCESS' || r.status === 'FAILURE' || r.status === 'ABORTED').length} result{results.filter(r => r.status === 'SUCCESS' || r.status === 'FAILURE' || r.status === 'ABORTED').length !== 1 ? 's' : ''}</span>
                <span className="ml-2 sm:ml-4 font-mono">{(elapsedTime / 1000).toFixed(2)}s</span>
              </div>
            )}
            {/* Show best result (lowest REL_ERR) */}
            <ResultCard result={bestResult} />
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
          </>
        ) : (
          <EmptyState onExampleClick={handleExampleClick} />
        )}
      </main>
    </div>
  );
}
