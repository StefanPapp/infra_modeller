import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite ships WASM and is only used for the local in-memory dev database.
  serverExternalPackages: ["@electric-sql/pglite"],
  // Pin the workspace root; otherwise a lockfile in a parent directory wins.
  turbopack: { root: __dirname },
};

export default nextConfig;
