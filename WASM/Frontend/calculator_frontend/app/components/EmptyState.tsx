interface EmptyStateProps {
  setInputValue: (value: string) => void;
}

export default function EmptyState({ setInputValue }: EmptyStateProps) {
  const exampleNumbers = ['3.14159', '2.71828', '1.61803', '1.41421'];

  return (
    <div className="flex flex-col items-center justify-center h-full text-center">
      <div className="w-16 h-16 rounded-2xl bg-gray-100 dark:bg-[#2a2a2e] flex items-center justify-center mb-4">
        <span className="text-3xl">π</span>
      </div>
      <h2 className="text-lg font-medium text-gray-900 dark:text-white mb-2">Enter a number to identify</h2>
      <p className="text-sm text-gray-500 dark:text-gray-500 max-w-md">
        This tool will find mathematical representations of any decimal number using fundamental constants 
        (π, e, φ) and operations (+, -, ×, ÷, ^, √, log, sin, cos, etc.)
      </p>
      <div className="mt-6 flex gap-2">
        {exampleNumbers.map(num => (
          <button
            key={num}
            onClick={() => setInputValue(num)}
            className="px-3 py-1.5 text-sm font-mono bg-gray-100 dark:bg-[#2a2a2e] text-gray-700 dark:text-gray-300 rounded hover:bg-gray-200 dark:hover:bg-[#3a3a3e] transition-colors"
          >
            {num}
          </button>
        ))}
      </div>
    </div>
  );
}
