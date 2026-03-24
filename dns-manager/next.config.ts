import type { NextConfig } from "next";

const bridgeUrl = process.env.BRIDGE_URL || "http://127.0.0.1:8650";

const nextConfig: NextConfig = {
  output: "standalone",
  turbopack: {
    root: ".",
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${bridgeUrl}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
