import { describe, it, expect } from 'vitest';
import {
  parseComplexInput, complexAutoDelta, formatComplex, formatComplexShort, resolveDomain
} from '../app/calculator/lib/complex';

describe('parseComplexInput', () => {
  it('parses plain real numbers', () => {
    expect(parseComplexInput('3.14')).toMatchObject({ re: 3.14, im: 0, isComplex: false });
    expect(parseComplexInput('-2')).toMatchObject({ re: -2, im: 0, isComplex: false });
    expect(parseComplexInput('1e-5')).toMatchObject({ re: 1e-5, im: 0, isComplex: false });
    expect(parseComplexInput('.5')).toMatchObject({ re: 0.5, im: 0, isComplex: false });
  });

  it('parses a+bi in its common spellings', () => {
    for (const text of ['1+2i', '1 + 2i', '1+2 i', '1+2*i', '1 + 2 I', '1+2*I']) {
      expect(parseComplexInput(text), text).toMatchObject({ re: 1, im: 2, isComplex: true });
    }
    expect(parseComplexInput('1-2.5i')).toMatchObject({ re: 1, im: -2.5, isComplex: true });
    expect(parseComplexInput('-0.5+0.25i')).toMatchObject({ re: -0.5, im: 0.25, isComplex: true });
    expect(parseComplexInput('1e3-2e-2i')).toMatchObject({ re: 1000, im: -0.02, isComplex: true });
    expect(parseComplexInput('0.5403023058681398+0.8414709848078965i'))
      .toMatchObject({ re: 0.5403023058681398, im: 0.8414709848078965 });
  });

  it('parses unit and pure imaginary forms', () => {
    expect(parseComplexInput('i')).toMatchObject({ re: 0, im: 1, isComplex: true });
    expect(parseComplexInput('-i')).toMatchObject({ re: 0, im: -1, isComplex: true });
    expect(parseComplexInput('2i')).toMatchObject({ re: 0, im: 2, isComplex: true });
    expect(parseComplexInput('1+i')).toMatchObject({ re: 1, im: 1, isComplex: true });
    expect(parseComplexInput('1-i')).toMatchObject({ re: 1, im: -1, isComplex: true });
    expect(parseComplexInput('2i+1')).toMatchObject({ re: 1, im: 2, isComplex: true });
  });

  it('accepts the unicode minus sign', () => {
    expect(parseComplexInput('1 − 2i')).toMatchObject({ re: 1, im: -2 });
  });

  it('rejects garbage', () => {
    for (const text of ['', 'abc', '1+', '1+2', 'i2', '1+2ii', '2 3', 'pi']) {
      expect(parseComplexInput(text), text).toBeNull();
    }
  });
});

describe('complexAutoDelta', () => {
  it('uses the number of decimals for reals (same rule as extractPrecision)', () => {
    expect(complexAutoDelta(parseComplexInput('3.14')!)).toBeCloseTo(0.005, 12);
    expect(complexAutoDelta(parseComplexInput('9')!)).toBe(0.5);
  });

  it('takes the looser of the two parts for complex numbers', () => {
    expect(complexAutoDelta(parseComplexInput('1.2345+0.5i')!)).toBeCloseTo(0.05, 12);
    expect(complexAutoDelta(parseComplexInput('0.5+1.2345i')!)).toBeCloseTo(0.05, 12);
    // bare "i" counts like an integer coefficient
    expect(complexAutoDelta(parseComplexInput('1.5+i')!)).toBe(0.5);
    expect(complexAutoDelta(parseComplexInput('0.25i')!)).toBeCloseTo(0.005, 12);
  });
});

describe('formatComplex', () => {
  it('formats real, imaginary and mixed values', () => {
    expect(formatComplex(3.5, 0)).toBe('3.5');
    expect(formatComplex(0, 1)).toBe('i');
    expect(formatComplex(0, -1)).toBe('-i');
    expect(formatComplex(0, 2)).toBe('2i');
    expect(formatComplex(1, 1)).toBe('1 + i');
    expect(formatComplex(1, -2)).toBe('1 - 2i');
    expect(formatComplex(-1.5, 0.25)).toBe('-1.5 + 0.25i');
    expect(formatComplex(NaN, 0)).toBe('N/A');
    expect(formatComplex(1, Infinity)).toBe('N/A');
  });

  it('short form rounds to significant digits', () => {
    expect(formatComplexShort(Math.PI, 0)).toBe('3.14159');
    expect(formatComplexShort(Math.PI, -Math.E, 4)).toBe('3.142 - 2.718i');
  });
});

describe('resolveDomain', () => {
  const real = parseComplexInput('2.5');
  const cplx = parseComplexInput('1+i');
  it('honours explicit choices', () => {
    expect(resolveDomain('real', cplx, ['I'])).toBe('real');
    expect(resolveDomain('complex', real, [])).toBe('complex');
  });
  it('auto picks complex for complex targets or when i is enabled', () => {
    expect(resolveDomain('auto', real, ['PI', 'ONE'])).toBe('real');
    expect(resolveDomain('auto', cplx, ['PI', 'ONE'])).toBe('complex');
    expect(resolveDomain('auto', real, ['PI', 'I'])).toBe('complex');
    expect(resolveDomain('auto', null, [])).toBe('real');
  });
});
