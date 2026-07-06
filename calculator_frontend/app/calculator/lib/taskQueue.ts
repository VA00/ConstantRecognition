// Dynamic load balancing: task queue for the WASM search workers.
//
// The WASM engine partitions each level K (RPN codes of length K) into
// `ncpus` contiguous chunks of ternary-structure space [0, 3^K) and computes
// chunk `cpuId`. Work per chunk varies by orders of magnitude: valid RPN
// codes occupy only one third of that range, and the leaf count of a single
// structure (nc^c * nu^u * nb^b index combinations) differs wildly between
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
//    pure-unary chain  c, f1, f2, ..., f(K-1)  with nc*nu^(K-1) leaves
//    (~19% of the whole level for full CALC4) — one ternary index,
//    unsplittable via (cpuId, ncpus). But it has exactly ONE constant slot,
//    so nc search_RPN_custom calls restricted to a single constant each tile
//    it exactly: nc * nu^(K-1) becomes nc tasks of nu^(K-1).
//
// 2. Heavy-first ordering (LPT scheduling). Within a level, tasks are sorted
//    by exact leaf weight, so big slices start while there is still plenty
//    of other work to run alongside them.
//
// The queue also supports a user-restricted calculator (button palette):
// pass the enabled subsets and every task carries explicit const/func/op
// lists for search_RPN_custom, with weights computed from the subset sizes.

export interface SearchTask {
  minK: number;      // MinCodeLength passed to WASM for this slice
  maxK: number;      // MaxCodeLength passed to WASM for this slice
  taskId: number;    // passed to WASM as cpuId  (slice index within level)
  taskCount: number; // passed to WASM as ncpus  (total slices of this level)
  weight: number;    // exact leaf count of this slice (for ordering/debug)
  // When set, the worker calls search_RPN_custom with these exact lists
  // instead of the full-calculator entry point. NOTE: the C parser treats an
  // empty string as "zero ops", which matches "user disabled all of them" —
  // but a missing (undefined) field must only occur when ALL are undefined
  // (full-CALC4 path).
  constList?: string;
  funcList?: string;
  opList?: string;
}

// Enabled button subsets, in canonical CALC4 order.
export interface CalculatorSelection {
  consts: string[];
  funcs: string[];
  ops: string[];
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

export const FULL_CALCULATOR: CalculatorSelection = {
  consts: CALC4_CONSTS,
  funcs: CALC4_FUNCS,
  ops: CALC4_OPS,
};

export function isFullCalculator(calc: CalculatorSelection): boolean {
  return calc.consts.length === CALC4_CONSTS.length &&
         calc.funcs.length === CALC4_FUNCS.length &&
         calc.ops.length === CALC4_OPS.length;
}

// Levels 1..BUNDLE_MAX_K are enumerated in a single task: together they
// contain at most 3+9+27+81 = 120 ternary structures, far less work than one
// slice of a deep level, so splitting them would be pure overhead.
export const BUNDLE_MAX_K = 4;

// Split the pure-unary chain into single-constant tasks from this level up.
// Below it the chain is small enough to stay a normal task.
export const CHAIN_SPLIT_MIN_K = 6;

// Exact leaf count of ternary structure k at level K (0 if syntactically
// invalid) for a calculator with nc constants, nu unary functions and nb
// binary operators. Structure digits are big-endian: token 0 = most
// significant, matching int_to_ternary() in vsearch_RPN_core.c.
export function structureWeight(
  k: number, K: number,
  nc: number = CALC4_CONSTS.length,
  nu: number = CALC4_FUNCS.length,
  nb: number = CALC4_OPS.length
): number {
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
  return Math.pow(nc, c) * Math.pow(nu, u) * Math.pow(nb, b);
}

// Ternary index of the pure-unary chain (digits 0,1,1,...,1 big-endian):
// k = sum_{i=0}^{K-2} 3^i = (3^(K-1) - 1) / 2
export function chainIndex(K: number): number {
  return (Math.pow(3, K - 1) - 1) / 2;
}

export function buildTaskQueue(
  searchDepth: number,
  calc: CalculatorSelection = FULL_CALCULATOR
): SearchTask[] {
  const nc = calc.consts.length;
  const nu = calc.funcs.length;
  const nb = calc.ops.length;
  if (nc === 0) return []; // no constants -> no valid formulas at all

  // Full CALC4 runs through the default entry point (search_RPN_with_cr),
  // which honors the user's CR slider; restricted calculators go through
  // search_RPN_custom and need explicit lists on every task.
  const restricted = !isFullCalculator(calc);
  const lists = restricted
    ? {
        constList: calc.consts.join(','),
        funcList: calc.funcs.join(','),
        opList: calc.ops.join(','),
      }
    : {};

  const tasks: SearchTask[] = [];
  const bundleMax = Math.min(BUNDLE_MAX_K, searchDepth);
  tasks.push({ minK: 1, maxK: bundleMax, taskId: 0, taskCount: 1, weight: 0, ...lists });

  // Valid structures are sparse (Motzkin numbers: 21 of 3^5, 51 of 3^7,
  // 323 of 3^9), so every valid structure simply becomes its own task:
  // ncpus = 3^K makes the WASM chunk exactly one structure. Task counts
  // stay tiny (~340 calls at depth 9) while no task can hide a cluster of
  // heavy structures the way fixed-size ranges did.
  for (let K = bundleMax + 1; K <= searchDepth; K++) {
    const N = Math.pow(3, K);
    // Splitting needs >=2 constants to matter and >=1 unary to exist
    const splitChain = K >= CHAIN_SPLIT_MIN_K && nc >= 2 && nu >= 1;
    const chain = chainIndex(K);
    const level: SearchTask[] = [];

    for (let k = 0; k < N; k++) {
      const w = structureWeight(k, K, nc, nu, nb);
      if (w === 0) continue; // invalid or unreachable with this button set
      if (splitChain && k === chain) {
        // Single-constant tasks that exactly tile the chain structure
        const perConst = Math.pow(nu, K - 1);
        for (const name of calc.consts) {
          level.push({
            minK: K, maxK: K, taskId: chain, taskCount: N, weight: perConst,
            constList: name,
            funcList: calc.funcs.join(','),
            opList: calc.ops.join(','),
          });
        }
      } else {
        level.push({ minK: K, maxK: K, taskId: k, taskCount: N, weight: w, ...lists });
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
