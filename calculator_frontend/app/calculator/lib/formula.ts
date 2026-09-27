// Formulas typed as the search target: "2/3", "asin(-1/3)", "5 Pi^2/96",
// "ArcSin[-1/3]", "Log[2, 8]", "N[E^Pi, 32]". The value is computed here in
// double precision and searched as an exact target, which makes the page a
// formula rewriter: remove the buttons you do not want (say pi) and search
// again.
//
// Syntax: + - * / ^ (also ** and the unicode forms − × · ÷), parentheses
// ( ) or [ ], implicit multiplication ("2pi", "5 Pi^2", "2 Sqrt[2]"),
// unary minus below ^ as in Mathematica (-2^2 = -4). Names are
// case-insensitive; the imaginary unit is i or I.
//
// Arithmetic is complex, with real fast paths: for real arguments inside
// the real domain the JS Math functions are used (about 1 ULP), so a real
// formula lands well within the engine's exact tolerance (16 ULP real,
// 64 complex). Outside the real domain (sqrt(-2), asin(2), log(-1)) the
// principal branch is taken, as in the complex engine.

import { gamma as lanczosGamma, numConstants } from './rpn';

export interface Complex { re: number; im: number }

export type FormulaResult = { ok: true; value: Complex } | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Complex arithmetic
// ---------------------------------------------------------------------------

// A zero imaginary part is always +0: "-1" must lie above the branch cut of
// log and sqrt (log(-1) = +iπ), like the engine's NEG = -1 + 0i. A -0 left
// by negation would put it below (atan2(-0, -1) = -π).
const C = (re: number, im = 0): Complex => ({ re, im: im === 0 ? 0 : im });
const isReal = (z: Complex) => z.im === 0;

