import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

/** Absolute path helper: paths are resolved from this file, never from the shell's cwd. */
const path = (relative) => fileURLToPath(new URL(relative, import.meta.url));

/**
 * Which packed models exist right now (see tools/pack-models.mjs).
 *
 * This is injected into the bundle so the game only fetches a payload that is
 * really there. Asking for a missing file would log a 404 in the player's console
 * for no reason, and start.ng's own checks would rather we did not.
 */
function packedModelIds() {
  const directory = path('./public/models');
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.slice(0, -'.json'.length));
}

/*
 * Sky Combat — Vite configuration.
 *
 * Three choices here are driven by start.ng's published rules
 * (https://start.ng/docs.md) rather than by convention:
 *
 * 1. `root: 'src'` — the HTML entry lives at `src/index.html`, so the repository
 *    has no `index.html` at its top level. start.ng looks for `index.html` at the
 *    repo top first and refuses a source file that needs building (`needs_build`),
 *    so the built `dist/index.html` must be the only one it can find.
 * 2. `base: './'` — the docs require relative paths, so the game works at any URL.
 * 3. `publicDir: './public'` — `startng.json` and `cover.png` must sit next to
 *    `dist/index.html`; anything in `public/` is copied there verbatim.
 *
 * Output file names are stable (no content hashes) so committed builds produce
 * readable diffs and never leave stale hashed files behind in `dist/`.
 */
export default defineConfig({
  root: path('./src'),
  base: './',
  publicDir: path('./public'),

  define: {
    __PACKED_MODELS__: JSON.stringify(packedModelIds()),
  },

  server: {
    host: '127.0.0.1',
    port: 5173,
    open: false,
  },

  build: {
    outDir: path('./dist'),
    emptyOutDir: true,
    target: 'es2020',
    sourcemap: false,
    cssCodeSplit: false,
    reportCompressedSize: false,
    assetsInlineLimit: 4096,
    /** One deliberate bundle: a game makes fewer requests, and Three.js is most of it. */
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        entryFileNames: 'assets/app.js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
});
