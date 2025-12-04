import { createWolframLink } from '../lib/rpn';

interface ResultCardProps {
  resultInfix: string;
  resultNumeric: string;
  resultMathematica: string;
  resultRPN: string;
  timing: string;
}

export default function ResultCard({
  resultInfix,
  resultNumeric,
  resultMathematica,
  resultRPN,
  timing
}: ResultCardProps) {
  if (!resultInfix) return null;

  return (
    <div className="bg-white dark:bg-[#1a1a1d] rounded-lg border border-gray-200 dark:border-[#2a2a2e] mb-6">
      <div className="px-4 py-3 border-b border-gray-100 dark:border-[#2a2a2e] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-green-500" />
          <span className="text-sm font-medium text-gray-900 dark:text-white">Result Found</span>
        </div>
        <span className="text-xs text-gray-500 dark:text-gray-500 font-mono">{timing}</span>
      </div>
      
      <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label className="text-[10px] font-medium text-gray-500 dark:text-gray-500 uppercase tracking-wider">Formula</label>
          <div className="mt-1 text-xl font-mono text-gray-900 dark:text-white">{resultInfix}</div>
        </div>
        <div>
          <label className="text-[10px] font-medium text-gray-500 dark:text-gray-500 uppercase tracking-wider">Numeric</label>
          <div className="mt-1 text-xl font-mono text-[#0066cc]">{resultNumeric}</div>
        </div>
        <div>
          <label className="text-[10px] font-medium text-gray-500 dark:text-gray-500 uppercase tracking-wider">Mathematica</label>
          <a 
            href={createWolframLink(resultMathematica)}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 text-lg font-mono text-[#0066cc] hover:underline flex items-center gap-1"
          >
            {resultMathematica}
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </a>
        </div>
      </div>

      <div className="px-4 py-3 bg-gray-50 dark:bg-[#111113] rounded-b-lg">
        <span className="text-xs text-gray-500 dark:text-gray-500">RPN: </span>
        <code className="text-xs font-mono text-gray-700 dark:text-gray-300">{resultRPN}</code>
      </div>
    </div>
  );
}
