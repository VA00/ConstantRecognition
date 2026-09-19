'use client';

import { CalculatorDefinition, calculatorTokenLabel, defaultEnabledTokens } from '../lib/calculators';

interface CalculatorPaletteProps {
  calculator: CalculatorDefinition;
  enabledTokens: string[];
  onToggleToken: (token: string) => void;
  onEnableAll: () => void;
  disabled?: boolean; // true while a search is running
  /** Short notes shown under a button instead of its name (e.g. "needs ℂ") */
  tokenNotes?: Record<string, string>;
}

const getTokenLabel = (token: string) => calculatorTokenLabel[token] ?? token;

// Labels may contain one "_{...}" group, rendered as a subscript: "log_{y}(x)"
function renderLabel(label: string) {
  const m = /^(.*?)_\{([^}]*)\}(.*)$/.exec(label);
  if (!m) return label;
  return (
    <>
      {m[1]}<sub className="text-[0.7em]">{m[2]}</sub>{m[3]}
    </>
  );
}

function TokenButton({
  token,
  enabled,
  onToggle,
  disabled,
  note,
}: {
  token: string;
  enabled: boolean;
  onToggle: () => void;
  disabled?: boolean;
  note?: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-pressed={enabled}
      title={enabled ? `${token} — click to disable` : `${token} — click to enable`}
      className={`rounded-md border px-2 py-2 text-center shadow-xs transition-colors select-none
        disabled:cursor-not-allowed disabled:opacity-60
        ${enabled
          ? 'border-[#0066cc]/40 bg-white dark:bg-[#111113] hover:border-[#0066cc]'
          : 'border-gray-200 bg-gray-100 opacity-45 hover:opacity-70 dark:border-[#2a2a2e] dark:bg-[#1a1a1d]'}`}
    >
      <div className={`text-sm font-semibold leading-none ${enabled ? 'text-gray-900 dark:text-white' : 'text-gray-400 dark:text-gray-500 line-through'}`}>
        {renderLabel(getTokenLabel(token))}
      </div>
      <div className={`mt-1 text-[9px] uppercase tracking-wide ${note ? 'text-amber-600 dark:text-amber-400 font-medium' : 'text-gray-400 dark:text-gray-500'}`}>
        {note ?? token}
      </div>
    </button>
  );
}

function SectionHeader({
  label,
  enabled,
  total,
}: {
  label: string;
  enabled: number;
  total: number;
}) {
  return (
    <div className="mb-2 flex items-center justify-between">
      <span className="text-[10px] font-medium uppercase tracking-wider text-gray-500 dark:text-gray-500">
        {label}
      </span>
      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-mono text-gray-500 dark:bg-[#111113] dark:text-gray-400">
        {enabled}/{total}
      </span>
    </div>
  );
}

export function CalculatorPalette({
  calculator,
  enabledTokens,
  onToggleToken,
  onEnableAll,
  disabled,
  tokenNotes = {},
}: CalculatorPaletteProps) {
  const enabled = new Set(enabledTokens);
  const countEnabled = (tokens: string[]) => tokens.filter((t) => enabled.has(t)).length;

  // The standard set is what the page enables on load; everything else
  // (extras and default-disabled buttons such as i) is counted separately
  const standardTokens = defaultEnabledTokens(calculator);
  const totalButtons = standardTokens.length;
  const totalEnabled = countEnabled(standardTokens);
  const extrasEnabled = countEnabled([
    ...calculator.constantsExtra, ...calculator.extra, ...calculator.defaultDisabled,
  ]);
  const isStandard = totalEnabled === totalButtons && extrasEnabled === 0;

  const renderGrid = (tokens: string[], cols: string) => (
    <div className={`grid ${cols} gap-2`}>
      {tokens.map((token) => (
        <TokenButton
          key={token}
          token={token}
          enabled={enabled.has(token)}
          onToggle={() => onToggleToken(token)}
          disabled={disabled}
          note={tokenNotes[token]}
        />
      ))}
    </div>
  );

  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50/80 p-3 dark:border-[#2a2a2e] dark:bg-[#111113]/80">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-gray-900 dark:text-white">{calculator.name}</div>
          <div className="text-[11px] text-gray-500 dark:text-gray-400">Click buttons to enable/disable</div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="rounded-full bg-[#0066cc]/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-[#0066cc]">
            {totalEnabled}/{totalButtons} buttons{extrasEnabled > 0 ? ` +${extrasEnabled}` : ''}
          </div>
          {!isStandard && (
            <button
              type="button"
              onClick={onEnableAll}
              disabled={disabled}
              className="text-[10px] font-medium text-[#0066cc] hover:underline disabled:cursor-not-allowed disabled:opacity-60"
              title="Enable the 36 standard buttons, disable the extras"
            >
              Reset to standard
            </button>
          )}
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <SectionHeader
            label="Core Constants"
            enabled={countEnabled(calculator.constantsCore)}
            total={calculator.constantsCore.length}
          />
          {renderGrid(calculator.constantsCore, 'grid-cols-5')}
        </div>

        <div>
          <SectionHeader
            label="Extra Constants"
            enabled={extrasEnabled}
            total={calculator.constantsExtra.length}
          />
          {renderGrid(calculator.constantsExtra, 'grid-cols-5')}
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <div className="space-y-4">
            <div>
              <SectionHeader
                label="Digits"
                enabled={countEnabled(calculator.constantsDigits)}
                total={calculator.constantsDigits.length}
              />
              {renderGrid(calculator.constantsDigits, 'grid-cols-3')}
            </div>

            <div>
              <SectionHeader
                label="Operators"
                enabled={countEnabled(calculator.operators)}
                total={calculator.operators.length}
              />
              {renderGrid(calculator.operators, 'grid-cols-2')}
            </div>

            <div>
              <SectionHeader
                label="Extra"
                enabled={countEnabled(calculator.extra)}
                total={calculator.extra.length}
              />
              {renderGrid(calculator.extra, 'grid-cols-2')}
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <SectionHeader
                label="Core Functions"
                enabled={countEnabled(calculator.unaryCore)}
                total={calculator.unaryCore.length}
              />
              {renderGrid(calculator.unaryCore, 'grid-cols-2')}
            </div>

            <div>
              <SectionHeader
                label="Other Functions"
                enabled={countEnabled(calculator.unaryOther)}
                total={calculator.unaryOther.length}
              />
              {renderGrid(calculator.unaryOther, 'grid-cols-3')}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
