// Types and interfaces for the calculator

// Error mode for uncertainty handling
export type ErrorMode = 'zero' | 'automatic' | 'manual';

export interface SearchResult {
  cpuId: number;
  K: number;
  RPN: string;
  result: string;
  REL_ERR: number;
  status: string;
  compressionRatio?: number;
}

export interface Filters {
  showSin: boolean;
  showCos: boolean;
  showExp: boolean;
  showLn: boolean;
  showSqrt: boolean;
  kFilter: number | null; 
  showBest: boolean;
  bestSofar: boolean;
}

export interface Precision {
  z?: string;
  deltaZ?: string;
  relDeltaZ?: string;
}

export interface ActiveWorker {
  id: number;
  status: string;
  currentK: number;
}

export const defaultFilters: Filters = {
  showSin: true,
  showCos: true,
  showExp: true,
  showLn: true,
  showSqrt: true,
  kFilter: null,
  showBest: true,
  bestSofar: true,
};
export const examples = [
  {
    value: '1.17809724509617246442', 
    label: '\\displaystyle \\int_0^{\\infty} \\left(\\frac{\\sin(x)}{x}\\right)^3 \\, dx', 
    description: 'Borwein Integral (Sinc^3)'
  },
  {
    value: '0.5778636748955', 
    label: '\\displaystyle \\int_0^{\\infty} \\frac{\\cos(x)}{x^2 + 1} \\, dx', 
    description: 'Recall classic integrals'
  },
  {
    value: '0.51404189589007076139762973957688', 
    label: '\\displaystyle \\int\\limits_0^1 \\frac{\\arctan(\\sqrt{2+x^2})}{(x^2 + 1)\\sqrt{2+x^2}} \\, dx', 
    description: 'Fix Wolfram Mathematica failure'
  },
  {
    value: '-0.45158270528945',
    label: '\\displaystyle \\sum_{n=1}^{\\infty} (-1)^n \\ln{\\left( 1+\\frac{1}{n} \\right)}',
    description: 'Discover sum'
  },
  {
    value: '10.185916357881301489208560855841',
    label: '\\frac{3}{128} (56 \\sqrt{5}-125) _3F_2 \\left(\\frac{3}{2},\\frac{3}{2},\\frac{3}{2};2,2;\\frac{1}{128} (47-21 \\sqrt{5} ) \\right)+\\frac{4 (5 \\sqrt{5}-1) K(\\frac{1}{32} (16-7   \\sqrt{3}-\\sqrt{15}))^2}{\\pi^2}',
    description: 'Simplify expressions'
  }
];