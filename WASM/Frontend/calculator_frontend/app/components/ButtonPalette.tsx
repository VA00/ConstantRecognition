'use client';

import { CalculatorButton as ButtonType } from '../types/calculator';

interface ButtonPaletteProps {
  buttons: ButtonType[];
  selectedButtons: string[];
  onToggle: (id: string) => void;
}

export default function ButtonPalette({ buttons, selectedButtons, onToggle }: ButtonPaletteProps) {
  const categories = [
    { id: 'constants', name: 'Constants', color: 'text-blue-600 dark:text-blue-400' },
    { id: 'arithmetic', name: 'Arithmetic Operations', color: 'text-orange-600 dark:text-orange-400' },
    { id: 'trigonometry', name: 'Trigonometric Functions', color: 'text-purple-600 dark:text-purple-400' },
    { id: 'special', name: 'Special Functions', color: 'text-green-600 dark:text-green-400' },
  ];

  return (
    <div className="space-y-3">
      {categories.map(category => {
        const categoryButtons = buttons.filter(b => b.category === category.id);
        const selectedCount = categoryButtons.filter(b => selectedButtons.includes(b.id)).length;
        
        return (
          <section key={category.id} className="bg-white dark:bg-[#2a2a2a] border border-gray-300 dark:border-gray-700 rounded shadow-sm">
            {/* Category Header - Wolfram Style */}
            <div className="bg-gray-100 dark:bg-[#333333] border-b border-gray-300 dark:border-gray-700 px-4 py-2 flex items-center justify-between">
              <h3 className={`text-xs font-semibold ${category.color} uppercase tracking-wider`}>
                {category.name}
              </h3>
              <div className="flex items-center gap-3">
                <span className="text-xs text-gray-500 dark:text-gray-400 font-mono">
                  {selectedCount}/{categoryButtons.length}
                </span>
                <button
                  onClick={() => {
                    const allSelected = categoryButtons.every(b => selectedButtons.includes(b.id));
                    categoryButtons.forEach(b => {
                      if (allSelected && selectedButtons.includes(b.id)) {
                        onToggle(b.id);
                      } else if (!allSelected && !selectedButtons.includes(b.id)) {
                        onToggle(b.id);
                      }
                    });
                  }}
                  className="text-xs px-2 py-1 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors border border-gray-300 dark:border-gray-600"
                >
                  {categoryButtons.every(b => selectedButtons.includes(b.id)) ? 'Clear' : 'All'}
                </button>
              </div>
            </div>
            
            {/* Button Grid */}
            <div className="p-3 grid grid-cols-8 sm:grid-cols-10 lg:grid-cols-12 xl:grid-cols-14 gap-0.5 bg-gray-100 dark:bg-[#1a1a1a]">
              {categoryButtons.map(button => {
                const isSelected = selectedButtons.includes(button.id);
                return (
                  <button
                    key={button.id}
                    onClick={() => onToggle(button.id)}
                    className={`
                      aspect-square flex items-center justify-center
                      font-mono text-xs font-semibold
                      transition-all border
                      ${isSelected 
                        ? 'border-orange-500 bg-orange-100 dark:bg-orange-900/40 text-orange-900 dark:text-orange-200' 
                        : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-[#2a2a2a] text-gray-700 dark:text-gray-300 hover:border-gray-400 dark:hover:border-gray-500 hover:bg-gray-50 dark:hover:bg-[#333333]'
                      }
                    `}
                    title={`${button.code} (${button.id})`}
                  >
                    {button.label}
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
