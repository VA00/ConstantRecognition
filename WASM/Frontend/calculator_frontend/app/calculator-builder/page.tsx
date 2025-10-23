'use client';

import { useState } from 'react';
import { CalculatorConfig, PRESET_CALCULATORS } from '../types/calculator';
import ButtonPalette from '../components/ButtonPalette';
import CalculatorPreview from '../components/CalculatorPreview';

export default function CalculatorBuilderPage() {
  const [currentConfig, setCurrentConfig] = useState<CalculatorConfig>(
    PRESET_CALCULATORS.casio
  );
  const [selectedButtons, setSelectedButtons] = useState<string[]>(
    currentConfig.buttons.map(b => b.id)
  );

  const toggleButton = (buttonId: string) => {
    setSelectedButtons(prev =>
      prev.includes(buttonId)
        ? prev.filter(id => id !== buttonId)
        : [...prev, buttonId]
    );
  };

  const activeButtons = currentConfig.buttons.filter(b => selectedButtons.includes(b.id));

  const handleUse = () => {
    console.log('Using calculator with buttons:', activeButtons);
    // TODO: Navigate to search page with this config
  };

  const handleSave = () => {
    const config = {
      ...currentConfig,
      buttons: activeButtons,
    };
    localStorage.setItem('calculatorConfig', JSON.stringify(config));
    alert('Configuration saved successfully');
  };

  const handleExport = () => {
    const config = {
      ...currentConfig,
      buttons: activeButtons,
    };
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `calculator-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const selectAll = () => {
    setSelectedButtons(currentConfig.buttons.map(b => b.id));
  };

  const deselectAll = () => {
    setSelectedButtons([]);
  };

  return (
    <div className="min-h-screen bg-[#f5f5f5] dark:bg-[#1c1c1c]">
      {/* Wolfram-style Header */}
      <header className="bg-white dark:bg-[#2a2a2a] border-b border-gray-300 dark:border-gray-700">
        <div className="max-w-[1800px] mx-auto px-8 py-3 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <h1 className="text-xl font-normal text-gray-900 dark:text-white">
              Calculator Builder
            </h1>
            
          </div>
          <div className="flex gap-2">
            <button
              onClick={selectAll}
              className="px-4 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded border border-gray-300 dark:border-gray-600 transition-colors"
            >
              Select All
            </button>
            <button
              onClick={deselectAll}
              className="px-4 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded border border-gray-300 dark:border-gray-600 transition-colors"
            >
              Clear
            </button>
          </div>
        </div>
      </header>

      {/* Main Content - Wolfram Layout */}
      <main className="max-w-[1800px] mx-auto px-8 py-6">
        <div className="flex gap-6">
          {/* Left Sidebar - Preview */}
          <aside className="w-[320px] shrink-0">
            <CalculatorPreview
              buttons={activeButtons}
              onUse={handleUse}
              onSave={handleSave}
              onExport={handleExport}
            />
          </aside>

          {/* Main Content - Button Palette */}
          <div className="flex-1 min-w-0">
            <ButtonPalette
              buttons={currentConfig.buttons}
              selectedButtons={selectedButtons}
              onToggle={toggleButton}
            />
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-300 dark:border-gray-700 bg-white dark:bg-[#2a2a2a] mt-8">
        <div className="max-w-[1800px] mx-auto px-8 py-3">
          <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-500">
            <p>© 2025 Constant Recognition System</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
