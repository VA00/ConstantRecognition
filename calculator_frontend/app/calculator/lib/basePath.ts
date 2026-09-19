// Base-path helpers for deployments in a sub-directory, e.g.
// http://th.if.uj.edu.pl/~odrzywolek/WASM/calculator/ built with
// NEXT_PUBLIC_BASE_PATH=/~odrzywolek/WASM/calculator.
//
// Next.js rewrites its own asset URLs, but anything we reference by hand
// (worker script, WASM files, images in public/) must be prefixed here.

// "/constant", "constant/" or "" -> "/constant" or ""
export function basePath(): string {
  const raw = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
  const trimmed = raw.replace(/^\/+|\/+$/g, '');
  return trimmed ? `/${trimmed}` : '';
}

// Root-relative URL for a file in public/. Deterministic on server and
// client, so it is safe in rendered markup (img src).
export function assetPath(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${basePath()}${normalizedPath}`;
}

// Absolute URL in the browser (for Worker and fetch), root-relative on the server.
export function withBasePath(path: string): string {
  const p = assetPath(path);
  if (typeof window === 'undefined') return p;
  return new URL(p, window.location.origin).toString();
}

// Cache-busting query for the hand-referenced WASM files. The value is a
// content hash computed at build time in next.config.ts, so it changes only
// when the engine or worker changes.
export function wasmVersionQuery(): string {
  const v = process.env.NEXT_PUBLIC_WASM_VERSION;
  return v ? `?v=${v}` : '';
}
