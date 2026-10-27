import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR || ".next",
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: [],
  // Hide the Next.js development badge from the product presentation.
  devIndicators: false,
};

export default nextConfig;
