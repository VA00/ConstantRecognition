import { describe, it, expect } from 'vitest';
import {
  buildTaskQueue, isFullCalculator, validStructureCount, levelWork, structureWeight, rangeWeights,
  estimateWork, CALC4_CONSTS, CALC4_FUNCS, CALC4_OPS, MAX_STRUCTURE_TASKS, MIN_STRUCTURE_WORK,
  RANGE_TASKS_PER_LEVEL, TASK_WORK, CalculatorSelection
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

describe('rangeWeights', () => {
  it('matches the structure weights inside every range', () => {
    for (const [nc, nu, nb] of [[4, 2, 3], [1, 2, 1], [13, 18, 5], [2, 0, 1]]) {
      for (const K of [1, 5, 9]) {
        for (const count of [1, 2, 7, 37, 512]) {
          if (count > Math.pow(3, K)) continue;
          const expected = new Array(count).fill(0);
          for (let j = 0; j < count; j++) {
            const [start, end] = chunkRange(K, j, count);
            for (let k = start; k < end; k++) expected[j] += structureWeight(k, K, nc, nu, nb);
          }
          expect(rangeWeights(K, count, nc, nu, nb), `(${nc},${nu},${nb}) K=${K} count=${count}`).toEqual(expected);
        }
      }
    }
  });

  it('is fast at the game depth K=24, whose structures cannot be listed', () => {
    const w = rangeWeights(24, RANGE_TASKS_PER_LEVEL, 1, 2, 1);
    expect(w.reduce((s, x) => s + x, 0)).toBe(levelWork(24, 1, 2, 1));
  });
});

describe('buildTaskQueue for deep levels of small calculators', () => {
  // the buttons of 1.5803748406519250461 = (7 sin 1 + 5 cos 1)/(2e), K=13
  const nine: CalculatorSelection = {
    consts: ['EULER', 'ONE', 'FIVE', 'SEVEN'], funcs: ['SIN', 'COS'], ops: ['PLUS', 'TIMES', 'DIVIDE'],
  };

  it('cuts levels with many or light structures into ranges of about TASK_WORK formulas', () => {
    const tasks = buildTaskQueue(13, nine);
    for (let K = 5; K <= 13; K++) {
      const level = tasks.filter(t => t.minK === K);
      const work = levelWork(K, 4, 2, 3);
      expect(validStructureCount(K) > MAX_STRUCTURE_TASKS || work < validStructureCount(K) * MIN_STRUCTURE_WORK).toBe(true);
      const count = Math.max(1, Math.min(RANGE_TASKS_PER_LEVEL, Math.pow(3, K), Math.ceil(7 * work / TASK_WORK)));
      for (const t of level) {
        expect(t.taskCount, `K=${K}`).toBe(count);
        expect(t.weight, `K=${K}`).toBeGreaterThan(0);   // empty ranges dropped
      }
      expect(level.reduce((s, t) => s + t.weight, 0), `K=${K}`).toBe(work);
      // heaviest first
      for (let i = 1; i < level.length; i++) expect(level[i].weight).toBeLessThanOrEqual(level[i - 1].weight);
    }
    // instead of one task per structure at K=5..10 and 512 ranges at K=11..13
    expect(tasks.length).toBeLessThan(200);
  });

  it('range tasks cover every valid structure exactly once', () => {
    const K = 11;
    const level = buildTaskQueue(K, nine).filter(t => t.minK === K);
    expect(level.length).toBeGreaterThan(1);
    const kMax = Math.pow(3, K);
    const covered = new Uint8Array(kMax);
    for (const t of level) {
      const [start, end] = chunkRange(K, t.taskId, t.taskCount);
      for (let k = start; k < end; k++) covered[k]++;
    }
    let missed = 0, twice = 0;
    for (let k = 0; k < kMax; k++) {
      if (covered[k] > 1) twice++;
      else if (covered[k] === 0 && structureWeight(k, K, 4, 2, 3) > 0) missed++;
    }
    expect({ missed, twice }).toEqual({ missed: 0, twice: 0 });
  });

  it('range tasks carry explicit lists', () => {
    for (const t of buildTaskQueue(11, nine).filter(t => t.minK === 11)) {
      expect(t.constList).toBe('EULER,ONE,FIVE,SEVEN');
      expect(t.funcList).toBe('SIN,COS');
      expect(t.opList).toBe('PLUS,TIMES,DIVIDE');
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
