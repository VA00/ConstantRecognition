// Types and interfaces for the calculator

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
    label: '\\int_0^{\\infty} \\left(\\frac{\\sin(x)}{x}\\right)^3 \\, dx', 
    description: 'Borwein Integral (Sinc^3)'
  },
  {
    value: '0.5778636748955', 
    label: '\\int_0^{\\infty} \\frac{\\cos(x)}{x^2 + 1} \\, dx', 
    description: 'Laplace Integral'
  },
  {
    value: '0.51404189589007076139762973957688', 
    label: '\\int_0^1 \\frac{\\arctan(\\sqrt{2+x^2})}{(x^2 + 1)\\sqrt{2+x^2}} \\, dx', 
    description: 'Wolfram Mathematica failure example'
  },
];