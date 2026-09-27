'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { SearchResult, Filters, Precision, ActiveWorker, defaultFilters, ErrorMode } from './lib/types';
import { evaluateRPN } from './lib/rpn';
import {
  Domain, parseTargetInput, targetDelta, complexAbs, formatComplex, resolveDomain
} from './lib/complex';
import {
  buildTaskQueue, createResultFilter, estimateWork, levelWork, SearchTask, CalculatorSelection, MAX_SEARCH_DEPTH,
  CALC4_CONSTS, CALC4_FUNCS, CALC4_OPS, EXTRA_CONSTS, EXTRA_FUNCS, EXTRA_OPS, COMPLEX_ONLY_CONSTS
} from './lib/taskQueue';
import { getCompressionRatio as computeCR } from './lib/cr';
import { ShortestSuccess } from './lib/shortest';
import {
  ThroughputRecord, loadThroughput, saveThroughput, measureRate, estimateSeconds, formatCount, formatDuration
} from './lib/estimate';
import { withBasePath, wasmVersionQuery } from './lib/basePath';
import {
  getCalculatorById, DEFAULT_CALCULATOR_ID, defaultEnabledTokens, CUSTOM_INT, parseCustomInteger
} from './lib/calculators';
import { Sidebar, InputBar, ResultCard, ResultsTable, EmptyState } from './components';

// Buttons enabled on load: the palette's standard set minus defaultDisabled
// (34 buttons: pi, e, the digits, 17 functions, 6 operators). -1, 0, i, Gamma,
// the sign change and the extra constants are off, so the Auto domain is the
// real line until the user enables i or types a complex target.
const DEFAULT_TOKENS = defaultEnabledTokens(getCalculatorById(DEFAULT_CALCULATOR_ID));
// Constants and operators in canonical order, extras last
const ALL_CONSTS = [...CALC4_CONSTS, ...EXTRA_CONSTS];
const ALL_FUNCS = [...CALC4_FUNCS, ...EXTRA_FUNCS];
const ALL_OPS = [...CALC4_OPS, ...EXTRA_OPS];
// Difficult integers 10..13 (numeric-literal tokens); the typed one follows them
const INT_CONSTS = getCalculatorById(DEFAULT_CALCULATOR_ID).constantsInt;

