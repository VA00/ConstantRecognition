export type CalculatorId = 'calc4';

export interface CalculatorDefinition {
  id: CalculatorId;
  name: string;
  shortName: string;
  description: string;
  statusNote: string;
  constantsCore: string[];
  constantsRedundant: string[];
  unaryCore: string[];
  unaryRedundant: string[];
  operatorsCommutative: string[];
  operatorsNoncommutative: string[];
}

export const CALCULATORS: CalculatorDefinition[] = [
  {
    id: 'calc4',
    name: 'CALC4',
    shortName: '36-button scientific RPN calculator',
    description: 'Default search calculator used by the current WASM and CPU backends.',
    statusNote: 'Display only for now: search still runs with CALC4 regardless of this selector.',
    constantsCore: ['PI', 'EULER', 'NEG', 'GOLDENRATIO'],
    constantsRedundant: ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE'],
    unaryCore: ['LOG', 'EXP'],
    unaryRedundant: [
      'INV',
      'GAMMA',
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
    operatorsCommutative: ['PLUS', 'TIMES'],
    operatorsNoncommutative: ['SUBTRACT', 'DIVIDE', 'POWER'],
  },
];

export const DEFAULT_CALCULATOR_ID: CalculatorId = 'calc4';

export const getCalculatorById = (id: CalculatorId): CalculatorDefinition =>
  CALCULATORS.find((calculator) => calculator.id === id) ?? CALCULATORS[0];

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
  LOG: 'log',
  EXP: 'exp',
  INV: '1/x',
  GAMMA: 'Γ',
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
};
