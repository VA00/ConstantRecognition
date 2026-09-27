import { describe, it, expect } from 'vitest';
import { evaluateFormula } from '../app/calculator/lib/formula';
import { parseTargetInput, targetDelta, ComplexInput } from '../app/calculator/lib/complex';

const value = (text: string) => {
  const r = evaluateFormula(text);
  if (!r.ok) throw new Error(`${text}: ${r.error}`);
  return r.value;
};
const real = (text: string) => {
  const v = value(text);
  expect(v.im, text).toBe(0);
  return v.re;
};
const error = (text: string) => {
  const r = evaluateFormula(text);
  expect(r.ok, text).toBe(false);
  return r.ok ? '' : r.error;
};

describe('evaluateFormula', () => {
  it('evaluates arithmetic with the usual precedence', () => {
    expect(real('2/3')).toBe(2 / 3);
    expect(real('1 + 2*3')).toBe(7);
    expect(real('-2^2')).toBe(-4);          // as in Mathematica: -(2^2)
    expect(real('2^-1')).toBe(0.5);
    expect(real('2^3^2')).toBe(512);        // right-associative
    expect(real('(1+2)*3')).toBe(9);
    expect(real('10 − 3 × 2 ÷ 4')).toBe(8.5);
    expect(real('2**10')).toBe(1024);
  });

  it('multiplies by juxtaposition', () => {
    expect(real('2pi')).toBe(2 * Math.PI);
    expect(real('5 Pi^2/96')).toBe(5 * Math.PI ** 2 / 96);
    expect(real('2 Sqrt[2]')).toBe(2 * Math.SQRT2);
    expect(real('2(3+4)')).toBe(14);
  });

  it('knows functions in both notations, with real values accurate to Math', () => {
    expect(real('asin(-1/3)')).toBe(Math.asin(-1 / 3));
    expect(real('ArcSin[-1/3]')).toBe(Math.asin(-1 / 3));
    expect(real('arctanh(1/2)')).toBe(Math.atanh(0.5));
    expect(real('ln(2)')).toBe(Math.LN2);
    expect(real('Log[2, 8]')).toBeCloseTo(3, 15);   // log base 2 of 8
    expect(real('E^Pi')).toBe(Math.E ** Math.PI);
    expect(real('exp(1)')).toBe(Math.E);
    expect(real('Gamma[5]')).toBe(24);
    expect(real('gamma(1/2)')).toBeCloseTo(Math.sqrt(Math.PI), 14);
    expect(real('N[2/3, 32]')).toBe(2 / 3);
    expect(real('EulerGamma')).toBe(0.5772156649015329);
    expect(real('φ^2 - φ')).toBeCloseTo(1, 15);
  });

  it('is complex outside the real domain, on the principal branch', () => {
    expect(value('sqrt(-4)')).toEqual({ re: 0, im: 2 });
    expect(value('i^2')).toEqual({ re: -1, im: 0 });   // repeated squaring: no residue
    expect(value('I^I').re).toBeCloseTo(Math.exp(-Math.PI / 2), 15);
    const l = value('log(-1)');
    expect(l.re).toBe(0);
    expect(l.im).toBe(Math.PI);
    const a = value('asin(2)');
    expect(a.re).toBeCloseTo(Math.PI / 2, 14);
    expect(Math.abs(a.im)).toBeCloseTo(Math.log(2 + Math.sqrt(3)), 14);
    const z = value('(1+2i)/(3-4i)');
    expect(z.re).toBeCloseTo(-0.2, 15);
    expect(z.im).toBeCloseTo(0.4, 15);
  });

  it('explains what is wrong', () => {
    expect(error('')).toMatch(/empty/);
    expect(error('sinx(1)')).toMatch(/unknown function "sinx"/);
    expect(error('foo')).toMatch(/unknown name "foo"/);
    expect(error('sin')).toMatch(/needs an argument/);
    expect(error('(1+2')).toMatch(/missing "\)"/);
    expect(error('ArcSin[1/3)')).toMatch(/missing "\]"/);
    expect(error('1/0')).toMatch(/no finite value/);
    expect(error('2 $ 3')).toMatch(/unexpected "\$"/);
    expect(error('Gamma[i]')).toMatch(/complex argument/);
  });
});

describe('search target and its uncertainty', () => {
  const target = (text: string) => parseTargetInput(text) as ComplexInput;

  it('reads numbers first and formulas otherwise', () => {
    expect(parseTargetInput('')).toBeNull();
    expect(target('3.14')).toMatchObject({ re: 3.14, exact: false });
    expect(target('1111111')).toMatchObject({ re: 1111111, exact: true });
    expect(target('3+4i')).toMatchObject({ re: 3, im: 4, exact: true, isComplex: true });
    expect(target('1.5+i')).toMatchObject({ exact: false });
    expect(target('2/3')).toMatchObject({ re: 2 / 3, exact: true, formula: true, isComplex: false });
    expect(target('sqrt(-1)')).toMatchObject({ re: 0, im: 1, isComplex: true, formula: true });
    expect(parseTargetInput('2/')).toEqual({ error: 'the formula ends too early' });
  });

  it('makes integers and formulas exact in Auto, decimals ± half a unit of the last digit', () => {
    expect(targetDelta(target('1111111'), 'automatic', '')).toEqual({ delta: 0, source: 'integer' });
    expect(targetDelta(target('asin(-1/3)'), 'automatic', '')).toEqual({ delta: 0, source: 'formula' });
    const d = targetDelta(target('3.14'), 'automatic', '') as { delta: number; source: string };
    expect(d.delta).toBeCloseTo(0.005, 12);
    expect(d.source).toBe('from typed digits');
  });

  it('follows the selected mode, and needs a manual ± to be typed', () => {
    expect(targetDelta(target('3.14'), 'zero', '')).toEqual({ delta: 0, source: '± 0 selected' });
    expect(targetDelta(target('2/3'), 'manual', '1e-6')).toEqual({ delta: 1e-6, source: 'manual' });
    for (const m of ['', 'abc', '0', '-1']) {
      expect(targetDelta(target('3.14'), 'manual', m)).toHaveProperty('error');
    }
  });
});
