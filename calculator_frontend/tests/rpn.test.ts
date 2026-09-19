import { describe, it, expect } from 'vitest';
import { evaluateRPN, rpnToInfix, rpnToMathematica, rpnToLatex } from '../app/calculator/lib/rpn';

// WASM RPN convention: "a, b, OP" means OP(b, a) — the top of the stack is the
// first argument. For LOGARITHM the base is therefore pushed last.
describe('LOGARITHM (arbitrary-base logarithm) in the RPN converters', () => {
  it('evaluates log_b(a) with the base on top of the stack', () => {
    expect(evaluateRPN('EIGHT, TWO, LOGARITHM')).toBeCloseTo(3, 12);      // log_2(8)
    expect(evaluateRPN('TWO, EIGHT, LOGARITHM')).toBeCloseTo(1 / 3, 12);  // log_8(2)
    expect(evaluateRPN('ONE, TWO, SUBTRACT')).toBe(1);                    // 2 - 1, same convention
  });

  it('renders base and argument in the right places', () => {
    expect(rpnToInfix('EIGHT, TWO, LOGARITHM')).toBe('log_2(8)');
    expect(rpnToMathematica('EIGHT, TWO, LOGARITHM')).toBe('Log[2, 8]');
    expect(rpnToLatex('EIGHT, TWO, LOGARITHM')).toBe('\\log_{2}\\left(8\\right)');
  });

  it('knows the extra constants', () => {
    expect(evaluateRPN('ZERO')).toBe(0);
    expect(evaluateRPN('CATALAN, SQR')).toBeCloseTo(0.915965594177219 ** 2, 15);
    expect(rpnToMathematica('GLAISHER, EULERGAMMA, KHINCHIN, TIMES, PLUS')).toBe('((Khinchin * EulerGamma) + Glaisher)');
    expect(rpnToLatex('I, PI, TIMES, EXP')).toBe('e^{\\pi \\cdot i}');
  });
});
