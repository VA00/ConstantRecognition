import { describe, it, expect } from 'vitest';
import {
  newGame, removeButton, undo, isWon, isLocked, canAttempt, removalTask, identityOf,
  START_BUTTONS, EML_BUTTONS, GAME_CONSTS, GAME_FUNCS, GAME_OPS, buttonKind,
} from '../app/game/lib/game';
import { planDepth, nextLevel, MIN_DEPTH } from '../app/game/lib/depth';
import { evaluateRPN } from '../app/calculator/lib/rpn';

describe('starting calculator (CALC_Milei.png)', () => {
  it('has 38 buttons: 14 constants, 6 operators, 18 functions, no Gamma, no witnesses', () => {
    expect(START_BUTTONS).toHaveLength(38);
    expect(GAME_CONSTS).toHaveLength(14);
    expect(GAME_OPS).toHaveLength(6);
    expect(GAME_FUNCS).toHaveLength(18);
    expect(START_BUTTONS).not.toContain('GAMMA');
    expect(START_BUTTONS).not.toContain('CATALAN');
    expect(START_BUTTONS).not.toContain('EULERGAMMA');
    expect(START_BUTTONS).not.toContain('GOLDENRATIO');
    for (const t of EML_BUTTONS) expect(START_BUTTONS).toContain(t);
    for (const t of START_BUTTONS) expect(() => buttonKind(t)).not.toThrow();
  });
});

describe('easy mode rules', () => {
  const g = newGame('easy');

  it('locks exactly the EML buttons', () => {
    for (const t of START_BUTTONS) expect(isLocked(g, t)).toBe(EML_BUTTONS.includes(t));
    expect(canAttempt(g, 'ONE')).toBe(false);
    expect(canAttempt(g, 'EIGHT')).toBe(true);
    expect(() => removalTask(g, 'EXP')).toThrow();
  });

  it('hard mode locks nothing', () => {
    const h = newGame('hard');
    for (const t of START_BUTTONS) expect(isLocked(h, t)).toBe(false);
  });

  it('is won exactly when only EML buttons remain', () => {
    expect(isWon(g)).toBe(false);
    const won = { ...g, remaining: [...EML_BUTTONS] };
    expect(isWon(won)).toBe(true);
  });
});

describe('removal tasks', () => {
  const g = newGame('easy');

  it('constant: its own value, searched without itself and without witnesses', () => {
    const t = removalTask(g, 'EIGHT');
    expect(t.kind).toBe('const');
    expect(t.targetRpn).toBe('EIGHT');
    expect(t.witnesses).toEqual([]);
    expect(t.selection.consts).not.toContain('EIGHT');
    expect(t.selection.consts).not.toContain('CATALAN');
    expect(t.selection.consts.length + t.selection.funcs.length + t.selection.ops.length).toBe(37);
  });

  it('function: f(G) with Catalan as an extra button', () => {
    const t = removalTask(g, 'SQRT');
    expect(t.kind).toBe('func');
    expect(t.targetRpn).toBe('CATALAN, SQRT');
    expect(t.witnesses).toEqual(['CATALAN']);
    expect(t.selection.funcs).not.toContain('SQRT');
    expect(t.selection.consts).toContain('CATALAN');
    expect(t.selection.consts).not.toContain('EULERGAMMA');
    expect(evaluateRPN(t.targetRpn)).toBeCloseTo(Math.sqrt(0.915965594177219), 15);
  });

  it('operator: x op y with x = G, y = gamma (y pushed first)', () => {
    const t = removalTask(g, 'POWER');
    expect(t.kind).toBe('op');
    expect(t.targetRpn).toBe('EULERGAMMA, CATALAN, POWER');
    expect(t.witnesses).toEqual(['CATALAN', 'EULERGAMMA']);
    expect(t.selection.ops).not.toContain('POWER');
    expect(t.selection.consts).toEqual(expect.arrayContaining(['CATALAN', 'EULERGAMMA']));
    // "a, b, OP" = OP(b, a): the value is G^gamma, not gamma^G
    expect(evaluateRPN(t.targetRpn)).toBeCloseTo(Math.pow(0.915965594177219, 0.5772156649015329), 15);
    const l = removalTask(g, 'LOGARITHM');
    expect(evaluateRPN(l.targetRpn)).toBeCloseTo(Math.log(0.5772156649015329) / Math.log(0.915965594177219), 12);
  });
});

