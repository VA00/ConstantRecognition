import { describe, it, expect } from 'vitest';
import {
  codeCounts, estimate, evalRPN, tokens, solveForX, explicitFormula, equationLatex, equationsUpTo, equationCR,
  equationChance, Equation, probeDistinct, distinctSizes, estimateDistinct, chooseEngine,
} from '../app/mitm/lib/mitm';

describe('code counts (as in the engine and PHASE1_RESULTS.md)', () => {
  it('counts CALC4 codes of each length', () => {
    const c = codeCounts(5, 13, 18, 5);
    expect(c.right.slice(1, 4)).toEqual([13, 234, 5057]);   // 13, 13*18, 18*234 + 5*13*13
    expect(c.left.slice(1, 4)).toEqual([1, 18, 454]);      // x once
  });

  it('marks a table too big for the browser', () => {
    expect(estimate(5, 6, 13, 18, 5).tooBig).toBe(false);   // 8.7e7 codes, 0.24 GB measured
    expect(estimate(5, 7, 13, 18, 5).tooBig).toBe(true);    // 2.4e9 codes, 5 GB measured
  });

  it('limits the memory of the build, which exceeds the table', () => {
    const e = estimate(5, 11, 4, 2, 3);   // {e, 1, 5, 7, sin, cos, +, *, /}: 4.4e8 codes
    expect(e.tableGB).toBeLessThan(1.5);
    expect(e.peakGB).toBeGreaterThan(1.5);
    expect(e.tooBig).toBe(true);
  });

  it('marks a search too long for the browser', () => {
    expect(estimate(7, 5, 13, 18, 5).tooLong).toBe(false);   // 3.8e8 left sides, ~46 s
    expect(estimate(8, 5, 13, 18, 5).tooLong).toBe(true);    // 1.2e10 left sides, ~24 min
    expect(estimate(12, 5, 4, 2, 3).tooLong).toBe(false);    // 4.4e9 left sides, ~9 min
  });
});

describe('evaluation with x (engine order: "a, b, SUBTRACT" = b - a)', () => {
  it('evaluates', () => {
    expect(evalRPN(tokens('x, PI, TIMES'), 2)).toBeCloseTo(2 * Math.PI, 14);
    expect(evalRPN(tokens('ONE, x, SUBTRACT'), 5)).toBe(4);
    expect(evalRPN(tokens('EIGHT, x, LOGARITHM'), 2)).toBeCloseTo(3, 14);   // log_x(8)
  });
});

describe('explicit formula from an equation with x once', () => {
  const check = (lhs: string, rhs: string, x0: number) => {
    const F = solveForX(lhs, rhs, x0);
    expect(F).not.toBeNull();
    expect(evalRPN(F as string[], 0)).toBeCloseTo(x0, 12);
    return F as string[];
  };

  it('undoes functions and operators', () => {
    expect(check('x, SQR', 'FOUR, EXP', -Math.exp(2))).toEqual(['FOUR', 'EXP', 'SQRT', 'MINUS']);   // sign branch
    check('x, NEG, NINE, SUBTRACT, POWER', 'NINE, SQR, TWO, PLUS', Math.log10(83));                 // 10^x = 83
    check('ONE, ARCSIN, SQRT, x, TIMES', 'TWO, FOUR, INV, DIVIDE', 0.25 / 2 / Math.sqrt(Math.PI / 2));
  });

  it('handles log_b in both operands', () => {
    expect(check('x, THREE, LOGARITHM', 'TWO', 9)).toEqual(['TWO', 'THREE', 'POWER']);     // log_3 x = 2
    check('NINE, x, LOGARITHM', 'TWO', 3);                                                  // log_x 9 = 2
  });

  it('picks the periodic branch next to the target', () => {
    // tan(81 x) = exp(arsinh(-1)) = sqrt 2 - 1 at x = 50 pi / 1296: 81 x = 3 pi + pi/8
    check('x, NINE, SQR, TIMES, TAN', 'NEG, ARCSINH, EXP', 50 * Math.PI / 1296);
  });

  it('gives no explicit formula when x occurs twice', () => {
    expect(solveForX('x, x, TIMES', 'TWO', Math.SQRT2)).toBeNull();
  });
});

describe('display and significance', () => {
  const e: Equation = { total: 4, a: 2, b: 2, lhs: 'x, SQR', rhs: 'TWO, SQRT', err: 0 };
  it('renders the equation', () => {
    expect(equationLatex(e)).toBe('(x)^2 = \\sqrt{2}');
    // "x" alone must not be read as the GPU short form (where x is SUBTRACT)
    expect(equationLatex({ ...e, lhs: 'x', rhs: 'PI' })).toBe('x = \\pi');
  });
  it('counts equations and computes the compression ratio', () => {
    // |L| + |R| <= 4: (1,1) (1,2) (2,1) (2,2)
    expect(equationsUpTo(4, [1, 10], [5, 50])).toBe(1 * 5 + 1 * 50 + 10 * 5 + 10 * 50);
    // an exact equation: about 16 digits over log10(605) = 2.8
    expect(equationCR(e, 0, [1, 10], [5, 50])).toBeCloseTo(-Math.log10(1.1e-16) / Math.log10(605), 10);
    // a target known to 6 digits cannot give more than 6
    expect(equationCR(e, 1e-6, [1, 10], [5, 50])).toBeCloseTo(6 / Math.log10(605), 10);
  });
});