const add = (a: Complex, b: Complex) => C(a.re + b.re, a.im + b.im);
const sub = (a: Complex, b: Complex) => C(a.re - b.re, a.im - b.im);
const neg = (a: Complex) => C(-a.re, -a.im);
function mul(a: Complex, b: Complex): Complex {
  if (isReal(a) && isReal(b)) return C(a.re * b.re);
  return C(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
}
function div(a: Complex, b: Complex): Complex {
  if (isReal(b)) return C(a.re / b.re, a.im / b.re);
  // Smith's algorithm: no overflow in |b|^2
  if (Math.abs(b.re) >= Math.abs(b.im)) {
    const r = b.im / b.re, d = b.re + b.im * r;
    return C((a.re + a.im * r) / d, (a.im - a.re * r) / d);
  }
  const r = b.re / b.im, d = b.re * r + b.im;
  return C((a.re * r + a.im) / d, (a.im * r - a.re) / d);
}

const I = C(0, 1);
const ONE = C(1);

function exp(z: Complex): Complex {
  if (isReal(z)) return C(Math.exp(z.re));
  const m = Math.exp(z.re);
  return C(m * Math.cos(z.im), m * Math.sin(z.im));
}
function log(z: Complex): Complex {
  if (isReal(z) && z.re >= 0) return C(Math.log(z.re));
  return C(Math.log(Math.hypot(z.re, z.im)), Math.atan2(z.im, z.re));
}
function sqrt(z: Complex): Complex {
  if (isReal(z)) return z.re >= 0 ? C(Math.sqrt(z.re)) : C(0, Math.sqrt(-z.re));
  // Principal root, computed without cancellation
  const m = Math.hypot(z.re, z.im);
  if (z.re >= 0) {
    const t = Math.sqrt((m + z.re) / 2);
    return C(t, z.im / (2 * t));
  }
  const t = Math.sqrt((m - z.re) / 2);
  return C(Math.abs(z.im) / (2 * t), Math.sign(z.im) * t);
}
function pow(a: Complex, b: Complex): Complex {
  if (isReal(a) && isReal(b) && (a.re >= 0 || Number.isInteger(b.re))) return C(Math.pow(a.re, b.re));
  // Integer exponents by repeated squaring: i^2 = -1 exactly, no rounding
  // residue in the imaginary part as exp(2 log i) would leave
  if (isReal(b) && Number.isInteger(b.re) && Math.abs(b.re) <= 1024) {
    let n = Math.abs(b.re), base = a, r = ONE;
    while (n > 0) {
      if (n & 1) r = mul(r, base);
      base = mul(base, base);
      n >>= 1;
    }
    return b.re < 0 ? div(ONE, r) : r;
  }
  if (a.re === 0 && a.im === 0) return b.re > 0 ? C(0) : C(NaN);
  return exp(mul(b, log(a)));
}

// sin, cos of a+bi from the real functions
function sin(z: Complex): Complex {
  if (isReal(z)) return C(Math.sin(z.re));
  return C(Math.sin(z.re) * Math.cosh(z.im), Math.cos(z.re) * Math.sinh(z.im));
}
function cos(z: Complex): Complex {
  if (isReal(z)) return C(Math.cos(z.re));
  return C(Math.cos(z.re) * Math.cosh(z.im), -Math.sin(z.re) * Math.sinh(z.im));
}
const tan = (z: Complex) => (isReal(z) ? C(Math.tan(z.re)) : div(sin(z), cos(z)));
// Hyperbolic functions through the circular ones: sinh z = -i sin(iz), ...
const iz = (z: Complex) => mul(I, z);
const sinh = (z: Complex) => (isReal(z) ? C(Math.sinh(z.re)) : mul(C(0, -1), sin(iz(z))));
const cosh = (z: Complex) => (isReal(z) ? C(Math.cosh(z.re)) : cos(iz(z)));
const tanh = (z: Complex) => (isReal(z) ? C(Math.tanh(z.re)) : mul(C(0, -1), tan(iz(z))));

// Inverse functions: real fast path inside the real domain, otherwise the
// principal branch from its logarithmic form
function asin(z: Complex): Complex {
  if (isReal(z) && Math.abs(z.re) <= 1) return C(Math.asin(z.re));
  return mul(C(0, -1), log(add(iz(z), sqrt(sub(ONE, mul(z, z))))));
}
function acos(z: Complex): Complex {
  if (isReal(z) && Math.abs(z.re) <= 1) return C(Math.acos(z.re));
  return sub(C(Math.PI / 2), asin(z));
}
function atan(z: Complex): Complex {
  if (isReal(z)) return C(Math.atan(z.re));
  // (i/2) (log(1 - iz) - log(1 + iz))
  return mul(C(0, 0.5), sub(log(sub(ONE, iz(z))), log(add(ONE, iz(z)))));
}
function asinh(z: Complex): Complex {
  if (isReal(z)) return C(Math.asinh(z.re));
  return log(add(z, sqrt(add(mul(z, z), ONE))));
}
function acosh(z: Complex): Complex {
  if (isReal(z) && z.re >= 1) return C(Math.acosh(z.re));
  return log(add(z, mul(sqrt(add(z, ONE)), sqrt(sub(z, ONE)))));
}
function atanh(z: Complex): Complex {
  if (isReal(z) && Math.abs(z.re) < 1) return C(Math.atanh(z.re));
  return mul(C(0.5), sub(log(add(ONE, z)), log(sub(ONE, z))));
}
function gammaFn(z: Complex): Complex {
  if (!isReal(z)) throw new FormulaError('Γ of a complex argument is not supported');
  const x = z.re;
  // Exact factorials for small positive integers, Lanczos otherwise
  if (Number.isInteger(x) && x >= 1 && x <= 23) {
    let f = 1;
    for (let k = 2; k < x; k++) f *= k;
    return C(f);
  }
  return C(lanczosGamma(x));
}

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

const CONSTANTS: Record<string, Complex> = {
  pi: C(Math.PI), 'π': C(Math.PI),
  e: C(Math.E),
  i: I,
  phi: C(numConstants.GOLDENRATIO), 'φ': C(numConstants.GOLDENRATIO), goldenratio: C(numConstants.GOLDENRATIO),
  catalan: C(numConstants.CATALAN),
  eulergamma: C(numConstants.EULERGAMMA), 'γ': C(numConstants.EULERGAMMA),
  glaisher: C(numConstants.GLAISHER),
  khinchin: C(numConstants.KHINCHIN),
};

const UNARY: Record<string, (z: Complex) => Complex> = {
  sqrt, exp, ln: log,
  sin, cos, tan, sinh, cosh, tanh,
  asin, arcsin: asin, acos, arccos: acos, atan, arctan: atan,
  asinh, arcsinh: asinh, arsinh: asinh,
  acosh, arccosh: acosh, arcosh: acosh,
  atanh, arctanh: atanh, artanh: atanh,
  gamma: gammaFn,
};

// ---------------------------------------------------------------------------
// Tokenizer and recursive-descent parser
// ---------------------------------------------------------------------------

class FormulaError extends Error {}

type Token =
  | { kind: 'num'; value: number }
  | { kind: 'name'; name: string }
  | { kind: 'op'; op: string };

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  const s = text
    .replace(/−/g, '-')
    .replace(/[×·]/g, '*')
    .replace(/÷/g, '/')
    .replace(/\*\*/g, '^');
  let p = 0;
  while (p < s.length) {
    const ch = s[p];
    if (/\s/.test(ch)) { p++; continue; }
    const num = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(s.slice(p));
    if (num) {
      tokens.push({ kind: 'num', value: parseFloat(num[0]) });
      p += num[0].length;
      continue;
    }
    const name = /^(?:[A-Za-z][A-Za-z0-9]*|[πφγ])/.exec(s.slice(p));
    if (name) {
      tokens.push({ kind: 'name', name: name[0].toLowerCase() });
      p += name[0].length;
      continue;
    }
    if ('+-*/^()[],'.includes(ch)) {
      tokens.push({ kind: 'op', op: ch });
      p++;
      continue;
    }
    throw new FormulaError(`unexpected "${ch}"`);
  }
  return tokens;
}

