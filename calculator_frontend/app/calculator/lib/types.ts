// Types and interfaces for the calculator

export interface SearchResult {
  cpuId: number;
  K: number;
  RPN: string;
  result: string;
  REL_ERR: number;
  HAMMING_DISTANCE: number;
  status: string;
  compressionRatio?: number;
}

export interface Filters {
  showSin: boolean;
  showCos: boolean;
  showExp: boolean;
  showLn: boolean;
  showSqrt: boolean;
  kFilter: number | null; // null = show all, number = show only that K
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
  kFilter: null
};
