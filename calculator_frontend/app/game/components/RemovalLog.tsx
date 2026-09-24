'use client';

import { Latex } from '../../calculator/components/Latex';
import { Removal, identityOf } from '../lib/game';
import { KEY_LABELS } from './Keypad';

interface RemovalLogProps {
  history: Removal[];
  selected: string | null;              // button whose identity is highlighted
  onSelect: (button: string) => void;
}

// The sequence of removals so far, oldest first
export function RemovalLog({ history, selected, onSelect }: RemovalLogProps) {
  if (history.length === 0) {
    return (
      <p className="text-sm text-gray-500 dark:text-gray-400">
        No button removed yet. The order matters: remove <span className="font-mono">√x</span> or{' '}
        <span className="font-mono">i</span> too early and the remaining formulas get long.
      </p>
    );
  }
  return (
    <ol className="space-y-1">
      {history.map((r, i) => {
        const id = identityOf(r);
        const active = r.button === selected;
        return (
          <li key={`${i}-${r.button}`}>
            <button
              type="button"
              onClick={() => onSelect(r.button)}
              className={`flex w-full items-center gap-3 rounded-md px-2 py-1 text-left transition-colors
                ${active ? 'bg-[#0066cc]/10' : 'hover:bg-gray-100 dark:hover:bg-[#222]'}`}
            >
              <span className="w-6 shrink-0 text-right font-mono text-xs text-gray-400">{i + 1}.</span>
              <span className="w-14 shrink-0 font-mono text-sm text-gray-700 dark:text-gray-200">{KEY_LABELS[r.button] ?? r.button}</span>
              <span className="min-w-0 flex-1 overflow-x-auto text-gray-900 dark:text-gray-100">
                <Latex formula={`${id.lhs} = ${id.rhs}`} />
              </span>
              <span className="shrink-0 font-mono text-[10px] text-gray-400">K={r.K}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
