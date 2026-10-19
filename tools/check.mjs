/**
 * Sky Combat — ask start.ng whether this repository would go live.
 *
 * `POST /games/check` runs exactly the checks publishing runs, but publishes
 * nothing. It reports every problem at once, so this is the step to run before
 * every publish. It needs no key and no account.
 *
 *   node tools/check.mjs [repo_url] [name]
 */
const API = 'https://api.start.ng';
const REPO_URL = process.argv[2] ?? 'https://github.com/HelenAgbro/sky-combat-game';
const NAME = process.argv[3] ?? 'sky-combat';

async function main() {
  let response;
  try {
    response = await fetch(`${API}/games/check`, {
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
  console.log(`POST ${API}/games/check -> ${response.status}`);
  console.log(`repo: ${REPO_URL}\nname: ${NAME}\n`);

  if (!body) {
    console.error('start.ng did not return JSON. Try again in a moment.');
    process.exitCode = 1;
    return;
  }

  if (body.detail) console.log(`${body.ok ? 'OK' : 'Refused'}: ${body.detail}\n`);

  for (const error of body.errors ?? []) {
    console.error(`ERROR   ${error.code}${error.file ? ` (${error.file})` : ''}: ${error.message}`);
  }
  for (const warning of body.warnings ?? []) {
    console.warn(`WARNING ${warning.code}${warning.file ? ` (${warning.file})` : ''}: ${warning.message}`);
  }

  const errors = body.errors?.length ?? 0;
  const warnings = body.warnings?.length ?? 0;
  console.log(`\n${errors} error(s), ${warnings} warning(s).`);

  if (response.ok && errors === 0) {
    console.log('The game would go live. Publish with `npm run startng:publish`.');
    process.exitCode = 0;
  } else {
    console.error('Fix the errors above, push, and run this again.');
    process.exitCode = 1;
  }
}

await main();
