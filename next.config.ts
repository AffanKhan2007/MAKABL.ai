import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Loaded with Node's require at runtime rather than bundled (pg has optional native bits).
  serverExternalPackages: ['pg', 'embedded-postgres'],
  // The public demo link is a Cloudflare quick tunnel (hackathon/public-link.md).
  allowedDevOrigins: ['*.trycloudflare.com'],
};

export default nextConfig;