describe('removals, undo and identities', () => {
  it('removes in sequence, undoes in reverse, keeps display order', () => {
    let g = newGame('easy');
    g = removeButton(g, { button: 'NINE', rpn: 'THREE, SQR', K: 2 });
    g = removeButton(g, { button: 'EIGHT', rpn: 'THREE, TWO, POWER', K: 3 });
    expect(g.remaining).toHaveLength(36);
    expect(g.history.map(r => r.button)).toEqual(['NINE', 'EIGHT']);
    expect(() => removeButton(g, { button: 'EIGHT', rpn: 'x', K: 1 })).toThrow();
    g = undo(g);
    expect(g.remaining).toContain('EIGHT');
    expect(g.remaining).not.toContain('NINE');
    expect(g.remaining.indexOf('EIGHT')).toBe(START_BUTTONS.indexOf('EIGHT') - 0);
    g = undo(g);
    expect(g.remaining).toEqual(START_BUTTONS);
    expect(undo(g)).toBe(g);
  });

  it('renders constants, functions and operators with witnesses as x and y', () => {
    expect(identityOf({ button: 'EIGHT', rpn: 'THREE, TWO, POWER', K: 3 })).toEqual({
      lhs: '8', rhs: '{2}^{3}', mathematica: '8 == (2 ^ 3)',
    });
    const sqrt = identityOf({ button: 'SQRT', rpn: 'TWO, INV, CATALAN, POWER', K: 4 });
    expect(sqrt.lhs).toBe('\\sqrt{x}');
    expect(sqrt.rhs).toBe('{x}^{\\frac{1}{2}}');
    expect(sqrt.mathematica).toBe('Sqrt[x] == (x ^ 1/(2))');
    const plus = identityOf({ button: 'PLUS', rpn: 'EULERGAMMA, MINUS, CATALAN, SUBTRACT', K: 4 });
    expect(plus.lhs).toBe('x + y');
    expect(plus.rhs).toBe('x - (-y)');
    const logb = identityOf({ button: 'LOGARITHM', rpn: 'CATALAN, LOG, EULERGAMMA, LOG, DIVIDE', K: 5 });
    expect(logb.lhs).toBe('\\log_{x}\\left(y\\right)');
    expect(logb.rhs).toBe('\\frac{\\ln(y)}{\\ln(x)}');
  });
});

describe('depth planning', () => {
  const sel = removalTask(newGame('easy'), 'EIGHT').selection;   // 37 buttons

  it('stays within the budget and never below the minimum depth', () => {
    const fast = planDepth(sel, 8, { complex: 3e7 }, 20);
    expect(fast.minK).toBe(1);
    expect(fast.maxK).toBeGreaterThanOrEqual(MIN_DEPTH);
    expect(fast.seconds).toBeLessThanOrEqual(20);
    const slow = planDepth(sel, 1, { complex: 1e6 }, 1);
    expect(slow.maxK).toBe(MIN_DEPTH);   // budget cannot be met: minimum depth anyway
    const rich = planDepth(sel, 16, { complex: 3e7 }, 600);
    expect(rich.maxK).toBeGreaterThan(fast.maxK);
  });

  it('search deeper covers exactly the next level', () => {
    const p = planDepth(sel, 8, { complex: 3e7 }, 20);
    const n = nextLevel(p, sel, 8, { complex: 3e7 });
    expect(n.minK).toBe(p.maxK + 1);
    expect(n.maxK).toBe(p.maxK + 1);
    expect(n.formulas).toBeGreaterThan(p.formulas);
  });
});
