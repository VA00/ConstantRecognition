'use client';

import { SearchResult } from '../lib/types';
import { rpnToMathematica, createWolframLink, rpnToLatex } from '../lib/rpn';
import { Latex } from './Latex';

interface ResultCardProps {
  result: SearchResult;
}

export function ResultCard({ result }: ResultCardProps) {
  return (
    <div className="p-6 bg-linear-to-r from-[#0066cc]/5 to-transparent dark:from-[#0066cc]/10 border-b border-gray-200 dark:border-[#2a2a2e]">
      <div className="max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-4 gap-6">
        <div>
          <label className="text-[10px] font-medium text-gray-500 dark:text-gray-500 uppercase tracking-wider">Best Match</label>
          <div className="text-xl text-gray-900 dark:text-white mt-1">
            <Latex formula={rpnToLatex(result.RPN)} />
          </div>
        </div>
        <div>
          <label className="text-[10px] font-medium text-gray-500 dark:text-gray-500 uppercase tracking-wider">Numeric Value</label>
          <div className="text-lg font-mono text-gray-700 dark:text-gray-300 mt-1">{result.result}</div>
        </div>
        <div>
          <label className="text-[10px] font-medium text-gray-500 dark:text-gray-500 uppercase tracking-wider">Mathematica</label>
          <a 
            href={createWolframLink(rpnToMathematica(result.RPN))}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-mono text-[#0066cc] hover:underline mt-1 block"
          >
            {rpnToMathematica(result.RPN)}
          </a>
        </div>
        <div>
          <label className="text-[10px] font-medium text-gray-500 dark:text-gray-500 uppercase tracking-wider">Relative Error</label>
          <div className="text-sm font-mono text-gray-500 dark:text-gray-500 mt-1">{result.REL_ERR.toExponential(2)}</div>
        </div>
      </div>
    </div>
  );
}
