const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
  // Mobile API compatibility: the Flutter app calls `/v1/...`. On Vercel this
  // is handled by vercel.json rewrites, but those are NOT applied during local
  // dev (`node server.js`) or `next start`. Declaring it here as well makes
  // `/v1/*` -> `/api/v1/*` work in every environment (the custom server.js
  // routes through Next's handler, which honors these rewrites).
  async rewrites() {
    return [{ source: "/v1/:path*", destination: "/api/v1/:path*" }];
  },
};
module.exports = nextConfig;