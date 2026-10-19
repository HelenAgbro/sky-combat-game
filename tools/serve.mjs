/**
 * Sky Combat — a minimal static file server.
 *
 * Used for local play, for the smoke test and by the cover renderer. It is a
 * development tool only: start.ng serves the built game itself, and nothing in
 * `src/` imports this file.
 *
 *   node tools/serve.mjs [directory] [port]      (defaults: dist 5173)
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
};

/**
 * Serve a directory.
 * @returns {Promise<import('node:http').Server>} the listening server
 */
export function serve(directory, port = 0) {
  const base = resolve(directory);

  const server = createServer(async (request, response) => {
    try {
      let pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      if (pathname.endsWith('/')) pathname += 'index.html';

      const file = normalize(join(base, pathname));
      if (!file.startsWith(base)) {
        response.writeHead(403).end('Forbidden');
        return;
      }
      if (!(await stat(file)).isFile()) throw new Error('not a file');

      response.writeHead(200, {
        'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      response.end(await readFile(file));
    } catch {
      response.writeHead(404).end('Not found');
    }
  });

  return new Promise((ready) => server.listen(port, '127.0.0.1', () => ready(server)));
}

// Command line entry point.
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const [directory = 'dist', port = '5173'] = process.argv.slice(2);
  const server = await serve(directory, Number(port));
  console.log(`Serving ${directory} at http://127.0.0.1:${server.address().port}/`);
}
