'use client';

// Equation search: the meet-in-the-middle engine (algorithms/methods/mitm, PHASE1_RESULTS.md) in the browser.
// Same buttons, input and uncertainty rules as the formula search (app/calculator), but the engine looks for
// equations L(x) = R. The right sides are a table that depends only on the buttons and |R|: one worker builds it
// once and keeps it, so every further number costs only its left sides (milliseconds).

import { useEffect, useMemo, useRef, useState } from 'react';
import { ErrorMode } from '../calculator/lib/types';
import { parseTargetInput, targetDelta, formatComplex } from '../calculator/lib/complex';
import { withBasePath, wasmVersionQuery } from '../calculator/lib/basePath';
import {
  getCalculatorById, DEFAULT_CALCULATOR_ID, defaultEnabledTokens, CUSTOM_INT, parseCustomInteger,
} from '../calculator/lib/calculators';
import { CALC4_CONSTS, CALC4_FUNCS, CALC4_OPS, EXTRA_CONSTS, EXTRA_FUNCS, EXTRA_OPS } from '../calculator/lib/taskQueue';
import { InputBar } from '../calculator/components/InputBar';
import { Latex } from '../calculator/components/Latex';
import { formatDuration } from '../calculator/lib/estimate';
import { MitmSidebar, TableInfo } from './components/MitmSidebar';
import { MitmResultCard, MitmResultsTable, MitmRow, buildRows } from './components/MitmResults';
import { SearchResponse, BuildResponse, estimate, UNSUPPORTED_TOKENS } from './lib/mitm';

const CALCULATOR = getCalculatorById(DEFAULT_CALCULATOR_ID);
const DEFAULT_TOKENS = defaultEnabledTokens(CALCULATOR);
const ALL_CONSTS = [...CALC4_CONSTS, ...EXTRA_CONSTS];
const ALL_FUNCS = [...CALC4_FUNCS, ...EXTRA_FUNCS];
const ALL_OPS = [...CALC4_OPS, ...EXTRA_OPS];
const EPS = 2.220446049250313e-16;
const LIST_CAP = 50;
const MEMCAP_GB = 1.5;

// Each example with the settings that find it (checked with the engine on the default buttons)
const EXAMPLES: { value: string; label: string; description: string; anyx?: boolean; kr?: number; enable?: string[] }[] = [
  { value: '1.919078092376074', label: '\\log_{10} 83', description: 'Found as 10^x = 9^2 + 2' },
  { value: '0.7390851332151607', label: '\\cos x = x', description: 'Dottie number: x any number of times', anyx: true },
  { value: '0.5671432904097838', label: 'x\\,e^{x} = 1', description: 'Omega constant: x any number of times', anyx: true },
  { value: '2.6220575542921198', label: '\\frac{\\Gamma(1/4)^2}{2\\sqrt{2\\pi}}', description: 'Lemniscate constant: needs right sides of 6 symbols and Γ; the first search builds a 0.25 GB table (several seconds), later ones reuse it', kr: 6, enable: ['GAMMA'] },
  { value: '3.14159', label: '3.14159', description: 'Six digits: searched within ± half a unit of the last digit' },
];

type Phase = { kind: 'idle' } | { kind: 'building'; start: number; seconds: number } | { kind: 'searching'; start: number };

interface Outcome {
  response: SearchResponse;
  T: number;
  relDelta: number;
  delta: number;   // the target's absolute uncertainty (0: exact)
  rows: MitmRow[];
  nR: number[];
  input: string;
}

