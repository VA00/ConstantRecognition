'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

interface SearchResult {
  cpuId: number;
  K: number;
  RPN: string;
  result: string;
  REL_ERR: string;
  HAMMING_DISTANCE: number;
  status?: string;
  results?: SearchResult[];
}

// RPN Interpreter functions
const namedConstants: Record<string, string> = {
  "NEG": "-1", "ZERO": "0", "ONE": "1", "TWO": "2", "THREE": "3",
  "FOUR": "4", "FIVE": "5", "SIX": "6", "SEVEN": "7", "EIGHT": "8",
  "NINE": "9", "POL": "½", "PI": "π", "EULER": "e", "GOLDENRATIO": "φ"
};

const namedFunctions: Record<string, string> = {
  "EXP": "exp", "LOG": "ln", "INV": "inv", "MINUS": "minus",
  "SIN": "sin", "ARCSIN": "arcsin", "COS": "cos", "ARCCOS": "arccos",
  "TAN": "tan", "ARCTAN": "arctan", "SINH": "sinh", "ARCSINH": "arsinh",
  "COSH": "cosh", "ARCCOSH": "arcosh", "TANH": "tanh", "ARCTANH": "artanh",
  "SQRT": "sqrt", "SQR": "sqr", "GAMMA": "Γ"
};

const namedOperators: Record<string, string> = {
  "PLUS": "+", "SUBTRACT": "-", "TIMES": "*", "DIVIDE": "/", "POWER": "^"
};

// Numerical evaluation
const numConstants: Record<string, number> = {
  "NEG": -1, "ZERO": 0, "ONE": 1, "TWO": 2, "THREE": 3, "FOUR": 4, "FIVE": 5,
  "SIX": 6, "SEVEN": 7, "EIGHT": 8, "NINE": 9, "POL": 0.5,
  "PI": Math.PI, "EULER": Math.E, "GOLDENRATIO": (1 + Math.sqrt(5)) / 2
};

const numFunctions: Record<string, (x: number) => number> = {
  "EXP": Math.exp, "LOG": Math.log, "INV": x => 1/x, "MINUS": x => -x,
  "SIN": Math.sin, "ARCSIN": Math.asin, "COS": Math.cos, "ARCCOS": Math.acos,
  "TAN": Math.tan, "ARCTAN": Math.atan, "SINH": Math.sinh, "ARCSINH": Math.asinh,
  "COSH": Math.cosh, "ARCCOSH": Math.acosh, "TANH": Math.tanh, "ARCTANH": Math.atanh,
  "SQRT": Math.sqrt, "SQR": x => x*x, "GAMMA": x => gamma(x)
};

const numOperators: Record<string, (a: number, b: number) => number> = {
  "PLUS": (a, b) => a + b, "SUBTRACT": (a, b) => a - b,
  "TIMES": (a, b) => a * b, "DIVIDE": (a, b) => a / b,
  "POWER": (a, b) => Math.pow(a, b)
};

// Gamma function approximation (Lanczos)
function gamma(z: number): number {
  if (z < 0.5) return Math.PI / (Math.sin(Math.PI * z) * gamma(1 - z));
  z -= 1;
  const g = 7;
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  let x = c[0];
  for (let i = 1; i < g + 2; i++) x += c[i] / (z + i);
  const t = z + g + 0.5;
  return Math.sqrt(2 * Math.PI) * Math.pow(t, z + 0.5) * Math.exp(-t) * x;
}

function rpnToInfix(rpn: string[]): string {
  const stack: string[] = [];
  rpn.forEach(token => {
    if (namedConstants[token]) {
      stack.push(namedConstants[token]);
    } else if (namedFunctions[token]) {
      const arg = stack.pop() || '';
      stack.push(`${namedFunctions[token]}(${arg})`);
    } else if (namedOperators[token]) {
      const left = stack.pop() || '';
      const right = stack.pop() || '';
      stack.push(`(${left} ${namedOperators[token]} ${right})`);
    }
  });
  return stack.pop() || '';
}

