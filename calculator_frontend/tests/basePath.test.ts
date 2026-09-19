import { describe, it, expect, afterEach } from 'vitest';
import { basePath, assetPath } from '../app/calculator/lib/basePath';

const original = process.env.NEXT_PUBLIC_BASE_PATH;
afterEach(() => { process.env.NEXT_PUBLIC_BASE_PATH = original; });

describe('base path helpers', () => {
  it('normalises the configured base path', () => {
    process.env.NEXT_PUBLIC_BASE_PATH = '/~odrzywolek/WASM/calculator/';
    expect(basePath()).toBe('/~odrzywolek/WASM/calculator');
    expect(assetPath('/wasm/worker.js')).toBe('/~odrzywolek/WASM/calculator/wasm/worker.js');
    expect(assetPath('logo.png')).toBe('/~odrzywolek/WASM/calculator/logo.png');
  });
  it('is a no-op at the site root', () => {
    process.env.NEXT_PUBLIC_BASE_PATH = '';
    expect(basePath()).toBe('');
    expect(assetPath('/wasm/worker.js')).toBe('/wasm/worker.js');
  });
});
