// Build the one-shot import payload that seeds the Cloudflare Durable Object with the progress
// rescued from S3 before the AWS account expired.
//
//   npx wrangler secret put IMPORT_TOKEN          # in worker/, pick any random string
//   IMPORT_TOKEN=<that string> node tools/build_import_payload.mjs > /tmp/import.json
//   curl -X POST https://german-sync.<subdomain>.workers.dev \
//     -H 'content-type: application/json' --data-binary @/tmp/import.json
//   npx wrangler secret delete IMPORT_TOKEN       # close the door afterwards
//
// The Worker's import is idempotent: it SKIPS any key that already holds data, so running this
// twice cannot clobber progress. It also 403s unless IMPORT_TOKEN is set on the Worker and
// matches, so this is not a back door once the secret is deleted.
//
// The S3 keys map one-for-one onto DO storage keys:
//   users/<user>.json  ->  user:<user>
//   admin/config.json  ->  admin:config

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(here, '..', 'backup', 'sync-state-2026-08-11');

const token = process.env.IMPORT_TOKEN;
if (!token) {
  console.error('Set IMPORT_TOKEN to the value you gave `wrangler secret put IMPORT_TOKEN`.');
  process.exit(2);
}

const read = (p) => JSON.parse(fs.readFileSync(path.join(dir, p), 'utf8'));

const blobs = {
  'user:mohamed': read('users/mohamed.json'),
  'user:mustafa': read('users/mustafa.json'),
  'admin:config': read('admin/config.json'),
};

// Report to stderr so stdout stays a clean JSON payload for piping.
for (const [k, v] of Object.entries(blobs)) {
  const done = Object.keys(v).filter((x) => x.endsWith('.done') && v[x]?.v === '1').length;
  const anki = Object.keys(v).filter((x) => x.endsWith('.anki')).length;
  console.error(`  ${k}: ${Object.keys(v).length} keys` + (done || anki ? ` (${done} done, ${anki} anki)` : ''));
}

process.stdout.write(JSON.stringify({ action: 'import', importToken: token, blobs }));
