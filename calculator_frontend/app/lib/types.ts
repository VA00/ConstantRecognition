export interface SearchResult {
  cpuId: number;
  K: number;
  RPN: string;
  result: string;
  REL_ERR: string;
  HAMMING_DISTANCE: number;
  status?: string;
  results?: SearchResult[];
}

export interface Precision {
  z: string;
  deltaZ: string;
  relDeltaZ: string;
}

export interface Filters {
  successfullyIdentified: boolean;
  bestSoFar: boolean;
  bestForLengthK: boolean;
  runningIntermediate: boolean;
  abortedPointless: boolean;
}

export const defaultFilters: Filters = {
  successfullyIdentified: true,
  bestSoFar: false,
  bestForLengthK: false,
  runningIntermediate: false,
  abortedPointless: false
};
