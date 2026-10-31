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
  // distinct values only: left levels kept (the longer left sides made on the fly), and false if the memory limit
  // stopped the left sides short of KL
  kept?: number;
  complete?: boolean;
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
export const MEMORY_LIMIT_GB = 1.5;     // larger tables are not built in the browser
export const TIME_LIMIT_SECONDS = 600;  // longer searches are not started (the left sides, on one thread)

export interface Estimate {
  unit: 'codes' | 'values';   // what rightCodes and leftCodes count: codes (every code), or distinct values
  rightCodes: number;   // codes of length <= KR (distinct values: of length <= max(KR, KL - 2))
  tableGB: number;      // estimated memory of the right-side table
  peakGB: number;       // estimated memory while the table is built (distinct values: or while a number is searched)
  buildSeconds: number;
  leftCodes: number;    // left sides per target (x once; any x: somewhat more)
  searchSeconds: number;
  tooBig: boolean;      // peakGB > MEMORY_LIMIT_GB
  tooLong: boolean;     // searchSeconds > TIME_LIMIT_SECONDS
}

export function estimate(KL: number, KR: number, nc: number, nu: number, nb: number): Estimate {
  const c = codeCounts(Math.max(KL, KR), nc, nu, nb);
  const rightCodes = cumulative(c.right, KR);
  const leftCodes = cumulative(c.left, KL);
  const tableGB = rightCodes * DISTINCT_FRACTION * 12 / 2 ** 30;
  // the build also holds a buffer of 16 bytes per surviving code
  const peakGB = tableGB + rightCodes * 0.4 * 16 / 2 ** 30;
  const searchSeconds = leftCodes * NS_PER_LEFT_CODE * 1e-9;
  return {
    unit: 'codes',
    rightCodes,
    tableGB,
    peakGB,
    buildSeconds: rightCodes * NS_PER_RIGHT_CODE * 1e-9,
    leftCodes,
    searchSeconds,
    tooBig: peakGB > MEMORY_LIMIT_GB,
    tooLong: searchSeconds > TIME_LIMIT_SECONDS,
  };
}

// ---------------------------------------------------------------------------------------------- engines

/**
 * The two engines of mitm.wasm (algorithms/methods/mitm), with the same equations: 'codes' evaluates every code
 * (mitm_cr.cpp, sides of up to 12 symbols); 'distinct' makes every length only from the distinct values of shorter
 * lengths (mitm_distinct.cpp): far less work when few buttons make most codes repeat a value (e, pi, sqr, +, *, ^
 * at 12 + 12 symbols: 0.6 s instead of 7 s), about twice the memory per value, x once only. The page offers the
 * distinct-value engine up to 20 symbols per side (the engine takes 30).
 */
export type Engine = 'codes' | 'distinct';
export type EngineChoice = 'automatic' | Engine;
export const MAX_LENGTH: Record<Engine, number> = { codes: 12, distinct: 20 };

const SMALLEST_NORMAL = 2.2250738585072014e-308;
const usableValue = (v: number) => Number.isFinite(v) && (v === 0 || Math.abs(v) >= SMALLEST_NORMAL);
const COMMUTATIVE = new Set(['PLUS', 'TIMES']);

function mergeSorted(a: Float64Array, b: Float64Array): Float64Array {
  const out = new Float64Array(a.length + b.length);
  let i = 0, j = 0, k = 0;
  while (i < a.length && j < b.length) out[k++] = a[i] <= b[j] ? a[i++] : b[j++];
  while (i < a.length) out[k++] = a[i++];
  while (j < b.length) out[k++] = b[j++];
  return out;
}

/**
 * Distinct right values of each length 1, 2, ... (index 0 unused), made as the distinct-value engine makes them
 * (double precision, the engine's operand order), while a length costs at most maxOps operations: the measured
 * start of the growth that estimateDistinct extrapolates. Milliseconds (e, pi, sqr, +, *, ^: 11 lengths; the
 * default buttons: 4). JavaScript's Math differs from the engine's libm in the last bits of some values, which
 * changes the counts slightly.
 */
