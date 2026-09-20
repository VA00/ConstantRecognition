'use client';

import type { ReactNode } from 'react';
import { GameState, GAME_CONSTS, GAME_OPS, GAME_FUNCS, isLocked, isRemoved } from '../lib/game';

// Button faces as in CALC_Milei.png
export const KEY_LABELS: Record<string, ReactNode> = {
  PI: 'π', EULER: 'e', NEG: '−1', I: 'i', ZERO: '0',
  ONE: '1', TWO: '2', THREE: '3', FOUR: '4', FIVE: '5', SIX: '6', SEVEN: '7', EIGHT: '8', NINE: '9',
  PLUS: '+', TIMES: '×', SUBTRACT: '−', DIVIDE: '/',
  POWER: <>x<sup>y</sup></>, LOGARITHM: <>log<sub>x</sub>y</>,
  LOG: 'Log', EXP: 'Exp', INV: '1/x', MINUS: '±', SQRT: '√x', SQR: <>x<sup>2</sup></>,
  SIN: 'Sin', ARCSIN: 'ArcSin', COS: 'Cos', ARCCOS: 'ArcCos', TAN: 'Tan', ARCTAN: 'ArcTan',
  SINH: 'Sinh', ARCSINH: 'ArcSinh', COSH: 'Cosh', ARCCOSH: 'ArcCosh', TANH: 'Tanh', ARCTANH: 'ArcTanh',
};

interface KeypadProps {
  state: GameState;
  busy: string | null;      // button whose search is running
  disabled: boolean;        // while a search runs
  onPress: (button: string) => void;
}

function Key({
  token, state, busy, disabled, onPress, className = '',
}: KeypadProps & { token: string; className?: string }) {
  const removed = isRemoved(state, token);
  const locked = isLocked(state, token);
  const isBusy = busy === token;
  const face = [
    'relative flex items-center justify-center rounded-md border-2 font-mono select-none transition-colors',
    'h-9 text-base sm:h-10 sm:text-lg',
    className,
  ];
  if (removed) {
    face.push('border-dashed border-gray-300 text-gray-300 line-through dark:border-[#333] dark:text-[#444]',
      'hover:border-gray-400 hover:text-gray-400');
  } else if (locked) {
    face.push('border-emerald-500/70 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200');
  } else if (isBusy) {
    face.push('border-[#0066cc] bg-[#0066cc]/10 text-[#0066cc] animate-pulse');
  } else {
    face.push('border-gray-900 bg-white text-gray-900 hover:bg-[#0066cc]/10 hover:border-[#0066cc]',
      'dark:border-gray-200 dark:bg-[#111113] dark:text-white',
      'disabled:hover:bg-white dark:disabled:hover:bg-[#111113] disabled:hover:border-gray-900');
  }
  return (
    <button
      type="button"
      onClick={() => onPress(token)}
      disabled={disabled && !removed}
      title={removed ? `${token}: removed, click to see the formula` : locked ? `${token}: goal button, locked` : `${token}: try to remove`}
      className={face.join(' ')}
    >
      {KEY_LABELS[token] ?? token}
      {locked && (
        <span className="absolute right-1 top-0.5 text-[10px] leading-none text-emerald-600 dark:text-emerald-400" aria-label="locked">
          🔒
        </span>
      )}
    </button>
  );
}

export function Keypad(props: KeypadProps) {
  const grid = (tokens: string[], cols: string, keyClass = '') => (
    <div className={`grid ${cols} gap-1.5`}>
      {tokens.map(t => <Key key={t} token={t} className={keyClass} {...props} />)}
    </div>
  );
  return (
    <div className="flex w-full max-w-sm flex-col items-stretch gap-2">
      {grid(GAME_CONSTS.slice(0, 5), 'grid-cols-5')}
      <div className="px-6 sm:px-10">{grid(GAME_OPS, 'grid-cols-2')}</div>
      <div className="px-12 sm:px-20">{grid(GAME_CONSTS.slice(5), 'grid-cols-3')}</div>
      {grid(GAME_FUNCS, 'grid-cols-3', 'text-sm sm:text-base')}
    </div>
  );
}
