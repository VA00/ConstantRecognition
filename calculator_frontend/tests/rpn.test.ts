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

// Difficult integers and typed constants reach the engine as numeric literals
// (C/numeric_literal.h) and come back verbatim in the RPN.
describe('numeric-literal constants', () => {
  it('evaluates them', () => {
    expect(evaluateRPN('29, SQRT')).toBe(Math.sqrt(29));
    expect(evaluateRPN('13, INV')).toBe(1 / 13);
    expect(evaluateRPN('0.20787957635076191, SQR')).toBe(0.20787957635076191 ** 2);
  });

  it('does not read a one-button result as a GPU short code', () => {
    expect(evaluateRPN('13')).toBe(13);      // not EULER, GOLDENRATIO
    expect(evaluateRPN('29')).toBe(29);      // not NEG, GAMMA
    expect(rpnToLatex('10')).toBe('10');
    expect(rpnToMathematica('12')).toBe('12');
  });

  it('renders them, a negative one in parentheses', () => {
    expect(rpnToLatex('29, SQRT')).toBe('\\sqrt{29}');
    expect(rpnToMathematica('11, TWO, POWER')).toBe('(2 ^ 11)');
    expect(rpnToInfix('-2.5, SQR')).toBe('sqr((-2.5))');
    expect(rpnToMathematica('-2.5, SQR')).toBe('((-2.5))^2');
  });
});

// Final step of the complex engine: the operation is the last RPN token
describe('final-step tokens', () => {
  it('render as functions of the whole formula', () => {
    expect(rpnToMathematica('I, SQRT, RE')).toBe('Re[Sqrt[I]]');
    expect(rpnToMathematica('ONE, I, PLUS, ARG')).toBe('Arg[(I + 1)]');
    expect(rpnToLatex('I, SQRT, RE')).toBe('\\operatorname{Re}(\\sqrt{i})');
    expect(rpnToLatex('TWO, I, TIMES, ABS')).toBe('\\left|i \\cdot 2\\right|');   // WASM order: op(top, second)
    expect(rpnToInfix('I, LOG, IM')).toBe('Im(ln(i))');
    expect(rpnToMathematica('EULER, EXP, MINUS')).toBe('(-Exp[E])');   // Minus: token of the sign-change button
    expect(rpnToLatex('EULER, EXP, MINUS')).toBe('(-e^{e})');
    expect(rpnToMathematica('PI, FRAC')).toBe('Mod[Pi, 1]');   // x - Floor[x], also for x < 0
    expect(rpnToLatex('PI, FRAC')).toBe('\\left\\{\\pi\\right\\}');
  });

  it('evaluate on real values as Re x = x, Im x = 0, |x|, arg x', () => {
    expect(evaluateRPN('PI, RE')).toBe(Math.PI);
    expect(evaluateRPN('PI, IM')).toBe(0);
    expect(evaluateRPN('TWO, ONE, SUBTRACT, ABS')).toBe(1);   // |1 - 2|, WASM order: op(top, second)
    expect(evaluateRPN('TWO, ONE, SUBTRACT, ARG')).toBe(Math.PI);
    expect(evaluateRPN('ONE, TWO, SUBTRACT, ARG')).toBe(0);   // 2 - 1 > 0
    expect(evaluateRPN('EULER, EXP, MINUS')).toBe(-Math.exp(Math.E));
    expect(evaluateRPN('PI, NINE, PLUS, FRAC')).toBeCloseTo(Math.PI - 3, 14);
    expect(evaluateRPN('SIX, PI, SUBTRACT, FRAC')).toBeCloseTo(Math.PI - 3, 14);   // {pi - 6}: x - floor(x), also for x < 0
  });
});
