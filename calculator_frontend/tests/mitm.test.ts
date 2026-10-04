import { describe, it, expect } from 'vitest';
import {
  codeCounts, estimate, evalRPN, tokens, solveForX, explicitFormula, equationLatex, equationsUpTo, equationCR,
  equationChance, Equation,
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
