import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
