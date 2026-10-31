import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // A separate output folder lets a production build run beside the dev server.
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  // Loaded with Node's require at runtime rather than bundled (pg has optional native bits).
  serverExternalPackages: ['pg', 'embedded-postgres'],
  // The public demo link is a Cloudflare quick tunnel (hackathon/public-link.md).
  allowedDevOrigins: ['*.trycloudflare.com'],
};

export default nextConfig;
