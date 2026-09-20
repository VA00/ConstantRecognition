// Search depth for one removal attempt: the deepest K whose estimated time
// stays within a budget on this machine, using the same formula counts and
// measured throughput as the calculator page.

import { CalculatorSelection, estimateWork, levelWork } from '../../calculator/lib/taskQueue';
import { ThroughputRecord, estimateSeconds } from '../../calculator/lib/estimate';

export const MIN_DEPTH = 5;
export const MAX_DEPTH = 24;             // engine limit is 32; deeper than this is hours
export const DEFAULT_BUDGET_SECONDS = 20;

export interface DepthPlan {
  minK: number;
  maxK: number;
  formulas: number;   // evaluations for levels minK..maxK
  seconds: number;    // estimated, upper bound (the search stops at the first hit)
}

function rangeWork(minK: number, maxK: number, sel: CalculatorSelection): number {
  return estimateWork(maxK, sel) - (minK > 1 ? estimateWork(minK - 1, sel) : 0);
}

export function planDepth(
  sel: CalculatorSelection, threads: number, throughput: ThroughputRecord,
  budgetSeconds = DEFAULT_BUDGET_SECONDS, minK = 1
): DepthPlan {
  let maxK = Math.max(minK, MIN_DEPTH);
  while (maxK < MAX_DEPTH) {
    const next = rangeWork(minK, maxK + 1, sel);
    if (estimateSeconds(next, threads, 'complex', throughput).seconds > budgetSeconds) break;
    maxK++;
  }
  const formulas = rangeWork(minK, maxK, sel);
  return { minK, maxK, formulas, seconds: estimateSeconds(formulas, threads, 'complex', throughput).seconds };
}

// One level deeper than a previous plan ("search deeper")
export function nextLevel(prev: DepthPlan, sel: CalculatorSelection, threads: number, throughput: ThroughputRecord): DepthPlan {
  const K = Math.min(prev.maxK + 1, MAX_DEPTH);
  const formulas = levelWork(K, sel.consts.length, sel.funcs.length, sel.ops.length);
  return { minK: K, maxK: K, formulas, seconds: estimateSeconds(formulas, threads, 'complex', throughput).seconds };
}
