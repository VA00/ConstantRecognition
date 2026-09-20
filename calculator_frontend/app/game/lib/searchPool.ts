// Persistent pool of WASM search workers for the game.
//
// Reuses public/wasm/worker.js unchanged: search tasks go through the
// calculator's task queue (bag of tasks, heavy-first), always in the complex
// domain with zero uncertainty (exact match = relative error <= 64 eps, the
// engine's own rule). Targets are computed by the engine too (evaluate
// message), so target and search share one implementation of every button.
//
// Workers stay alive between attempts. A WASM call cannot be interrupted, so
// when a search ends early (first hit, or abort) the workers still busy either
// finish their slice in the background (short searches: their late results
// are ignored and the worker is reused) or, after a long search, are
// terminated and respawned lazily.

import { withBasePath, wasmVersionQuery } from '../../calculator/lib/basePath';
import { buildTaskQueue, CalculatorSelection, SearchTask } from '../../calculator/lib/taskQueue';

export interface EvalResult {
  ok: boolean;
  finite: boolean;
  re: number;
  im: number;
}

export interface Hit {
  rpn: string;
  K: number;
  re: number;
  im: number;
}

export interface SearchParams {
  re: number;
  im: number;
  selection: CalculatorSelection;
  minK: number;
  maxK: number;
  onProgress?: (done: number, total: number) => void;
}

export interface SearchOutcome {
  hit: Hit | null;
  evaluations: number;   // summed over finished tasks (for the throughput estimate)
  seconds: number;
  aborted: boolean;
  workers: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type WorkerData = any;

interface Slot {
  worker: Worker;
  busy: boolean;
  task: SearchTask | null;
  searchId: number;   // search the current task belongs to (stale results are dropped)
}

// Busy workers of a search that lasted longer than this are terminated at
// its end instead of being left to finish their slice
const TERMINATE_AFTER_MS = 2000;

export class SearchPool {
  private readonly size: number;
  private slots: (Slot | null)[] = [];
  private evalId = 0;
  private pendingEvals = new Map<number, (r: EvalResult) => void>();
  private onSearchMessage: ((slot: number, data: WorkerData) => void) | null = null;
  private onSearchError: ((slot: number) => void) | null = null;
  private onSlotFree: ((slot: number) => void) | null = null;
  private searchSeq = 0;
  private disposed = false;

  constructor(size: number) {
    this.size = Math.max(1, size);
  }

  get running(): boolean {
    return this.onSearchMessage !== null;
  }

  private spawn(index: number): Slot {
    const worker = new Worker(withBasePath('/wasm/worker.js') + wasmVersionQuery());
    const slot: Slot = { worker, busy: false, task: null, searchId: 0 };
    worker.onmessage = (e: MessageEvent) => {
      const data = e.data;
      if (!data || data.type === 'ready') return;
      if (data.type === 'evaluated') {
        const resolve = this.pendingEvals.get(data.id);
        if (resolve) {
          this.pendingEvals.delete(data.id);
          resolve({ ok: data.ok === 1, finite: data.finite === 1, re: data.re ?? NaN, im: data.im ?? NaN });
        }
        return;
      }
      const stale = slot.searchId !== this.searchSeq;
      slot.busy = false;
      slot.task = null;
      if (stale) {
        // Late result of an earlier search: drop it, offer the worker to the
        // running search (if any)
        this.onSlotFree?.(index);
        return;
      }
      this.onSearchMessage?.(index, data);
    };
    worker.onerror = (err: ErrorEvent) => {
      console.error(`Game worker ${index} error:`, err.message || err);
      this.onSearchError?.(index);
    };
    return slot;
  }

  private ensureWorkers(): void {
    if (this.disposed) throw new Error('SearchPool disposed');
    for (let i = 0; i < this.size; i++) {
      if (!this.slots[i]) this.slots[i] = this.spawn(i);
    }
  }

  private terminate(index: number): void {
    const slot = this.slots[index];
    if (!slot) return;
    // A worker killed while still loading the engine fires an error event;
    // it is intentional, so drop its handlers before terminating
    slot.worker.onmessage = null;
    slot.worker.onerror = null;
    slot.worker.terminate();
    this.slots[index] = null;
  }

