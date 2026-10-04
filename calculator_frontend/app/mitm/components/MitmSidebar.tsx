'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ErrorMode } from '../../calculator/lib/types';
import { formatCount, formatDuration } from '../../calculator/lib/estimate';
import { assetPath } from '../../calculator/lib/basePath';
import { getCalculatorById, DEFAULT_CALCULATOR_ID } from '../../calculator/lib/calculators';
import { CalculatorPalette } from '../../calculator/components/CalculatorPalette';
import { Estimate } from '../lib/mitm';

export const MAX_LEFT = 7;
export const MAX_RIGHT = 7;

// The table the worker holds, if any
export interface TableInfo {
  key: string;
  kr: number;
  sizes: number[];
  gb: number;
  ms: number;
}

interface MitmSidebarProps {
  isMobile: boolean;
  isOpen: boolean;
  onToggle: () => void;
  busy: boolean;
  workerReady: boolean;
  // buttons
  enabledTokens: string[];
  onToggleToken: (token: string) => void;
  onEnableAll: () => void;
  customInt: string;
  onCustomIntChange: (text: string) => void;
  hasConstants: boolean;
  // lengths
  kl: number;
  setKl: (n: number) => void;
  kr: number;
  setKr: (n: number) => void;
  anyx: boolean;
  setAnyx: (v: boolean) => void;
  est: Estimate;
  table: TableInfo | null;
  tableCurrent: boolean;   // the table matches the buttons and |R|
  // uncertainty
  errorMode: ErrorMode;
  setErrorMode: (m: ErrorMode) => void;
  manualError: string;
  setManualError: (v: string) => void;
  uncertaintyNote: string | null;
  exactTolEps: number;
  setExactTolEps: (v: number) => void;
}

const Label = ({ children }: { children: React.ReactNode }) => (
  <label className="text-[10px] font-medium text-gray-500 dark:text-gray-500 uppercase tracking-wider">{children}</label>
);

function Slider({ label, value, min, max, onChange, note, disabled }: {
  label: string; value: number; min: number; max: number; onChange: (n: number) => void; note: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={min}
          max={max}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(parseInt(e.target.value))}
          className="flex-1 accent-[#0066cc] h-2 disabled:opacity-40"
        />
        <span className="font-mono text-sm font-bold text-gray-900 dark:text-white w-6 text-right">{value}</span>
      </div>
      {note}
    </div>
  );
}

