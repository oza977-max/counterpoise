/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { CSP_META } from './src/csp';

// The real package version, stamped into the bundle at build time so the
// hand-off bundle's provenance field (RG-8) is accurate rather than a
// hardcoded string that goes stale. Provenance only — never used in logic.
// This `define` block is shared by the `test` config below (Vitest reads
// this same file), so __APP_VERSION__ is a real string under `npm test`
// too, not just in dev/build — see src/vite-env.d.ts (code-review-005 F24).
const pkgVersion = JSON.parse(readFileSync('./package.json', 'utf-8')).version as string;

// base: './' — relative paths, required for file:// compatibility (NF-4)
export default defineConfig({
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkgVersion),
  },
  plugins: [
    react(),
    // R18-G (specs/intake-flow.md §27.9): the Content-Security-Policy <meta>, on the built page only (the dev
    // server injects an inline script that `script-src 'self'` would block).
    {
      name: 'counterpoise-csp-meta',
      apply: 'build',
      transformIndexHtml(html: string) {
        return html.replace('<meta charset="UTF-8" />', (m) => `${m}\n    ${CSP_META}`);
      },
    },
  ],
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        // Function form — Vite 8's Rolldown bundler requires this over the
        // legacy Rollup object-map form.
        manualChunks(id: string) {
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) {
            return 'vendor';
          }
          if (id.includes('node_modules/uuid')) {
            return 'engine';
          }
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    // jsdom requires a valid origin to enable the Web Storage API (localStorage/
    // sessionStorage) — without it, `localStorage` is undefined in the test DOM.
    environmentOptions: {
      jsdom: { url: 'http://localhost/' },
    },
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    // Agent worktrees live under .claude/worktrees/ and contain a full copy of
    // this repo, tests included. Without this the suite silently runs twice —
    // every count doubles, and the two copies compete for CPU until
    // interaction-heavy tests time out. That reads as a code failure and is
    // not one. Found 2026-07-29 when a background task's worktree turned a
    // green suite red.
    exclude: ['**/node_modules/**', '**/dist/**', '.claude/**'],
  },
});
