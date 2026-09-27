import { describe, it, expect } from 'vitest';
import { ShortestSuccess } from '../app/calculator/lib/shortest';
import { buildTaskQueue, BUNDLE_MAX_K } from '../app/calculator/lib/taskQueue';

describe('ShortestSuccess', () => {
  it('keeps the shortest SUCCESS and ignores longer ones', () => {
    const s = new ShortestSuccess();
    expect(s.offer(5)).toBe(true);
    expect(s.offer(6)).toBe(false);
    expect(s.offer(5)).toBe(false);   // a tie is not a new shortest
    expect(s.offer(2)).toBe(true);
    expect(s.bestK).toBe(2);
  });

  it('only needs tasks that start below the best level', () => {
    const s = new ShortestSuccess();
    expect(s.needed(9)).toBe(true);   // nothing found yet: everything is needed
    s.offer(5);
    expect(s.needed(1)).toBe(true);
    expect(s.needed(4)).toBe(true);
    expect(s.needed(5)).toBe(false);
    expect(s.needed(6)).toBe(false);
  });

  it('settles only when no shorter level is queued or running', () => {
    const s = new ShortestSuccess();
    expect(s.settled([])).toBe(false);         // no SUCCESS yet
    s.offer(5);
    expect(s.settled([1, 5, 5, 6])).toBe(false); // the K=1..4 bundle still runs
    expect(s.settled([5, 6, 7])).toBe(true);
  });
});

// Sqrt[Pi]: 2^log_4(pi) at K=5 arrives before the bundle's sqrt(pi) at K=2
describe('out-of-order results from parallel workers', () => {
  const replay = (bundleResult: number | null) => {
    const tasks = buildTaskQueue(7);
    const s = new ShortestSuccess();
    // 4 workers took the first 4 tasks: the bundle and three K=5 structures
    const running = new Set(tasks.slice(0, 4));
    let next = 4;
    const pending = () => [...tasks.slice(next), ...running].map((t) => t.minK);
    const finish = (i: number, successK: number | null) => {
      running.delete(tasks[i]);
      if (successK !== null) s.offer(successK);
      return s.settled(pending());
    };
    // A K=5 worker reports first: not settled, the bundle is still running
    expect(tasks[1].minK).toBe(BUNDLE_MAX_K + 1);
    expect(finish(1, 5)).toBe(false);
    // Idle workers skip what cannot beat K=5
    while (tasks[next] && !s.needed(tasks[next].minK)) next++;
    expect(next).toBe(tasks.length);
    // The bundle (K=1..4) reports: now it is settled
    expect(tasks[0]).toMatchObject({ minK: 1, maxK: BUNDLE_MAX_K });
    expect(finish(0, bundleResult)).toBe(true);
    return s.bestK;
  };

  it('returns the shorter formula found by the bundle', () => {
    expect(replay(2)).toBe(2);
  });

  it('returns the K=5 formula when the shorter levels have none', () => {
    expect(replay(null)).toBe(5);
  });
});
