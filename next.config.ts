import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Loaded with Node's require at runtime rather than bundled (pg has optional native bits).
  serverExternalPackages: ['pg', 'embedded-postgres'],
};

export default nextConfig;
