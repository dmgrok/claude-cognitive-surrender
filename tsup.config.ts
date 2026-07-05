import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: { cli: 'src/cli.ts' },
    format: ['esm'],
    target: 'node22',
    banner: { js: '#!/usr/bin/env node' },
    clean: true,
    sourcemap: true,
    external: ['better-sqlite3'],
  },
  {
    entry: { hook: 'src/hook.ts', statusline: 'src/statusline.ts' },
    format: ['cjs'],
    target: 'node22',
    clean: false,
    sourcemap: false,
    noExternal: [/^(?!better-sqlite3).*/],
  },
]);
