'use client';

import { CalculatorDefinition, calculatorTokenLabel } from '../lib/calculators';

interface CalculatorPaletteProps {
  calculator: CalculatorDefinition;
}

const getTokenLabel = (token: string) => calculatorTokenLabel[token] ?? token;

function TokenButton({
  token,
  className = '',
}: {
  token: string;
  className?: string;
}) {
  return (
    <div
      className={`rounded-md border border-gray-200 dark:border-[#2a2a2e] bg-white dark:bg-[#111113] px-2 py-2 text-center shadow-xs ${className}`}
      title={token}
    >
      <div className="text-sm font-semibold text-gray-900 dark:text-white leading-none">
        {getTokenLabel(token)}
      </div>
      <div className="mt-1 text-[9px] uppercase tracking-wide text-gray-400 dark:text-gray-500">
        {token}
      </div>
    </div>
  );
}

function SectionHeader({
  label,
  count,
}: {
  label: string;
  count: number;
}) {
  return (
    <div className="mb-2 flex items-center justify-between">
      <span className="text-[10px] font-medium uppercase tracking-wider text-gray-500 dark:text-gray-500">
        {label}
      </span>
      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-mono text-gray-500 dark:bg-[#111113] dark:text-gray-400">
        {count}
      </span>
    </div>
  );
}

export function CalculatorPalette({ calculator }: CalculatorPaletteProps) {
  const totalButtons =
    calculator.constantsCore.length +
    calculator.constantsRedundant.length +
    calculator.unaryCore.length +
    calculator.unaryRedundant.length +
    calculator.operatorsCommutative.length +
    calculator.operatorsNoncommutative.length;

  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50/80 p-3 dark:border-[#2a2a2e] dark:bg-[#111113]/80">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-gray-900 dark:text-white">{calculator.name}</div>
          <div className="text-[11px] text-gray-500 dark:text-gray-400">{calculator.shortName}</div>
        </div>
        <div className="rounded-full bg-[#0066cc]/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-[#0066cc]">
          {totalButtons} buttons
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <SectionHeader label="Core Constants" count={calculator.constantsCore.length} />
          <div className="grid grid-cols-4 gap-2">
            {calculator.constantsCore.map((token) => (
              <TokenButton key={token} token={token} />
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <div className="space-y-4">
            <div>
              <SectionHeader label="Redundant Constants" count={calculator.constantsRedundant.length} />
              <div className="grid grid-cols-3 gap-2">
                {calculator.constantsRedundant.map((token) => (
                  <TokenButton key={token} token={token} />
                ))}
              </div>
            </div>

            <div>
              <SectionHeader
                label="Operators"
                count={calculator.operatorsCommutative.length + calculator.operatorsNoncommutative.length}
              />
              <div className="grid grid-cols-2 gap-2">
                {[...calculator.operatorsCommutative, ...calculator.operatorsNoncommutative].map((token) => (
                  <TokenButton key={token} token={token} />
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <SectionHeader label="Core Functions" count={calculator.unaryCore.length} />
              <div className="grid grid-cols-2 gap-2">
                {calculator.unaryCore.map((token) => (
                  <TokenButton key={token} token={token} />
                ))}
              </div>
            </div>

            <div>
              <SectionHeader label="Other Functions" count={calculator.unaryRedundant.length} />
              <div className="grid grid-cols-3 gap-2">
                {calculator.unaryRedundant.map((token) => (
                  <TokenButton key={token} token={token} />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