export default function MitmPage() {
  const [inputValue, setInputValue] = useState('');
  const [enabledTokens, setEnabledTokens] = useState<string[]>(DEFAULT_TOKENS);
  const [customInt, setCustomInt] = useState('');
  const [kl, setKl] = useState(5);
  const [kr, setKr] = useState(4);   // small table at a fresh start (milliseconds); larger on request
  const [anyx, setAnyx] = useState(false);
  const [errorMode, setErrorMode] = useState<ErrorMode>('automatic');
  const [manualError, setManualError] = useState('');
  const [exactTolEps, setExactTolEps] = useState(16);
  const [isMobile, setIsMobile] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [workerReady, setWorkerReady] = useState(false);
  const [table, setTable] = useState<TableInfo | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [now, setNow] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const workerRef = useRef<Worker | null>(null);
  const pendingRef = useRef(new Map<number, (d: Record<string, unknown>) => void>());
  const nextIdRef = useRef(1);
  const tableRef = useRef<TableInfo | null>(null);

  // ------------------------------------------------------------------ worker
  // A new worker (no table yet). Called on mount and after an abort; state is reset by the caller.
  const createWorker = () => {
    workerRef.current?.terminate();
    pendingRef.current.forEach(cb => cb({ type: 'error', error: 'aborted' }));
    pendingRef.current.clear();
    tableRef.current = null;
    const w = new Worker(withBasePath('/wasm/mitm_worker.js') + wasmVersionQuery());
    w.onmessage = (e: MessageEvent) => {
      const d = e.data;
      if (d?.type === 'ready') { setWorkerReady(true); return; }
      const cb = pendingRef.current.get(d?.id);
      if (cb) { pendingRef.current.delete(d.id); cb(d); }
    };
    w.onerror = (e: ErrorEvent) => {
      pendingRef.current.forEach(cb => cb({ type: 'error', error: e.message || 'worker error' }));
      pendingRef.current.clear();
    };
    workerRef.current = w;
  };
  const restartWorker = () => {
    setTable(null);
    setWorkerReady(false);
    createWorker();
  };
  const request = (msg: Record<string, unknown>) =>
    new Promise<Record<string, unknown>>(resolve => {
      const id = nextIdRef.current++;
      pendingRef.current.set(id, resolve);
      workerRef.current?.postMessage({ ...msg, id });
    });

  useEffect(() => {
    createWorker();
    const mq = window.matchMedia('(max-width: 1023px)');
    const apply = (m: boolean) => { setIsMobile(m); setSidebarCollapsed(m); };
    apply(mq.matches);
    const onChange = (e: MediaQueryListEvent) => apply(e.matches);
    mq.addEventListener('change', onChange);
    return () => { mq.removeEventListener('change', onChange); workerRef.current?.terminate(); };
  }, []);

  useEffect(() => {
    if (phase.kind === 'idle') return;
    const t = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(t);
  }, [phase.kind]);

  // ------------------------------------------------------------------ buttons
  const toggleToken = (token: string) =>
    setEnabledTokens(prev => (prev.includes(token) ? prev.filter(t => t !== token) : [...prev, token]));
  const changeCustomInt = (text: string) => {
    setCustomInt(text);
    const usable = 'value' in parseCustomInteger(text);
    setEnabledTokens(prev => {
      if (usable) return prev.includes(CUSTOM_INT) ? prev : [...prev, CUSTOM_INT];
      return text.trim() === '' ? prev.filter(t => t !== CUSTOM_INT) : prev;
    });
  };
  const lists = useMemo(() => {
    const custom = parseCustomInteger(customInt);
    const consts = [
      ...ALL_CONSTS.filter(t => enabledTokens.includes(t) && !UNSUPPORTED_TOKENS.includes(t)),
      ...CALCULATOR.constantsInt.filter(t => enabledTokens.includes(t)),
      ...(enabledTokens.includes(CUSTOM_INT) && 'value' in custom ? [custom.value] : []),
    ];
    return { consts, funcs: ALL_FUNCS.filter(t => enabledTokens.includes(t)), ops: ALL_OPS.filter(t => enabledTokens.includes(t)) };
  }, [enabledTokens, customInt]);
  const tableKey = JSON.stringify({ ...lists, kr });
  const est = useMemo(
    () => estimate(kl, kr, lists.consts.length, lists.funcs.length, lists.ops.length),
    [kl, kr, lists]
  );
  const tableCurrent = table !== null && table.key === tableKey;

  // ------------------------------------------------------------------ target
  const target = useMemo(() => parseTargetInput(inputValue), [inputValue]);
  const parsed = target && !('error' in target) ? target : null;
  const deltaInfo = parsed ? targetDelta(parsed, errorMode, manualError) : null;
  const deltaError = deltaInfo && 'error' in deltaInfo ? deltaInfo.error : null;
  const deltaText = !deltaInfo ? null : 'error' in deltaInfo ? deltaInfo.error
    : deltaInfo.delta === 0 ? `exact (${deltaInfo.source}), tolerance ${exactTolEps} ε` : `± ${deltaInfo.delta.toExponential(2)} (${deltaInfo.source})`;
  const formulaError = target && 'error' in target ? target.error : null;
  const busy = phase.kind !== 'idle';
  const reason = formulaError ? `Formula: ${formulaError}`
    : !parsed ? 'Enter a number (1.919078092376074) or a formula (log(83)/log(10))'
    : parsed.isComplex ? 'Complex target: use the formula search'
    : deltaError ? deltaError
    : lists.consts.length === 0 ? 'Enable at least one constant'
    : est.tooBig && !tableCurrent ? 'The right-side table would be too large: shorten the right side'
    : !workerReady ? 'Loading the engine…'
    : undefined;
  const canSearch = reason === undefined;
  const hint = formulaError ? { text: `Formula: ${formulaError}`, error: true }
    : parsed && deltaText ? { text: parsed.formula ? `= ${formatComplex(parsed.re, parsed.im)} · ${deltaText}` : deltaText, error: deltaError !== null }
    : null;

  // ------------------------------------------------------------------ search
  const runSearch = async () => {
    if (!canSearch || !parsed || !deltaInfo || 'error' in deltaInfo) return;
    const T = parsed.re;
    const relDelta = T !== 0 ? deltaInfo.delta / Math.abs(T) : deltaInfo.delta;
    const tolrel = deltaInfo.delta > 0 ? Math.max(relDelta, exactTolEps * EPS) : exactTolEps * EPS;
    setError(null);
    if (!tableRef.current || tableRef.current.key !== tableKey) {
      setPhase({ kind: 'building', start: Date.now(), seconds: est.buildSeconds });
      const b = await request({ type: 'build', ...{ consts: lists.consts.join(','), funcs: lists.funcs.join(','), ops: lists.ops.join(',') }, kr, memcapGB: MEMCAP_GB }) as unknown as BuildResponse & { type: string };
      if (b.type === 'error' || !b.ok) {
        if (b.error !== 'aborted') setError(`Right-side table: ${b.error ?? 'failed'}`);
        if (b.type === 'error' && b.error !== 'aborted') restartWorker();   // the module may be broken (out of memory)
        setPhase({ kind: 'idle' });
        return;
      }
      tableRef.current = { key: tableKey, kr, sizes: b.sizes ?? [], gb: b.gb ?? 0, ms: b.ms ?? 0 };
      setTable(tableRef.current);
    }
    setPhase({ kind: 'searching', start: Date.now() });
    const r = await request({ type: 'search', T, tolrel, kl, anyx, listCap: LIST_CAP }) as unknown as SearchResponse & { type: string };
    setPhase({ kind: 'idle' });
    if (r.type === 'error' || !r.ok) {
      if (r.error !== 'aborted') setError(`Search: ${r.error ?? 'failed'}`);
      return;
    }
    const nR = tableRef.current?.sizes ?? [];
    const nL = r.nL ?? [];
    setOutcome({
      response: r, T, relDelta, delta: deltaInfo.delta, nR, input: inputValue,
      rows: buildRows(r.matches ?? [], r.approx ?? [], T, relDelta, nL, nR),
    });
  };

  const abort = () => {
    restartWorker();   // the table is lost; the next search builds it again
    setPhase({ kind: 'idle' });
  };

  const reset = () => {
    setInputValue('');
    setOutcome(null);
    setError(null);
  };

  // ------------------------------------------------------------------ view
  // the shortest match; without one, as the calculator page, the approximation of the highest compression ratio
  // (the smallest error alone would always pick the longest, most chance-like equation)
  const best = outcome?.rows.find(r => r.status === 'MATCH') ?? outcome?.rows.slice().sort((a, b) => b.cr - a.cr)[0] ?? null;
  const success = outcome?.response.status === 'SUCCESS';
  const ms = outcome?.response.ms ?? 0;
  const took = ms < 1000 ? `${Math.max(1, Math.round(ms))} ms` : `${(ms / 1000).toFixed(2)}s`;
  const elapsed = phase.kind === 'idle' ? 0 : Math.max(0, (now - phase.start) / 1000);

  return (
    <div className="flex h-screen w-screen bg-gray-50 dark:bg-[#1a1a1d] overflow-hidden">
      <MitmSidebar
        isMobile={isMobile}
        isOpen={!sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
        busy={busy}
        workerReady={workerReady}
        enabledTokens={enabledTokens}
        onToggleToken={toggleToken}
        onEnableAll={() => setEnabledTokens(DEFAULT_TOKENS)}
        customInt={customInt}
        onCustomIntChange={changeCustomInt}
        hasConstants={lists.consts.length > 0}
        kl={kl}
        setKl={setKl}
        kr={kr}
        setKr={setKr}
        anyx={anyx}
        setAnyx={setAnyx}
        est={est}
        table={table}
        tableCurrent={tableCurrent}
        errorMode={errorMode}
        setErrorMode={setErrorMode}
        manualError={manualError}
        setManualError={setManualError}
        uncertaintyNote={deltaText}
        exactTolEps={exactTolEps}
        setExactTolEps={setExactTolEps}
      />

      <main className="flex-1 flex flex-col overflow-hidden">
        <InputBar
          inputValue={inputValue}
          setInputValue={setInputValue}
          isCalculating={busy}
          canCalculate={canSearch}
          cannotCalculateReason={reason}
          hint={hint}
          onCalculate={runSearch}
          onReset={reset}
          onAbort={abort}
        />

        {busy && (
          <div className="bg-blue-500 text-white py-3 px-4 text-center flex items-center justify-center gap-4">
            <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            <span className="font-bold">
              {phase.kind === 'building' ? 'Building the right-side table (once for these buttons)…' : 'Searching equations…'}
            </span>
            <span className="font-mono">{elapsed.toFixed(1)}s</span>
            {phase.kind === 'building' && (
              <span className="text-sm opacity-75">estimated {formatDuration(phase.seconds)}</span>
            )}
          </div>
        )}

        {error && (
          <div className="bg-red-500 text-white py-2 px-4 text-center text-sm">{error}</div>
        )}

        {outcome && best ? (
          <div className="flex-1 min-h-0 overflow-hidden flex flex-col bg-white dark:bg-[#1a1a1d]">
            {success ? (
              <div className="bg-green-500 text-white py-2 px-4 text-center text-sm">
                {outcome.delta === 0 ? 'Exact equation selected' : `Equation selected within ±${outcome.delta.toExponential(2)}`}
                {' '}in {took}
              </div>
            ) : (
              <div className="bg-red-500 text-white py-2 px-4 text-center text-sm">
                Found {outcome.rows.length} approximation{outcome.rows.length !== 1 ? 's' : ''} in {took}, none within the tolerance
              </div>
            )}
            <MitmResultCard row={best} rows={outcome.rows} />
            <MitmResultsTable rows={outcome.rows} best={best} />
          </div>
        ) : !busy && (
          <div className="flex-1 flex items-center justify-center overflow-y-auto">
            <div className="text-center max-w-lg px-4 py-8">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">Equation Search</h2>
              <p className="text-sm text-gray-500 dark:text-gray-500 mb-6">
                Finds equations L(x) = R that your number satisfies, built from the calculator buttons, by meeting in
                the middle: all right sides are computed once and sorted, then every left side with x is looked up.
                With x once, each equation is solved for x and shown as an explicit formula. Real numbers only.
              </p>
              <div className="flex flex-wrap gap-2 justify-center">
                {EXAMPLES.map(ex => (
                  <button
                    key={ex.value}
                    onClick={() => {
                      setInputValue(ex.value);
                      setAnyx(ex.anyx ?? false);
                      if (ex.kr !== undefined) setKr(Math.max(kr, ex.kr));
                      const enable = ex.enable ?? [];
                      if (enable.length > 0) setEnabledTokens(prev => [...prev, ...enable.filter(t => !prev.includes(t))]);
                    }}
                    className="px-4 py-2 text-sm bg-gray-100 dark:bg-[#2a2a2e] hover:bg-gray-200 dark:hover:bg-[#3a3a3e] text-gray-700 dark:text-gray-300 rounded-lg transition-colors"
                    title={ex.description}
                  >
                    <Latex formula={ex.label} />
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