function evaluateRPN(rpn: string[]): number {
  const stack: number[] = [];
  rpn.forEach(token => {
    if (numConstants[token] !== undefined) {
      stack.push(numConstants[token]);
    } else if (numFunctions[token]) {
      const arg = stack.pop() || 0;
      stack.push(numFunctions[token](arg));
    } else if (numOperators[token]) {
      const a = stack.pop() || 0;
      const b = stack.pop() || 0;
      stack.push(numOperators[token](a, b));
    }
  });
  return stack.pop() || NaN;
}

function extractPrecision(inputString: string): number {
  const parts = inputString.split(/e/i);
  const mainPart = parts[0];
  const exponent = parts.length > 1 ? parseInt(parts[1]) : 0;
  const decimalIndex = mainPart.indexOf('.');
  if (decimalIndex === -1) return 0;
  const fractionalPart = mainPart.slice(decimalIndex + 1);
  return 0.5 * Math.pow(10, -fractionalPart.length + exponent);
}

// Mathematica conversion
function rpnToMathematica(rpn: string[]): string {
  const mmaConstants: Record<string, string> = {
    "NEG": "(-1)", "ZERO": "0", "ONE": "1", "TWO": "2", "THREE": "3",
    "FOUR": "4", "FIVE": "5", "SIX": "6", "SEVEN": "7", "EIGHT": "8",
    "NINE": "9", "PI": "Pi", "EULER": "E", "GOLDENRATIO": "GoldenRatio"
  };
  const mmaFunctions: Record<string, string> = {
    "EXP": "Exp", "LOG": "Log", "SIN": "Sin", "ARCSIN": "ArcSin",
    "COS": "Cos", "ARCCOS": "ArcCos", "TAN": "Tan", "ARCTAN": "ArcTan",
    "SINH": "Sinh", "ARCSINH": "ArcSinh", "COSH": "Cosh", "ARCCOSH": "ArcCosh",
    "TANH": "Tanh", "ARCTANH": "ArcTanh", "SQRT": "Sqrt", "GAMMA": "Gamma"
  };
  const mmaUnnamed: Record<string, (x: string) => string> = {
    "SQR": x => `(${x})^2`,
    "INV": x => `1/(${x})`
  };
  const mmaOperators: Record<string, string> = {
    "PLUS": "+", "SUBTRACT": "-", "TIMES": "*", "DIVIDE": "/", "POWER": "^"
  };

  const stack: string[] = [];
  rpn.forEach(token => {
    if (mmaConstants[token]) {
      stack.push(mmaConstants[token]);
    } else if (mmaFunctions[token]) {
      const arg = stack.pop() || '';
      stack.push(`${mmaFunctions[token]}[${arg}]`);
    } else if (mmaUnnamed[token]) {
      const arg = stack.pop() || '';
      stack.push(mmaUnnamed[token](arg));
    } else if (mmaOperators[token]) {
      const left = stack.pop() || '';
      const right = stack.pop() || '';
      stack.push(`((${left}) ${mmaOperators[token]} (${right}))`);
    }
  });
  return stack.pop() || '';
}

