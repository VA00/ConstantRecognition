'use client';

import { SearchResult } from '../lib/types';
import { rpnToMathematica, createWolframLink, rpnToLatex } from '../lib/rpn';
import { Latex } from './Latex';

interface ResultCardProps {
  result: SearchResult;
}

export function ResultCard({ result }: ResultCardProps) {
  return (
    <div className="p-4 sm:p-6 bg-gradient-to-r from-[#0066cc]/5 to-transparent dark:from-[#0066cc]/10 border-b border-gray-200 dark:border-[#2a2a2e] overflow-hidden">
      <div className="max-w-4xl mx-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
        <div className="col-span-1 sm:col-span-2 lg:col-span-1 overflow-hidden">
          <label className="text-[10px] sm:text-xs font-medium text-gray-500 dark:text-gray-500 uppercase tracking-wider">Best Match</label>
          <div className="text-lg sm:text-xl text-gray-900 dark:text-white mt-1 overflow-x-auto">
            <Latex formula={rpnToLatex(result.RPN)} />
          </div>
        </div>
        <div>
          <label className="text-[10px] sm:text-xs font-medium text-gray-500 dark:text-gray-500 uppercase tracking-wider">Numeric Value</label>
          <div className="text-base sm:text-lg font-mono text-gray-700 dark:text-gray-300 mt-1 break-all">{result.result}</div>
        </div>
        <div>
          <label className="text-[10px] sm:text-xs font-medium text-gray-500 dark:text-gray-500 uppercase tracking-wider">Mathematica</label>
          <a 
            href={createWolframLink(rpnToMathematica(result.RPN))}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-mono text-[#0066cc] hover:underline mt-1 block break-all"
          >
            {rpnToMathematica(result.RPN)}
          </a>
        </div>
        <div>
          <label className="text-[10px] sm:text-xs font-medium text-gray-500 dark:text-gray-500 uppercase tracking-wider">Relative Error</label>
          <div className="text-sm font-mono text-gray-500 dark:text-gray-500 mt-1">{result.REL_ERR.toExponential(2)}</div>
        </div>
      </div>
    </div>
  );
}
