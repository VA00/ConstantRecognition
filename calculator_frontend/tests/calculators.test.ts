import { describe, it, expect } from 'vitest';
import { getCalculatorById, defaultEnabledTokens } from '../app/calculator/lib/calculators';
import { resolveDomain, parseComplexInput } from '../app/calculator/lib/complex';

describe('default palette', () => {
  const calc = getCalculatorById('calc4');
  const enabled = defaultEnabledTokens(calc);

  it('starts with 36 buttons, real domain, no extras', () => {
    expect(enabled).toHaveLength(36);
    expect(enabled).not.toContain('I');
    expect(enabled).toContain('ZERO');
    expect(enabled).toContain('LOGARITHM');
    for (const t of [...calc.constantsExtra, ...calc.extra]) expect(enabled).not.toContain(t);
    expect(resolveDomain('auto', parseComplexInput('3.14'), enabled)).toBe('real');
  });

  it('switches Auto to complex when i is enabled or the target is complex', () => {
    expect(resolveDomain('auto', parseComplexInput('3.14'), [...enabled, 'I'])).toBe('complex');
    expect(resolveDomain('auto', parseComplexInput('1+i'), enabled)).toBe('complex');
  });
});