export function probeDistinct(consts: string[], funcs: string[], ops: string[], maxOps = 400000): number[] {
  const cv = consts.map(c => (numConstants[c] !== undefined ? numConstants[c] : parseFloat(c))).filter(usableValue);
  const fs = funcs.map(f => numFunctions[f]).filter(Boolean);
  const os = ops.filter(o => numOperators[o]);
  const levels: Float64Array[] = [new Float64Array(0)];
  const sizes = [0];
  let seen: Float64Array = new Float64Array(0);
  for (let k = 1; k <= MAX_LENGTH.distinct; k++) {
    let n = k === 1 ? cv.length : levels[k - 1].length * fs.length;
    if (k > 1)
      for (const o of os)
        for (let i = 1; i <= k - 2; i++) {
          const j = k - 1 - i, a = levels[i].length, b = levels[j].length;
          n += !COMMUTATIVE.has(o) ? a * b : i < j ? a * b : i === j ? (a * (a + 1)) / 2 : 0;
        }
    if (n > maxOps) break;
    const cand = new Float64Array(n);
    let m = 0;
    if (k === 1) for (const v of cv) cand[m++] = v + 0;
    else {
      const P = levels[k - 1];
      for (const f of fs)
        for (let a = 0; a < P.length; a++) {
          const r = f(P[a]);
          if (usableValue(r)) cand[m++] = r + 0;
        }
      for (const o of os) {
        const op = numOperators[o], comm = COMMUTATIVE.has(o);
        for (let i = 1; i <= k - 2; i++) {
          const j = k - 1 - i;
          if (comm && i > j) continue;
          const A = levels[i], B = levels[j];
          for (let ia = 0; ia < A.length; ia++)
            for (let jb = comm && i === j ? ia : 0; jb < B.length; jb++) {
              const r = op(A[ia], B[jb]);
              if (usableValue(r)) cand[m++] = r + 0;
            }
        }
      }
    }
    const sorted = cand.subarray(0, m).sort();
    const out: number[] = [];
    let p = 0;
    for (let i = 0; i < m; i++) {
      const v = sorted[i];
      if (i > 0 && v === sorted[i - 1]) continue;
      while (p < seen.length && seen[p] < v) p++;
      if (p < seen.length && seen[p] === v) continue;
      out.push(v);
    }
    const level = Float64Array.from(out);
    levels.push(level);
    sizes.push(level.length);
    seen = mergeSorted(seen, level);
  }
  return sizes;
}

/**
 * Estimated distinct values per length 1..K (index 0 unused): the probe's counts where measured; beyond, the code
 * counts times the fraction of distinct values, extrapolated geometrically from the last two measured lengths
 * (the fraction falls with the length: e, pi, sqr, +, *, ^ keep 10% of the codes of length 10, 6% at 11, and the
 * extrapolation gives 1.8% at 14, measured 1.8%). Left sides (x once): the left codes times 0.55 of that fraction
 * (e, pi, sqr, +, *, ^: 0.51 measured up to length 11).
 */
export function distinctSizes(K: number, probe: number[], nc: number, nu: number, nb: number): { right: number[]; left: number[] } {
  const c = codeCounts(Math.max(K, 1), nc, nu, nb);
  const frac: number[] = new Array(K + 1).fill(1);
  const measured: number[] = [];
  for (let k = 1; k < probe.length && k <= K; k++) if (c.right[k] > 0 && probe[k] > 0) measured.push(k);
  for (let k = 1; k <= K; k++) {
    if (k < probe.length && c.right[k] > 0) { frac[k] = Math.min(1, probe[k] / c.right[k]); continue; }
    const n = measured.length;
    if (n === 0) { frac[k] = 1; continue; }
    const k1 = measured[n - 1], f1 = probe[k1] / c.right[k1];
    if (n === 1) { frac[k] = f1; continue; }
    const k0 = measured[n - 2], f0 = probe[k0] / c.right[k0];
    frac[k] = Math.min(1, f1 * Math.pow(Math.min(1, f1 / f0), (k - k1) / (k1 - k0)));
  }
  const right = c.right.map((x, k) => (k === 0 ? 0 : k < probe.length ? probe[k] : x * frac[k]));
  const left = c.left.map((x, k) => (k === 0 ? 0 : Math.min(x, Math.max(1, 0.55 * x * frac[k]))));
  return { right, left };
}

