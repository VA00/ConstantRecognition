// Search-time estimate shown under the complexity slider.
//
// The number of formulas is exact (estimateWork in taskQueue.ts). The time
// is formulas / (threads x per-thread rate). The per-thread rate is measured
// from the user's own completed searches (evaluations reported by the engine
// divided by wall time and worker count) and remembered in localStorage;
// before the first measurement a conservative default is used. The search
// stops at the first exact match, so the time is an upper bound.

export type RateDomain = 'real' | 'complex';

export interface ThroughputRecord {
  real?: number;      // formulas per second per thread
  complex?: number;
}

// Conservative per-thread WASM rates for unknown hardware. A 2024 laptop
// core does roughly 2x these; measured values replace them after one search.
export const DEFAULT_RATE_PER_THREAD: Record<RateDomain, number> = {
  real: 4e7,
  complex: 1.5e7,
};

const STORAGE_KEY = 'constant-recognizer.throughput.v1';

export function loadThroughput(): ThroughputRecord {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    if (!raw) return {};
    const parsed = JSON.parse(raw) as ThroughputRecord;
    const ok = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v > 0;
    return { real: ok(parsed.real) ? parsed.real : undefined, complex: ok(parsed.complex) ? parsed.complex : undefined };
  } catch {
    return {};
  }
}

export function saveThroughput(record: ThroughputRecord): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  } catch {
    // storage unavailable: estimates simply stay session-local
  }
}

// A measurement is trusted only when it is long enough to average out worker
// start-up and message overhead.
export const MIN_MEASURE_SECONDS = 2;
export const MIN_MEASURE_EVALUATIONS = 5e7;

export function measureRate(evaluations: number, seconds: number, threads: number): number | null {
  if (!(seconds >= MIN_MEASURE_SECONDS) || !(evaluations >= MIN_MEASURE_EVALUATIONS) || threads < 1) return null;
  return evaluations / seconds / threads;
}

export function estimateSeconds(
  formulas: number, threads: number, domain: RateDomain, measured: ThroughputRecord
): { seconds: number; measured: boolean } {
  const rate = measured[domain];
  const perThread = rate ?? DEFAULT_RATE_PER_THREAD[domain];
  return { seconds: formulas / (Math.max(1, threads) * perThread), measured: rate !== undefined };
}

// "< 1 s", "~12 s", "~3 min", "~2.5 h", "~4 days"
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return '?';
  if (seconds < 1) return '< 1 s';
  if (seconds < 60) return `~${Math.round(seconds)} s`;
  if (seconds < 3600) return `~${Math.round(seconds / 60)} min`;
  if (seconds < 86400) {
    const h = seconds / 3600;
    return `~${h < 10 ? h.toFixed(1) : Math.round(h)} h`;
  }
  const d = seconds / 86400;
  return `~${d < 10 ? d.toFixed(1) : Math.round(d)} days`;
}
