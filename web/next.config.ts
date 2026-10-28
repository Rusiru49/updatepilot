import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The browser calls /api/... on port 3000; Next.js forwards it to the backend on port 4000.
  // Same origin → cookies just work, no CORS problems.
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${process.env.API_URL ?? "http://localhost:4000"}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;