/**
 * Sky Combat — publish to start.ng.
 *
 * `POST /games/publish` needs no key. The first time, start.ng replies 202 with an
 * `approve_url` that a human must open once to put the game on their account; after
 * that, publishing the same repository updates the live game, and every push to the
 * published branch updates it by itself.
 *
 *   node tools/publish.mjs [repo_url] [name]
 */
const API = 'https://api.start.ng';
const REPO_URL = process.argv[2] ?? 'https://github.com/HelenAgbro/sky-combat-game';
const NAME = process.argv[3] ?? 'sky-combat';

async function main() {
  let response;
  try {
    response = await fetch(`${API}/games/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo_url: REPO_URL, name: NAME }),
    });
  } catch (error) {
    console.error(`Could not reach ${API}: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  const body = await response.json().catch(() => null);
  console.log(`POST ${API}/games/publish -> ${response.status}\n`);

  if (!body) {
    console.error('start.ng did not return JSON. Try again in a moment.');
    process.exitCode = 1;
    return;
  }

  if (!response.ok) {
    console.error(body.detail ?? 'Publishing was refused.');
    for (const error of body.errors ?? []) {
      console.error(`ERROR   ${error.code}${error.file ? ` (${error.file})` : ''}: ${error.message}`);
    }
    for (const warning of body.warnings ?? []) {
      console.warn(`WARNING ${warning.code}: ${warning.message}`);
    }
    process.exitCode = 1;
    return;
  }

  if (body.status === 'pending') {
    console.log('Checked and ready, but it needs one approval before it goes live.');
    console.log(`\n  Open this link to put it live: ${body.approve_url}\n`);
    console.log(`  Game:   ${body.name}`);
    console.log(`  Folder: ${body.folder}  (${body.files} files, ${(body.size_bytes / 1024).toFixed(0)} KB)`);
    if (body.expires_at) console.log(`  The link works once and expires ${body.expires_at}.`);
    if (body.skipped?.length) console.log(`  Skipped: ${body.skipped.join(', ')}`);
    return;
  }

  console.log(`Live at ${body.url}`);
  console.log(`Folder: ${body.folder}  (${body.files} files, ${(body.size_bytes / 1024).toFixed(0)} KB)`);
  if (body.created) console.log('This was a new game.');
  for (const warning of body.warnings ?? []) {
    console.warn(`WARNING ${warning.code}: ${warning.message}`);
  }
}

await main();
