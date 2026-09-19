// Complex-number helpers for the frontend: parsing user input, deriving its
// precision, and formatting values returned by the WASM engine.
//
// All complex arithmetic happens in the WASM engine (every result row carries
// value_re/value_im), so nothing here evaluates formulas.

import { extractPrecision } from './rpn';

export type Domain = 'auto' | 'real' | 'complex';

export interface ComplexInput {
  re: number;
  im: number;
  isComplex: boolean;   // true when the text had an imaginary part
  reText: string;       // textual parts, for precision extraction ('' if absent)
  imText: string;
}

const NUM = '(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][+-]?\\d+)?';
const RE_REAL = new RegExp(`^[+-]?${NUM}$`);
const RE_RE_IM = new RegExp(`^([+-]?${NUM})([+-](?:${NUM})?)i$`);   // a+bi, a-i
const RE_IM = new RegExp(`^([+-]?(?:${NUM})?)i$`);                    // bi, i, -i
const RE_IM_RE = new RegExp(`^([+-]?(?:${NUM})?)i([+-]${NUM})$`);    // bi+a

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
    return { re: parseFloat(s), im: 0, isComplex: false, reText: s, imText: '' };
  }

  const coef = (t: string): number => {
    if (t === '' || t === '+') return 1;
    if (t === '-') return -1;
    return parseFloat(t);
  };

  let m = RE_RE_IM.exec(s);
  if (m) {
    return { re: parseFloat(m[1]), im: coef(m[2]), isComplex: true, reText: m[1], imText: m[2] };
  }
  m = RE_IM_RE.exec(s);
  if (m) {
    return { re: parseFloat(m[2]), im: coef(m[1]), isComplex: true, reText: m[2], imText: m[1] };
  }
  m = RE_IM.exec(s);
  if (m) {
    return { re: 0, im: coef(m[1]), isComplex: true, reText: '', imText: m[1] };
  }
  return null;
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
