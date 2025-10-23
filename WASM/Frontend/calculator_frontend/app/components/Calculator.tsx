'use client';

import { useState } from 'react';
import { useWASM } from '../hooks/useWASM';

export default function Calculator() {
  const { isReady, isLoading, error, searchRPN } = useWASM();
  const [input, setInput] = useState('137.035999206');
  const [maxDepth, setMaxDepth] = useState(5);
  const [result, setResult] = useState<any>(null);
  const [calculationTime, setCalculationTime] = useState<number | null>(null);

  const handleCalculate = async () => {
    const startTime = performance.now();
    const res = await searchRPN(parseFloat(input), 0, 1, maxDepth, 0, 1);
    const endTime = performance.now();

    if (res) {
      setResult(res);
      setCalculationTime(endTime - startTime);
    }
  };

  return (
    <div className="min-h-screen bg-linear-to-br from-blue-50 via-indigo-50 to-purple-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 py-8 px-4">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl p-8 border border-gray-200 dark:border-gray-700">
          <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-3 flex items-center gap-3">
            🔢 Constant Recognizer
          </h1>
          <p className="text-gray-600 dark:text-gray-300 text-lg">
            Enter any number to discover mathematical formulas that produce it
          </p>
          {!isReady && (
            <div className="mt-4 p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
              <p className="text-yellow-800 dark:text-yellow-200 text-sm">
                ⏳ Loading WebAssembly module...
              </p>
            </div>
          )}
          {error && (
            <div className="mt-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
              <p className="text-red-800 dark:text-red-200 text-sm">
                ❌ {error}
              </p>
            </div>
          )}
        </div>

        {/* Main Calculator Card */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl p-8 border border-gray-200 dark:border-gray-700">
          {/* Input Section */}
          <div className="space-y-6">
            <div>
              <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                Enter Number:
              </label>
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="137.035999206"
                className="w-full px-4 py-3 text-lg border-2 border-gray-300 dark:border-gray-600 rounded-xl 
                         focus:ring-4 focus:ring-blue-500/20 focus:border-blue-500 dark:focus:border-blue-400
                         transition-all bg-white dark:bg-gray-900 text-gray-900 dark:text-white
                         disabled:bg-gray-100 dark:disabled:bg-gray-800 disabled:cursor-not-allowed"
                disabled={isLoading || !isReady}
              />
            </div>

            {/* Depth Slider */}
            <div>
              <div className="flex justify-between items-center mb-2">
                <label className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                  Max Code Length:
                </label>
                <span className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                  {maxDepth}
                </span>
              </div>
              <input
                type="range"
                min="2"
                max="9"
                value={maxDepth}
                onChange={(e) => setMaxDepth(parseInt(e.target.value))}
                className="w-full h-3 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer
                         [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-6 
                         [&::-webkit-slider-thumb]:h-6 [&::-webkit-slider-thumb]:rounded-full 
                         [&::-webkit-slider-thumb]:bg-blue-600 [&::-webkit-slider-thumb]:cursor-pointer
                         [&::-webkit-slider-thumb]:shadow-lg hover:[&::-webkit-slider-thumb]:bg-blue-700
                         disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={isLoading || !isReady}
              />
              <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mt-2">
                <span>⚡ Fast (2)</span>
                <span>⏱️ Moderate (5)</span>
                <span>🐌 Slow (9)</span>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                ⚠️ Each step increases search time by ~36x
              </p>
            </div>

            {/* Calculate Button */}
            <button
              onClick={handleCalculate}
              disabled={!isReady || isLoading}
              className={`w-full py-4 rounded-xl font-bold text-lg transition-all transform shadow-lg
                ${
                  isReady && !isLoading
                    ? 'bg-linear-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white hover:scale-[1.02] active:scale-[0.98] hover:shadow-xl'
                    : 'bg-gray-300 dark:bg-gray-700 text-gray-500 dark:text-gray-400 cursor-not-allowed'
                }`}
            >
              {!isReady
                ? '⏳ Loading WASM...'
                : isLoading
                ? '🔄 Calculating...'
                : '🚀 Identify Constant'}
            </button>
          </div>

          {/* Results Section */}
          {result && (
            <div className="mt-8 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xl font-bold text-gray-900 dark:text-white">
                  ✨ Results:
                </h3>
                {calculationTime && (
                  <span className="text-sm text-gray-500 dark:text-gray-400">
                    ⏱️ {calculationTime.toFixed(0)} ms
                  </span>
                )}
              </div>

              <div className="space-y-3">
                {/* RPN Code */}
                <div className="p-4 bg-linear-to-r from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 
                              rounded-xl border border-green-200 dark:border-green-800">
                  <span className="text-xs font-semibold text-green-700 dark:text-green-300 uppercase tracking-wide">
                    RPN Code:
                  </span>
                  <p className="mt-2 font-mono text-gray-900 dark:text-white bg-white dark:bg-gray-900 p-3 rounded-lg text-sm">
                    {result.RPN}
                  </p>
                </div>

                {/* Mathematica */}
                <div className="p-4 bg-linear-to-r from-purple-50 to-pink-50 dark:from-purple-900/20 dark:to-pink-900/20 
                              rounded-xl border border-purple-200 dark:border-purple-800">
                  <span className="text-xs font-semibold text-purple-700 dark:text-purple-300 uppercase tracking-wide">
                    Mathematica:
                  </span>
                  <p className="mt-2 font-mono text-gray-900 dark:text-white bg-white dark:bg-gray-900 p-3 rounded-lg text-sm break-all">
                    {result.Mathematica}
                  </p>
                </div>

                {/* Error */}
                <div className="p-4 bg-linear-to-r from-blue-50 to-cyan-50 dark:from-blue-900/20 dark:to-cyan-900/20 
                              rounded-xl border border-blue-200 dark:border-blue-800">
                  <span className="text-xs font-semibold text-blue-700 dark:text-blue-300 uppercase tracking-wide">
                    Relative Error:
                  </span>
                  <p className="mt-2 font-mono text-gray-900 dark:text-white bg-white dark:bg-gray-900 p-3 rounded-lg text-sm">
                    {typeof result.Error === 'number' 
                      ? result.Error.toExponential(6) 
                      : result.Error}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer Info */}
        <div className="text-center text-sm text-gray-500 dark:text-gray-400 space-y-1">
          <p>Powered by WebAssembly • Next.js 16 • React 19 • Tailwind CSS 4</p>
          <p className="text-xs">
            Try: π (3.14159...), e (2.71828...), φ (1.618...), or physical constants
          </p>
        </div>
      </div>
    </div>
  );
}