export default function ConstantRecognitionPage() {
  const [inputValue, setInputValue] = useState('');
  const [resultInfix, setResultInfix] = useState('');
  const [resultNumeric, setResultNumeric] = useState('');
  const [resultRPN, setResultRPN] = useState('');
  const [resultMathematica, setResultMathematica] = useState('');
  const [timing, setTiming] = useState('');
  const [searchDepth, setSearchDepth] = useState(6);
  const [threadCount, setThreadCount] = useState(4);
  const [autoThreads, setAutoThreads] = useState(true);
  const [detectedCPUs, setDetectedCPUs] = useState(0);
  const [isCalculating, setIsCalculating] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [wasmLoaded, setWasmLoaded] = useState(false);
  const [precision, setPrecision] = useState({ z: '', deltaZ: '', relDeltaZ: '' });
  
  // Filter states
  const [filters, setFilters] = useState({
    successfullyIdentified: true,
    bestSoFar: false,
    bestForLengthK: false,
    runningIntermediate: false,
    abortedPointless: false
  });
  const [tableSearch, setTableSearch] = useState('');
  const [showEntries, setShowEntries] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);
  
  const workersRef = useRef<Worker[]>([]);
  const startTimeRef = useRef<Date | null>(null);

  useEffect(() => {
    const cpus = navigator.hardwareConcurrency || 4;
    setDetectedCPUs(cpus);
    setThreadCount(cpus);
    checkWasmAvailability();
  }, []);

  const checkWasmAvailability = async () => {
    try {
      const response = await fetch('/wasm/rpn_function.js', { method: 'HEAD' });
      console.log('WASM check response:', response.status, response.ok);
      setWasmLoaded(response.ok);
    } catch (error) {
      console.error('WASM check error:', error);
      setWasmLoaded(false);
    }
  };

  const terminateAllWorkers = useCallback(() => {
    workersRef.current.forEach(worker => worker.terminate());
    workersRef.current = [];
  }, []);

  const displayResult = useCallback((result: SearchResult) => {
    const endTime = new Date();
    const timeTaken = startTimeRef.current 
      ? (endTime.getTime() - startTimeRef.current.getTime()) / 1000 
      : 0;

    if (result.result === "SUCCESS") {
      const rpnArray = result.RPN.split(', ');
      const infix = rpnToInfix(rpnArray);
      const numeric = evaluateRPN(rpnArray);
      
      setResultInfix(infix);
      setResultRPN(result.RPN);
      setResultNumeric(numeric.toString());
      setResultMathematica(rpnToMathematica(rpnArray));
    } else {
      setResultInfix('Not found');
      setResultRPN('Nothing found. Try larger K...');
      setResultNumeric('Check table');
      setResultMathematica('?');
    }
    setTiming(`${timeTaken.toFixed(3)} s`);
    setIsCalculating(false);
  }, []);

  const calculate = async () => {
    if (!inputValue) return;
    
    setIsCalculating(true);
    setResults([]);
    startTimeRef.current = new Date();
    
    const z = parseFloat(inputValue);
    const inputPrecision = extractPrecision(inputValue);
    const relPrecision = inputPrecision / Math.abs(z);
    
    setPrecision({
      z: z.toString(),
      deltaZ: inputPrecision.toString(),
      relDeltaZ: relPrecision.toExponential(4)
    });

    const ncpus = autoThreads ? detectedCPUs : threadCount;
    
    console.log('Calculate called, wasmLoaded:', wasmLoaded, 'ncpus:', ncpus);
    
    if (!wasmLoaded) {
      console.warn('WASM not loaded, using mock data');
      // Mock search for demo - simulate finding a result
      setTimeout(() => {
        const mockResults: SearchResult[] = [
          { cpuId: 0, K: 2, RPN: 'PI, SQR', result: 'FAILURE', REL_ERR: '0.05', HAMMING_DISTANCE: 5 },
          { cpuId: 1, K: 3, RPN: 'PI, EULER, TIMES', result: 'FAILURE', REL_ERR: '0.01', HAMMING_DISTANCE: 3 },
          { cpuId: 0, K: 4, RPN: 'PI, EULER, PLUS, SQR', result: 'SUCCESS', REL_ERR: '1e-10', HAMMING_DISTANCE: 0 },
        ];
        
        mockResults.forEach((r, i) => {
          setTimeout(() => {
            setResults(prev => [...prev, r]);
            if (r.result === 'SUCCESS') {
              displayResult(r);
            }
          }, i * 500);
        });
      }, 500);
      return;
    }

    // Real WASM workers
    terminateAllWorkers();
    let activeWorkers = ncpus;

    for (let i = 0; i < ncpus; i++) {
      const worker = new Worker('/wasm/worker.js');
      
      worker.addEventListener('message', (e) => {
        const result = e.data;
        
        if (result.type === 'ready') {
          worker.postMessage({
            initDelay: 0,
            z,
            inputPrecision,
            MinCodeLength: 1,
            MaxCodeLength: searchDepth,
            cpuId: i,
            ncpus
          });
          return;
        }

        if (result.results) {
          setResults(prev => [...prev, ...result.results]);
        }

        if (result.result === 'SUCCESS') {
          displayResult(result);
          terminateAllWorkers();
          setResults(prev => [...prev, result]);
        } else {
          setResults(prev => [...prev, result]);
          if (result.status === 'FINISHED') activeWorkers--;
          if (activeWorkers === 0) {
            displayResult(result);
          }
        }
      });

      worker.onerror = (err) => console.error('Worker error:', err);
      workersRef.current.push(worker);
    }
  };

  const createWolframLink = (formula: string) => {
    return `https://www.wolframalpha.com/input?i=${encodeURIComponent(formula)}`;
  };

  return (
    <div className="h-screen flex bg-[#f8f9fa] dark:bg-[#111113]">
      {/* Sidebar */}
      <aside className="w-64 bg-white dark:bg-[#1a1a1d] border-r border-gray-200 dark:border-[#2a2a2e] flex flex-col">
        {/* Logo */}
        <div className="p-4 border-b border-gray-200 dark:border-[#2a2a2e]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-[#0066cc] flex items-center justify-center text-white font-bold text-sm">
              ∞
            </div>
            <div>
              <h1 className="font-semibold text-gray-900 dark:text-white text-sm">Constant Recognizer</h1>
              <p className="text-[10px] text-gray-500 dark:text-gray-500">Jagiellonian University</p>
            </div>
          </div>
        </div>

        {/* Settings */}
        <div className="flex-1 p-4 space-y-6 overflow-y-auto">
          {/* Status */}
          <div className="space-y-2">
            <label className="text-[10px] font-medium text-gray-500 dark:text-gray-500 uppercase tracking-wider">Status</label>
            <div className="flex items-center gap-2 text-sm">
              <div className={`w-2 h-2 rounded-full ${wasmLoaded ? 'bg-green-500' : 'bg-amber-500'}`} />
              <span className="text-gray-700 dark:text-gray-300">{wasmLoaded ? 'WASM Ready' : 'Demo Mode'}</span>
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-500">
              {detectedCPUs} logical CPUs detected
            </div>
          </div>

          {/* Complexity */}
          <div className="space-y-2">
            <label className="text-[10px] font-medium text-gray-500 dark:text-gray-500 uppercase tracking-wider">
              Max Complexity (K)
            </label>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min="2"
                max="9"
                value={searchDepth}
                onChange={(e) => setSearchDepth(parseInt(e.target.value))}
                className="flex-1 accent-[#0066cc]"
              />
              <span className="font-mono text-sm font-bold text-gray-900 dark:text-white w-4">{searchDepth}</span>
            </div>
            <p className="text-[10px] text-gray-400 dark:text-gray-600">Higher = slower but more accurate</p>
          </div>

          {/* Threads */}
          <div className="space-y-2">
            <label className="text-[10px] font-medium text-gray-500 dark:text-gray-500 uppercase tracking-wider">
              Threads
            </label>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min="1"
                max="32"
                value={threadCount}
                onChange={(e) => setThreadCount(parseInt(e.target.value))}
                disabled={autoThreads}
                className="flex-1 accent-[#0066cc] disabled:opacity-40"
              />
              <span className="font-mono text-sm font-bold text-gray-900 dark:text-white w-6">
                {autoThreads ? 'Auto' : threadCount}
              </span>
            </div>
            <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400 cursor-pointer">
              <input
                type="checkbox"
                checked={autoThreads}
                onChange={(e) => setAutoThreads(e.target.checked)}
                className="accent-[#0066cc]"
              />
              Auto-detect
            </label>
          </div>

          {/* Precision Info */}
          {precision.z && (
            <div className="space-y-2">
              <label className="text-[10px] font-medium text-gray-500 dark:text-gray-500 uppercase tracking-wider">
                Search Target
              </label>
              <div className="text-xs font-mono text-gray-600 dark:text-gray-400 space-y-1 bg-gray-50 dark:bg-[#111113] p-2 rounded">
                <div>z = {precision.z}</div>
                <div>Δz = {precision.deltaZ}</div>
                <div>δz/z = {precision.relDeltaZ}</div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-200 dark:border-[#2a2a2e]">
          <a 
            href="https://github.com/Klaudiusz321/ConstantRecognition" 
            target="_blank" 
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-500 hover:text-[#0066cc] transition-colors"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>
            View on GitHub
          </a>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Input Bar */}
        <div className="bg-white dark:bg-[#1a1a1d] border-b border-gray-200 dark:border-[#2a2a2e] p-4">
          <div className="flex items-center gap-3">
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && calculate()}
              placeholder="Enter a number to identify... (e.g., 3.14159265, 2.71828, 1.618034)"
              className="flex-1 px-4 py-3 bg-gray-50 dark:bg-[#111113] border border-gray-200 dark:border-[#2a2a2e] rounded-lg
                         text-gray-900 dark:text-white font-mono text-lg
                         focus:outline-none focus:ring-2 focus:ring-[#0066cc] focus:border-transparent
                         placeholder-gray-400 dark:placeholder-gray-600"
            />
            <button
              onClick={calculate}
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

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Result Card */}
          {resultInfix && (
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
          )}

          {/* Results Table with Filters */}
          {results.length > 0 && (
            <div className="bg-white dark:bg-[#1a1a1d] rounded-lg border border-gray-200 dark:border-[#2a2a2e]">
              <div className="px-4 py-3 border-b border-gray-100 dark:border-[#2a2a2e]">
                <span className="text-sm font-medium text-gray-900 dark:text-white">Search intermediate results</span>
              </div>
              
              {/* Filters */}
              <div className="px-4 py-3 border-b border-gray-100 dark:border-[#2a2a2e] flex flex-wrap items-center gap-4">
                <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={filters.successfullyIdentified}
                    onChange={(e) => setFilters(f => ({...f, successfullyIdentified: e.target.checked}))}
                    className="accent-[#0066cc]"
                  />
                  Successfully identified
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={filters.bestSoFar}
                    onChange={(e) => setFilters(f => ({...f, bestSoFar: e.target.checked}))}
                    className="accent-[#0066cc]"
                  />
                  Best so far
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={filters.bestForLengthK}
                    onChange={(e) => setFilters(f => ({...f, bestForLengthK: e.target.checked}))}
                    className="accent-[#0066cc]"
                  />
                  Best for length K
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={filters.runningIntermediate}
                    onChange={(e) => setFilters(f => ({...f, runningIntermediate: e.target.checked}))}
                    className="accent-[#0066cc]"
                  />
                  Running intermediate result
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={filters.abortedPointless}
                    onChange={(e) => setFilters(f => ({...f, abortedPointless: e.target.checked}))}
                    className="accent-[#0066cc]"
                  />
                  Aborted pointless search
                </label>
                <button
                  onClick={() => setFilters({
                    successfullyIdentified: false,
                    bestSoFar: false,
                    bestForLengthK: false,
                    runningIntermediate: false,
                    abortedPointless: false
                  })}
                  className="px-3 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-100 dark:hover:bg-[#2a2a2e] transition-colors text-gray-700 dark:text-gray-300"
                >
                  Clear Filters
                </button>
              </div>

              {/* Table controls */}
              <div className="px-4 py-3 flex items-center justify-between border-b border-gray-100 dark:border-[#2a2a2e]">
                <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                  Show
                  <select
                    value={showEntries}
                    onChange={(e) => { setShowEntries(parseInt(e.target.value)); setCurrentPage(1); }}
                    className="px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-[#111113] text-gray-900 dark:text-white"
                  >
                    <option value={10}>10</option>
                    <option value={25}>25</option>
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                  </select>
                  entries
                </div>
                <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                  Search:
                  <input
                    type="text"
                    value={tableSearch}
                    onChange={(e) => { setTableSearch(e.target.value); setCurrentPage(1); }}
                    className="px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-[#111113] text-gray-900 dark:text-white w-48"
                    placeholder="Filter results..."
                  />
                </div>
              </div>
              
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 dark:bg-[#111113]">
                      <th className="px-3 py-2 text-left text-[10px] font-medium text-gray-500 dark:text-gray-500 uppercase tracking-wider">CPU ID</th>
                      <th className="px-3 py-2 text-left text-[10px] font-medium text-gray-500 dark:text-gray-500 uppercase tracking-wider">Komplexity</th>
                      <th className="px-3 py-2 text-left text-[10px] font-medium text-gray-500 dark:text-gray-500 uppercase tracking-wider">Numeric result</th>
                      <th className="px-3 py-2 text-left text-[10px] font-medium text-gray-500 dark:text-gray-500 uppercase tracking-wider">Mathematica</th>
                      <th className="px-3 py-2 text-left text-[10px] font-medium text-gray-500 dark:text-gray-500 uppercase tracking-wider">Search status</th>
                      <th className="px-3 py-2 text-left text-[10px] font-medium text-gray-500 dark:text-gray-500 uppercase tracking-wider">Relative error</th>
                      <th className="px-3 py-2 text-left text-[10px] font-medium text-gray-500 dark:text-gray-500 uppercase tracking-wider">Compression ratio</th>
                      <th className="px-3 py-2 text-left text-[10px] font-medium text-gray-500 dark:text-gray-500 uppercase tracking-wider">Hamming distance</th>
                      <th className="px-3 py-2 text-left text-[10px] font-medium text-gray-500 dark:text-gray-500 uppercase tracking-wider">RPN code</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-[#2a2a2e]">
                    {(() => {
                      // Apply filters
                      let filtered = results.filter(r => {
                        const isSuccess = r.result === 'SUCCESS';
                        const isBestSoFar = r.status === 'BEST_SO_FAR';
                        const isBestForK = r.status === 'BEST_FOR_K';
                        const isRunning = r.status === 'RUNNING' || r.status === 'INTERMEDIATE';
                        const isAborted = r.status === 'ABORTED' || r.status === 'POINTLESS';
                        
                        // If no filters selected, show all
                        const anyFilterActive = filters.successfullyIdentified || filters.bestSoFar || 
                          filters.bestForLengthK || filters.runningIntermediate || filters.abortedPointless;
                        
                        if (!anyFilterActive) return true;
                        
                        if (filters.successfullyIdentified && isSuccess) return true;
                        if (filters.bestSoFar && isBestSoFar) return true;
                        if (filters.bestForLengthK && isBestForK) return true;
                        if (filters.runningIntermediate && isRunning) return true;
                        if (filters.abortedPointless && isAborted) return true;
                        
                        return false;
                      });
                      
                      // Apply search
                      if (tableSearch) {
                        const search = tableSearch.toLowerCase();
                        filtered = filtered.filter(r => 
                          r.RPN?.toLowerCase().includes(search) ||
                          r.result?.toLowerCase().includes(search) ||
                          r.status?.toLowerCase().includes(search) ||
                          String(r.K).includes(search) ||
                          String(r.cpuId).includes(search)
                        );
                      }
                      
                      const totalFiltered = filtered.length;
                      const totalPages = Math.ceil(totalFiltered / showEntries);
                      const startIdx = (currentPage - 1) * showEntries;
                      const paginated = filtered.slice(startIdx, startIdx + showEntries);
                      
                      return (
                        <>
                          {paginated.map((result, idx) => {
                            const rpnArray = result.RPN ? result.RPN.split(', ') : [];
                            const numericValue = rpnArray.length > 0 ? evaluateRPN(rpnArray) : NaN;
                            const mathematica = rpnArray.length > 0 ? rpnToMathematica(rpnArray) : '-';
                            const compressionRatio = result.K > 0 ? (inputValue.length / result.K).toFixed(2) : '-';
                            
                            return (
                              <tr 
                                key={startIdx + idx}
                                className={`hover:bg-gray-50 dark:hover:bg-[#111113] ${result.result === 'SUCCESS' ? 'bg-green-50 dark:bg-green-900/10' : ''}`}
                              >
                                <td className="px-3 py-2 font-mono text-gray-600 dark:text-gray-400">{result.cpuId}</td>
                                <td className="px-3 py-2 font-mono font-bold text-gray-900 dark:text-white">{result.K}</td>
                                <td className="px-3 py-2 font-mono text-gray-700 dark:text-gray-300 text-xs">
                                  {!isNaN(numericValue) ? numericValue.toPrecision(12) : '-'}
                                </td>
                                <td className="px-3 py-2">
                                  {mathematica !== '-' ? (
                                    <a 
                                      href={createWolframLink(mathematica)}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="font-mono text-xs text-[#0066cc] hover:underline"
                                    >
                                      {mathematica}
                                    </a>
                                  ) : (
                                    <span className="text-gray-400">-</span>
                                  )}
                                </td>
                                <td className="px-3 py-2">
                                  <span className={`px-2 py-0.5 rounded text-xs font-medium
                                    ${result.result === 'SUCCESS' 
                                      ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' 
                                      : result.status === 'RUNNING' || result.status === 'INTERMEDIATE'
                                      ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'
                                      : result.status === 'ABORTED' || result.status === 'POINTLESS'
                                      ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                                      : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'}`}>
                                    {result.result || result.status || 'SEARCHING'}
                                  </span>
                                </td>
                                <td className="px-3 py-2 font-mono text-xs text-gray-500 dark:text-gray-500">{result.REL_ERR || '-'}</td>
                                <td className="px-3 py-2 font-mono text-xs text-gray-500 dark:text-gray-500">{compressionRatio}</td>
                                <td className="px-3 py-2 font-mono text-xs text-gray-500 dark:text-gray-500">{result.HAMMING_DISTANCE ?? '-'}</td>
                                <td className="px-3 py-2 font-mono text-xs text-gray-500 dark:text-gray-500 max-w-[200px] truncate" title={result.RPN}>{result.RPN || '-'}</td>
                              </tr>
                            );
                          })}
                          {paginated.length === 0 && (
                            <tr>
                              <td colSpan={9} className="px-4 py-8 text-center text-gray-500 dark:text-gray-500">
                                No matching records found
                              </td>
                            </tr>
                          )}
                        </>
                      );
                    })()}
                  </tbody>
                </table>
              </div>
              
              {/* Pagination */}
              <div className="px-4 py-3 border-t border-gray-100 dark:border-[#2a2a2e] flex items-center justify-between text-sm text-gray-600 dark:text-gray-400">
                <div>
                  {(() => {
                    let filtered = results;
                    const anyFilterActive = filters.successfullyIdentified || filters.bestSoFar || 
                      filters.bestForLengthK || filters.runningIntermediate || filters.abortedPointless;
                    
                    if (anyFilterActive) {
                      filtered = results.filter(r => {
                        const isSuccess = r.result === 'SUCCESS';
                        const isBestSoFar = r.status === 'BEST_SO_FAR';
                        const isBestForK = r.status === 'BEST_FOR_K';
                        const isRunning = r.status === 'RUNNING' || r.status === 'INTERMEDIATE';
                        const isAborted = r.status === 'ABORTED' || r.status === 'POINTLESS';
                        
                        if (filters.successfullyIdentified && isSuccess) return true;
                        if (filters.bestSoFar && isBestSoFar) return true;
                        if (filters.bestForLengthK && isBestForK) return true;
                        if (filters.runningIntermediate && isRunning) return true;
                        if (filters.abortedPointless && isAborted) return true;
                        return false;
                      });
                    }
                    
                    if (tableSearch) {
                      const search = tableSearch.toLowerCase();
                      filtered = filtered.filter(r => 
                        r.RPN?.toLowerCase().includes(search) ||
                        r.result?.toLowerCase().includes(search) ||
                        r.status?.toLowerCase().includes(search) ||
                        String(r.K).includes(search) ||
                        String(r.cpuId).includes(search)
                      );
                    }
                    
                    const start = filtered.length > 0 ? (currentPage - 1) * showEntries + 1 : 0;
                    const end = Math.min(currentPage * showEntries, filtered.length);
                    return `Showing ${start} to ${end} of ${filtered.length} entries${filtered.length !== results.length ? ` (filtered from ${results.length} total entries)` : ''}`;
                  })()}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    className="px-3 py-1 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-100 dark:hover:bg-[#2a2a2e] disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Previous
                  </button>
                  <button
                    onClick={() => setCurrentPage(p => p + 1)}
                    disabled={currentPage * showEntries >= results.length}
                    className="px-3 py-1 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-100 dark:hover:bg-[#2a2a2e] disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Next
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Empty State */}
          {!resultInfix && results.length === 0 && (
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
                {['3.14159', '2.71828', '1.61803', '1.41421'].map(num => (
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
          )}
        </div>
      </main>
    </div>
  );
}

