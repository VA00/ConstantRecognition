// Shared compression-ratio computation.
//
// CR = (decimal digits of accuracy) / (information content of the RPN code),
// where the information content is K * log10(n) for n calculator buttons.
// n depends on the enabled button subset, so callers pass the instruction
// count used by the search that produced the result (36 for full CALC4).

export interface CRInput {
  K: number;
  REL_ERR: number;
  compressionRatio?: number | null;
}

export function getCompressionRatio(r: CRInput, instructionCount: number = 36): number {
  const logN = Math.log10(Math.max(2, instructionCount));
  if (typeof r.REL_ERR === 'number' && r.K > 0 && Number.isFinite(r.REL_ERR) && r.REL_ERR === 0) {
    return 16.0 / r.K / logN;
  }
  if (r.compressionRatio !== undefined && r.compressionRatio !== null) {
    return Math.max(0, Number.isFinite(r.compressionRatio) ? r.compressionRatio : 0);
  }
  if (typeof r.REL_ERR === 'number' && r.K > 0 && Number.isFinite(r.REL_ERR) && r.REL_ERR < 1.0) {
    const numerator = r.REL_ERR === 0 ? 16.0 : -Math.log10(r.REL_ERR);
    return Math.max(0, numerator / r.K / logN);
  }
  return 0;
}
