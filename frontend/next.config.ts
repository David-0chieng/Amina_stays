import type { NextConfig } from "next";

// Django serves the API, Africa's Talking webhooks, the admin and uploaded media. Proxying them
// through Next.js gives the browser a single origin (session cookie + CSRF), and one public tunnel
// (ngrok / cloudflared) on port 3000 exposes both the website and the AT callback URLs.
const BACKEND = (process.env.BACKEND_URL || "http://127.0.0.1:8000").replace(/\/$/, "");

const nextConfig: NextConfig = {
  output: "standalone", // slim Docker image (frontend/Dockerfile)
  cacheComponents: true,
  partialPrefetching: true,
  skipTrailingSlashRedirect: true, // Django admin uses trailing slashes; AT callbacks must never be redirected
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  images: {
    remotePatterns: [{ protocol: "https", hostname: "images.unsplash.com" }],
  },
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${BACKEND}/api/:path*` },
      { source: "/at/:path*", destination: `${BACKEND}/at/:path*` },
      { source: "/media/:path*", destination: `${BACKEND}/media/:path*` },
      { source: "/admin/:path*", destination: `${BACKEND}/admin/:path*` },
      { source: "/static/:path*", destination: `${BACKEND}/static/:path*` },
      { source: "/health", destination: `${BACKEND}/health` },
    ];
  },
};

export default nextConfig;
