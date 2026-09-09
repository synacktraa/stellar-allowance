import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // The SDK is linked from ../sdk. Turbopack resolves nothing outside its root, and infers that
  // root as this directory, so the root has to be the parent of both.
  turbopack: { root: path.join(__dirname, '..') },
};

export default nextConfig;
