'use client';

import { CalculatorButton as ButtonType } from '../types/calculator';

interface CalculatorButtonProps {
  button: ButtonType;
  isSelected: boolean;
  onToggle: (id: string) => void;
}

export default function CalculatorButton({ button, isSelected, onToggle }: CalculatorButtonProps) {
  return (
    <button
      onClick={() => onToggle(button.id)}
      className={`
        group relative p-4 rounded-xl font-bold text-base
        transition-all duration-200 transform
        hover:scale-110 hover:shadow-2xl hover:z-10
        active:scale-95
        ${isSelected 
          ? 'ring-4 ring-offset-2 ring-blue-500 shadow-xl scale-105' 
          : 'opacity-60 hover:opacity-100 shadow-md'
        }
      `}
      style={{
        backgroundColor: button.color || '#6B7280',
        color: 'white',
      }}
      title={`${button.code} (${button.type})`}
    >
      <div className="flex flex-col items-center gap-1">
        <span className="text-xl">{button.label}</span>
        {isSelected && (
          <span className="text-xs opacity-75 font-normal">
            {button.id}
          </span>
        )}
      </div>
      
      {/* Hover tooltip */}
      <div className="absolute -top-12 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
        <div className="bg-gray-900 text-white text-xs px-3 py-2 rounded-lg shadow-xl whitespace-nowrap">
          {button.code}
        </div>
      </div>
    </button>
  );
}
