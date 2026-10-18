import type { NextConfig } from 'next';

const config: NextConfig = {
  // A static site: `next build` writes plain HTML, CSS and JS to out/.
  output: 'export',
  // @tassel/shared ships source (TS and CSS), not a build.
  transpilePackages: ['@tassel/shared'],
  images: { unoptimized: true },
};

export default config;