class Parser {
  private p = 0;
  constructor(private tokens: Token[]) {}

  private peek(): Token | undefined { return this.tokens[this.p]; }
  private isOp(op: string): boolean {
    const t = this.peek();
    return t !== undefined && t.kind === 'op' && t.op === op;
  }
  private expectClose(open: string): void {
    const close = open === '(' ? ')' : ']';
    if (!this.isOp(close)) throw new FormulaError(`missing "${close}"`);
    this.p++;
  }

  parse(): Complex {
    if (this.tokens.length === 0) throw new FormulaError('empty formula');
    const v = this.expr();
    if (this.p < this.tokens.length) throw new FormulaError('unexpected text after the formula');
    return v;
  }

  // expr = term (('+' | '-') term)*
  private expr(): Complex {
    let v = this.term();
    while (this.isOp('+') || this.isOp('-')) {
      const op = (this.tokens[this.p++] as { op: string }).op;
      const r = this.term();
      v = op === '+' ? add(v, r) : sub(v, r);
    }
    return v;
  }

  // term = unary (('*' | '/' | juxtaposition) unary)*
  private term(): Complex {
    let v = this.unary();
    for (;;) {
      if (this.isOp('*') || this.isOp('/')) {
        const op = (this.tokens[this.p++] as { op: string }).op;
        const r = this.unary();
        v = op === '*' ? mul(v, r) : div(v, r);
      } else if (this.startsPrimary()) {
        v = mul(v, this.power());   // "2pi", "5 Pi^2", "2 Sqrt[2]"
      } else {
        return v;
      }
    }
  }

  private startsPrimary(): boolean {
    const t = this.peek();
    return t !== undefined && (t.kind === 'num' || t.kind === 'name' || (t.kind === 'op' && (t.op === '(' || t.op === '[')));
  }

  // unary = ('-' | '+') unary | power      (so -2^2 = -(2^2))
  private unary(): Complex {
    if (this.isOp('-')) { this.p++; return neg(this.unary()); }
    if (this.isOp('+')) { this.p++; return this.unary(); }
    return this.power();
  }

  // power = primary ('^' unary)?           (right-associative, 2^-1 allowed)
  private power(): Complex {
    const base = this.primary();
    if (this.isOp('^')) {
      this.p++;
      return pow(base, this.unary());
    }
    return base;
  }

  private primary(): Complex {
    const t = this.peek();
    if (!t) throw new FormulaError('the formula ends too early');
    if (t.kind === 'num') { this.p++; return C(t.value); }
    if (t.kind === 'op' && (t.op === '(' || t.op === '[')) {
      this.p++;
      const v = this.expr();
      this.expectClose(t.op);
      return v;
    }
    if (t.kind === 'name') {
      this.p++;
      const next = this.peek();
      const call = next !== undefined && next.kind === 'op' && (next.op === '(' || next.op === '[');
      if (call) return this.call(t.name, (next as { op: string }).op);
      const c = CONSTANTS[t.name];
      if (c) return c;
      if (UNARY[t.name] || t.name === 'log' || t.name === 'n') throw new FormulaError(`${t.name} needs an argument in ( )`);
      throw new FormulaError(`unknown name "${t.name}"`);
    }
    throw new FormulaError(`unexpected "${(t as { op: string }).op}"`);
  }

  private call(name: string, open: string): Complex {
    this.p++;   // the opening bracket
    const args = [this.expr()];
    while (this.isOp(',')) { this.p++; args.push(this.expr()); }
    this.expectClose(open);
    if (name === 'log') {
      // log(x) natural; log(b, x) = log_b(x) as Mathematica's Log[b, x]
      if (args.length === 1) return log(args[0]);
      if (args.length === 2) return div(log(args[1]), log(args[0]));
      throw new FormulaError('log takes 1 or 2 arguments');
    }
    if (name === 'n') {
      // Mathematica's N[expr] and N[expr, digits]: the value, in double precision
      if (args.length === 1 || args.length === 2) return args[0];
      throw new FormulaError('N takes 1 or 2 arguments');
    }
    const f = UNARY[name];
    if (!f) throw new FormulaError(`unknown function "${name}"`);
    if (args.length !== 1) throw new FormulaError(`${name} takes 1 argument`);
    return f(args[0]);
  }
}

export function evaluateFormula(text: string): FormulaResult {
  try {
    const value = new Parser(tokenize(text)).parse();
    if (!Number.isFinite(value.re) || !Number.isFinite(value.im)) {
      return { ok: false, error: 'the formula has no finite value' };
    }
    return { ok: true, value };
  } catch (e) {
    if (e instanceof FormulaError) return { ok: false, error: e.message };
    throw e;
  }
}
