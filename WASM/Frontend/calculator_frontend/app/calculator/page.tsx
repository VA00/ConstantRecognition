'use client';

import { useState, useEffect, useRef } from 'react';
import { SearchResult, Filters, Precision, ActiveWorker, defaultFilters } from './lib/types';
import { extractPrecision } from './lib/rpn';
import { Sidebar, InputBar, ResultCard, ResultsTable, EmptyState } from './components';

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
  const [sortColumn, setSortColumn] = useState<'K' | 'REL_ERR' | 'HAMMING_DISTANCE' | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const itemsPerPage = 20;
  
  const workersRef = useRef<Worker[]>([]);
  const isAbortedRef = useRef(false);

  // Check for WASM support and detect CPUs
  useEffect(() => {
    const checkWasm = async () => {
      try {
        const response = await fetch('/wasm/rpn_function.wasm');
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
    
    // Worker completed with results array
    if (data.results && Array.isArray(data.results)) {
      data.results.forEach((r: { K: number; RPN: string; result: string; REL_ERR: number; HAMMING_DISTANCE: number; status?: string; cpuId?: number }) => {
        const result: SearchResult = {
          cpuId: r.cpuId || data.cpuId || cpuId,
          K: r.K,
          RPN: r.RPN,
          result: r.result,
          REL_ERR: r.REL_ERR,
          HAMMING_DISTANCE: r.HAMMING_DISTANCE,
          status: r.status || 'K_BEST'
        };
        setResults(prev => [...prev, result]);
      });
      
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
    isAbortedRef.current = false;
    
    const precisionInfo = extractPrecision(inputValue);
    setPrecision(precisionInfo);

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
      const worker = new Worker('/wasm/worker.js');
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
      initialActiveWorkers.push({ id: cpuId, status: 'running', currentK: 2 });
    }
    
    workersRef.current = workers;
    setActiveWorkers(initialActiveWorkers);
    
    // Start computation on each worker
    const deltaZNum = parseFloat(precisionInfo.deltaZ || '0.5');
    workers.forEach((worker, i) => {
      worker.postMessage({
        initDelay: 0,
        z: parseFloat(inputValue),
        inputPrecision: deltaZNum,
        MinCodeLength: 2,
        MaxCodeLength: searchDepth,
        cpuId: i + 1,
        ncpus: effectiveThreads
      });
    });
    
    // Wait for all workers to complete
    await allComplete;
    
    setIsCalculating(false);
  };

  const handleAbort = () => {
    isAbortedRef.current = true;
    workersRef.current.forEach(w => w.terminate());
    workersRef.current = [];
    setActiveWorkers([]);
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
  };

  const handleExampleClick = (value: string) => {
    setInputValue(value);
  };

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-[#111113] overflow-hidden">
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
      />

      <main className="flex-1 flex flex-col overflow-hidden">
        <InputBar
          inputValue={inputValue}
          setInputValue={setInputValue}
          isCalculating={isCalculating}
          onCalculate={calculate}
        />

        {results.length > 0 ? (
          <>
            <ResultCard result={results[0]} />
            <ResultsTable
              results={results}
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

