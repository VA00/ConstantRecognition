interface SidebarProps {
  wasmLoaded: boolean;
  detectedCPUs: number;
  searchDepth: number;
  setSearchDepth: (value: number) => void;
  threadCount: number;
  setThreadCount: (value: number) => void;
  autoThreads: boolean;
  setAutoThreads: (value: boolean) => void;
  precision: { z: string; deltaZ: string; relDeltaZ: string };
}

export default function Sidebar({
  wasmLoaded,
  detectedCPUs,
  searchDepth,
  setSearchDepth,
  threadCount,
  setThreadCount,
  autoThreads,
  setAutoThreads,
  precision
}: SidebarProps) {
  return (
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
  );
}
