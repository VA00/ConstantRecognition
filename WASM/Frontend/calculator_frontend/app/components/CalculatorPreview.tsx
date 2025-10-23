'use client';

import { CalculatorButton } from '../types/calculator';

interface CalculatorPreviewProps {
  buttons: CalculatorButton[];
  onUse: () => void;
  onSave: () => void;
  onExport: () => void;
}

export default function CalculatorPreview({ buttons, onUse, onSave, onExport }: CalculatorPreviewProps) {
  const stats = {
    total: buttons.length,
    constants: buttons.filter(b => b.type === 'constant').length,
    unary: buttons.filter(b => b.type === 'unary').length,
    binary: buttons.filter(b => b.type === 'binary').length,
  };

  return (
    <div className="sticky top-6 space-y-3">
      {/* Configuration Panel - Wolfram Style */}
      <div className="bg-white dark:bg-[#2a2a2a] border border-gray-300 dark:border-gray-700 rounded shadow-sm">
        {/* Header */}
        <div className="bg-gray-100 dark:bg-[#333333] border-b border-gray-300 dark:border-gray-700 px-4 py-2">
          <h3 className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
            Configuration
          </h3>
        </div>
        
        {/* Content */}
        <div className="p-4 space-y-4">
        
          {/* Stats Table */}
          <div className="space-y-2">
            <div className="flex justify-between items-center text-sm border-b border-gray-200 dark:border-gray-700 pb-2">
              <span className="text-gray-600 dark:text-gray-400">Constants:</span>
              <span className="font-mono font-semibold text-gray-900 dark:text-white">{stats.constants}</span>
            </div>
            <div className="flex justify-between items-center text-sm border-b border-gray-200 dark:border-gray-700 pb-2">
              <span className="text-gray-600 dark:text-gray-400">Unary Functions:</span>
              <span className="font-mono font-semibold text-gray-900 dark:text-white">{stats.unary}</span>
            </div>
            <div className="flex justify-between items-center text-sm border-b border-gray-200 dark:border-gray-700 pb-2">
              <span className="text-gray-600 dark:text-gray-400">Binary Operations:</span>
              <span className="font-mono font-semibold text-gray-900 dark:text-white">{stats.binary}</span>
            </div>
            <div className="flex justify-between items-center text-sm pt-2">
              <span className="text-gray-900 dark:text-white font-semibold">Total:</span>
              <span className="font-mono font-bold text-orange-600 dark:text-orange-400 text-lg">{stats.total}</span>
            </div>
          </div>

          {/* Calculator Display */}
          <div className="bg-[#1a1a1a] border border-gray-600 rounded p-3">
            <div className="text-right font-mono space-y-1">
              <div className="text-green-400 text-[10px] opacity-60">BASE {buttons.length || 'N'} SYSTEM</div>
              <div className="text-green-400 text-2xl font-bold">{stats.total}</div>
              <div className="text-green-400 text-[10px] opacity-60">OPERATIONS</div>
            </div>
          </div>

          {/* Preview Grid */}
          {buttons.length > 0 ? (
            <div>
              <div className="text-xs text-gray-500 dark:text-gray-500 mb-2 uppercase tracking-wider">Preview</div>
              <div className="grid grid-cols-6 gap-0.5 p-2 bg-gray-200 dark:bg-[#1a1a1a] rounded border border-gray-300 dark:border-gray-700">
                {buttons.slice(0, 36).map(button => (
                  <div
                    key={button.id}
                    className="aspect-square flex items-center justify-center text-[9px] font-mono font-semibold bg-white dark:bg-[#2a2a2a] text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600"
                    title={button.code}
                  >
                    {button.label}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-center py-6 text-gray-400 dark:text-gray-600 text-xs border border-dashed border-gray-300 dark:border-gray-700 rounded">
              No operations selected
            </div>
          )}
        </div>
      </div>

      {/* Actions Panel */}
      <div className="bg-white dark:bg-[#2a2a2a] border border-gray-300 dark:border-gray-700 rounded shadow-sm overflow-hidden">
        <div className="bg-gray-100 dark:bg-[#333333] border-b border-gray-300 dark:border-gray-700 px-4 py-2">
          <h3 className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
            Actions
          </h3>
        </div>
        <div className="p-4 space-y-2">
          <button
            onClick={onUse}
            disabled={buttons.length === 0}
            className="w-full py-2.5 bg-orange-600 hover:bg-orange-700 text-white text-sm font-medium rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-orange-600"
          >
            Apply Configuration
          </button>
          <button
            onClick={onSave}
            disabled={buttons.length === 0}
            className="w-full py-2 text-sm bg-white dark:bg-[#1a1a1a] text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#333333] font-medium rounded transition-colors border border-gray-300 dark:border-gray-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Save
          </button>
          <button
            onClick={onExport}
            disabled={buttons.length === 0}
            className="w-full py-2 text-sm bg-white dark:bg-[#1a1a1a] text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#333333] font-medium rounded transition-colors border border-gray-300 dark:border-gray-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Export JSON
          </button>
        </div>
      </div>
    </div>
  );
}
