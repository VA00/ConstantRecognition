import type { NextConfig } from "next";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Content hash of the hand-referenced WASM files, used as a cache-busting
// query (?v=...) on worker.js, vsearch.js and vsearch.wasm. Static servers
// (e.g. plain Apache) send no cache-control headers for them, and browsers
// would otherwise keep running an old engine against a new page.
const wasmVersion = (() => {
  const hash = createHash("md5");
  for (const f of ["worker.js", "vsearch.js", "vsearch.wasm"]) {
    try {
      hash.update(readFileSync(join(__dirname, "public", "wasm", f)));
    } catch {
      hash.update(f);
    }
  }
  return hash.digest("hex").slice(0, 10);
})();


  
  // Accepts values like "/constant" or "constant/" and normalizes them to "/constant".
  // The regex strips leading/trailing slashes so we can add exactly one leading slash back.
  const rawBasePath = process.env.NEXT_PUBLIC_BASE_PATH;
  const normalizedBasePath = rawBasePath
    ? `/${rawBasePath.replace(/^\/+|\/+$/g, "")}`
    : undefined;

  const nextConfig: NextConfig = {

    env: {
      NEXT_PUBLIC_WASM_VERSION: wasmVersion,
    },
  
    // Generate a static export in `out/` when running `next build`
    output: "export",
    // Keep all asset URLs relative to an optional base path (or the current folder)
    basePath: normalizedBasePath,
    assetPrefix: normalizedBasePath ?? "./",
    trailingSlash: true,
    images: {
      unoptimized: true,
    },
    
  // Disable dev indicators that might cause layout issues
  devIndicators: false,
  
  // Pusta konfiguracja Turbopack (wystarczy dla większości przypadków)
  turbopack: {},
  
  // Zachowaj webpack dla fallback (jeśli ktoś użyje --webpack)
  webpack: (config, { isServer }) => {
    // Enable WebAssembly support
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
      layers: true,
    };

    // Handle .wasm files
    config.module.rules.push({
      test: /\.wasm$/,
      type: "webassembly/async",
    });

    // Exclude WASM from server-side rendering
    if (isServer) {
      config.externals = config.externals || [];
    }

    return config;
  },
};

export default nextConfig;
