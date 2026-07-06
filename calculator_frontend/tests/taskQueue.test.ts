import { describe, it, expect } from 'vitest';
import {
  buildTaskQueue, createResultFilter, structureWeight, chainIndex,
  BUNDLE_MAX_K, CHAIN_SPLIT_MIN_K, CALC4_CONSTS, CalculatorSelection
} from '../app/calculator/lib/taskQueue';

// Replicates the chunking in vsearch_RPN_core.c (vsearch_core):
//   chunk = ceil(3^K / ncpus); start = cpu_id * chunk; end = min(start + chunk, 3^K)
function chunkRange(K: number, cpuId: number, ncpus: number): [number, number] {
  const kMax = Math.pow(3, K);
  const chunk = Math.ceil(kMax / ncpus);
  const start = cpuId * chunk;
  const end = Math.min(start + chunk, kMax);
  return [start, Math.max(start, end)];
}

describe('buildTaskQueue', () => {
  it('covers every valid structure of every level exactly once', () => {
    for (const depth of [1, 3, 4, 5, 6, 7, 9]) {
      const tasks = buildTaskQueue(depth);
      for (let K = 1; K <= depth; K++) {
        const kMax = Math.pow(3, K);
        const chain = chainIndex(K);
        const covered = new Array(kMax).fill(0);
        const chainConstNames: string[] = [];
        for (const t of tasks) {
          if (K < t.minK || K > t.maxK) continue;
          if (t.constList) {
            // single-constant chain task: covers 1/13 of the chain structure
            expect(t.taskId).toBe(chain);
            chainConstNames.push(t.constList);
            continue;
          }
          const [start, end] = chunkRange(K, t.taskId, t.taskCount);
          for (let k = start; k < end; k++) covered[k]++;
        }
        for (let k = 0; k < kMax; k++) {
          const valid = structureWeight(k, K) > 0;
          if (k === chain && K >= CHAIN_SPLIT_MIN_K && K > BUNDLE_MAX_K) {
            // chain handled exclusively by the 13 single-constant tasks
            expect(covered[k], `chain K=${K}`).toBe(0);
          } else if (valid) {
            expect(covered[k], `k=${k} K=${K} depth=${depth}`).toBe(1);
          } else {
            // invalid structures may be skipped entirely or scanned once
            expect(covered[k]).toBeLessThanOrEqual(1);
          }
        }
        if (K >= CHAIN_SPLIT_MIN_K && K > BUNDLE_MAX_K) {
          // the 13 constants tile the chain exactly: all names, no repeats
          expect(chainConstNames.sort()).toEqual([...CALC4_CONSTS].sort());
        } else {
          expect(chainConstNames.length).toBe(0);
        }
      }
    }
  });

  it('bundles shallow levels into a single task', () => {
    const tasks = buildTaskQueue(7);
    expect(tasks[0]).toMatchObject({ minK: 1, maxK: BUNDLE_MAX_K, taskId: 0, taskCount: 1 });
    for (const t of tasks.slice(1)) {
      expect(t.minK).toBe(t.maxK);
      expect(t.minK).toBeGreaterThan(BUNDLE_MAX_K);
    }
  });

  it('creates one task per valid structure (plus 13 chain sub-tasks)', () => {
    const tasks = buildTaskQueue(7);
    const level7 = tasks.filter(t => t.minK === 7);
    let validCount = 0;
    for (let k = 0; k < Math.pow(3, 7); k++) {
      if (structureWeight(k, 7) > 0) validCount++;
    }
    expect(validCount).toBe(51); // Motzkin(6)
    // chain replaced by 13 single-constant tasks: 51 - 1 + 13
    expect(level7.length).toBe(validCount - 1 + 13);
  });

  it('orders tasks within a level heaviest-first (LPT)', () => {
    const tasks = buildTaskQueue(7);
    for (const K of [5, 6, 7]) {
      const weights = tasks.filter(t => t.minK === K).map(t => t.weight);
      for (let i = 1; i < weights.length; i++) {
        expect(weights[i], `K=${K} position ${i}`).toBeLessThanOrEqual(weights[i - 1]);
      }
    }
  });

  it('splits the chain so no single task dominates a level', () => {
    const tasks = buildTaskQueue(7);
    const level7 = tasks.filter(t => t.minK === 7);
    const total = level7.reduce((s, t) => s + t.weight, 0);
    const biggest = Math.max(...level7.map(t => t.weight));
    // Without chain splitting the chain alone is ~19% of the level; after
    // splitting, the biggest atom is a one-binary structure (~3.8%)
    expect(biggest / total).toBeLessThan(0.05);
    // Chain sub-tasks carry full instruction lists (empty string = zero ops in C!)
    for (const t of level7.filter(t => t.constList)) {
      expect(t.funcList).toContain('GAMMA');
      expect(t.opList).toContain('POWER');
      expect(t.weight).toBe(Math.pow(18, 6));
    }
  });

  it('handles searchDepth below the bundle threshold', () => {
    const tasks = buildTaskQueue(2);
    expect(tasks).toMatchObject([{ minK: 1, maxK: 2, taskId: 0, taskCount: 1 }]);
  });
});

