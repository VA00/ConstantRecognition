import { describe, it, expect } from 'vitest';
import {
  getCalculatorById, defaultEnabledTokens, parseCustomInteger, CUSTOM_INT, DEFAULT_FINAL_STEPS, finalStepList
} from '../app/calculator/lib/calculators';
import { resolveDomain, parseComplexInput } from '../app/calculator/lib/complex';

describe('default palette', () => {
  const calc = getCalculatorById('calc4');
  const enabled = defaultEnabledTokens(calc);

  it('starts with 34 buttons, real domain, no extras', () => {
    expect(enabled).toHaveLength(34);
    for (const t of ['I', 'NEG', 'ZERO']) expect(enabled).not.toContain(t);
    expect(enabled).toContain('LOGARITHM');
    for (const t of [...calc.constantsExtra, ...calc.extra]) expect(enabled).not.toContain(t);
    expect(resolveDomain('auto', parseComplexInput('3.14'), enabled)).toBe('real');
  });

  it('switches Auto to complex when i is enabled or the target is complex', () => {
    expect(resolveDomain('auto', parseComplexInput('3.14'), [...enabled, 'I'])).toBe('complex');
    expect(resolveDomain('auto', parseComplexInput('1+i'), enabled)).toBe('complex');
  });
});

describe('custom integer button', () => {
  it('accepts integers without a button of their own, in canonical form', () => {
    expect(parseCustomInteger('29')).toEqual({ value: '29' });
    expect(parseCustomInteger(' 029 ')).toEqual({ value: '29' });
    expect(parseCustomInteger('1000000')).toEqual({ value: '1000000' });
  });

  it('rejects everything else with a short reason', () => {
    for (const t of ['', '  ']) expect(parseCustomInteger(t)).toEqual({ error: 'empty' });
    for (const t of ['2.5', '-29', '1e3', 'abc']) expect(parseCustomInteger(t)).toEqual({ error: 'integer' });
    for (const t of ['0', '7', '13']) expect(parseCustomInteger(t)).toEqual({ error: 'has button' });
    expect(parseCustomInteger('1000001')).toEqual({ error: '≤ 10⁶' });
  });

  it('is off by default, like the rest of the difficult integers', () => {
    const calc = getCalculatorById('calc4');
    const enabled = defaultEnabledTokens(calc);
    for (const t of [...calc.constantsInt, CUSTOM_INT]) expect(enabled).not.toContain(t);
  });
});

describe('final steps sent to the engine', () => {
  it('defaults: Abs in a real search, Re, Im, Abs in a complex one', () => {
    expect(finalStepList(DEFAULT_FINAL_STEPS, 'real')).toBe('ABS');
    expect(finalStepList(DEFAULT_FINAL_STEPS, 'complex')).toBe('RE,IM,ABS');
  });

  it('keeps the engine order and drops Re, Im from real searches', () => {
    expect(finalStepList(['ARG', 'RE', 'ABS'], 'complex')).toBe('RE,ABS,ARG');
    expect(finalStepList(['ARG', 'RE', 'IM'], 'real')).toBe('ARG');
    expect(finalStepList([], 'complex')).toBe('');
  });
});
