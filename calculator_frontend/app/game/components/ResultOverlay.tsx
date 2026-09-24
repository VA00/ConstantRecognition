'use client';

import { Latex } from '../../calculator/components/Latex';
import { Identity } from '../lib/game';
import { formatDuration } from '../../calculator/lib/estimate';

// Small-screen companion to the status card: the keypad fills a phone screen
// and the card sits below it, out of sight. The overlay repeats what matters
// on top of the keypad: progress while searching, the found identity for a
// moment, the decision after a miss, or the victory card with the total time
// (shown on every screen size: the player presents it to claim the prize).
export type OverlayContent =
  | { kind: 'searching'; lhs: string; elapsed: number; maxK: number; estimate: number }
  | { kind: 'found'; identity: Identity; label: string; K: number }
  | { kind: 'notfound'; lhs: string; maxK: number; seconds: number; deeperK: number; deeperSeconds: number }
  | { kind: 'won'; time: string; removals: number }
  | { kind: 'error'; message: string };

interface ResultOverlayProps {
  content: OverlayContent;
  onClose: () => void;
  onAbort: () => void;
  onDeeper: () => void;
}

export function ResultOverlay({ content, onClose, onAbort, onDeeper }: ResultOverlayProps) {
  const card = 'w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl dark:bg-[#1a1a1d]';
  const button = 'rounded-md px-3 py-2 text-sm font-medium';
  // Cards without controls close on a tap anywhere, including the card itself
  const tapToClose = content.kind === 'found' || content.kind === 'won';
  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 ${content.kind === 'won' ? '' : 'lg:hidden'}`}
      onClick={content.kind === 'searching' ? undefined : onClose}
      role="dialog"
    >
      <div className={card} onClick={tapToClose ? undefined : e => e.stopPropagation()}>
        {content.kind === 'searching' && (
          <div className="space-y-3 text-center">
            <div className="flex items-center justify-center gap-3">
              <svg className="h-6 w-6 animate-spin text-[#0066cc]" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <span className="text-lg">Searching for <Latex formula={content.lhs} /></span>
            </div>
            <div className="font-mono text-2xl tabular-nums">{content.elapsed.toFixed(1)} s</div>
            <div className="text-xs text-gray-500">K ≤ {content.maxK}, at most {formatDuration(content.estimate)}</div>
            <button type="button" onClick={onAbort} className={`${button} border border-red-300 text-red-600`}>Stop</button>
          </div>
        )}

        {content.kind === 'found' && (
          <div className="space-y-3 text-center">
            <div className="text-xs uppercase tracking-wider text-emerald-600">Removed {content.label}</div>
            <div className="overflow-x-auto py-2 text-3xl">
              <Latex formula={`${content.identity.lhs} = ${content.identity.rhs}`} />
            </div>
            <div className="font-mono text-[11px] text-gray-500">{content.identity.mathematica}</div>
            <div className="text-xs text-gray-400">K = {content.K} · Tap anywhere to continue</div>
          </div>
        )}

        {content.kind === 'won' && (
          <div className="space-y-3 text-center">
            <div className="text-5xl">🏆</div>
            <div className="text-2xl font-semibold text-emerald-600">Reduced to EML!</div>
            <div className="text-sm text-gray-600 dark:text-gray-300">
              {content.removals} buttons removed, only <span className="font-mono">1, Exp, −, Log</span> remain.
            </div>
            <div className="text-xs uppercase tracking-wider text-gray-500">Total time</div>
            <div className="font-mono text-5xl tabular-nums">{content.time}</div>
            <div className="text-xs text-gray-400">Tap anywhere to close</div>
          </div>
        )}

        {content.kind === 'notfound' && (
          <div className="space-y-4 text-center">
            <div className="text-lg">
              No formula for <Latex formula={content.lhs} /> up to K = {content.maxK}
            </div>
            <div className="text-xs text-gray-500">{content.seconds.toFixed(1)} s searched. The button stays.</div>
            <div className="flex flex-col gap-2">
              <button type="button" onClick={onDeeper} className={`${button} bg-[#0066cc] text-white`}>
                Search deeper: K = {content.deeperK}, {formatDuration(content.deeperSeconds)}
              </button>
              <button type="button" onClick={onClose} className={`${button} border border-gray-300 dark:border-[#444]`}>
                Keep the button
              </button>
            </div>
          </div>
        )}

        {content.kind === 'error' && (
          <div className="space-y-3 text-center">
            <div className="text-red-600">{content.message}</div>
            <button type="button" onClick={onClose} className={`${button} border border-gray-300`}>Close</button>
          </div>
        )}
      </div>
    </div>
  );
}
