import { describe, it, expect } from 'vitest';
import { estimateSeconds, formatDuration, measureRate, DEFAULT_RATE_PER_THREAD } from '../app/calculator/lib/estimate';

describe('search time estimate', () => {
  it('divides by the thread count and the per-thread rate', () => {
    const r = estimateSeconds(6.883e10, 14, 'real', { real: 1.05e8 });
    expect(r.measured).toBe(true);
    expect(r.seconds).toBeCloseTo(6.883e10 / (14 * 1.05e8), 6);   // ~47 s
    const d = estimateSeconds(1e9, 4, 'complex', {});
    expect(d.measured).toBe(false);
    expect(d.seconds).toBeCloseTo(1e9 / (4 * DEFAULT_RATE_PER_THREAD.complex), 6);
  });

  it('measures a per-thread rate only from searches long enough to be meaningful', () => {
    expect(measureRate(6.883e10, 47, 14)).toBeCloseTo(6.883e10 / 47 / 14, 3);
    expect(measureRate(1e6, 0.5, 8)).toBeNull();     // too short
    expect(measureRate(1e7, 10, 8)).toBeNull();      // too few evaluations
    expect(measureRate(1e9, 10, 0)).toBeNull();
  });

  it('formats durations', () => {
    expect(formatDuration(0.3)).toBe('< 1 s');
    expect(formatDuration(47.2)).toBe('~47 s');
    expect(formatDuration(150)).toBe('~3 min');
    expect(formatDuration(2.5 * 3600)).toBe('~2.5 h');
    expect(formatDuration(30 * 3600)).toBe('~1.3 days');
  });
});
