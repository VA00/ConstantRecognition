// Complex-number helpers for the frontend: parsing user input, deriving its
// precision, and formatting values returned by the WASM engine.
//
// Search results carry their own values (value_re/value_im from the WASM
// engine); only a formula typed as the target is evaluated in the page, see
// formula.ts.

import { extractPrecision } from './rpn';
import { evaluateFormula } from './formula';
import { ErrorMode } from './types';

export type Domain = 'auto' | 'real' | 'complex';

export interface ComplexInput {
  re: number;
  im: number;
  isComplex: boolean;   // true when the text had an imaginary part
  reText: string;       // textual parts, for precision extraction ('' if absent)
  imText: string;
  // true for integers (3, -7, 3+4i, 2i) and formulas: searched exactly, since
  // their value carries no rounding of typed decimals
  exact: boolean;
  formula?: boolean;    // the text was a formula, evaluated in the page
}

const NUM = '(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][+-]?\\d+)?';
const RE_REAL = new RegExp(`^[+-]?${NUM}$`);
const RE_RE_IM = new RegExp(`^([+-]?${NUM})([+-](?:${NUM})?)i$`);   // a+bi, a-i
const RE_IM = new RegExp(`^([+-]?(?:${NUM})?)i$`);                    // bi, i, -i
const RE_IM_RE = new RegExp(`^([+-]?(?:${NUM})?)i([+-]${NUM})$`);    // bi+a
// Integer parts: "7", "-3", and the bare coefficients of "i", "+i", "-i"
const isIntegerText = (t: string) => /^[+-]?\d*$/.test(t);

// Accepts "3.14", "1+2i", "1 - 2.5 i", "2i", "-i", "i", "0.5+0.3I", "1+2*i",
// Mathematica-style "1 + 2 I", unicode minus. Returns null when unparsable.
export function parseComplexInput(raw: string): ComplexInput | null {
  if (!raw) return null;
  if (/[\d.]\s+[\d.]/.test(raw)) return null;   // "2 3" is not a number
  const s = raw
    .replace(/−/g, '-')   // unicode minus
    .replace(/\s+/g, '')
    .replace(/\*/g, '')
    .replace(/I/g, 'i')
    .replace(/[jJ]$/, 'i');    // engineering notation
  if (!s) return null;

  if (RE_REAL.test(s)) {
    return { re: parseFloat(s), im: 0, isComplex: false, reText: s, imText: '', exact: isIntegerText(s) };
  }

  const coef = (t: string): number => {
    if (t === '' || t === '+') return 1;
    if (t === '-') return -1;
    return parseFloat(t);
  };

  const complex = (re: number, im: number, reText: string, imText: string): ComplexInput =>
    ({ re, im, isComplex: true, reText, imText, exact: isIntegerText(reText) && isIntegerText(imText) });
  let m = RE_RE_IM.exec(s);
  if (m) return complex(parseFloat(m[1]), coef(m[2]), m[1], m[2]);
  m = RE_IM_RE.exec(s);
  if (m) return complex(parseFloat(m[2]), coef(m[1]), m[2], m[1]);
  m = RE_IM.exec(s);
  if (m) return complex(0, coef(m[1]), '', m[1]);
  return null;
}

// The search box: a number as above, or else a formula ("2/3", "asin(-1/3)",
// "5 Pi^2/96"). null for an empty box, { error } when neither parses.
export function parseTargetInput(raw: string): ComplexInput | { error: string } | null {
  if (!raw.trim()) return null;
  const number = parseComplexInput(raw);
  if (number) return number;
  const f = evaluateFormula(raw);
  if (!f.ok) return { error: f.error };
  const { re, im } = f.value;
  return { re, im, isComplex: im !== 0, reText: '', imText: '', exact: true, formula: true };
}

// Absolute uncertainty used by the search, and where it comes from. The one
// rule for every place that shows or uses it:
//   zero      -> 0
//   manual    -> the typed ±, which must be a positive number
//   automatic -> 0 for integers and formulas, else half a unit of the last
//                typed decimal (complexAutoDelta)
export function targetDelta(
  input: ComplexInput, mode: ErrorMode, manualError: string
): { delta: number; source: string } | { error: string } {
  if (mode === 'zero') return { delta: 0, source: '± 0 selected' };
  if (mode === 'manual') {
    const d = parseFloat(manualError);
    if (!(Number.isFinite(d) && d > 0)) return { error: 'Type the manual ± in Advanced Options' };
    return { delta: d, source: 'manual' };
  }
  if (input.exact) return { delta: 0, source: input.formula ? 'formula' : 'integer' };
  return { delta: complexAutoDelta(input), source: 'from typed digits' };
}

// Absolute uncertainty implied by the number of decimals typed. For a
// complex input the looser of the two parts is used; a bare "i" or "+i"
// counts like an integer (half a unit).
export function complexAutoDelta(input: ComplexInput): number {
  const partDelta = (t: string): number => {
    const digits = t.replace(/^[+-]/, '');
    if (digits === '' || digits === '.') return 0.5;
    return parseFloat(extractPrecision(digits).deltaZ ?? '0.5');
  };
  if (!input.isComplex) return partDelta(input.reText);
  const dRe = input.reText ? partDelta(input.reText) : 0;
  const dIm = partDelta(input.imText);
  return Math.max(dRe, dIm);
}

export function complexAbs(re: number, im: number): number {
  return Math.hypot(re, im);
}

// "3.14", "2i", "1 + 2i", "1 - 2i"; parts use the shortest round-trip form.
export function formatComplex(re: number, im: number): string {
  if (!Number.isFinite(re) || !Number.isFinite(im)) return 'N/A';
  if (im === 0) return re.toString();
  const imAbs = Math.abs(im);
  const imText = imAbs === 1 ? '' : imAbs.toString();
  if (re === 0) return `${im < 0 ? '-' : ''}${imText}i`;
  return `${re} ${im < 0 ? '-' : '+'} ${imText}i`;
}

// Same, but with limited significant digits for compact display.
export function formatComplexShort(re: number, im: number, digits = 6): string {
  if (!Number.isFinite(re) || !Number.isFinite(im)) return 'N/A';
  const f = (x: number) => parseFloat(x.toPrecision(digits)).toString();
  if (im === 0) return f(re);
  const imAbs = Math.abs(im);
  const imText = imAbs === 1 ? '' : f(imAbs);
  if (re === 0) return `${im < 0 ? '-' : ''}${imText}i`;
  return `${f(re)} ${im < 0 ? '-' : '+'} ${imText}i`;
}

// Which engine to use for a given setting, input and button palette.
export function resolveDomain(domain: Domain, input: ComplexInput | null, enabledTokens: string[]): 'real' | 'complex' {
  if (domain === 'real') return 'real';
  if (domain === 'complex') return 'complex';
  if (input?.isComplex) return 'complex';
  if (enabledTokens.includes('I')) return 'complex';
  return 'real';
}
