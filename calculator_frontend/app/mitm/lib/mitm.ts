// Meet-in-the-middle (bidirectional) search: what the page sends to the engine (public/wasm/mitm_worker.js,
// algorithms/methods/mitm/mitm_wasm.cpp) and what it does with the answer.
//
// The engine finds equations L(x) = R that hold at the target: L contains x (exactly once by default), R does
// not. RPN codes use the calculator's button names and the engine's operand order ("a, b, SUBTRACT" = b - a,
// "a, b, LOGARITHM" = log_b(a)), with "x" for the unknown. With x exactly once an equation can be solved for x
// (solveForX), which gives an explicit formula like the brute-force calculator's.

import { numConstants, numFunctions, numOperators, isNumericLiteral, rpnToLatex, rpnToMathematica } from '../../calculator/lib/rpn';

export interface Equation {
  total: number;   // length of the equation: a + b RPN symbols
  a: number;       // length of the left side
  b: number;       // length of the right side
  lhs: string;     // RPN with x
  rhs: string;     // RPN without x
  err: number;     // |x - T| / |T| of the root next to T
  x?: number | null;   // that root (null: not computed)
}

export interface BuildResponse {
  ok: number;
  error?: string;
  sizes?: number[];    // distinct right-side values per length 1..KR
  codes?: number;
  distinct?: number;
  passes?: number;
  seconds?: number;
  gb?: number;
  ms?: number;         // measured in the worker, including the call
}

export interface SearchResponse {
  ok: number;
  error?: string;
  status?: 'SUCCESS' | 'FAILURE';
  tol?: number;
  ms?: number;
  candidates?: number;
  best?: Equation | null;
  approx?: Equation[];   // closest pair of every total length (not accepted)
  matches?: Equation[];  // accepted equations, shortest first
  nL?: number[];         // distinct left values tested per length 1..KL
}

// Buttons the engine does not take: i (the search is real)
export const UNSUPPORTED_TOKENS = ['I'];

// ---------------------------------------------------------------------------------------------- estimates

/** Codes of length 1..K over nc constants, nu functions, nb operators: right[K], and left sides with x
 *  exactly once: left[K] (index 0 unused) */
export function codeCounts(K: number, nc: number, nu: number, nb: number): { right: number[]; left: number[] } {
  const f = new Array(K + 1).fill(0);
  const g = new Array(K + 1).fill(0);
  for (let k = 1; k <= K; k++) {
    if (k === 1) { f[1] = nc; g[1] = 1; continue; }
    let sf = 0, sg = 0;
    for (let i = 1; i < k - 1; i++) {
      sf += f[i] * f[k - 1 - i];
      sg += g[i] * f[k - 1 - i] + f[i] * g[k - 1 - i];
    }
    f[k] = nu * f[k - 1] + nb * sf;
    g[k] = nu * g[k - 1] + nb * sg;
  }
  return { right: f, left: g };
}

const cumulative = (a: number[], K: number) => a.slice(1, K + 1).reduce((s, x) => s + x, 0);

// Measured in WebAssembly (Node, one thread, CALC4): the table costs about 80 ns per code of length <= KR,
// and keeps about 30 % of them as distinct values of 12 bytes; a left side costs about 120 ns (generation,
// sort, lookups in all tables).
const NS_PER_RIGHT_CODE = 80;
const DISTINCT_FRACTION = 0.3;
const NS_PER_LEFT_CODE = 120;
export const MEMORY_LIMIT_GB = 1.5;   // larger tables are not built in the browser

export interface Estimate {
  rightCodes: number;   // codes of length <= KR
  tableGB: number;      // estimated memory of the right-side table
  buildSeconds: number;
  leftCodes: number;    // left sides per target (x once; any x: somewhat more)
  searchSeconds: number;
  tooBig: boolean;
}

export function estimate(KL: number, KR: number, nc: number, nu: number, nb: number): Estimate {
  const c = codeCounts(Math.max(KL, KR), nc, nu, nb);
  const rightCodes = cumulative(c.right, KR);
  const leftCodes = cumulative(c.left, KL);
  const tableGB = rightCodes * DISTINCT_FRACTION * 12 / 2 ** 30;
  // the build also holds a buffer of 16 bytes per surviving code
  const peakGB = tableGB + rightCodes * 0.4 * 16 / 2 ** 30;
  return {
    rightCodes,
    tableGB,
    buildSeconds: rightCodes * NS_PER_RIGHT_CODE * 1e-9,
    leftCodes,
    searchSeconds: leftCodes * NS_PER_LEFT_CODE * 1e-9,
    tooBig: peakGB > MEMORY_LIMIT_GB,
  };
}

// ---------------------------------------------------------------------------------------------- evaluation

export const tokens = (rpn: string): string[] => rpn.split(',').map(t => t.trim()).filter(t => t.length > 0);

