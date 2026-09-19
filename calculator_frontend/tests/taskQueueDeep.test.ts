import { describe, it, expect } from 'vitest';
import {
  buildTaskQueue, isFullCalculator, validStructureCount, levelWork, structureWeight,
  estimateWork, CALC4_CONSTS, CALC4_FUNCS, CALC4_OPS, MAX_STRUCTURE_TASKS, RANGE_TASKS_PER_LEVEL,
  CalculatorSelection
} from '../app/calculator/lib/taskQueue';

// Replicates the chunking in the C engines:
//   chunk = ceil(3^K / ncpus); start = cpu_id * chunk; end = min(start + chunk, 3^K)
function chunkRange(K: number, cpuId: number, ncpus: number): [number, number] {
  const kMax = Math.pow(3, K);
  const chunk = Math.ceil(kMax / ncpus);
  const start = cpuId * chunk;
  const end = Math.min(start + chunk, kMax);
  return [start, Math.max(start, end)];
}

describe('isFullCalculator', () => {
  it('is a set comparison, not a length comparison', () => {
    expect(isFullCalculator({ consts: CALC4_CONSTS, funcs: CALC4_FUNCS, ops: CALC4_OPS })).toBe(true);
    // swap one CALC4 constant for an extra one: same length, not full
    const consts = [...CALC4_CONSTS.filter(c => c !== 'NINE'), 'CATALAN'];
    expect(isFullCalculator({ consts, funcs: CALC4_FUNCS, ops: CALC4_OPS })).toBe(false);
    expect(isFullCalculator({ consts: [...CALC4_CONSTS, 'I'], funcs: CALC4_FUNCS, ops: CALC4_OPS })).toBe(false);
  });
});

describe('validStructureCount (Motzkin numbers)', () => {
  it('matches brute-force enumeration', () => {
    for (let K = 1; K <= 9; K++) {
      let count = 0;
      for (let k = 0; k < Math.pow(3, K); k++) if (structureWeight(k, K) > 0) count++;
      expect(validStructureCount(K), `K=${K}`).toBe(count);
    }
    expect(validStructureCount(11)).toBe(2188);
    expect(validStructureCount(16)).toBe(310572);
  });
});

describe('levelWork', () => {
  it('matches the sum of structure weights', () => {
    for (const [nc, nu, nb] of [[13, 18, 5], [3, 4, 2], [1, 2, 1], [2, 0, 1]]) {
      for (let K = 1; K <= 8; K++) {
        let total = 0;
        for (let k = 0; k < Math.pow(3, K); k++) total += structureWeight(k, K, nc, nu, nb);
        expect(levelWork(K, nc, nu, nb), `(${nc},${nu},${nb}) K=${K}`).toBe(total);
      }
    }
  });

  it('EML calculator {1, exp, log, -} grows like Catalan numbers', () => {
    // C(0..9) = 1, 1, 2, 5, 14, 42, 132, 429, 1430, 4862 at K = 1, 2, 3, ..., 19 (odd/even mix)
    expect(levelWork(1, 1, 2, 1)).toBe(1);
    expect(levelWork(3, 1, 2, 1)).toBe(5);
    expect(levelWork(5, 1, 2, 1)).toBe(42);
    expect(levelWork(7, 1, 2, 1)).toBe(429);
    expect(levelWork(16, 1, 2, 1)).toBe(35357670);
  });

  it('estimateWork is cumulative', () => {
    const calc: CalculatorSelection = { consts: ['ONE'], funcs: ['LOG', 'EXP'], ops: ['SUBTRACT'] };
    expect(estimateWork(3, calc)).toBe(1 + 2 + 5);
    expect(estimateWork(0, calc)).toBe(0);
    expect(estimateWork(5, { consts: [], funcs: ['LOG'], ops: [] })).toBe(0);
  });
});

describe('buildTaskQueue for deep levels of small calculators', () => {
  const eml: CalculatorSelection = { consts: ['ONE'], funcs: ['LOG', 'EXP'], ops: ['SUBTRACT'] };

  it('switches to contiguous ranges above MAX_STRUCTURE_TASKS structures', () => {
    const tasks = buildTaskQueue(12, eml);
    for (let K = 5; K <= 12; K++) {
      const level = tasks.filter(t => t.minK === K);
      if (validStructureCount(K) > MAX_STRUCTURE_TASKS) {
        expect(level.length, `K=${K}`).toBe(Math.min(RANGE_TASKS_PER_LEVEL, Math.pow(3, K)));
        for (const t of level) expect(t.taskCount).toBe(level.length);
      } else {
        // one task per valid structure (no chain split: single constant)
        expect(level.length, `K=${K}`).toBe(validStructureCount(K));
      }
    }
  });

  it('range tasks cover [0, 3^K) exactly once', () => {
    const tasks = buildTaskQueue(11, eml);
    const K = 11;
    const level = tasks.filter(t => t.minK === K);
    const kMax = Math.pow(3, K);
    const covered = new Uint8Array(kMax);
    for (const t of level) {
      const [start, end] = chunkRange(K, t.taskId, t.taskCount);
      for (let k = start; k < end; k++) covered[k]++;
    }
    for (let k = 0; k < kMax; k++) expect(covered[k]).toBe(1);
  });

  it('range tasks carry explicit lists and the level weight', () => {
    const tasks = buildTaskQueue(11, eml);
    const level = tasks.filter(t => t.minK === 11);
    const total = level.reduce((s, t) => s + t.weight, 0);
    expect(total).toBeCloseTo(levelWork(11, 1, 2, 1), 6);
    for (const t of level) {
      expect(t.constList).toBe('ONE');
      expect(t.funcList).toBe('LOG,EXP');
      expect(t.opList).toBe('SUBTRACT');
    }
  });

  it('keeps structure tasks for the full calculator up to K=9', () => {
    const tasks = buildTaskQueue(9);
    for (const t of tasks.filter(t => t.minK >= 5)) {
      expect(t.taskCount).toBe(Math.pow(3, t.minK));
    }
  });

  it('extra constants appear in explicit lists and in chain splitting', () => {
    const calc: CalculatorSelection = {
      consts: [...CALC4_CONSTS, 'I', 'CATALAN'], funcs: CALC4_FUNCS, ops: CALC4_OPS,
    };
    const tasks = buildTaskQueue(6, calc);
    const lists = new Set(tasks.map(t => t.constList));
    expect(lists.has([...CALC4_CONSTS, 'I', 'CATALAN'].join(','))).toBe(true);
    expect(lists.has('I')).toBe(true);        // chain sub-task for i
    expect(lists.has('CATALAN')).toBe(true);
  });
});
