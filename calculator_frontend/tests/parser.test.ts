import { describe, it, expect } from 'vitest';

// We extract the parsing logic that is used in worker.js and page.tsx 
// into an easily testable format.
function parseFunctionInput(inputValue) {
    const pairs = inputValue.split(/[\n;]/).map(p => p.trim()).filter(p => p);
    const x_arr = [];
    const y_arr = [];
    pairs.forEach(p => {
        const parts = p.split(/[:,]/);
        if (parts.length >= 2) {
            x_arr.push(parseFloat(parts[0]));
            y_arr.push(parseFloat(parts[1]));
        }
    });
    return { x_arr, y_arr };
}

function parseMultipleConstants(inputValue) {
    return inputValue.split(/[,;\n]/).map(v => parseFloat(v.trim())).filter(v => !isNaN(v));
}

describe('Frontend Input Parsing Logic', () => {
  
  describe('parseFunctionInput (MODE_FUNCTION)', () => {
    it('should parse semi-colon separated pairs', () => {
      const input = "1:1; 2:4; 3:9";
      const { x_arr, y_arr } = parseFunctionInput(input);
      expect(x_arr).toEqual([1, 2, 3]);
      expect(y_arr).toEqual([1, 4, 9]);
    });

    it('should parse newline separated comma pairs', () => {
      const input = `
        1,1
        2,4
        3,9
      `;
      const { x_arr, y_arr } = parseFunctionInput(input);
      expect(x_arr).toEqual([1, 2, 3]);
      expect(y_arr).toEqual([1, 4, 9]);
    });

    it('should ignore invalid pairs', () => {
      const input = "1:1; invalid; 3:9";
      const { x_arr, y_arr } = parseFunctionInput(input);
      expect(x_arr).toEqual([1, 3]);
      expect(y_arr).toEqual([1, 9]);
    });
  });

  describe('parseMultipleConstants (MODE_BATCH)', () => {
    it('should parse comma-separated constants', () => {
      const input = "3.14159, 2.71828, 1.61803";
      const vals = parseMultipleConstants(input);
      expect(vals).toEqual([3.14159, 2.71828, 1.61803]);
    });

    it('should parse newline and semicolon-separated constants', () => {
      const input = "3.14159; \n 2.71828; \n 1.61803";
      const vals = parseMultipleConstants(input);
      expect(vals).toEqual([3.14159, 2.71828, 1.61803]);
    });

    it('should ignore NaN values', () => {
      const input = "3.14159, abc, 2.71828";
      const vals = parseMultipleConstants(input);
      expect(vals).toEqual([3.14159, 2.71828]);
    });
  });

});