/** Value of an RPN code at x (double precision, the engine's operand order) */
export function evalRPN(code: string[], x: number): number {
  const st: number[] = [];
  for (const t of code) {
    if (t === 'x') st.push(x);
    else if (numConstants[t] !== undefined) st.push(numConstants[t]);
    else if (isNumericLiteral(t)) st.push(parseFloat(t));
    else if (numFunctions[t]) st.push(numFunctions[t](st.pop() ?? NaN));
    else if (numOperators[t]) {
      const top = st.pop() ?? NaN;
      const second = st.pop() ?? NaN;
      st.push(numOperators[t](top, second));
    } else return NaN;
  }
  return st.length === 1 ? st[0] : NaN;
}

// ---------------------------------------------------------------------------------------------- display

// Token arrays, not strings: the converters read a string without commas made of a few characters as the GPU
// short form ("x" alone would be SUBTRACT)
export const equationLatex = (e: Equation) => `${rpnToLatex(tokens(e.lhs))} = ${rpnToLatex(tokens(e.rhs))}`;
export const equationMathematica = (e: Equation) =>
  `${rpnToMathematica(tokens(e.lhs))} == ${rpnToMathematica(tokens(e.rhs))}`;

/** Wolfram|Alpha query for an equation: the bare equation. Alpha then solves it symbolically and shows the real
 *  solution in closed form (x^x == E: x = e^W(1); a periodic one with "n element Z"); Solve[...] lists all complex
 *  branches, FindRoot[...] only 6 digits (checked 2026-10-04 through Mathematica's WolframAlpha[]) */
export function equationWolframQuery(e: Equation): string {
  return equationMathematica(e);
}

// ---------------------------------------------------------------------------------------------- explicit formula

type Node = { tok: string; kids: Node[] };   // kids of a binary node: [top, second]

const BINARY = new Set(['PLUS', 'TIMES', 'SUBTRACT', 'DIVIDE', 'POWER', 'LOGARITHM']);

function tree(code: string[]): Node | null {
  const st: Node[] = [];
  for (const t of code) {
    if (BINARY.has(t)) {
      const top = st.pop(), second = st.pop();
      if (!top || !second) return null;
      st.push({ tok: t, kids: [top, second] });
    } else if (numFunctions[t]) {
      const arg = st.pop();
      if (!arg) return null;
      st.push({ tok: t, kids: [arg] });
    } else {
      st.push({ tok: t, kids: [] });
    }
  }
  return st.length === 1 ? st[0] : null;
}

function code(n: Node): string[] {
  if (n.kids.length === 0) return [n.tok];
  if (n.kids.length === 1) return [...code(n.kids[0]), n.tok];
  return [...code(n.kids[1]), ...code(n.kids[0]), n.tok];
}

const countX = (n: Node): number => (n.tok === 'x' ? 1 : 0) + n.kids.reduce((s, k) => s + countX(k), 0);

/** Tokens of op(t, s) in the engine's order ("s, t, op") */
const bin = (op: string, t: string[], s: string[]) => [...s, ...t, op];

const INVERSE: Record<string, string> = {
  LOG: 'EXP', EXP: 'LOG', INV: 'INV', SQRT: 'SQR', SQR: 'SQRT', SIN: 'ARCSIN', ARCSIN: 'SIN', COS: 'ARCCOS',
  ARCCOS: 'COS', TAN: 'ARCTAN', ARCTAN: 'TAN', SINH: 'ARCSINH', ARCSINH: 'SINH', COSH: 'ARCCOSH', ARCCOSH: 'COSH',
  TANH: 'ARCTANH', ARCTANH: 'TANH', MINUS: 'MINUS',
};
const DIGITS = ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE'];

/** e + k step pi for |k step| <= 9 */
function shifts(e: string[], step: number): string[][] {
  const out = [e];
  for (let k = 1; k * step <= 9; k++) {
    const kpi = k * step === 1 ? ['PI'] : [DIGITS[k * step - 1], 'PI', 'TIMES'];
    out.push(bin('PLUS', e, kpi), bin('SUBTRACT', e, kpi));
  }
  return out;
}

/** Solutions u of f(u) = y (y: tokens), principal branch first */
function candidates(f: string, y: string[]): string[][] {
  const g = [...y, INVERSE[f]];
  const neg = (e: string[]) => [...e, 'MINUS'];
  if (f === 'SQR' || f === 'COSH') return [g, neg(g)];
  if (f === 'SIN') return [...shifts(g, 2), ...shifts(bin('SUBTRACT', ['PI'], g), 2)];
  if (f === 'COS') return [...shifts(g, 2), ...shifts(neg(g), 2)];
  if (f === 'TAN') return shifts(g, 1);
  return [g];
}

const close = (u: number, want: number) => Math.abs(u - want) <= 1e-9 * Math.max(1, Math.abs(want));

/**
 * Explicit formula x = F for an equation with x exactly once, as RPN tokens, or null (x more than once, GAMMA on
 * the path of x, no branch reproducing the value). The operations of L are undone from the root down to x;
 * multivalued inverses take the branch (sign, multiple of pi) that reproduces the value of the inverted part
 * at the target x0. The result may use buttons the search did not (inverse functions, MINUS).
 * exact = false (an approximation, not an identity): the nearest branch is taken, and F is kept if its value lies
 * within 1e3 times the approximation's relative error approxErr of x0 (an inversion through a branch the
 * approximation does not support, e.g. tan near pi/2, gives a value far from x0).
 */
