# Calculator Frontend

This is a Next.js 16 frontend for the constant recognizer. The project is configured for **static export**, so running `npm run build` emits a fully static site in the `out/` directory that can be served by any plain HTTP server (no Node.js runtime needed at deploy time).

## Development
- Install dependencies: `npm install`
- Start the dev server: `npm run dev`
- Run the unit tests: `npm test`

## Rebuilding the WASM engine

The search engine lives in `../C` and is compiled with Emscripten (`emcc`) into two files,
`public/wasm/vsearch.js` and `public/wasm/vsearch.wasm`. They are build artifacts and are **not tracked in git**,
so they must be built:

- after a fresh clone, before `npm run dev` or `npm run build`,
- after any change under `../C`.

The `emcc` command is the same on every system (Makefile target `wasm` in `../C/Makefile`, and `../C/compile.bat`);
only the way to install Emscripten and put `emcc` on the PATH differs.

### Windows (tested in PowerShell 7)

One-time installation of the Emscripten SDK:

```
git clone https://github.com/emscripten-core/emsdk.git
cd emsdk
.\emsdk install latest
.\emsdk activate latest
```

`activate` also puts `emcc` on the PATH of the current window. In every new window run `.\emsdk_env.ps1`
(PowerShell) or `emsdk_env.bat` (cmd.exe) from the `emsdk` directory first, or run
`.\emsdk activate latest --permanent` once. Check with `emcc --version`.

Then build from the repository's `C` directory. Either run the script:

```
cd <repo>\C
.\compile.bat
```

or paste the `emcc` one-liner, the last command in `compile.bat`, into PowerShell or cmd.exe:

```
emcc -O2 -Wall vsearch_RPN_wasm.c vsearch_RPN_core.c vsearch_RPN_complex.c utils.c -s WASM=1 -s ALLOW_MEMORY_GROWTH=1 -s EXPORTED_FUNCTIONS="['_search_RPN','_search_RPN_with_cr','_search_RPN_hybrid','_search_RPN_custom','_search_RPN_custom_cr','_search_RPN_complex','_evaluate_RPN_complex','_search_function_wasm','_search_batch_wasm','_free','_malloc']" -s EXPORTED_RUNTIME_METHODS="['ccall','cwrap','UTF8ToString']" -o ../calculator_frontend/public/wasm/vsearch.js
```

### macOS (tested)

Emscripten from Homebrew; `make` comes with the Xcode Command Line Tools:

```
brew install emscripten
cd <repo>/C
make wasm
```

### Linux

TODO: not yet verified on a Linux machine. The expected procedure is the official emsdk one, plus `make`
(e.g. `build-essential` on Debian/Ubuntu):

```
git clone https://github.com/emscripten-core/emsdk.git
cd emsdk
./emsdk install latest
./emsdk activate latest
source ./emsdk_env.sh        # in every new shell
cd <repo>/C
make wasm
```

### Result

Both `compile.bat` and `make wasm` write `vsearch.js` and `vsearch.wasm` into `calculator_frontend/public/wasm/`.
The static build (`npm run build`) computes the `?v=<content hash>` cache-busting query from these files, so rebuild
the site after rebuilding the engine.

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

This sets both the Next.js `basePath` and the URLs used to load the WASM worker so the static files under `out/`
remain portable.

**Example for FreeBSD server**

Target URL: `http://th.if.uj.edu.pl/~odrzywolek/WASM/calculator/`

1. In PowerShell, set the base path (note: use the path portion, not the full URL):
   ```powershell
   $env:NEXT_PUBLIC_BASE_PATH = "/~odrzywolek/WASM/calculator"
   npm run build
   ```
2. Copy the generated `out/` directory to `http://th.if.uj.edu.pl/~odrzywolek/WASM/calculator/` on the server (so
   `out/index.html` ends up at `.../calculator/index.html`, `out/wasm/worker.js` at `.../calculator/wasm/worker.js`,
   etc.).
3. Serve the contents of `out/` with any HTTP server (Apache `httpd`, `nginx`, etc.) — no Node.js runtime is needed
   on the server because everything is static.

The engine files `wasm/worker.js`, `wasm/vsearch.js` and `wasm/vsearch.wasm` are requested with a `?v=<content hash>`
query computed at build time, so browsers fetch a new engine after an update even without cache-control headers.

If you prefer to run the Next.js server instead of exporting static files, omit `output: "export"` in `next.config.ts` and use `npm run start` after `npm run build`.
