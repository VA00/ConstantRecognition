'use client';

import { CalculatorDefinition, calculatorTokenLabel } from '../lib/calculators';

interface CalculatorPaletteProps {
  calculator: CalculatorDefinition;
  enabledTokens: string[];
  onToggleToken: (token: string) => void;
  onEnableAll: () => void;
  disabled?: boolean; // true while a search is running
}

const getTokenLabel = (token: string) => calculatorTokenLabel[token] ?? token;

function TokenButton({
  token,
  enabled,
  onToggle,
  disabled,
}: {
  token: string;
  enabled: boolean;
  onToggle: () => void;
  disabled?: boolean;
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
        {getTokenLabel(token)}
      </div>
      <div className="mt-1 text-[9px] uppercase tracking-wide text-gray-400 dark:text-gray-500">
        {token}
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
}: CalculatorPaletteProps) {
  const enabled = new Set(enabledTokens);
  const countEnabled = (tokens: string[]) => tokens.filter((t) => enabled.has(t)).length;

  const allTokens = [
    ...calculator.constantsCore,
    ...calculator.constantsRedundant,
    ...calculator.unaryCore,
    ...calculator.unaryRedundant,
    ...calculator.operatorsCommutative,
    ...calculator.operatorsNoncommutative,
  ];
  const totalButtons = allTokens.length;
  const totalEnabled = countEnabled(allTokens);

  const renderGrid = (tokens: string[], cols: string) => (
    <div className={`grid ${cols} gap-2`}>
      {tokens.map((token) => (
        <TokenButton
          key={token}
          token={token}
          enabled={enabled.has(token)}
          onToggle={() => onToggleToken(token)}
          disabled={disabled}
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
            {totalEnabled}/{totalButtons} buttons
          </div>
          {totalEnabled < totalButtons && (
            <button
              type="button"
              onClick={onEnableAll}
              disabled={disabled}
              className="text-[10px] font-medium text-[#0066cc] hover:underline disabled:cursor-not-allowed disabled:opacity-60"
            >
              Enable all
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
          {renderGrid(calculator.constantsCore, 'grid-cols-4')}
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <div className="space-y-4">
            <div>
              <SectionHeader
                label="Redundant Constants"
                enabled={countEnabled(calculator.constantsRedundant)}
                total={calculator.constantsRedundant.length}
              />
              {renderGrid(calculator.constantsRedundant, 'grid-cols-3')}
            </div>

            <div>
              <SectionHeader
                label="Operators"
                enabled={countEnabled([...calculator.operatorsCommutative, ...calculator.operatorsNoncommutative])}
                total={calculator.operatorsCommutative.length + calculator.operatorsNoncommutative.length}
              />
              {renderGrid([...calculator.operatorsCommutative, ...calculator.operatorsNoncommutative], 'grid-cols-2')}
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
                enabled={countEnabled(calculator.unaryRedundant)}
                total={calculator.unaryRedundant.length}
              />
              {renderGrid(calculator.unaryRedundant, 'grid-cols-3')}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