export function MitmSidebar(p: MitmSidebarProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const calculator = getCalculatorById(DEFAULT_CALCULATOR_ID);
  const tokenNotes: Record<string, string> = p.enabledTokens.includes('I') ? { I: 'real only' } : {};
  const tone = (s: number) => (s < 5 ? 'text-emerald-600 dark:text-emerald-400' : s < 60 ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400');
  const fmtGB = (gb: number) => (gb < 0.1 ? `${Math.max(1, Math.round(gb * 1024))} MB` : `${gb.toFixed(2)} GB`);

  const tableNote = p.est.tooBig ? (
    <p className="text-[11px] text-red-600 dark:text-red-400">
      ≈ {formatCount(p.est.rightCodes)} codes, about {fmtGB(p.est.tableGB)}: too large for the browser. Shorten the right
      side or switch buttons off.
    </p>
  ) : p.table && p.tableCurrent ? (
    <p className="text-[10px] font-mono text-emerald-600 dark:text-emerald-400">
      Table ready: {formatCount(p.table.sizes.reduce((s, x) => s + x, 0))} values, {fmtGB(p.table.gb)}, built in{' '}
      {formatDuration(p.table.ms / 1000)}; kept until the page closes
    </p>
  ) : (
    <p className={`text-[10px] font-mono ${tone(p.est.buildSeconds)}`}>
      Table built at the next search: ≈ {formatCount(p.est.rightCodes)} codes, ≈ {fmtGB(p.est.tableGB)}, ≈{' '}
      {formatDuration(p.est.buildSeconds)}
    </p>
  );

  return (
    <>
      {!p.isOpen && (
        <button
          onClick={p.onToggle}
          className="fixed left-4 bottom-4 z-50 inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-4 py-3 text-sm font-medium text-gray-700 shadow-lg transition-colors hover:bg-gray-50 dark:border-[#2a2a2e] dark:bg-[#1a1a1d] dark:text-gray-200 dark:hover:bg-[#2a2a2e]"
          aria-label="Open search settings"
        >
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M7 12h10m-7 6h4" />
          </svg>
          <span>Search Settings</span>
        </button>
      )}

      {p.isMobile && p.isOpen && (
        <button type="button" onClick={p.onToggle} className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[1px]" aria-label="Close search settings" />
      )}

      <aside className={`
        ${p.isMobile ? 'fixed inset-y-0 left-0 z-50 w-[min(20rem,calc(100vw-1rem))] max-w-[20rem] transform shadow-2xl' : 'relative'}
        bg-white dark:bg-[#1a1a1d] border-r border-gray-200 dark:border-[#2a2a2e] flex flex-col
        transition-all duration-300 ease-in-out overflow-x-hidden
        ${p.isMobile
          ? (p.isOpen ? 'translate-x-0' : '-translate-x-full')
          : (p.isOpen ? 'w-96 min-w-96' : 'w-0 min-w-0 overflow-hidden')}
      `}>
        <div className="p-4 border-b border-gray-200 dark:border-[#2a2a2e]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <img src={assetPath('/cdaaebfdc71641160f831c2a2fb564ce8d081055.png')} alt="Logo" className="w-10 h-10 rounded-lg object-cover" />
              <div>
                <h1 className="font-semibold text-gray-900 dark:text-white text-sm">Equation Search</h1>
                <p className="text-[10px] text-gray-500">meet in the middle · Jagiellonian University</p>
              </div>
            </div>
            <button
              onClick={p.onToggle}
              className="p-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-[#2a2a2e] transition-colors"
              aria-label={p.isMobile ? 'Close search settings' : 'Collapse sidebar'}
            >
              <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={p.isMobile ? 'M6 18L18 6M6 6l12 12' : 'M15 19l-7-7 7-7'} />
              </svg>
            </button>
          </div>
          <Link href="/calculator" className="mt-2 inline-block text-[11px] text-[#0066cc] hover:underline">
            ← Formula search (brute force, complex numbers)
          </Link>
        </div>

        <div className="flex-1 p-4 space-y-6 overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
          <div className="space-y-2">
            <Label>Calculator</Label>
            <CalculatorPalette
              calculator={calculator}
              enabledTokens={p.enabledTokens}
              onToggleToken={p.onToggleToken}
              onEnableAll={p.onEnableAll}
              customInt={p.customInt}
              onCustomIntChange={p.onCustomIntChange}
              disabled={p.busy}
              tokenNotes={tokenNotes}
            />
            {!p.hasConstants && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400">Enable at least one constant.</p>
            )}
            {p.enabledTokens.includes('I') && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400">
                i is ignored: this search is real. Complex targets: use the formula search.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Status</Label>
            <div className="flex items-center gap-2 text-sm">
              <div className={`w-2 h-2 rounded-full ${p.workerReady ? 'bg-green-500' : 'bg-amber-500'}`} />
              <span className="text-gray-700 dark:text-gray-300">{p.workerReady ? 'WASM Ready' : 'Loading WASM…'}</span>
            </div>
          </div>

          <div className="space-y-4">
            <p className="text-[11px] text-gray-500 dark:text-gray-400">
              Equations L(x) = R: the left side contains x, the right side does not. The right sides are computed once
              and kept; each number then costs only its left sides.
            </p>
            <Slider
              label="Left side length (with x)"
              value={p.kl}
              min={1}
              max={MAX_LEFT}
              onChange={p.setKl}
              disabled={p.busy}
              note={
                <p className={`text-[10px] font-mono ${tone(p.est.searchSeconds)}`}>
                  ≈ {formatCount(p.est.leftCodes)} left sides per number · up to {formatDuration(p.est.searchSeconds)}
                </p>
              }
            />
            <Slider
              label="Right side length (shared table)"
              value={p.kr}
              min={1}
              max={MAX_RIGHT}
              onChange={p.setKr}
              disabled={p.busy}
              note={tableNote}
            />
            <div className="space-y-1">
              <Label>x appears</Label>
              <div className="grid grid-cols-2 gap-1 rounded-lg bg-gray-100 p-1 dark:bg-[#111113]">
                {([[false, 'once'], [true, 'any number of times']] as [boolean, string][]).map(([v, label]) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => p.setAnyx(v)}
                    disabled={p.busy}
                    aria-pressed={p.anyx === v}
                    className={`rounded-md px-2 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed
                      ${p.anyx === v
                        ? 'bg-white text-[#0066cc] shadow-xs dark:bg-[#1a1a1d]'
                        : 'text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-gray-400">
                {p.anyx
                  ? 'Also implicit equations such as x^x = e (RIES-like); no explicit formula then.'
                  : 'Every equation can be solved for x: an explicit formula is shown.'}
              </p>
            </div>
          </div>

          <div className="border-t border-gray-200 dark:border-[#2a2a2e] pt-4">
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center justify-between w-full text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
            >
              <span className="font-medium">Advanced Options</span>
              <svg className={`w-4 h-4 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          </div>

          {showAdvanced && (
            <div className="space-y-6 pb-2">
              <div className="space-y-2">
                <Label>Uncertainty (±)</Label>
                {([
                  ['zero', 'Exact / Symbolic', '(± 0)'],
                  ['manual', 'Manual', '(type the ±)'],
                  ['automatic', 'Auto', '(± ½ last digit; integers, formulas exact)'],
                ] as [ErrorMode, string, string][]).map(([mode, label, hint]) => (
                  <label key={mode} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="mitmErrorMode"
                      checked={p.errorMode === mode}
                      onChange={() => p.setErrorMode(mode)}
                      className="w-4 h-4 accent-[#0066cc]"
                    />
                    <span className="text-sm text-gray-700 dark:text-gray-300">{label}</span>
                    <span className="text-xs text-gray-400">{hint}</span>
                  </label>
                ))}
                {p.errorMode === 'manual' && (
                  <div className="flex items-center gap-2 ml-6">
                    <span className="text-gray-500">±</span>
                    <input
                      type="text"
                      value={p.manualError}
                      onChange={(e) => p.setManualError(e.target.value)}
                      placeholder="1e-8"
                      className="w-32 px-2 py-1 rounded border border-gray-300 dark:border-[#2a2a2e] bg-white dark:bg-[#111113] text-gray-900 dark:text-white font-mono text-sm"
                    />
                  </div>
                )}
                {p.uncertaintyNote && (
                  <p className="text-xs font-mono text-gray-500 dark:text-gray-400">Current target: {p.uncertaintyNote}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label>Tolerance of exact targets</Label>
                <div className="grid grid-cols-2 gap-1 rounded-lg bg-gray-100 p-1 dark:bg-[#111113]">
                  {[16, 2].map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => p.setExactTolEps(t)}
                      aria-pressed={p.exactTolEps === t}
                      className={`rounded-md px-2 py-1.5 text-xs font-medium transition-colors
                        ${p.exactTolEps === t
                          ? 'bg-white text-[#0066cc] shadow-xs dark:bg-[#1a1a1d]'
                          : 'text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'}`}
                    >
                      {t} ε
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-gray-400">
                  16 ε as the formula search. True identities agree to 0–1 ε, chance matches anywhere up to the tolerance:
                  2 ε cuts chance matches of long equations about five-fold.
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="p-4 border-t border-gray-200 dark:border-[#2a2a2e]">
          <a
            href="https://github.com/VA00/ConstantRecognition"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-xs text-gray-500 hover:text-[#0066cc] transition-colors"
          >
            GitHub · algorithms/methods/mitm
          </a>
        </div>
      </aside>
    </>
  );
}
