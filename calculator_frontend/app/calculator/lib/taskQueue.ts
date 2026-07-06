// Dynamic load balancing: task queue for the WASM search workers.
//
// The WASM engine partitions each level K (RPN codes of length K) into
// `ncpus` contiguous chunks of ternary-structure space [0, 3^K) and computes
// chunk `cpuId`. Work per chunk varies by orders of magnitude: valid RPN
// codes occupy only one third of that range, and the leaf count of a single
// structure (13^c * 18^u * 5^b index combinations) differs wildly between
// structures. A static one-chunk-per-worker split therefore leaves most
// workers idle while one or two lag ("last worker" problem).
//
// Instead, each level is over-decomposed into many small slices and workers
// pull them from a queue as they finish ("bag of tasks"). The slider-selected
// thread count still controls how many workers run simultaneously; it no
// longer dictates how the search space is divided.
//
// Two refinements keep the tail short:
//
// 1. Chain splitting. The single heaviest structure of every level is the
//    pure-unary chain  c, f1, f2, ..., f(K-1)  with 13*18^(K-1) leaves
//    (~19% of the whole level) — one ternary index, unsplittable via
//    (cpuId, ncpus). But it has exactly ONE constant slot, so thirteen
//    search_RPN_custom calls restricted to a single constant each tile it
//    exactly: 13 * 18^(K-1) becomes 13 tasks of 18^(K-1).
//
// 2. Heavy-first ordering (LPT scheduling). Within a level, tasks are sorted
//    by exact leaf weight, so big slices start while there is still plenty
//    of other work to run alongside them.

export interface SearchTask {
  minK: number;      // MinCodeLength passed to WASM for this slice
  maxK: number;      // MaxCodeLength passed to WASM for this slice
  taskId: number;    // passed to WASM as cpuId  (slice index within level)
  taskCount: number; // passed to WASM as ncpus  (total slices of this level)
  weight: number;    // exact leaf count of this slice (for ordering/debug)
  // When set, the worker calls search_RPN_custom with these exact lists
  // instead of the full-calculator entry point. NOTE: the C parser treats an
  // empty string as "zero ops", so all three must be complete lists.
  constList?: string;
  funcList?: string;
  opList?: string;
}

// CALC4 instruction set — names must match CALC4.h exactly.
export const CALC4_CONSTS = [
  'PI', 'EULER', 'NEG', 'GOLDENRATIO', 'ONE', 'TWO', 'THREE', 'FOUR',
  'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE'
];
export const CALC4_FUNCS = [
  'LOG', 'EXP', 'INV', 'GAMMA', 'SQRT', 'SQR', 'SIN', 'ARCSIN', 'COS',
  'ARCCOS', 'TAN', 'ARCTAN', 'SINH', 'ARCSINH', 'COSH', 'ARCCOSH',
  'TANH', 'ARCTANH'
];
export const CALC4_OPS = ['PLUS', 'TIMES', 'SUBTRACT', 'DIVIDE', 'POWER'];

const N_CONST = CALC4_CONSTS.length;   // 13
const N_UNARY = CALC4_FUNCS.length;    // 18
const N_BINARY = CALC4_OPS.length;     // 5

// Levels 1..BUNDLE_MAX_K are enumerated in a single task: together they
// contain at most 3+9+27+81 = 120 ternary structures, far less work than one
// slice of a deep level, so splitting them would be pure overhead.
export const BUNDLE_MAX_K = 4;

// Split the pure-unary chain into 13 single-constant tasks from this level
// up. Below it the chain is small enough to stay inside a normal slice.
export const CHAIN_SPLIT_MIN_K = 6;

// Exact leaf count of ternary structure k at level K (0 if syntactically
// invalid). Structure digits are big-endian: token 0 = most significant,
// matching int_to_ternary() in vsearch_RPN_core.c.
export function structureWeight(k: number, K: number): number {
  const digits = new Array(K);
  for (let i = K - 1; i >= 0; i--) {
    digits[i] = k % 3;
    k = Math.floor(k / 3);
  }
  let stack = 0, c = 0, u = 0, b = 0;
  for (const d of digits) {
    if (d === 0) { stack++; c++; }
    else if (d === 1) { if (stack < 1) return 0; u++; }
    else { if (stack < 2) return 0; stack--; b++; }
  }
  if (stack !== 1) return 0;
  return Math.pow(N_CONST, c) * Math.pow(N_UNARY, u) * Math.pow(N_BINARY, b);
}

// Ternary index of the pure-unary chain (digits 0,1,1,...,1 big-endian):
// k = sum_{i=0}^{K-2} 3^i = (3^(K-1) - 1) / 2
export function chainIndex(K: number): number {
  return (Math.pow(3, K - 1) - 1) / 2;
}

export function buildTaskQueue(searchDepth: number): SearchTask[] {
  const tasks: SearchTask[] = [];
  const bundleMax = Math.min(BUNDLE_MAX_K, searchDepth);
  tasks.push({ minK: 1, maxK: bundleMax, taskId: 0, taskCount: 1, weight: 0 });

  // Valid structures are sparse (Motzkin numbers: 21 of 3^5, 51 of 3^7,
  // 323 of 3^9), so every valid structure simply becomes its own task:
  // ncpus = 3^K makes the WASM chunk exactly one structure. Task counts
  // stay tiny (~340 calls at depth 9) while no task can hide a cluster of
  // heavy structures the way fixed-size ranges did.
  for (let K = bundleMax + 1; K <= searchDepth; K++) {
    const N = Math.pow(3, K);
    const splitChain = K >= CHAIN_SPLIT_MIN_K;
    const chain = chainIndex(K);
    const level: SearchTask[] = [];

    for (let k = 0; k < N; k++) {
      const w = structureWeight(k, K);
      if (w === 0) continue; // syntactically invalid, nothing to search
      if (splitChain && k === chain) {
        // 13 single-constant tasks that exactly tile the chain structure
        const perConst = Math.pow(N_UNARY, K - 1);
        for (const name of CALC4_CONSTS) {
          level.push({
            minK: K, maxK: K, taskId: chain, taskCount: N, weight: perConst,
            constList: name,
            funcList: CALC4_FUNCS.join(','),
            opList: CALC4_OPS.join(',')
          });
        }
      } else {
        level.push({ minK: K, maxK: K, taskId: k, taskCount: N, weight: w });
      }
    }

    // Heavy-first (LPT): start the big structures while other work remains
    level.sort((a, b) => b.weight - a.weight);
    tasks.push(...level);
  }
  return tasks;
}

// Filters redundant rows when merging results from many small tasks.
// Each task reports its own local-best progression, so most rows repeat
// information already shown. Keep a row only if it improves on the best
// error seen so far for its K, or ties it with a formula not yet listed.
export function createResultFilter() {
  const bestByK = new Map<number, { err: number; rpns: Set<string> }>();
  return (K: number, relErr: number, rpn: string): boolean => {
    const err = Number.isFinite(relErr) ? relErr : Infinity;
    const entry = bestByK.get(K);
    if (!entry || err < entry.err) {
      bestByK.set(K, { err, rpns: new Set([rpn]) });
      return true;
    }
    if (err === entry.err && !entry.rpns.has(rpn)) {
      entry.rpns.add(rpn);
      return true;
    }
    return false;
  };
}