// Measured in WebAssembly (Node, one thread, e, pi, sqr, +, *, ^): the table about 330 ns per distinct value (made,
// sorted, merged), a left side about 350 ns per estimated value (made, merged, matched: 0.4 s at |L| <= 12,
// 5.6 s at 14, 27 s at 15; the default buttons at |L| <= 7 natively 11 s against 20 s for every code, as the ratio
// of the two estimates). Kept values: 24 bytes on the right, 28 on the left; the engine works in passes within the
// memory limit, about a third of it for a pass.
const NS_PER_RIGHT_VALUE = 330;
const NS_PER_LEFT_VALUE = 350;

export function estimateDistinct(KL: number, KR: number, probe: number[], nc: number, nu: number, nb: number): Estimate {
  const KT = Math.max(KR, KL - 2);   // right levels kept: the matched ones, and the constants of the left sides
  const s = distinctSizes(Math.max(KT, KL), probe, nc, nu, nb);
  const rightValues = cumulative(s.right, KT);
  const tableGB = (rightValues * 24) / 2 ** 30;
  const pass = (n: number) => Math.min((n * 1.3 * 64) / 2 ** 30, MEMORY_LIMIT_GB / 3);
  // the longest right level while it is made: the shorter levels, one pass, and the level counted twice, as the
  // engine counts a level made in several passes (its parts and the level joined from them; make_level), so that
  // the page offers no table that the engine refuses
  const buildGB = ((rightValues - (s.right[KT] ?? 0)) * 24 + 2 * (s.right[KT] ?? 0) * 24) / 2 ** 30 + pass(s.right[KT] ?? 0);
  const kept = cumulative(s.left, KL - 1);
  const leftValues = kept + 1.2 * (s.left[KL] ?? 0);
  const searchGB = tableGB + (kept * 28) / 2 ** 30 + pass(s.left[KL - 1] ?? 0) + 0.03;
  const peakGB = Math.max(buildGB, searchGB);
  const searchSeconds = leftValues * NS_PER_LEFT_VALUE * 1e-9;
  return {
    unit: 'values',
    rightCodes: rightValues,
    tableGB,
    peakGB,
    buildSeconds: rightValues * NS_PER_RIGHT_VALUE * 1e-9,
    leftCodes: leftValues,
    searchSeconds,
    tooBig: peakGB > MEMORY_LIMIT_GB,
    tooLong: searchSeconds > TIME_LIMIT_SECONDS,
  };
}

/**
 * The engine of a search. 'automatic': x any number of times, or no probe yet, every code; a side longer than the
 * codes engine takes, distinct values; otherwise the one within the browser's limits, and if both are, distinct
 * values when its first search (table and one number) is estimated at least 30% shorter (every code needs half the
 * memory per value).
 */
export function chooseEngine(choice: EngineChoice, anyX: boolean, kl: number, kr: number, codes: Estimate,
                             distinct: Estimate | null): Engine {
  if (anyX) return 'codes';
  if (choice !== 'automatic') return choice;
  if (!distinct) return 'codes';
  if (kl > MAX_LENGTH.codes || kr > MAX_LENGTH.codes) return 'distinct';
  const fits = (e: Estimate) => !e.tooBig && !e.tooLong;
  if (fits(distinct) !== fits(codes)) return fits(distinct) ? 'distinct' : 'codes';
  const time = (e: Estimate) => e.buildSeconds + e.searchSeconds;
  return time(distinct) < 0.7 * time(codes) ? 'distinct' : 'codes';
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
