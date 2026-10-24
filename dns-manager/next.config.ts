import type { NextConfig } from "next";

const bridgeUrl = process.env.BRIDGE_URL || "http://127.0.0.1:8650";

const nextConfig: NextConfig = {
  output: "standalone",
  async headers() {
    return [
      {
        // Admin console: never render inside another site's frame (clickjacking).
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
    ];
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