describe('buildTaskQueue with a restricted calculator (button palette)', () => {
  const subset: CalculatorSelection = {
    consts: ['PI', 'EULER', 'TWO'],
    funcs: ['LOG', 'EXP', 'SQRT'],
    ops: ['PLUS', 'TIMES'],
  };

  it('carries explicit instruction lists on every task', () => {
    const tasks = buildTaskQueue(7, subset);
    expect(tasks.length).toBeGreaterThan(1);
    for (const t of tasks) {
      expect(t.funcList).toBe('LOG,EXP,SQRT');
      expect(t.opList).toBe('PLUS,TIMES');
      // either the full subset, or a single constant on a chain sub-task
      expect(['PI,EULER,TWO', 'PI', 'EULER', 'TWO']).toContain(t.constList);
    }
  });

  it('computes weights from subset sizes and covers the level total', () => {
    const tasks = buildTaskQueue(7, subset);
    const chain = chainIndex(7);
    const chainTasks = tasks.filter(t => t.minK === 7 && t.taskId === chain && t.taskCount === Math.pow(3, 7));
    // chain split into one task per enabled constant, each nu^(K-1)
    expect(chainTasks.length).toBe(subset.consts.length);
    for (const t of chainTasks) expect(t.weight).toBe(Math.pow(subset.funcs.length, 6));
    // level total matches brute-force enumeration with (3,3,2)
    const level7 = tasks.filter(t => t.minK === 7);
    const total = level7.reduce((s, t) => s + t.weight, 0);
    let expected = 0;
    for (let k = 0; k < Math.pow(3, 7); k++) expected += structureWeight(k, 7, 3, 3, 2);
    expect(total).toBe(expected);
  });

  it('does not split the chain for a single constant', () => {
    const tasks = buildTaskQueue(7, { consts: ['PI'], funcs: ['LOG'], ops: ['PLUS'] });
    const chainTasks = tasks.filter(t => t.minK === 7 && t.taskId === chainIndex(7));
    expect(chainTasks.length).toBe(1); // splitting into 1 piece is pointless
  });

  it('skips unary-dependent structures when all functions are disabled', () => {
    const tasks = buildTaskQueue(7, { consts: ['PI', 'TWO'], funcs: [], ops: ['PLUS'] });
    // the pure-unary chain has weight 0 without functions -> no task for it
    expect(tasks.some(t => t.taskId === chainIndex(7) && t.minK === 7)).toBe(false);
    for (const t of tasks) expect(t.funcList).toBe('');
  });

  it('returns an empty queue when no constants are enabled', () => {
    expect(buildTaskQueue(7, { consts: [], funcs: ['LOG'], ops: ['PLUS'] })).toEqual([]);
  });

  it('full selection uses the default entry point (no lists except chain)', () => {
    const tasks = buildTaskQueue(7);
    for (const t of tasks) {
      const isChainSubTask = t.minK >= CHAIN_SPLIT_MIN_K && t.taskId === chainIndex(t.minK) && t.taskCount === Math.pow(3, t.minK);
      if (!isChainSubTask) {
        expect(t.constList, `task K=${t.minK} id=${t.taskId}`).toBeUndefined();
      }
    }
  });
});

describe('structureWeight / chainIndex', () => {
  it('weights the pure-unary chain as 13 * 18^(K-1)', () => {
    for (const K of [2, 5, 7]) {
      expect(structureWeight(chainIndex(K), K)).toBe(13 * Math.pow(18, K - 1));
    }
  });

  it('rejects invalid structures', () => {
    // K=2: k=0 -> digits (0,0): two constants, stack ends at 2 -> invalid
    expect(structureWeight(0, 2)).toBe(0);
    // K=2: digits (1,0) -> starts with unary on empty stack -> invalid
    expect(structureWeight(3, 2)).toBe(0);
  });

  it('level total matches brute-force enumeration', () => {
    // K=3 by hand: valid structures are (0,1,1)=k=4 -> 13*18^2 and (0,0,2)=k=2 -> 13^2*5
    const K = 3;
    let total = 0;
    for (let k = 0; k < 27; k++) total += structureWeight(k, K);
    expect(total).toBe(13 * 324 + 169 * 5);
  });
});

describe('createResultFilter', () => {
  it('keeps improvements and drops repeats', () => {
    const keep = createResultFilter();
    expect(keep(5, 1e-3, 'pi, 2, plus')).toBe(true);   // first row for K=5
    expect(keep(5, 1e-5, 'e, sqrt')).toBe(true);       // improvement
    expect(keep(5, 1e-3, 'pi, 2, plus')).toBe(false);  // worse than best
    expect(keep(5, 1e-5, 'e, sqrt')).toBe(false);      // duplicate of best
  });

  it('keeps ties with distinct formulas', () => {
    const keep = createResultFilter();
    expect(keep(4, 0, 'pi')).toBe(true);
    expect(keep(4, 0, '-1, arccos')).toBe(true);   // same error, new formula
    expect(keep(4, 0, 'pi')).toBe(false);          // already listed
  });

  it('tracks each K independently', () => {
    const keep = createResultFilter();
    expect(keep(3, 1e-8, 'pi')).toBe(true);
    expect(keep(7, 1e-2, 'e, e, plus')).toBe(true); // worse error but new level
  });

  it('treats non-finite errors as worst', () => {
    const keep = createResultFilter();
    expect(keep(2, NaN, 'weird')).toBe(true);      // first row still shown
    expect(keep(2, 1.0, 'better')).toBe(true);     // any finite error beats it
    expect(keep(2, Infinity, 'weird2')).toBe(false);
  });
});
