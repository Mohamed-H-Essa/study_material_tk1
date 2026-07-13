// German Study — sync backend (single Lambda behind a Function URL).
//
// Actions (JSON body): {action:'login'|'pull'|'push', ...}
//   login {user, pass}            -> {ok, user, token}
//   pull  {user, token}           -> {ok, state}
//   push  {user, token, changes}  -> {ok, state}   (changes merged, newest-wins per key)
//
// State model: per user one JSON object at s3://STATE_BUCKET/users/<user>.json
//   { "de.<slug>.<what>": { v:<value>, t:<epoch ms> }, ... }
// Merge rule everywhere: for each key keep the entry with the larger t (union of keys).
// This is what makes progress reorder-safe and add-safe: keys are slug-based and only ever
// added, never rewritten by structural changes.
//
// Passwords live ONLY here (env vars PW_MOHAMED / PW_MUSTAFA). Tokens are HMAC-signed
// (user.expiry.sig) with TOKEN_SECRET, so pull/push verify statelessly.

import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import crypto from 'node:crypto';

const s3 = new S3Client({});
const BUCKET = process.env.STATE_BUCKET;
const SECRET = process.env.TOKEN_SECRET || 'dev-secret-change-me';
const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

// Fixed users. Passwords default to "123" and are overridable per user via env.
const USERS = {
  mohamed: process.env.PW_MOHAMED || '123',
  mustafa: process.env.PW_MUSTAFA || '123',
};

const json = (code, obj) => ({
  statusCode: code,
  headers: {
    'content-type': 'application/json',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
  },
  body: JSON.stringify(obj),
});

const sign = (msg) => crypto.createHmac('sha256', SECRET).update(msg).digest('hex');

function makeToken(user) {
  const exp = Date.now() + TOKEN_TTL_MS;
  const msg = `${user}.${exp}`;
  return `${msg}.${sign(msg)}`;
}

function verifyToken(token, user) {
  if (!token || typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [u, exp, sig] = parts;
  if (u !== user) return false;
  if (sign(`${u}.${exp}`) !== sig) return false;
  if (Number(exp) < Date.now()) return false;
  return true;
}

async function readState(user) {
  try {
    const out = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: `users/${user}.json` }));
    const text = await out.Body.transformToString();
    const obj = JSON.parse(text);
    return obj && typeof obj === 'object' ? obj : {};
  } catch (e) {
    if (e.name === 'NoSuchKey' || e.$metadata?.httpStatusCode === 404) return {};
    throw e;
  }
}

async function writeState(user, state) {
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: `users/${user}.json`,
    Body: JSON.stringify(state),
    ContentType: 'application/json',
  }));
}

// Merge `incoming` into `base`, newest-wins per key. Entries are {v,t}.
function merge(base, incoming) {
  const out = { ...base };
  for (const [k, e] of Object.entries(incoming || {})) {
    if (!e || typeof e !== 'object' || !('t' in e)) continue;
    const cur = out[k];
    if (!cur || Number(e.t) >= Number(cur.t)) out[k] = { v: e.v, t: Number(e.t) };
  }
  return out;
}

export const handler = async (event) => {
  const method = event.requestContext?.http?.method || 'POST';
  if (method === 'OPTIONS') return json(200, { ok: true });

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { ok: false, error: 'bad json' });
  }

  const action = body.action;
  const user = String(body.user || '').toLowerCase().trim();

  try {
    if (action === 'login') {
      const pass = String(body.pass ?? '');
      if (!USERS[user] || USERS[user] !== pass) {
        return json(401, { ok: false, error: 'wrong user or password' });
      }
      return json(200, { ok: true, user, token: makeToken(user) });
    }

    if (action === 'pull' || action === 'push') {
      if (!USERS[user]) return json(401, { ok: false, error: 'unknown user' });
      if (!verifyToken(body.token, user)) return json(401, { ok: false, error: 'bad or expired token' });

      let state = await readState(user);
      if (action === 'push') {
        state = merge(state, body.changes);
        await writeState(user, state);
      }
      return json(200, { ok: true, state });
    }

    return json(400, { ok: false, error: 'unknown action' });
  } catch (e) {
    console.error(e);
    return json(500, { ok: false, error: 'server error' });
  }
};
