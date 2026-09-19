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
  unaryCore: string[];
  unaryOther: string[];
  /** Binary operators in display order (two per row) */
  operators: string[];
  /** Beyond the standard button set (functions or operators); disabled by default */
  extra: string[];
  /** Standard buttons that nevertheless start disabled (e.g. i, which forces the complex domain) */
  defaultDisabled: string[];
}

export const CALCULATORS: CalculatorDefinition[] = [
  {
    id: 'calc4',
    name: 'CALC4',
    shortName: '36-button scientific RPN calculator',
    description: 'Default search calculator. Click buttons to restrict the search space.',
    // Euler's identity e^(i pi) + 1 = 0: pi, e, -1, 0, i. i starts disabled
    // (see defaultDisabled): enabling it switches the Auto domain to the
    // complex plane.
    constantsCore: ['PI', 'EULER', 'NEG', 'ZERO', 'I'],
    constantsDigits: ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE'],
    // Off by default. The last four are transcendental constants with no known
    // relation to the rest, handy as generic "witness" values.
    constantsExtra: ['GOLDENRATIO', 'GLAISHER', 'CATALAN', 'KHINCHIN', 'EULERGAMMA'],
    unaryCore: ['LOG', 'EXP'],
    unaryOther: [
      'INV',
      'SQRT',
      'SQR',
      'SIN',
      'ARCSIN',
      'COS',
      'ARCCOS',
      'TAN',
      'ARCTAN',
      'SINH',
      'ARCSINH',
      'COSH',
      'ARCCOSH',
      'TANH',
      'ARCTANH',
    ],
    // rows: + −  |  × ÷  |  x^y log_b(x)   ("a, b, LOGARITHM" = log_b(a))
    operators: ['PLUS', 'SUBTRACT', 'TIMES', 'DIVIDE', 'POWER', 'LOGARITHM'],
    // Off by default: Gamma (not elementary) and the sign change -x
    extra: ['GAMMA', 'MINUS'],
    defaultDisabled: ['I'],
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
