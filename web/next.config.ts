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

    poweredByHeader: false, // hides "X-Powered-By: Next.js"

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" }, // stops clickjacking (our buttons inside a fake site)
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;