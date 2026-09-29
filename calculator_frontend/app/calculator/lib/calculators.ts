export type CalculatorId = 'calc4';

export interface CalculatorDefinition {
  id: CalculatorId;
  name: string;
  shortName: string;
  description: string;
  constantsCore: string[];
  /** The digits 1..9 */
  constantsDigits: string[];
  /** Beyond the standard button set; disabled by default */
  constantsExtra: string[];
  /** Integers beyond the digits, sent to the engine as numeric literals; disabled by default */
  constantsInt: string[];
  unaryCore: string[];
  unaryOther: string[];
  /** Binary operators in display order (two per row) */
  operators: string[];
  /** Beyond the standard button set (functions or operators); disabled by default */
  extra: string[];
  /** Standard buttons that nevertheless start disabled (-1, 0, and i, which forces the complex domain) */
  defaultDisabled: string[];
}

export const CALCULATORS: CalculatorDefinition[] = [
  {
    id: 'calc4',
    name: 'CALC4',
    shortName: '36-button scientific RPN calculator',
    description: 'Default search calculator. Click buttons to restrict the search space.',
    // Euler's identity e^(i pi) + 1 = 0: pi, e, -1, 0, i. -1, 0 and i start
    // disabled (see defaultDisabled); enabling i switches the Auto domain to
    // the complex plane.
    constantsCore: ['PI', 'EULER', 'NEG', 'ZERO', 'I'],
    constantsDigits: ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE'],
    // Off by default. The last four are transcendental constants with no known
    // relation to the rest, handy as generic "witness" values.
    constantsExtra: ['GOLDENRATIO', 'GLAISHER', 'CATALAN', 'KHINCHIN', 'EULERGAMMA'],
    // Off by default. Integers that short RPN codes over the digits reach
    // poorly; a digit range 4..13 serves them better than 1..9. The engine
    // reads each token as a numeric literal (C/numeric_literal.h). The fifth
    // button of the row is CUSTOM_INT, an integer the user types.
    constantsInt: ['10', '11', '12', '13'],
    unaryCore: ['LOG', 'EXP'],
    // rows of three: 1/x √x x² | sin cos tan | asin acos atan | sinh cosh tanh | asinh acosh atanh
    unaryOther: [
      'INV', 'SQRT', 'SQR',
      'SIN', 'COS', 'TAN',
      'ARCSIN', 'ARCCOS', 'ARCTAN',
      'SINH', 'COSH', 'TANH',
      'ARCSINH', 'ARCCOSH', 'ARCTANH',
    ],
    // rows: + −  |  × ÷  |  x^y log_b(x)   ("a, b, LOGARITHM" = log_b(a))
    operators: ['PLUS', 'SUBTRACT', 'TIMES', 'DIVIDE', 'POWER', 'LOGARITHM'],
    // Off by default: Gamma (not elementary) and the sign change -x
    extra: ['GAMMA', 'MINUS'],
    defaultDisabled: ['NEG', 'ZERO', 'I'],
  },
];

export const DEFAULT_CALCULATOR_ID: CalculatorId = 'calc4';

export const getCalculatorById = (id: CalculatorId): CalculatorDefinition =>
  CALCULATORS.find((calculator) => calculator.id === id) ?? CALCULATORS[0];

/** Buttons enabled when the page loads: the standard set minus defaultDisabled, no extras */
export const defaultEnabledTokens = (calculator: CalculatorDefinition): string[] => [
  ...calculator.constantsCore,
  ...calculator.constantsDigits,
  ...calculator.unaryCore,
  ...calculator.unaryOther,
  ...calculator.operators,
].filter((t) => !calculator.defaultDisabled.includes(t));

// Palette token of the user-typed integer. It is never sent to the engine:
// the page replaces it with the typed number (see parseCustomInteger).
export const CUSTOM_INT = 'CUSTOM_INT';
export const CUSTOM_INT_MAX = 1_000_000;

/** The typed integer in canonical form ("029" -> "29"), or a short note why it is not usable */
export function parseCustomInteger(text: string): { value: string } | { error: string } {
  const s = text.trim();
  if (s === '') return { error: 'empty' };   // not shown: the palette just says "custom"
  if (!/^\d+$/.test(s)) return { error: 'integer' };
  const n = parseInt(s, 10);
  if (n <= 13) return { error: 'has button' };   // 0..13 are buttons already
  if (n > CUSTOM_INT_MAX) return { error: '≤ 10⁶' };
  return { value: String(n) };
}

// Final step ("Finalize" in the Mathematica package): operations the engine
// may apply to a finished formula only, never inside it, so formulas stay
// analytic. Identity is always applied and not listed. They do not count in K.
// complexOnly: no effect on real values (Re x = x, Im x = 0), so a real search
// leaves them out; Abs and Arg act in both searches.
export const FINAL_STEPS: { token: string; label: string; complexOnly: boolean; hint?: string }[] = [
  { token: 'MINUS', label: 'Minus', complexOnly: false },   // -f; token of the sign-change button
  { token: 'RE', label: 'Re', complexOnly: true },
  { token: 'IM', label: 'Im', complexOnly: true },
  { token: 'ABS', label: 'Abs', complexOnly: false },
  { token: 'ARG', label: 'Arg', complexOnly: false },
  { token: 'FRAC', label: 'Frac', complexOnly: false,
    hint: 'Fractional part {x} = x - floor(x): matches the target up to any integer offset' },
];
// Real search: Minus; complex search: Minus, Re, Im. Abs and Arg off.
export const DEFAULT_FINAL_STEPS = ['MINUS', 'RE', 'IM'];

/** Final steps sent to the engine for a search domain, in the engine's tie order */
export function finalStepList(steps: string[], domain: 'real' | 'complex'): string {
  return FINAL_STEPS
    .filter(f => steps.includes(f.token) && (domain === 'complex' || !f.complexOnly))
    .map(f => f.token)
    .join(',');
}

export const calculatorTokenLabel: Record<string, string> = {
  PI: 'π',
  EULER: 'e',
  NEG: '-1',
  GOLDENRATIO: 'φ',
  ONE: '1',
  TWO: '2',
  THREE: '3',
  FOUR: '4',
  FIVE: '5',
  SIX: '6',
  SEVEN: '7',
  EIGHT: '8',
  NINE: '9',
  ZERO: '0',
  I: 'i',
  GLAISHER: 'A',
  CATALAN: 'G',
  KHINCHIN: 'K₀',
  EULERGAMMA: 'γ',
  LOG: 'log',
  EXP: 'exp',
  INV: '1/x',
  GAMMA: 'Γ',
  MINUS: '±',
  SQRT: '√x',
  SQR: 'x²',
  SIN: 'sin',
  ARCSIN: 'asin',
  COS: 'cos',
  ARCCOS: 'acos',
  TAN: 'tan',
  ARCTAN: 'atan',
  SINH: 'sinh',
  ARCSINH: 'asinh',
  COSH: 'cosh',
  ARCCOSH: 'acosh',
  TANH: 'tanh',
  ARCTANH: 'atanh',
  PLUS: '+',
  TIMES: '×',
  SUBTRACT: '-',
  DIVIDE: '/',
  POWER: 'xʸ',
  LOGARITHM: 'log_{y}x',   // _{...} renders as a subscript in the palette
};
