# Calculator Frontend

This is a Next.js 16 frontend for the constant recognizer. The project is configured for **static export**, so running `npm run build` emits a fully static site in the `out/` directory that can be served by any plain HTTP server (no Node.js runtime needed at deploy time).

## Development
- Install dependencies: `npm install`
- Start the dev server: `npm run dev`
- Run the unit tests: `npm test`

## Rebuilding the WASM engine
The search engine lives in `../C` and is compiled with Emscripten into `public/wasm/vsearch.js` + `vsearch.wasm`
(both committed, so a plain `npm run build` needs no emcc):

```
cd ../C && make wasm
```

Exports used by `public/wasm/worker.js`: `search_RPN_with_cr` (full CALC4), `search_RPN_custom_cr` (any button
set, with the CR early-exit threshold), `search_RPN_complex` (complex domain, target `z_re + i z_im`), `evaluate_RPN_complex` (value of a named RPN code).

## Static production build
- Build the site: `npm run build`
  - The static files are written to `out/`
- Serve locally for a quick check (example): `npx serve@latest out`
- Deploy by copying the `out/` directory to any HTTP server (e.g., `nginx`, `httpd`, `python -m http.server`).

### Hosting in a subdirectory or behind a reverse proxy path
If the site will be served from a non-root path (for example `https://example.com/constant/`), build with the base
path baked in so all assets resolve correctly:

```
NEXT_PUBLIC_BASE_PATH=/constant npm run build
```

This sets the Next.js `basePath` and the URLs used to load the worker, the WASM files and the images in `public/`,
so the static files under `out/` remain portable. The three hand-referenced engine files (`wasm/worker.js`,
`wasm/vsearch.js`, `wasm/vsearch.wasm`) are requested with a `?v=<content hash>` query computed at build time, so
browsers pick up a new engine even when the server sends no cache-control headers.

### Deployment to the FreeBSD server (th.if.uj.edu.pl)

Target: `http://th.if.uj.edu.pl/~odrzywolek/WASM/calculator/` (landing page) and
`http://th.if.uj.edu.pl/~odrzywolek/WASM/calculator/calculator/` (the recognizer). Plain Apache, no Node.js.

1. Make sure the committed WASM engine is current (`cd ../C && make wasm` if the C sources changed, then commit
   `public/wasm/vsearch.js` and `vsearch.wasm`).
2. Build with the base path (macOS/Linux shell; on PowerShell set `$env:NEXT_PUBLIC_BASE_PATH` first):
   ```
   rm -rf out && NEXT_PUBLIC_BASE_PATH=/~odrzywolek/WASM/calculator npm run build
   ```
3. Copy the *contents* of `out/` to the directory Apache serves as `~odrzywolek/WASM/calculator/`, so that
   `out/index.html` becomes `.../calculator/index.html` and `out/wasm/worker.js` becomes `.../calculator/wasm/worker.js`:
   ```
   rsync -avz --delete out/ USER@th.if.uj.edu.pl:public_html/WASM/calculator/
   ```
   `--delete` removes the hashed chunks of the previous build (only use it if the directory holds nothing else).
   Without rsync on the server: `tar czf - -C out . | ssh USER@th.if.uj.edu.pl 'tar xzf - -C public_html/WASM/calculator'`.
4. Files must be world-readable: `chmod -R a+rX public_html/WASM/calculator` on the server if needed.
5. Optional: if `AllowOverride` permits it, a `.htaccess` with `AddType application/wasm .wasm` lets browsers use
   streaming compilation. Without it the engine still works (the loader falls back to ArrayBuffer instantiation).
6. Check in the browser: the sidebar status should say "WASM Ready"; in the console, the JSON returned by the
   workers carries a `buildTime` field that must match the new build. No COOP/COEP headers are required (the
   workers do not share memory), so plain `http://` is fine.

If you prefer to run the Next.js server instead of exporting static files, omit `output: "export"` in `next.config.ts` and use `npm run start` after `npm run build`.
