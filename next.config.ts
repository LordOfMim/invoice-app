import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  allowedDevOrigins: ["127.0.0.1"],
  // Output standalone build for Electron
  output: 'standalone',
  // Disable image optimization for Electron compatibility
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
