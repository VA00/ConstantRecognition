'use client';

interface InputBarProps {
  inputValue: string;
  setInputValue: (value: string) => void;
  isCalculating: boolean;
  onCalculate: () => void;
}

export function InputBar({
  inputValue,
  setInputValue,
  isCalculating,
  onCalculate
}: InputBarProps) {
  return (
    <div className="p-4 sm:p-6 bg-white dark:bg-[#1a1a1d] border-b border-gray-200 dark:border-[#2a2a2e]">
      <div className="max-w-4xl mx-auto flex flex-col sm:flex-row gap-3 sm:gap-4">
        <div className="flex-1 relative">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="Enter a decimal number, e.g. 3.14159..."
            className="w-full px-4 py-3 rounded-lg bg-gray-50 dark:bg-[#111113] border border-gray-200 dark:border-[#2a2a2e] text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-600 focus:border-[#0066cc] focus:outline-none focus:ring-1 focus:ring-[#0066cc] font-mono text-base"
            onKeyDown={(e) => e.key === 'Enter' && onCalculate()}
          />
        </div>
        <button
          onClick={onCalculate}
          disabled={!inputValue || isCalculating}
          className="w-full sm:w-auto px-6 py-3 bg-[#0066cc] hover:bg-[#0052a3] disabled:bg-gray-300 dark:disabled:bg-gray-700 text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2 disabled:cursor-not-allowed"
        >
          {isCalculating ? (
            <>
              <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              <span>Searching...</span>
            </>
          ) : (
            <>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <span>Identify</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}