  // Value of a named RPN code in the complex domain (engine implementation)
  evaluate(rpn: string): Promise<EvalResult> {
    this.ensureWorkers();
    // Prefer an idle worker; a busy one answers after its current task
    const slot = this.slots.find(s => s && !s.busy) ?? this.slots[0]!;
    const id = ++this.evalId;
    return new Promise(resolve => {
      this.pendingEvals.set(id, resolve);
      slot.worker.postMessage({ type: 'evaluate', id, rpn });
    });
  }

  search(params: SearchParams): Promise<SearchOutcome> {
    if (this.running) throw new Error('A search is already running');
    this.ensureWorkers();
    const searchId = ++this.searchSeq;
    const { re, im, selection, minK, maxK, onProgress } = params;

    // Levels minK..maxK only: clamp the bundled shallow task and drop levels
    // below minK (used by "search deeper")
    const tasks = buildTaskQueue(maxK, selection)
      .map(t => ({ ...t, minK: Math.max(t.minK, minK) }))
      .filter(t => t.minK <= t.maxK);
    const lists = {
      constList: selection.consts.join(','),
      funcList: selection.funcs.join(','),
      opList: selection.ops.join(','),
    };
    const total = tasks.length;
    let next = 0;
    let remaining = total;
    let evaluations = 0;
    const start = performance.now();

    return new Promise<SearchOutcome>(resolve => {
      let ended = false;

      const finish = (hit: Hit | null, aborted: boolean) => {
        if (ended) return;
        ended = true;
        this.onSearchMessage = null;
        this.onSearchError = null;
        this.onSlotFree = null;
        // Workers still inside a WASM call cannot be stopped. After a short
        // search their slices are short too: let them finish (results are
        // dropped as stale). After a long one, replace them.
        if (performance.now() - start > TERMINATE_AFTER_MS) {
          this.slots.forEach((s, i) => { if (s && s.busy) this.terminate(i); });
        }
        resolve({
          hit, evaluations, aborted,
          seconds: (performance.now() - start) / 1000,
          workers: this.size,
        });
      };

      const assign = (index: number) => {
        const slot = this.slots[index];
        if (!slot || slot.busy || ended) return;   // busy = still on a stale slice
        const task = tasks[next];
        if (!task) return;
        next++;
        slot.busy = true;
        slot.task = task;
        slot.searchId = searchId;
        slot.worker.postMessage({
          z: re,
          zIm: im,
          domain: 'complex',
          inputPrecision: 0,
          MinCodeLength: task.minK,
          MaxCodeLength: task.maxK,
          cpuId: task.taskId,
          ncpus: task.taskCount,
          earlyExitCRThreshold: 0.9,   // unused with zero uncertainty
          workerId: index,
          constList: task.constList ?? lists.constList,
          funcList: task.funcList ?? lists.funcList,
          opList: task.opList ?? lists.opList,
        });
      };

      this.onSearchMessage = (index, data) => {
        if (ended) return;
        if (typeof data.evaluations === 'number') evaluations += data.evaluations;
        if (data.result === 'SUCCESS' && typeof data.RPN === 'string') {
          finish({ rpn: data.RPN, K: data.K, re: data.value_re, im: data.value_im }, false);
          return;
        }
        remaining--;
        onProgress?.(total - remaining, total);
        if (remaining <= 0) {
          finish(null, false);
          return;
        }
        assign(index);
      };

      this.onSearchError = (index) => {
        if (ended) return;
        // Requeue the slice this worker held and replace the worker
        const task = this.slots[index]?.task;
        this.terminate(index);
        if (task) tasks.push(task);
        this.slots[index] = this.spawn(index);
        assign(index);
      };

      this.onSlotFree = (index) => assign(index);
      this.abortCurrent = () => finish(null, true);

      if (total === 0) {
        finish(null, false);
        return;
      }
      for (let i = 0; i < this.size; i++) assign(i);
    });
  }

  private abortCurrent: (() => void) | null = null;

  abort(): void {
    this.abortCurrent?.();
    this.abortCurrent = null;
  }

  dispose(): void {
    this.abort();
    this.disposed = true;
    this.slots.forEach((_, i) => this.terminate(i));
    this.slots = [];
    this.pendingEvals.clear();
  }
}