describe('inexact targets', () => {
  const T = 3.14159;   // typed with 6 digits: x = pi is a match, its root is pi, not T
  it('solves an equation at its own root, not at the target', () => {
    const e: Equation = { total: 2, a: 1, b: 1, lhs: 'x', rhs: 'PI', err: Math.abs(Math.PI - T) / T, x: Math.PI };
    expect(explicitFormula(e, T, true)).toEqual(['PI']);
    // arcsinh(x^2) / 3 = tanh(3): x = sqrt(sinh(3 tanh 3)), 1.2e-6 from T
    const root = Math.sqrt(Math.sinh(3 * Math.tanh(3)));
    const f: Equation = { total: 7, a: 5, b: 2, lhs: 'THREE, x, SQR, ARCSINH, DIVIDE', rhs: 'THREE, TANH', err: Math.abs(root - T) / T, x: root };
    expect(evalRPN(tokens(f.lhs), root)).toBeCloseTo(Math.tanh(3), 14);
    const F = explicitFormula(f, T, true);
    expect(F).not.toBeNull();
    expect(evalRPN(F!, 0)).toBeCloseTo(root, 14);
  });
  it('gives the chance of an equation this close', () => {
    // 2.2e7 equations, the target known to 1.6e-6: a chance match is expected (N d = 35)
    const e: Equation = { total: 7, a: 5, b: 2, lhs: 'x', rhs: 'PI', err: 1.2e-6 };
    expect(equationChance(e, 1.6e-6, [1e3, 1e4], [1e3, 1e3])).toBeGreaterThan(0.99);
    // an exact match among 605 equations: about 605 * 1.1e-16
    expect(equationChance({ ...e, total: 4, err: 0 }, 0, [1, 10], [5, 50])).toBeCloseTo(605 * 1.1e-16, 20);
  });
});

describe('engines: all codes or distinct values (mitm_distinct.cpp)', () => {
  const SIX: [string[], string[], string[]] = [['PI', 'EULER'], ['SQR'], ['PLUS', 'TIMES', 'POWER']];
  const CALC4: [string[], string[], string[]] = [
    'PI,EULER,NEG,GOLDENRATIO,ONE,TWO,THREE,FOUR,FIVE,SIX,SEVEN,EIGHT,NINE'.split(','),
    'LOG,EXP,INV,GAMMA,SQRT,SQR,SIN,ARCSIN,COS,ARCCOS,TAN,ARCTAN,SINH,ARCSINH,COSH,ARCCOSH,TANH,ARCTANH'.split(','),
    'PLUS,TIMES,SUBTRACT,DIVIDE,POWER'.split(','),
  ];

  it('probes the distinct values per length as the engine makes them', () => {
    // mitm_distinct.cpp: 2 2 10 24 94 317 1196 4125 14792 51073 176911 (JavaScript's Math differs in some last bits)
    const p = probeDistinct(...SIX);
    expect(p.slice(1, 5)).toEqual([2, 2, 10, 24]);
    expect(p.length - 1).toBe(11);
    expect(p[11] / 176911).toBeCloseTo(1, 1);
  });

  it('extrapolates the distinct values of longer lengths', () => {
    const s = distinctSizes(14, probeDistinct(...SIX), 2, 1, 3);
    const total = s.right.slice(1).reduce((a, b) => a + b, 0);
    expect(total / 9948131).toBeGreaterThan(0.8);   // measured at |R| <= 14
    expect(total / 9948131).toBeLessThan(1.25);
  });

  it('estimates the distinct-value engine as measured in WebAssembly', () => {
    const p = probeDistinct(...SIX);
    const d = estimateDistinct(15, 14, p, 2, 1, 3);   // 3.6 s + 27 s measured, 1.56 GB of WebAssembly memory
    expect(d.buildSeconds + d.searchSeconds).toBeGreaterThan(15);
    expect(d.buildSeconds + d.searchSeconds).toBeLessThan(60);
    expect(d.tooBig).toBe(false);
    expect(estimateDistinct(16, 15, p, 2, 1, 3).tooBig).toBe(true);   // 5.6 GB natively
  });

  it('chooses the engine', () => {
    const p6 = probeDistinct(...SIX), p4 = probeDistinct(...CALC4);
    const six = (kl: number, kr: number) =>
      chooseEngine('automatic', false, kl, kr, estimate(kl, kr, 2, 1, 3), estimateDistinct(kl, kr, p6, 2, 1, 3));
    const calc4 = (kl: number, kr: number, anyX = false) =>
      chooseEngine('automatic', anyX, kl, kr, estimate(kl, kr, 13, 18, 5), estimateDistinct(kl, kr, p4, 13, 18, 5));
    expect(six(12, 12)).toBe('distinct');      // 0.6 s against 7 s in WebAssembly
    expect(calc4(5, 6)).toBe('codes');         // about the same time, half the memory
    expect(calc4(7, 5)).toBe('distinct');      // 11 s against 20 s natively
    expect(calc4(7, 5, true)).toBe('codes');   // x any number of times: all codes
    expect(calc4(13, 5)).toBe('distinct');     // all codes stop at 12 symbols
    const e = estimate(12, 12, 2, 1, 3), d = estimateDistinct(12, 12, p6, 2, 1, 3);
    expect(chooseEngine('codes', false, 12, 12, e, d)).toBe('codes');
    expect(chooseEngine('distinct', true, 12, 12, e, d)).toBe('codes');
  });
});