export function solveForX(lhs: string, rhs: string, x0: number, exact = true, approxErr = 0): string[] | null {
  const root = tree(tokens(lhs));
  if (!root || countX(root) !== 1) return null;
  let node: Node = root;
  let y = tokens(rhs);
  while (node.tok !== 'x') {
    if (node.kids.length === 1) {
      const f: string = node.tok;
      const child: Node = node.kids[0];
      if (!INVERSE[f]) return null;                       // GAMMA
      const want = evalRPN(code(child), x0);
      let best: { d: number; c: string[] } | null = null;
      for (const c of candidates(f, y)) {
        const d = Math.abs(evalRPN(c, 0) - want);
        if (Number.isFinite(d) && (!best || d < best.d)) best = { d, c };
      }
      if (!best || (exact && !close(evalRPN(best.c, 0), want))) return null;
      y = best.c;
      node = child;
    } else {
      const t: Node = node.kids[0], s: Node = node.kids[1];
      const xt: boolean = countX(t) === 1;
      const ct = code(t), cs = code(s);
      switch (node.tok) {
        case 'PLUS': y = xt ? bin('SUBTRACT', y, cs) : bin('SUBTRACT', y, ct); break;
        case 'TIMES': y = xt ? bin('DIVIDE', y, cs) : bin('DIVIDE', y, ct); break;
        case 'SUBTRACT': y = xt ? bin('PLUS', y, cs) : bin('SUBTRACT', ct, y); break;     // t - s = y
        case 'DIVIDE': y = xt ? bin('TIMES', y, cs) : bin('DIVIDE', ct, y); break;        // t / s = y
        case 'POWER':                                                                    // t^s = y
          if (xt) {
            let g = bin('POWER', y, [...cs, 'INV']);
            const want = evalRPN(ct, x0);                                                 // odd root of a negative base
            if (Math.abs(evalRPN([...g, 'MINUS'], 0) - want) < Math.abs(evalRPN(g, 0) - want)) g = [...g, 'MINUS'];
            y = g;
          } else {
            y = bin('DIVIDE', [...y, 'LOG'], [...ct, 'LOG']);
          }
          break;
        case 'LOGARITHM':                                                                // log_t(s) = y
          y = xt ? bin('POWER', cs, [...y, 'INV']) : bin('POWER', ct, y);
          break;
        default:
          return null;
      }
      node = xt ? t : s;
    }
  }
  if (exact) return close(evalRPN(y, 0), x0) ? y : null;
  const u = evalRPN(y, 0);
  return Math.abs(u - x0) <= Math.max(1e-9, 1e3 * approxErr) * Math.max(1, Math.abs(x0)) ? y : null;
}

/** x = F for an equation, or null. The branches are taken at the equation's own root e.x, which differs from the
 *  target T by up to the target's uncertainty (x = pi for 3.14159) or, for an approximation, by its error */
export function explicitFormula(e: Equation, T: number, isMatch: boolean): string[] | null {
  if (typeof e.x === 'number' && Number.isFinite(e.x)) return solveForX(e.lhs, e.rhs, e.x);
  return solveForX(e.lhs, e.rhs, T, isMatch, e.err);
}

// ---------------------------------------------------------------------------------------------- significance

/** Equations of total length <= n the search compared: sum over |L| + |R| <= n of (distinct left values of
 *  length |L|) x (distinct right values of length |R|) */
export function equationsUpTo(n: number, nL: number[], nR: number[]): number {
  let s = 0;
  for (let a = 1; a <= nL.length; a++)
    for (let b = 1; b <= nR.length; b++)
      if (a + b <= n) s += nL[a - 1] * nR[b - 1];
  return s;
}

/**
 * Compression ratio of an equation, as the calculator's CR = digits / (K log10 n) with the number of formulas
 * n^K replaced by the number of equations searched up to the equation's length: digits of agreement (limited
 * by the target's own uncertainty) over log10 of that number. Above 1 the agreement is unlikely to be chance.
 */
export function equationCR(e: Equation, relDelta: number, nL: number[], nR: number[]): number {
  const N = Math.max(10, equationsUpTo(e.total, nL, nR));
  const err = Math.max(e.err, relDelta, 1.1e-16);
  return -Math.log10(err) / Math.log10(N);
}

/**
 * Probability that an equation this close turns up by chance: of the N equations compared up to its length, about
 * N d have a root within the relative distance d of the target (d: the error, or the target's uncertainty if
 * larger; the closest pair of each length in the searches has N d of about 1-7), so P = 1 - exp(-N d).
 */
export function equationChance(e: Equation, relDelta: number, nL: number[], nR: number[]): number {
  const d = Math.max(e.err, relDelta, 1.1e-16);
  return -Math.expm1(-equationsUpTo(e.total, nL, nR) * d);
}
