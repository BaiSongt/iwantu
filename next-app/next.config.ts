import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Silence Turbopack webpack-config warning in Next.js 16
  turbopack: {},

  serverExternalPackages: ["bcryptjs"],
};

export default nextConfig;
