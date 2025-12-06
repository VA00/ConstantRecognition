interface SearchInputProps {
  inputValue: string;
  setInputValue: (value: string) => void;
  isCalculating: boolean;
  onCalculate: () => void;
}

export default function SearchInput({
  inputValue,
  setInputValue,
  isCalculating,
  onCalculate
}: SearchInputProps) {
  return (
    <div className="bg-white dark:bg-[#1a1a1d] border-b border-gray-200 dark:border-[#2a2a2e] p-4">
      <div className="flex items-center gap-3">
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onCalculate()}
          placeholder="Enter a number to identify... (e.g., 3.14159265, 2.71828, 1.618034)"
          className="flex-1 px-4 py-3 bg-gray-50 dark:bg-[#111113] border border-gray-200 dark:border-[#2a2a2e] rounded-lg
                     text-gray-900 dark:text-white font-mono text-lg
                     focus:outline-none focus:ring-2 focus:ring-[#0066cc] focus:border-transparent
                     placeholder-gray-400 dark:placeholder-gray-600"
        />
        <button
          onClick={onCalculate}
          disabled={isCalculating || !inputValue}
          className={`px-6 py-3 rounded-lg font-medium transition-all flex items-center gap-2
            ${isCalculating 
              ? 'bg-gray-200 dark:bg-[#2a2a2e] text-gray-500 cursor-not-allowed' 
              : 'bg-[#0066cc] text-white hover:bg-[#0052a3]'
            }`}
        >
          {isCalculating ? (
            <>
              <span className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
              Searching...
            </>
          ) : (
            'Identify'
          )}
        </button>
      </div>
    </div>
  );
}
