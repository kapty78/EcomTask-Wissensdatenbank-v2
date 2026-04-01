const withBundleAnalyzer = require("@next/bundle-analyzer")({
  enabled: process.env.ANALYZE === "true"
})

const withPWA = require("next-pwa")({
  dest: "public",
  disable: process.env.NODE_ENV === "development",
  register: process.env.NODE_ENV === 'production'
})

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      {
        protocol: "http",
        hostname: "localhost"
      },
      {
        protocol: "http",
        hostname: "127.0.0.1"
      },
      {
        protocol: "https",
        hostname: "**"
      }
    ]
  },
  experimental: {
    serverComponentsExternalPackages: ['pdf-parse', 'mammoth'],
  },
  // Completely disable ESLint during builds
  eslint: {
    ignoreDuringBuilds: true,
  },
  // Disable TypeScript type checking during builds
  typescript: {
    ignoreBuildErrors: true,
    tsconfigPath: "tsconfig.json"
  },
  // Environment variables for production
  env: {
    NEXT_PUBLIC_DISABLE_CONSOLE: process.env.NODE_ENV === 'production' ? 'true' : 'false',
  },
  // Allow embedding in iframe from Support AI
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'X-Frame-Options',
            value: 'ALLOW-FROM https://support.ai-mitarbeiter.de',
          },
          {
            key: 'Content-Security-Policy',
            value: "frame-ancestors 'self' https://support.ai-mitarbeiter.de http://localhost:3000 http://localhost:3001",
          },
        ],
      },
    ];
  },
}

module.exports = withBundleAnalyzer(
  withPWA(nextConfig)
)
