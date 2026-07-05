import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: { cli: 'src/cli.ts' },
    format: ['esm'],
    target: 'node22',
    banner: { js: '#!/usr/bin/env node' },
    clean: true,
    sourcemap: true,
  },
  {
    entry: { statusline: 'src/statusline.ts' },
    format: ['cjs'],
    target: 'node22',
    clean: false,
    sourcemap: false,
  },
]);
