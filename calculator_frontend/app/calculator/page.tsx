'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { SearchResult, Filters, Precision, ActiveWorker, defaultFilters, ErrorMode, ComputeMode, RecognitionTarget, Domain, CalculatorMode } from './lib/types';
import { CalculatorId, DEFAULT_CALCULATOR_ID } from './lib/calculators';
import { extractPrecision, evaluateRPN } from './lib/rpn';
import { buildTaskQueue, createResultFilter, SearchTask } from './lib/taskQueue';
import { useWebGPU } from './hooks/useWebGPU';
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
  const [precision, setPrecision] = useState<Precision>({});
  const [activeWorkers, setActiveWorkers] = useState<ActiveWorker[]>([]);
  const [taskProgress, setTaskProgress] = useState<{ done: number; total: number } | null>(null);
  const [sortColumn, setSortColumn] = useState<'K' | 'REL_ERR' | 'CR' | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [searchFinished, setSearchFinished] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [isMobile, setIsMobile] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [errorMode, setErrorMode] = useState<ErrorMode>('automatic');
  const [manualError, setManualError] = useState('');
  const [computeMode, setComputeMode] = useState<ComputeMode>('cpu');
  const [selectedCalculatorId, setSelectedCalculatorId] = useState<CalculatorId>(DEFAULT_CALCULATOR_ID);
  const [earlyExitCRThreshold, setEarlyExitCRThreshold] = useState(0.9);
  const [lastSearchExact, setLastSearchExact] = useState(false);
  const [recognitionTarget, setRecognitionTarget] = useState<RecognitionTarget>('constant');
  const [domain, setDomain] = useState<Domain>('real');
  const [calculatorMode, setCalculatorMode] = useState<CalculatorMode>('standard');
  
  const workersRef = useRef<Worker[]>([]);
  const isAbortedRef = useRef(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const startTimeRef = useRef<number>(0);
  const resolveAllRef = useRef<(() => void) | null>(null);
  const searchEndedRef = useRef(false);

  const {
    gpuAvailable,
    gpuInfo,
    search: searchGPU,
    abort: abortGPU
  } = useWebGPU();
  const gpuName = gpuInfo?.name;
  
  // Helper to calculate compression ratio
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
  
  // Best result = MAXIMUM Compression Ratio (CR) - this is the correct identification criterion
  // CR rises initially as accuracy improves, then falls when overfitting starts
  // The maximum CR indicates the true match
  const bestResult = useMemo(() => {
    if (results.length === 0) return null;
    return [...results].sort((a, b) => {
      const aCR = getCompressionRatio(a);
      const bCR = getCompressionRatio(b);
      if (lastSearchExact) {
        if (a.REL_ERR !== b.REL_ERR) return a.REL_ERR - b.REL_ERR;
        return bCR - aCR;
      }
      if (aCR !== bCR) return bCR - aCR;
      return a.REL_ERR - b.REL_ERR;
    })[0];
  }, [results, lastSearchExact]);

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

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 1023px)');

    const applyLayoutMode = (matches: boolean) => {
      setIsMobile(matches);
      setSidebarCollapsed(matches);
    };

    applyLayoutMode(mediaQuery.matches);

    const handleChange = (event: MediaQueryListEvent) => {
      applyLayoutMode(event.matches);
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);


  const calculate = async () => {
    if (!inputValue) return;
    
    setIsCalculating(true);
    setResults([]);
    setSearchFinished(false);
    setTaskProgress(null);
    searchEndedRef.current = false;
    isAbortedRef.current = false;
    resolveAllRef.current = null;
    
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
    const exactSearch = deltaZNum === 0;
    setLastSearchExact(exactSearch);
    setSortColumn(exactSearch ? 'REL_ERR' : 'CR');
    setSortDirection(exactSearch ? 'asc' : 'desc');

    const shouldUseGpu =
      (computeMode === 'gpu' && gpuAvailable) ||
      (computeMode === 'auto' && gpuAvailable);

    if (shouldUseGpu) {
      setActiveWorkers([]);
      try {
        const gpuResults = await searchGPU(zNum, {
          minK: 1,
          maxK: searchDepth
        });

        const mappedResults: SearchResult[] = gpuResults.map(result => {
          let numericValue: string;
          try {
            numericValue = evaluateRPN(result.RPN).toString();
          } catch {
            numericValue = 'N/A';
          }

          return {
            cpuId: result.cpuId ?? 0,
            K: result.K,
            RPN: result.RPN,
            result: numericValue,
            REL_ERR: result.REL_ERR,
            status: result.status
          };
        });

        setResults(mappedResults);
      } catch (err) {
        console.error('GPU search failed:', err);
      } finally {
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
        setElapsedTime(Date.now() - startTimeRef.current);
        setIsCalculating(false);
        setSearchFinished(true);
      }
      return;
    }

    // CPU/WASM computation
    const effectiveThreads = autoThreads ? detectedCPUs : threadCount;

    // Terminate existing workers
    workersRef.current.forEach(w => w.terminate());
    workersRef.current = [];

    // Dynamic load balancing: the search space is over-decomposed into many
    // small slices ("bag of tasks") and idle workers pull the next slice from
    // the queue. The thread count only controls how many workers run
    // simultaneously — no worker is married to a fixed slice, so uneven work
    // distribution (heavy gamma-chain structures, E-cores, tab throttling)
    // self-balances instead of leaving one lagging worker at the end.
    const tasks = buildTaskQueue(searchDepth);
    const totalTasks = tasks.length;
    let nextTaskIndex = 0;
    let remainingTasks = totalTasks;
    let aliveWorkers = 0;
    const inFlight = new Map<number, SearchTask>();          // workerId -> running task
    const idlePool: { worker: Worker; workerId: number }[] = []; // parked workers (queue drained)
    const keepRow = createResultFilter();

    setTaskProgress({ done: 0, total: totalTasks });

    const allComplete = new Promise<void>(resolve => {
      resolveAllRef.current = resolve;
    });

    const endSearch = () => {
      if (searchEndedRef.current) return;
      searchEndedRef.current = true;
      workersRef.current.forEach(w => w.terminate());
      workersRef.current = [];
      setActiveWorkers([]);
      resolveAllRef.current?.();
    };

    const assignTask = (worker: Worker, workerId: number) => {
      if (searchEndedRef.current || isAbortedRef.current) return;
      const task = tasks[nextTaskIndex];
      if (!task) {
        // Queue drained; park this worker (it may be revived if another
        // worker dies and its task is requeued)
        inFlight.delete(workerId);
        idlePool.push({ worker, workerId });
        setActiveWorkers(prev => prev.filter(w => w.id !== workerId));
        return;
      }
      nextTaskIndex++;
      inFlight.set(workerId, task);
      setActiveWorkers(prev => {
        const running = { id: workerId, status: 'running', currentK: task.maxK };
        return prev.some(w => w.id === workerId)
          ? prev.map(w => (w.id === workerId ? { ...w, currentK: task.maxK } : w))
          : [...prev, running];
      });
      worker.postMessage({
        initDelay: 0,
        z: zNum,
        inputValue: inputValue,
        recognitionTarget: recognitionTarget,
        calculatorMode: calculatorMode,
        inputPrecision: deltaZNum,
        MinCodeLength: task.minK,
        MaxCodeLength: task.maxK,
        cpuId: task.taskId,
        ncpus: task.taskCount,
        earlyExitCRThreshold,
        workerId,
        constList: task.constList,
        funcList: task.funcList,
        opList: task.opList
      });
    };

    const onWorkerMessage = (worker: Worker, workerId: number) => (e: MessageEvent) => {
      const data = e.data;
      if (!data || data.type === 'ready') return;
      if (searchEndedRef.current || isAbortedRef.current) return;

      // Collect all results in one batch to avoid multiple re-renders.
      // Rows that don't improve on what is already shown for their K are
      // dropped — with hundreds of slices most task-local bests are redundant.
      const newResults: SearchResult[] = [];
      const rows = Array.isArray(data.results) ? data.results : [];

      rows.forEach((r: { K: number; RPN: string; result: string; REL_ERR: number; status?: string; COMPRESSION_RATIO?: number }) => {
        if (!r || typeof r.RPN !== 'string') return;
        if (!keepRow(r.K, r.REL_ERR, r.RPN)) return;
        let numericValue: string;
        try {
          numericValue = evaluateRPN(r.RPN).toString();
        } catch {
          numericValue = 'N/A';
        }
        newResults.push({
          cpuId: workerId,
          K: r.K,
          RPN: r.RPN,
          result: numericValue,
          REL_ERR: r.REL_ERR,
          status: r.result === 'INTERMEDIATE' ? 'SEARCHING' : (r.result || r.status || 'K_BEST'),
          compressionRatio: r.COMPRESSION_RATIO
        });
      });

      // Handle final result (SUCCESS/FAILURE/ABORTED) from top-level data
      const isSuccess = data.result === 'SUCCESS';
      if (data.result && data.RPN && (isSuccess || keepRow(data.K, data.REL_ERR, data.RPN))) {
        let numericValue: string;
        try {
          numericValue = evaluateRPN(data.RPN).toString();
        } catch {
          numericValue = 'N/A';
        }
        newResults.push({
          cpuId: workerId,
          K: data.K,
          RPN: data.RPN,
          result: numericValue,
          REL_ERR: data.REL_ERR,
          status: data.result, // SUCCESS, FAILURE, ABORTED
          compressionRatio: data.COMPRESSION_RATIO
        });
      }

      if (newResults.length > 0) {
        setResults(prev => [...prev, ...newResults]);
      }

      if (isSuccess) {
        endSearch();
        return;
      }

      // Task finished without a definitive match — pull the next slice
      remainingTasks--;
      setTaskProgress({ done: totalTasks - remainingTasks, total: totalTasks });
      if (remainingTasks <= 0) {
        endSearch();
        return;
      }
      assignTask(worker, workerId);
    };

    const onWorkerError = (worker: Worker, workerId: number) => (error: ErrorEvent) => {
      console.error(`Worker ${workerId} error:`, error.message || error);
      if (searchEndedRef.current || isAbortedRef.current) return;
      aliveWorkers--;
      worker.terminate();
      workersRef.current = workersRef.current.filter(w => w !== worker);
      setActiveWorkers(prev => prev.filter(w => w.id !== workerId));
      // Requeue the slice this worker was computing so nothing is skipped
      const task = inFlight.get(workerId);
      if (task) {
        inFlight.delete(workerId);
        tasks.push(task);
        const idle = idlePool.pop();
        if (idle) assignTask(idle.worker, idle.workerId);
      }
      if (aliveWorkers <= 0) {
        // Every worker died; end the search so the UI doesn't hang
        endSearch();
      }
    };

    const workerCount = Math.min(effectiveThreads, totalTasks);
    const workers: Worker[] = [];
    const initialActiveWorkers: ActiveWorker[] = [];

    for (let i = 0; i < workerCount; i++) {
      const worker = new Worker(withBasePath('/wasm/worker.js'));
      worker.onmessage = onWorkerMessage(worker, i);
      worker.onerror = onWorkerError(worker, i);
      workers.push(worker);
      initialActiveWorkers.push({ id: i, status: 'running', currentK: 1 });
    }

    aliveWorkers = workerCount;
    workersRef.current = workers;
    setActiveWorkers(initialActiveWorkers);

    // Hand each worker its first slice; afterwards they pull from the queue
    workers.forEach((worker, i) => assignTask(worker, i));

    // Wait for the task queue to drain (or SUCCESS/abort)
    await allComplete;
    
    // Stop timer
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setElapsedTime(Date.now() - startTimeRef.current);
    
    if (!isAbortedRef.current) {
      setIsCalculating(false);
      setSearchFinished(true);
    }
  };

  const handleAbort = () => {
    isAbortedRef.current = true;
    workersRef.current.forEach(w => w.terminate());
    workersRef.current = [];
    setActiveWorkers([]);
    abortGPU();
    resolveAllRef.current?.();
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
    setSortColumn(null);
    setSortDirection('asc');
    setFilters(defaultFilters);
    setLastSearchExact(false);
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
        isMobile={isMobile}
        isOpen={!sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
        errorMode={errorMode}
        setErrorMode={setErrorMode}
        manualError={manualError}
        setManualError={setManualError}
        earlyExitCRThreshold={earlyExitCRThreshold}
        setEarlyExitCRThreshold={setEarlyExitCRThreshold}
        gpuAvailable={gpuAvailable}
        gpuName={gpuName}
        computeMode={computeMode}
        setComputeMode={setComputeMode}
        selectedCalculatorId={selectedCalculatorId}
        setSelectedCalculatorId={setSelectedCalculatorId}
        recognitionTarget={recognitionTarget}
        setRecognitionTarget={setRecognitionTarget}
        domain={domain}
        setDomain={setDomain}
        calculatorMode={calculatorMode}
        setCalculatorMode={setCalculatorMode}
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
            {taskProgress && taskProgress.total > 1 && (
              <span className="font-mono text-sm opacity-75">
                chunk {taskProgress.done}/{taskProgress.total}
              </span>
            )}
            {precision.deltaZ && (
              <span className="text-sm opacity-75">(±{precision.deltaZ})</span>
            )}
          </div>
        )}

        {results.length > 0 && bestResult ? (
          <div className="flex-1 min-h-0 overflow-hidden flex flex-col bg-white dark:bg-[#1a1a1d]">
            {/* Success banner */}
            {searchFinished && !isCalculating && (
              <div className="bg-green-500 text-white py-2 px-4 text-center text-sm">
                Found {results.length} result{results.length !== 1 ? 's' : ''} in {(elapsedTime / 1000).toFixed(2)}s
              </div>
            )}
            {/* Best result card */}
            <ResultCard
              result={bestResult}
              allResults={results}
              crThreshold={earlyExitCRThreshold}
            />
            {/* Results table */}
            <ResultsTable
              results={results}
              filters={filters}
              setFilters={setFilters}
              sortColumn={sortColumn}
              setSortColumn={setSortColumn}
              sortDirection={sortDirection}
              setSortDirection={setSortDirection}
            />
          </div>
        ) : (
          <EmptyState onExampleClick={handleExampleClick} />
        )}
      </main>
    </div>
  );
}
