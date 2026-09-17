import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // the loader route reads fixture files at request time (directory scans the
  // bundler can't trace statically), so ship them with its serverless function
  outputFileTracingIncludes: {
    "/api/admin/load": ["./data/nielsen/**", "./data/promos/**", "./lib/fixtures/**"],
  },
};

export default nextConfig;