// Raw result row as emitted by the WASM engine (real or complex)
interface EngineRow {
  K: number;
  RPN: string;
  result: string;
  REL_ERR: number;
  status?: string;
  COMPRESSION_RATIO?: number;
  value_re?: number;
  value_im?: number;
}

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
  const [earlyExitCRThreshold, setEarlyExitCRThreshold] = useState(0.9);
  const [lastSearchExact, setLastSearchExact] = useState(false);
  // Number domain: auto picks complex for complex targets or when i is enabled
  const [domain, setDomain] = useState<Domain>('auto');
  // Calculator button palette: enabled button names
  const [enabledTokens, setEnabledTokens] = useState<string[]>(DEFAULT_TOKENS);
  // Text of the custom "difficult integer" button (CUSTOM_INT token)
  const [customInt, setCustomInt] = useState('');
  // Button count of the search that produced the current results (for CR)
  const [lastSearchN, setLastSearchN] = useState(DEFAULT_TOKENS.length);
  // Settings and depth of the last search, for "search deeper" (continue at K+1)
  const [lastSearch, setLastSearch] = useState<{ key: string; depth: number } | null>(null);
  // Per-thread throughput measured on this machine (persisted in localStorage)
  const [throughput, setThroughput] = useState<ThroughputRecord>({});

  const workersRef = useRef<Worker[]>([]);
  const isAbortedRef = useRef(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const startTimeRef = useRef<number>(0);
  const resolveAllRef = useRef<(() => void) | null>(null);
  const searchEndedRef = useRef(false);

  const toggleToken = (token: string) => {
    setEnabledTokens(prev =>
      prev.includes(token) ? prev.filter(t => t !== token) : [...prev, token]
    );
  };
  const enableAllTokens = () => setEnabledTokens(DEFAULT_TOKENS);
  // Typing a usable integer switches its button on, clearing the box switches it off
  const changeCustomInt = (text: string) => {
    setCustomInt(text);
    const usable = 'value' in parseCustomInteger(text);
    setEnabledTokens(prev => {
      if (usable) return prev.includes(CUSTOM_INT) ? prev : [...prev, CUSTOM_INT];
      return text.trim() === '' ? prev.filter(t => t !== CUSTOM_INT) : prev;
    });
  };

  // Target parsing (a number or a formula), its uncertainty, and the domain
  const target = useMemo(() => parseTargetInput(inputValue), [inputValue]);
  const parsedInput = target && !('error' in target) ? target : null;
  const formulaError = target && 'error' in target ? target.error : null;
  const deltaInfo = parsedInput ? targetDelta(parsedInput, errorMode, manualError) : null;
  const deltaError = deltaInfo && 'error' in deltaInfo ? deltaInfo.error : null;
  const effectiveDomain = resolveDomain(domain, parsedInput, enabledTokens);

  // Calculator restriction from the button palette (canonical order). In the
  // real domain complex-only constants (i) are silently left out. The custom
  // integer button contributes its typed number, when that is usable.
  const selection: CalculatorSelection = useMemo(() => {
    const custom = parseCustomInteger(customInt);
    const customConsts = enabledTokens.includes(CUSTOM_INT) && 'value' in custom ? [custom.value] : [];
    return {
      consts: [
        ...ALL_CONSTS.filter(t =>
          enabledTokens.includes(t) && (effectiveDomain === 'complex' || !COMPLEX_ONLY_CONSTS.includes(t))),
        ...INT_CONSTS.filter(t => enabledTokens.includes(t)),
        ...customConsts,
      ],
      funcs: ALL_FUNCS.filter(t => enabledTokens.includes(t)),
      ops: ALL_OPS.filter(t => enabledTokens.includes(t)),
    };
  }, [enabledTokens, effectiveDomain, customInt]);
  const hasConstants = selection.consts.length > 0;
  const workEstimate = useMemo(() => estimateWork(searchDepth, selection), [searchDepth, selection]);
  const effectiveThreads = autoThreads ? detectedCPUs : threadCount;
  const timeEstimate = useMemo(
    () => estimateSeconds(workEstimate, effectiveThreads, effectiveDomain, throughput),
    [workEstimate, effectiveThreads, effectiveDomain, throughput]
  );

  const canCalculate =
    parsedInput !== null && deltaError === null && hasConstants &&
    !(parsedInput.isComplex && effectiveDomain === 'real');
  const cannotCalculateReason = formulaError
    ? `Formula: ${formulaError}`
    : !parsedInput
      ? 'Enter a number (3.14, 1+2i) or a formula (2/3, asin(-1/3))'
      : deltaError
        ? deltaError
        : !hasConstants
          ? 'Enable at least one constant in the calculator palette'
          : parsedInput.isComplex && effectiveDomain === 'real'
            ? 'Complex target: switch the domain to Auto or Complex'
            : undefined;

  // Uncertainty the target gets, as text: "exact (integer)", "± 5.00e-3 (from typed digits)"
  const deltaText = !deltaInfo
    ? null
    : 'error' in deltaInfo
      ? deltaInfo.error
      : deltaInfo.delta === 0
        ? `exact (${deltaInfo.source})`
        : `± ${deltaInfo.delta.toExponential(2)} (${deltaInfo.source})`;

  // Line under the search box: what will be searched, or why it cannot be
  const inputHint: { text: string; error: boolean } | null = formulaError
    ? { text: `Formula: ${formulaError}`, error: true }
    : parsedInput && deltaText
      ? {
          text: parsedInput.formula ? `= ${formatComplex(parsedInput.re, parsedInput.im)} · ${deltaText}` : deltaText,
          error: deltaError !== null,
        }
      : null;

  const getCompressionRatio = (r: SearchResult): number => computeCR(r, lastSearchN);

  // The engine accepted a formula (as opposed to only reporting approximations)
  const searchSucceeded = useMemo(() => results.some(r => r.status === 'SUCCESS'), [results]);

  // Everything that decides what a search computes except its depth. "Search
  // deeper" continues the last search only while this is unchanged; after an
  // edit the user starts a new search instead.
  const searchKey = JSON.stringify({
    inputValue, errorMode, manualError, earlyExitCRThreshold, domain: effectiveDomain, selection,
  });
  const deeperK = lastSearch && lastSearch.key === searchKey && lastSearch.depth < MAX_SEARCH_DEPTH
    ? lastSearch.depth + 1
    : null;
  const deeperFormulas = deeperK
    ? levelWork(deeperK, selection.consts.length, selection.funcs.length, selection.ops.length)
    : 0;
  const deeperSeconds = estimateSeconds(deeperFormulas, effectiveThreads, effectiveDomain, throughput).seconds;

  // Best result = MAXIMUM Compression Ratio (CR) - this is the correct identification criterion
  // CR rises initially as accuracy improves, then falls when overfitting starts
  // The maximum CR indicates the true match
  const bestResult = useMemo(() => {
    if (results.length === 0) return null;
    // An accepted formula is the answer: the shortest SUCCESS, then the most accurate
    const successes = results.filter(r => r.status === 'SUCCESS');
    if (successes.length > 0) {
      return [...successes].sort((a, b) => (a.K - b.K) || (a.REL_ERR - b.REL_ERR))[0];
    }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results, lastSearchExact, lastSearchN]);

  // Check for WASM support and detect CPUs
  useEffect(() => {
    const checkWasm = async () => {
      try {
        const response = await fetch(withBasePath('/wasm/vsearch.wasm') + wasmVersionQuery(), { method: 'HEAD' });
        setWasmLoaded(response.ok);
      } catch {
        setWasmLoaded(false);
      }
    };
    checkWasm();
    
    const cpus = navigator.hardwareConcurrency || 4;
    setDetectedCPUs(cpus);
    setThreadCount(cpus);
    setThroughput(loadThroughput());
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


  // A new search over levels 1..searchDepth, or with continueToK the same
  // search continued by the single level continueToK: earlier results, sort
  // order and time are kept, the finished levels are not repeated.
  const runSearch = async (continueToK?: number) => {
    const input = parsedInput;
    if (!input || !canCalculate || !deltaInfo || 'error' in deltaInfo) return;
    const searchDomain = effectiveDomain;
    const depth = continueToK ?? searchDepth;
    const startK = continueToK ?? 1;
    const continuing = continueToK !== undefined;

    setIsCalculating(true);
    if (!continuing) setResults([]);
    setSearchFinished(false);
    setTaskProgress(null);
    setLastSearch({ key: searchKey, depth });
    searchEndedRef.current = false;
    isAbortedRef.current = false;
    resolveAllRef.current = null;
    
    // Start timer (update every 500ms to reduce re-renders). A continued
    // search counts on from the time already spent.
    const runStart = Date.now();
    if (!continuing) setElapsedTime(0);
    startTimeRef.current = runStart - (continuing ? elapsedTime : 0);
    timerRef.current = setInterval(() => {
      setElapsedTime(Date.now() - startTimeRef.current);
    }, 500);
    
    // Target and its uncertainty (targetDelta: the same rule the hints show)
    const zNum = input.re;
    const zIm = input.im;
    const deltaZNum = deltaInfo.delta;
    
    // Update precision display
    const zAbs = complexAbs(zNum, zIm);
    const relDeltaZ = zAbs !== 0 ? deltaZNum / zAbs : 0;
    setPrecision({
      z: inputValue,
      value: input.formula ? formatComplex(zNum, zIm) : undefined,
      deltaZ: deltaZNum === 0 ? '0' : deltaZNum.toExponential(2),
      relDeltaZ: relDeltaZ === 0 ? '0' : relDeltaZ.toExponential(2),
      domain: searchDomain,
    });
    const exactSearch = deltaZNum === 0;
    setLastSearchExact(exactSearch);
    if (!continuing) {
      setSortColumn(exactSearch ? 'REL_ERR' : 'CR');
      setSortDirection(exactSearch ? 'asc' : 'desc');
    }

    // Terminate existing workers
    workersRef.current.forEach(w => w.terminate());
    workersRef.current = [];

    setLastSearchN(selection.consts.length + selection.funcs.length + selection.ops.length);

    // Dynamic load balancing: the search space is over-decomposed into many
    // small slices ("bag of tasks") and idle workers pull the next slice from
    // the queue. The thread count only controls how many workers run
    // simultaneously — no worker is married to a fixed slice, so uneven work
    // distribution (heavy gamma-chain structures, E-cores, tab throttling)
    // self-balances instead of leaving one lagging worker at the end.
    const tasks = buildTaskQueue(depth, selection, startK);
    const totalTasks = tasks.length;
    let nextTaskIndex = 0;
    let remainingTasks = totalTasks;
    let aliveWorkers = 0;
    const inFlight = new Map<number, SearchTask>();          // workerId -> running task
    const idlePool: { worker: Worker; workerId: number }[] = []; // parked workers (queue drained)
    const keepRow = createResultFilter();
    let totalEvaluations = 0;                                 // summed over finished tasks, for the rate
    // A SUCCESS ends the search only once no shorter level is still being
    // searched (lib/shortest.ts): workers finish in any order
    const shortest = new ShortestSuccess();
    const pendingMinKs = () => [
      ...tasks.slice(nextTaskIndex).map(t => t.minK),
      ...[...inFlight.values()].map(t => t.minK),
    ];

    // The complex entry point has no "full calculator" default: lists are
    // always explicit there.
    const fullLists = {
      constList: selection.consts.join(','),
      funcList: selection.funcs.join(','),
      opList: selection.ops.join(','),
    };

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
      // Skip tasks that cannot beat a SUCCESS already found
      while (tasks[nextTaskIndex] && !shortest.needed(tasks[nextTaskIndex].minK)) {
        nextTaskIndex++;
        remainingTasks--;
      }
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
      const lists = searchDomain === 'complex'
        ? {
            constList: task.constList ?? fullLists.constList,
            funcList: task.funcList ?? fullLists.funcList,
            opList: task.opList ?? fullLists.opList,
          }
        : { constList: task.constList, funcList: task.funcList, opList: task.opList };
      worker.postMessage({
        z: zNum,
        zIm,
        domain: searchDomain,
        inputPrecision: deltaZNum,
        MinCodeLength: task.minK,
        MaxCodeLength: task.maxK,
        cpuId: task.taskId,
        ncpus: task.taskCount,
        earlyExitCRThreshold,
        workerId,
        ...lists,
      });
    };

    // Numeric value shown in the table: the engine's own value in the complex
    // domain (it may be complex), a JS re-evaluation of the RPN otherwise.
    const valueText = (r: EngineRow): string => {
      if (searchDomain === 'complex' && typeof r.value_re === 'number') {
        return formatComplex(r.value_re, r.value_im ?? 0);
      }
      try {
        return evaluateRPN(r.RPN).toString();
      } catch {
        return 'N/A';
      }
    };

    const onWorkerMessage = (worker: Worker, workerId: number) => (e: MessageEvent) => {
      const data = e.data;
      if (!data || data.type === 'ready' || data.type === 'evaluated') return;
      if (searchEndedRef.current || isAbortedRef.current) return;
      if (typeof data.evaluations === 'number') totalEvaluations += data.evaluations;
      inFlight.delete(workerId);   // this worker's task is finished

      // Collect all results in one batch to avoid multiple re-renders.
      // Rows that don't improve on what is already shown for their K are
      // dropped — with hundreds of slices most task-local bests are redundant.
      const newResults: SearchResult[] = [];
      const rows: EngineRow[] = Array.isArray(data.results) ? data.results : [];

      rows.forEach((r) => {
        if (!r || typeof r.RPN !== 'string') return;
        if (!keepRow(r.K, r.REL_ERR, r.RPN)) return;
        newResults.push({
          cpuId: workerId,
          K: r.K,
          RPN: r.RPN,
          result: valueText(r),
          REL_ERR: r.REL_ERR,
          status: r.result === 'INTERMEDIATE' ? 'SEARCHING' : (r.result || r.status || 'K_BEST'),
          compressionRatio: r.COMPRESSION_RATIO,
          valueRe: r.value_re,
          valueIm: r.value_im,
        });
      });

      // Handle final result (SUCCESS/FAILURE/ABORTED) from top-level data.
      // A SUCCESS longer than one already found is only the best of its K.
      const isSuccess = data.result === 'SUCCESS';
      const newShortest = isSuccess && shortest.offer(data.K);
      const accepted = isSuccess && data.K <= shortest.bestK;
      if (data.result && data.RPN && (isSuccess || keepRow(data.K, data.REL_ERR, data.RPN))) {
        newResults.push({
          cpuId: workerId,
          K: data.K,
          RPN: data.RPN,
          result: valueText(data),
          REL_ERR: data.REL_ERR,
          status: isSuccess && !accepted ? 'K_BEST' : data.result, // SUCCESS, FAILURE, ABORTED
          compressionRatio: data.COMPRESSION_RATIO,
          valueRe: data.value_re,
          valueIm: data.value_im,
        });
      }

      if (newResults.length > 0 || newShortest) {
        const bestK = shortest.bestK;
        setResults(prev => [
          // A shorter SUCCESS demotes the longer ones shown before it
          ...(newShortest
            ? prev.map(r => (r.status === 'SUCCESS' && r.K > bestK ? { ...r, status: 'K_BEST' } : r))
            : prev),
          ...newResults,
        ]);
      }

      remainingTasks--;
      setTaskProgress({ done: totalTasks - remainingTasks, total: totalTasks });
      // Done: a SUCCESS with nothing shorter left to search, or the queue is empty
      if (shortest.settled(pendingMinKs()) || remainingTasks <= 0) {
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
      // The query is forwarded by worker.js to vsearch.js and vsearch.wasm
      const worker = new Worker(withBasePath('/wasm/worker.js') + wasmVersionQuery());
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
    const elapsedMs = Date.now() - startTimeRef.current;
    setElapsedTime(elapsedMs);
    
    if (!isAbortedRef.current) {
      setIsCalculating(false);
      setSearchFinished(true);
      // Calibrate the time estimate with this machine's real throughput
      // (this run only: a continued search adds to an earlier elapsed time)
      const rate = measureRate(totalEvaluations, (Date.now() - runStart) / 1000, workerCount);
      if (rate !== null) {
        setThroughput(prev => {
          const next = { ...prev, [searchDomain]: rate };
          saveThroughput(next);
          return next;
        });
      }
    }
  };

  const handleAbort = () => {
    isAbortedRef.current = true;
    workersRef.current.forEach(w => w.terminate());
    workersRef.current = [];
    setActiveWorkers([]);
    resolveAllRef.current?.();
    // Stop timer
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setElapsedTime(Date.now() - startTimeRef.current);
    setIsCalculating(false);
  };

  const calculate = () => runSearch();

  // Continue a failed search by one level; the K slider follows
  const searchDeeper = () => {
    if (deeperK === null) return;
    setSearchDepth(deeperK);
    void runSearch(deeperK);
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

  const handleExampleClick = (value: string, enable: string[] = []) => {
    setInputValue(value);
    if (enable.length > 0) {
      setEnabledTokens(prev => [...prev, ...enable.filter(t => !prev.includes(t))]);
    }
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
        uncertaintyNote={deltaText}
        toleranceSearch={deltaInfo && !('error' in deltaInfo) ? deltaInfo.delta > 0 : errorMode !== 'zero'}
        earlyExitCRThreshold={earlyExitCRThreshold}
        setEarlyExitCRThreshold={setEarlyExitCRThreshold}
        enabledTokens={enabledTokens}
        onToggleToken={toggleToken}
        onEnableAll={enableAllTokens}
        customInt={customInt}
        onCustomIntChange={changeCustomInt}
        hasConstants={hasConstants}
        domain={domain}
        setDomain={setDomain}
        effectiveDomain={effectiveDomain}
        inputIsComplex={parsedInput?.isComplex ?? false}
        workEstimate={workEstimate}
        estimatedSeconds={timeEstimate.seconds}
        rateMeasured={timeEstimate.measured}
        effectiveThreads={effectiveThreads}
      />

      {/* Main content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        <InputBar
          inputValue={inputValue}
          setInputValue={setInputValue}
          isCalculating={isCalculating}
          canCalculate={canCalculate}
          cannotCalculateReason={cannotCalculateReason}
          hint={inputHint}
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
            <span className="font-bold">Searching for formulas{precision.domain === 'complex' ? ' in ℂ' : ''}...</span>
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
            {/* Outcome banner: green only when the engine accepted a formula
                (SUCCESS: exact match, or within the uncertainty with CR above
                the threshold); otherwise the rows are just the best
                approximations per K and the search failed */}
            {searchFinished && !isCalculating && (
              searchSucceeded ? (
                <div className="bg-green-500 text-white py-2 px-4 text-center text-sm">
                  {lastSearchExact
                    ? 'Exact formula selected'
                    : `Formula selected within ±${precision.deltaZ}`} in {(elapsedTime / 1000).toFixed(2)}s
                </div>
              ) : (
                <div className="bg-red-500 text-white py-2 px-4 text-sm flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
                  <span>
                    Found {results.length} approximation{results.length !== 1 ? 's' : ''} in {(elapsedTime / 1000).toFixed(2)}s,
                    none meets the selection criteria
                  </span>
                  {deeperK !== null && (
                    <button
                      type="button"
                      onClick={searchDeeper}
                      title={`Search level K = ${deeperK} only; levels up to ${deeperK - 1} are done`}
                      className="rounded-md bg-white px-3 py-1 font-medium text-red-600 hover:bg-red-50"
                    >
                      Search deeper: K = {deeperK}, {formatCount(deeperFormulas)} formulas, {formatDuration(deeperSeconds)}
                    </button>
                  )}
                </div>
              )
            )}
            {/* Best result card */}
            <ResultCard
              result={bestResult}
              allResults={results}
              crThreshold={earlyExitCRThreshold}
              instructionCount={lastSearchN}
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
              instructionCount={lastSearchN}
            />
          </div>
        ) : (
          <EmptyState onExampleClick={handleExampleClick} />
        )}
      </main>
    </div>
  );
}
