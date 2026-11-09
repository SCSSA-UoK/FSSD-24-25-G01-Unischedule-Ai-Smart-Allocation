import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/platform-api/:path*",
        destination: `${process.env.PLATFORM_API_URL || "http://localhost:8081"}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
