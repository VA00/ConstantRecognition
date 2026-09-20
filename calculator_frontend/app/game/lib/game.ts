// EML reduction game: pure state and rules (no React, no workers).
//
// Start with the 38-button calculator of CALC_Milei.png and remove buttons
// one at a time. A button may go only when the recognizer finds an exact
// formula for it from the buttons that are left:
//
//   constant  c        target = c                buttons = remaining \ {c}
//   function  f        target = f(G)             buttons = remaining \ {f} + {G}
//   operator  op       target = G op gamma       buttons = remaining \ {op} + {G, gamma}
//
// G (Catalan) and gamma (EulerGamma) are "witness" constants that are not in
// the calculator; in the found formula they stand for x and y. The goal is
// the EML set {1, exp, log, -}, which is locked in easy mode.

import { CalculatorSelection, CALC4_CONSTS, CALC4_FUNCS, CALC4_OPS, EXTRA_CONSTS, EXTRA_FUNCS, EXTRA_OPS }
  from '../../calculator/lib/taskQueue';
import { rpnToLatex, rpnToMathematica, parseRPN } from '../../calculator/lib/rpn';

export type Mode = 'easy' | 'hard';
export type ButtonKind = 'const' | 'func' | 'op';

// Starting calculator (CALC_Milei.png), in display order
export const GAME_CONSTS = ['PI', 'EULER', 'NEG', 'I', 'ZERO',
  'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE'];
export const GAME_OPS = ['PLUS', 'TIMES', 'SUBTRACT', 'DIVIDE', 'POWER', 'LOGARITHM'];
export const GAME_FUNCS = ['LOG', 'EXP', 'INV', 'MINUS', 'SQRT', 'SQR',
  'SIN', 'ARCSIN', 'COS', 'ARCCOS', 'TAN', 'ARCTAN',
  'SINH', 'ARCSINH', 'COSH', 'ARCCOSH', 'TANH', 'ARCTANH'];
export const START_BUTTONS = [...GAME_CONSTS, ...GAME_OPS, ...GAME_FUNCS];

// EML[x, y] = Exp[x] - Log[y] with the constant 1
export const EML_BUTTONS = ['ONE', 'EXP', 'LOG', 'SUBTRACT'];

// Witness constants (not in the calculator) and the variable each stands for
export const WITNESS_UNARY = 'CATALAN';
export const WITNESS_BINARY_X = 'CATALAN';
export const WITNESS_BINARY_Y = 'EULERGAMMA';
export const WITNESS_VARS: Record<string, string> = { CATALAN: 'x', EULERGAMMA: 'y' };

const ALL_CONSTS = [...CALC4_CONSTS, ...EXTRA_CONSTS];
const ALL_FUNCS = [...CALC4_FUNCS, ...EXTRA_FUNCS];
const ALL_OPS = [...CALC4_OPS, ...EXTRA_OPS];

export function buttonKind(token: string): ButtonKind {
  if (ALL_CONSTS.includes(token)) return 'const';
  if (ALL_FUNCS.includes(token)) return 'func';
  if (ALL_OPS.includes(token)) return 'op';
  throw new Error(`Unknown button ${token}`);
}

export interface Removal {
  button: string;
  rpn: string;   // formula found, in engine RPN ("a, b, OP" = OP(b, a))
  K: number;
}

export interface GameState {
  mode: Mode;
  remaining: string[];   // in START_BUTTONS order
  history: Removal[];    // in removal order
}

export function newGame(mode: Mode = 'easy'): GameState {
  return { mode, remaining: [...START_BUTTONS], history: [] };
}

export function isLocked(state: GameState, button: string): boolean {
  return state.mode === 'easy' && EML_BUTTONS.includes(button);
}

export function isRemoved(state: GameState, button: string): boolean {
  return !state.remaining.includes(button);
}

export function canAttempt(state: GameState, button: string): boolean {
  return state.remaining.includes(button) && !isLocked(state, button);
}

export function removeButton(state: GameState, removal: Removal): GameState {
  if (!canAttempt(state, removal.button)) throw new Error(`Cannot remove ${removal.button}`);
  return {
    ...state,
    remaining: state.remaining.filter(t => t !== removal.button),
    history: [...state.history, removal],
  };
}

export function undo(state: GameState): GameState {
  const last = state.history[state.history.length - 1];
  if (!last) return state;
  return {
    ...state,
    remaining: START_BUTTONS.filter(t => state.remaining.includes(t) || t === last.button),
    history: state.history.slice(0, -1),
  };
}

// Won when nothing beyond the EML set is left (in hard mode possibly less)
export function isWon(state: GameState): boolean {
  return state.remaining.every(t => EML_BUTTONS.includes(t));
}

// Split a token list into the engine's three lists, canonical order
export function selectionOf(tokens: string[]): CalculatorSelection {
  return {
    consts: ALL_CONSTS.filter(t => tokens.includes(t)),
    funcs: ALL_FUNCS.filter(t => tokens.includes(t)),
    ops: ALL_OPS.filter(t => tokens.includes(t)),
  };
}

export interface RemovalTask {
  button: string;
  kind: ButtonKind;
  targetRpn: string;               // evaluated by the engine to get the target value
  selection: CalculatorSelection;  // buttons the search may use
  witnesses: string[];             // witness tokens present in the search
}

export function removalTask(state: GameState, button: string): RemovalTask {
  if (!canAttempt(state, button)) throw new Error(`Cannot remove ${button}`);
  const kind = buttonKind(button);
  const rest = state.remaining.filter(t => t !== button);
  if (kind === 'const') {
    return { button, kind, targetRpn: button, selection: selectionOf(rest), witnesses: [] };
  }
  if (kind === 'func') {
    return {
      button, kind,
      targetRpn: `${WITNESS_UNARY}, ${button}`,
      selection: selectionOf([...rest, WITNESS_UNARY]),
      witnesses: [WITNESS_UNARY],
    };
  }
  // "a, b, OP" = OP(b, a): push y first, then x, so the value is x op y
  return {
    button, kind,
    targetRpn: `${WITNESS_BINARY_Y}, ${WITNESS_BINARY_X}, ${button}`,
    selection: selectionOf([...rest, WITNESS_BINARY_X, WITNESS_BINARY_Y]),
    witnesses: [WITNESS_BINARY_X, WITNESS_BINARY_Y],
  };
}

// Witness tokens -> x, y (unknown tokens render verbatim in the converters)
export function substituteWitnesses(rpn: string): string[] {
  return parseRPN(rpn).map(t => WITNESS_VARS[t] ?? t);
}

// Left-hand side of the identity for a button: "8", "\sqrt{x}", "x + y"
export function buttonLatex(button: string): string {
  switch (buttonKind(button)) {
    case 'const': return rpnToLatex([button]);
    case 'func': return rpnToLatex(['x', button]);
    case 'op': return rpnToLatex(['y', 'x', button]);
  }
}

export function buttonMathematica(button: string): string {
  switch (buttonKind(button)) {
    case 'const': return rpnToMathematica([button]);
    case 'func': return rpnToMathematica(['x', button]);
    case 'op': return rpnToMathematica(['y', 'x', button]);
  }
}

export interface Identity {
  lhs: string;          // LaTeX
  rhs: string;          // LaTeX
  mathematica: string;  // "lhs == rhs" in Mathematica syntax
}

export function identityOf(removal: Removal): Identity {
  const tokens = substituteWitnesses(removal.rpn);
  return {
    lhs: buttonLatex(removal.button),
    rhs: rpnToLatex(tokens),
    mathematica: `${buttonMathematica(removal.button)} == ${rpnToMathematica(tokens)}`,
  };
}
