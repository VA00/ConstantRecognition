'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Latex } from '../calculator/components/Latex';
import { ThroughputRecord, loadThroughput, saveThroughput, measureRate, formatDuration } from '../calculator/lib/estimate';
import {
  GameState, Removal, RemovalTask, newGame, removeButton, undo, isWon, isLocked, isRemoved,
  removalTask, identityOf, buttonLatex, EML_BUTTONS, START_BUTTONS,
} from './lib/game';
import { DepthPlan, planDepth, nextLevel, DEFAULT_BUDGET_SECONDS } from './lib/depth';
import { SearchPool } from './lib/searchPool';
import { Keypad, KEY_LABELS } from './components/Keypad';
import { RemovalLog } from './components/RemovalLog';
import { ResultOverlay, OverlayContent } from './components/ResultOverlay';

type Phase =
  | { kind: 'idle'; note?: string }
  | { kind: 'searching'; task: RemovalTask; plan: DepthPlan; done: number; total: number }
  | { kind: 'found'; removal: Removal; seconds: number }
  | { kind: 'notfound'; task: RemovalTask; plan: DepthPlan; seconds: number; deeper: DepthPlan }
  | { kind: 'error'; message: string };

// "1:23.4"
function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds - 60 * m;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`;
}

// "2.1·10⁹"
function formatCount(n: number): string {
  if (n < 1e4) return Math.round(n).toString();
  const e = Math.floor(Math.log10(n));
  const m = n / Math.pow(10, e);
  const sup = String(e).replace(/\d/g, d => '⁰¹²³⁴⁵⁶⁷⁸⁹'[Number(d)]);
  return `${m.toFixed(1)}·10${sup}`;
}

export default function GamePage() {
  const [game, setGame] = useState<GameState>(() => newGame('easy'));
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [selected, setSelected] = useState<string | null>(null);   // identity shown from the log
  const [elapsed, setElapsed] = useState(0);
  const [threads, setThreads] = useState(4);
  const [maxThreads, setMaxThreads] = useState(8);
  const [throughput, setThroughput] = useState<ThroughputRecord>({});
  const [budget, setBudget] = useState(DEFAULT_BUDGET_SECONDS);
  // Game clock: starts at the first attempt, stops at the win (undo resumes it)
  const [clock, setClock] = useState<{ start: number | null; end: number | null }>({ start: null, end: null });
  const [now, setNow] = useState(0);
  // Small screens: the result pops up over the keypad until tapped away
  const [overlayDismissed, setOverlayDismissed] = useState(false);

  const poolRef = useRef<SearchPool | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const cpus = navigator.hardwareConcurrency || 4;
    setThreads(cpus);
    setMaxThreads(cpus);
    setThroughput(loadThroughput());
    poolRef.current = new SearchPool(cpus);
    return () => {
      poolRef.current?.dispose();
      poolRef.current = null;
    };
  }, []);

  const searching = phase.kind === 'searching';
  const won = isWon(game);

  useEffect(() => {
    if (clock.start === null || clock.end !== null) return;
    const id = setInterval(() => setNow(performance.now()), 100);
    return () => clearInterval(id);
  }, [clock]);
  useEffect(() => {
    if (clock.start === null) return;
    if (won && clock.end === null) setClock(c => ({ ...c, end: performance.now() }));
    if (!won && clock.end !== null) setClock(c => ({ ...c, end: null }));
  }, [won, clock]);
  const clockSeconds = clock.start === null ? 0 : ((clock.end ?? now) - clock.start) / 1000;

  // Every new phase shows the overlay again; a hit fades after a moment
  useEffect(() => {
    setOverlayDismissed(false);
    if (phase.kind !== 'found') return;
    const id = setTimeout(() => setOverlayDismissed(true), 3000);
    return () => clearTimeout(id);
  }, [phase]);
  const removedCount = START_BUTTONS.length - game.remaining.length;

  const startTimer = () => {
    const t0 = performance.now();
    setElapsed(0);
    timerRef.current = setInterval(() => setElapsed((performance.now() - t0) / 1000), 100);
  };
  const stopTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  };

  // Run one search (levels plan.minK..plan.maxK) for a removal task
  const runSearch = useCallback(async (task: RemovalTask, plan: DepthPlan) => {
    const pool = poolRef.current;
    if (!pool || pool.running) return;
    setSelected(null);
    setPhase({ kind: 'searching', task, plan, done: 0, total: 0 });
    startTimer();
    try {
      const target = await pool.evaluate(task.targetRpn);
      if (!target.ok || !target.finite) {
        throw new Error(`The engine cannot evaluate ${task.targetRpn}`);
      }
      const outcome = await pool.search({
        re: target.re, im: target.im, selection: task.selection,
        minK: plan.minK, maxK: plan.maxK,
        onProgress: (done, total) => setPhase(p => p.kind === 'searching' ? { ...p, done, total } : p),
      });
      stopTimer();
      if (outcome.aborted) {
        setPhase({ kind: 'idle', note: 'Search stopped.' });
        return;
      }
      const rate = measureRate(outcome.evaluations, outcome.seconds, outcome.workers);
      if (rate !== null) {
        setThroughput(prev => {
          const next = { ...prev, complex: rate };
          saveThroughput(next);
          return next;
        });
      }
      if (outcome.hit) {
        const removal: Removal = { button: task.button, rpn: outcome.hit.rpn, K: outcome.hit.K };
        setGame(g => removeButton(g, removal));
        setPhase({ kind: 'found', removal, seconds: outcome.seconds });
      } else {
        const deeper = nextLevel(plan, task.selection, threads, throughput);
        setPhase({ kind: 'notfound', task, plan, seconds: outcome.seconds, deeper });
      }
    } catch (err) {
      stopTimer();
      setPhase({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }, [threads, throughput]);

  const handlePress = (button: string) => {
    if (isRemoved(game, button)) {
      setSelected(button);
      return;
    }
    if (searching) return;
    if (isLocked(game, button)) {
      setPhase({ kind: 'idle', note: 'Goal button: 1, Exp, Log and − are locked in easy mode.' });
      return;
    }
    const task = removalTask(game, button);
    const plan = planDepth(task.selection, threads, throughput, budget);
    if (clock.start === null) {
      const t = performance.now();
      setClock({ start: t, end: null });
      setNow(t);
    }
    void runSearch(task, plan);
  };

  const handleDeeper = () => {
    if (phase.kind !== 'notfound') return;
    void runSearch(phase.task, phase.deeper);
  };

  const handleAbort = () => poolRef.current?.abort();

  const handleUndo = () => {
    if (searching) return;
    setGame(g => undo(g));
    setPhase({ kind: 'idle' });
    setSelected(null);
  };

  const handleRestart = () => {
    poolRef.current?.abort();
    stopTimer();
    setGame(newGame('easy'));
    setPhase({ kind: 'idle' });
    setSelected(null);
    setClock({ start: null, end: null });
  };

  const selectedRemoval = useMemo(
    () => (selected ? game.history.find(r => r.button === selected) ?? null : null),
    [selected, game.history]
  );

  // Identity to show large: the log selection, else the last hit
  const shownRemoval = selectedRemoval ?? (phase.kind === 'found' ? phase.removal : null);
  const shownIdentity = shownRemoval ? identityOf(shownRemoval) : null;

  // Plain-text key faces for the overlay (some faces are JSX with sub/superscripts)
  const labelText = (button: string) => {
    const plain: Record<string, string> = { POWER: 'xʸ', LOGARITHM: 'logₓy', SQR: 'x²' };
    const l = KEY_LABELS[button];
    return plain[button] ?? (typeof l === 'string' ? l : button);
  };
  let overlay: OverlayContent | null = null;
  if (!overlayDismissed) {
    if (phase.kind === 'searching') {
      overlay = { kind: 'searching', lhs: buttonLatex(phase.task.button), elapsed, maxK: phase.plan.maxK, estimate: phase.plan.seconds };
    } else if (phase.kind === 'found') {
      overlay = { kind: 'found', identity: identityOf(phase.removal), label: labelText(phase.removal.button), K: phase.removal.K };
    } else if (phase.kind === 'notfound') {
      overlay = {
        kind: 'notfound', lhs: buttonLatex(phase.task.button), maxK: phase.plan.maxK, seconds: phase.seconds,
        deeperK: phase.deeper.maxK, deeperSeconds: phase.deeper.seconds,
      };
    } else if (phase.kind === 'error') {
      overlay = { kind: 'error', message: phase.message };
    }
  }

  return (
    <div className="h-screen w-screen overflow-y-auto bg-gray-50 text-gray-900 dark:bg-[#1a1a1d] dark:text-gray-100">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-4 py-3 dark:border-[#2a2a2e]">
        <div>
          <h1 className="text-lg font-semibold">EML calculator reduction game</h1>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Remove a button when the remaining ones can express it. Goal: <span className="font-mono">1, EML (Exp, −, Log)</span>
          </p>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="font-mono">
            {game.remaining.length} / {START_BUTTONS.length} buttons
          </span>
          <button type="button" onClick={handleUndo} disabled={searching || game.history.length === 0}
            className="rounded-md border border-gray-300 px-3 py-1 hover:bg-white disabled:opacity-40 dark:border-[#333] dark:hover:bg-[#222]">
            Undo
          </button>
          <button type="button" onClick={handleRestart}
            className="rounded-md border border-gray-300 px-3 py-1 hover:bg-white dark:border-[#333] dark:hover:bg-[#222]">
            Restart
          </button>
          <span className="font-mono tabular-nums" title="Total time: searching and thinking, from the first attempt">
            ⏱ {formatClock(clockSeconds)}
          </span>
        </div>
      </header>

      {/* progress 38 -> 4 */}
      <div className="h-1 w-full bg-gray-200 dark:bg-[#2a2a2e]">
        <div className="h-1 bg-[#0066cc] transition-all"
          style={{ width: `${(100 * removedCount) / (START_BUTTONS.length - EML_BUTTONS.length)}%` }} />
      </div>

      <main className="mx-auto grid max-w-6xl gap-4 p-3 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <section className="flex justify-center">
          <Keypad state={game} busy={phase.kind === 'searching' ? phase.task.button : null}
            disabled={searching} onPress={handlePress} />
        </section>

        <section className="space-y-4">
          {/* status card */}
          <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-[#2a2a2e] dark:bg-[#111113]">
            {won && (
              <div className="mb-3 rounded-md bg-emerald-500 px-3 py-2 text-white">
                Reduced to EML: <span className="font-mono">1, Exp, −, Log</span>.
                Total time <span className="font-mono">{formatClock(clockSeconds)}</span>.
              </div>
            )}

            {phase.kind === 'idle' && (
              <p className="text-sm text-gray-600 dark:text-gray-300">
                {phase.note ?? (won ? 'Every other button was expressed with these four.' : 'Click a button to try to remove it.')}
              </p>
            )}

            {phase.kind === 'searching' && (
              <div className="space-y-2">
                <div className="flex items-center gap-3">
                  <svg className="h-5 w-5 animate-spin text-[#0066cc]" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  <span>
                    Searching for <Latex formula={buttonLatex(phase.task.button)} /> with{' '}
                    {phase.task.selection.consts.length + phase.task.selection.funcs.length + phase.task.selection.ops.length} buttons
                  </span>
                  <span className="ml-auto font-mono">{elapsed.toFixed(1)} s</span>
                  <button type="button" onClick={handleAbort}
                    className="rounded-md border border-red-300 px-2 py-0.5 text-xs text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40">
                    Stop
                  </button>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  K = {phase.plan.minK === phase.plan.maxK ? phase.plan.maxK : `${phase.plan.minK}…${phase.plan.maxK}`},{' '}
                  {formatCount(phase.plan.formulas)} formulas, estimated {formatDuration(phase.plan.seconds)} at most
                  {phase.total > 1 && <> · chunk {phase.done}/{phase.total}</>}
                </p>
              </div>
            )}

            {phase.kind === 'found' && !selectedRemoval && (
              <p className="text-sm text-gray-600 dark:text-gray-300">
                Removed <span className="font-mono">{KEY_LABELS[phase.removal.button] ?? phase.removal.button}</span>{' '}
                in {phase.seconds.toFixed(2)} s (K = {phase.removal.K}).
              </p>
            )}

            {phase.kind === 'notfound' && (
              <div className="space-y-2 text-sm">
                <p>
                  No formula for <Latex formula={buttonLatex(phase.task.button)} /> up to K = {phase.plan.maxK}{' '}
                  ({formatCount(phase.plan.formulas)} formulas, {phase.seconds.toFixed(1)} s). The button stays.
                </p>
                <button type="button" onClick={handleDeeper}
                  className="rounded-md bg-[#0066cc] px-3 py-1 text-white hover:bg-[#0052a3]">
                  Search deeper: K = {phase.deeper.maxK}, {formatCount(phase.deeper.formulas)} formulas,
                  {' '}{formatDuration(phase.deeper.seconds)}
                </button>
              </div>
            )}

            {phase.kind === 'error' && (
              <p className="text-sm text-red-600">{phase.message}</p>
            )}

            {shownIdentity && shownRemoval && (
              <div className="mt-3 overflow-x-auto rounded-md bg-gray-50 p-4 dark:bg-[#1a1a1d]">
                <div className="text-2xl">
                  <Latex formula={`${shownIdentity.lhs} = ${shownIdentity.rhs}`} />
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-3 font-mono text-[11px] text-gray-500 dark:text-gray-400">
                  <span>{shownIdentity.mathematica}</span>
                  <span>RPN: {shownRemoval.rpn}</span>
                </div>
              </div>
            )}
          </div>

          {/* removal sequence */}
          <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-[#2a2a2e] dark:bg-[#111113]">
            <h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-gray-500">Sequence</h2>
            <RemovalLog history={game.history} selected={selected} onSelect={setSelected} />
          </div>

          {/* settings */}
          <details className="rounded-xl border border-gray-200 bg-white p-4 text-sm dark:border-[#2a2a2e] dark:bg-[#111113]">
            <summary className="cursor-pointer text-xs font-medium uppercase tracking-wider text-gray-500">Settings</summary>
            <div className="mt-3 space-y-3">
              <label className="flex items-center gap-3">
                <span className="w-40">Time budget per attempt</span>
                <input type="range" min={5} max={120} step={5} value={budget} disabled={searching}
                  onChange={e => setBudget(Number(e.target.value))} className="flex-1" />
                <span className="w-14 text-right font-mono">{budget} s</span>
              </label>
              <label className="flex items-center gap-3">
                <span className="w-40">Threads</span>
                <input type="range" min={1} max={maxThreads} value={threads} disabled={searching}
                  onChange={e => { setThreads(Number(e.target.value)); poolRef.current?.dispose(); poolRef.current = new SearchPool(Number(e.target.value)); }}
                  className="flex-1" />
                <span className="w-14 text-right font-mono">{threads}</span>
              </label>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Measured rate: {throughput.complex ? `${formatCount(throughput.complex)} formulas/s per thread` : 'not yet measured (conservative default)'}.
                Depth is chosen so the estimated time stays within the budget; exact match only (relative error ≤ 64 ε).
                {' '}Functions are searched at the witness x = G (Catalan, 0.9159…), operators at x = G, y = γ (EulerGamma, 0.5772…).
              </p>
            </div>
          </details>
        </section>
      </main>

      {overlay && (
        <ResultOverlay
          content={overlay}
          onClose={() => setOverlayDismissed(true)}
          onAbort={handleAbort}
          onDeeper={handleDeeper}
        />
      )}
    </div>
  );
}
