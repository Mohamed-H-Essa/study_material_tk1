// German Study — sync backend (single Lambda behind an API Gateway HTTP API).
//
// Actions (JSON body): {action:'login'|'pull'|'push', ...}
//   login {user, pass}                    -> {ok, user, token}
//   pull  {user, token, cursor}           -> {ok, seq, state}   (entries with seq > cursor)
//   push  {user, token, cursor, changes}  -> {ok, seq, state}   (merged; then delta since cursor)
//
// State model: per user one JSON object at s3://STATE_BUCKET/users/<user>.json
//   { "__seq": <n>, "de.<slug>.<what>": { v:<value>, seq:<n>, kind:'done'|'anki'|'other' }, ... }
//
// Ordering is a SERVER-ASSIGNED monotonic sequence (__seq), never a client clock. This is the
// whole point: client wall-clocks disagree, and the old "larger timestamp wins" merge let a
// skewed device silently overwrite good progress (even on the same device after a pull). The
// server is the single authority on order, and merges by key `kind`:
//
//   done  — monotonic. "1" always accepted; a clear to "0" is accepted ONLY with {clear:true}
//           (the lesson's "clear & redo" button). So a stale write can never un-done a lesson.
//   anki  — per-card forward-only union: max(existing ease, incoming ease) per card, unless
//           {reset:true} replaces the map (deck reset).
//   other — higher server seq wins.
//
// Backward compatible with old {v,t} entries: a missing seq reads as 0, kind is recomposed from
// the key suffix, and the entry is re-stamped with a real seq the next time it is touched. No
// migration, no rewrite on deploy — upgrade is lazy and per-key.
//
// Passwords live ONLY here (env PW_MOHAMED / PW_MUSTAFA). Tokens are HMAC-signed
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

// The single admin. Only this user may read other users' state, hide lessons from them, or
// override their done-flags. Enforced here, not just in the UI.
const ADMIN = 'mohamed';
const isAdmin = (u) => u === ADMIN;

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

// ---- admin config -----------------------------------------------------------
// One extra blob, separate from any user's progress:
//   s3://STATE_BUCKET/admin/config.json  ->  { hidden: { "<user>": { "<slug>": true } } }
//
// `hidden` is an OPT-OUT list, which is what keeps this backwards-compatible: a slug that is
// absent (or a missing blob entirely) means "visible", exactly the behaviour before the feature
// existed. Visibility deliberately lives OUTSIDE the progress blob — hiding a lesson must never
// touch a de.<slug>.* key, so a user's progress survives being hidden and comes back untouched.
const ADMIN_KEY = 'admin/config.json';

async function readAdminConfig() {
  let raw = {};
  try {
    const out = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: ADMIN_KEY }));
    const parsed = JSON.parse(await out.Body.transformToString());
    if (parsed && typeof parsed === 'object') raw = parsed;
  } catch (e) {
    if (!(e.name === 'NoSuchKey' || e.$metadata?.httpStatusCode === 404)) throw e;
  }
  const hidden = {};
  for (const u of Object.keys(USERS)) {
    hidden[u] = {};
    const h = raw.hidden && raw.hidden[u];
    if (h && typeof h === 'object') {
      for (const [slug, v] of Object.entries(h)) if (v === true) hidden[u][slug] = true;
    }
  }
  hidden[ADMIN] = {}; // the admin is never hidden from his own hub
  return { hidden };
}

async function writeAdminConfig(cfg) {
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: ADMIN_KEY,
    Body: JSON.stringify(cfg),
    ContentType: 'application/json',
  }));
}

// ---- merge helpers ----------------------------------------------------------

// A data key we track: "de.<slug>.<what>", excluding our own "__*" bookkeeping.
const isDataKey = (k) => typeof k === 'string' && k.startsWith('de.') && !k.startsWith('de.__');

// kind is intrinsic to the key suffix, so old entries lacking `kind` recompose correctly.
function kindOf(key) {
  if (key.endsWith('.done')) return 'done';
  if (key.endsWith('.anki')) return 'anki';
  return 'other';
}

// Largest server seq currently in the blob (handles old blobs that never had __seq).
function currentSeq(state) {
  let max = Number(state.__seq) || 0;
  for (const [k, e] of Object.entries(state)) {
    if (isDataKey(k) && e && typeof e === 'object') max = Math.max(max, Number(e.seq) || 0);
  }
  return max;
}

function isDoneValue(v) {
  return v === '1' || v === 1 || v === true || v === '"1"';
}

// Merge one incoming change into `state`, applying the kind's rule. Returns true if state
// changed (so the caller assigns a fresh seq). `seqFn` yields the next server seq on demand.
function applyChange(state, key, change, seqFn) {
  if (!isDataKey(key) || !change || typeof change !== 'object') return false;
  const kind = kindOf(key);
  const existing = state[key];

  if (kind === 'done') {
    if (isDoneValue(change.v)) {
      if (existing && isDoneValue(existing.v)) return false; // already ✓ — idempotent
      state[key] = { v: '1', seq: seqFn(), kind };
      return true;
    }
    // Un-done only with explicit intent; a bare "0" from a stale device is ignored.
    if (change.clear === true) {
      if (existing && !isDoneValue(existing.v)) return false; // already cleared — idempotent
      // Stamp `cleared:true`. Without it, sync.js's "done is permanent" guard would block
      // this on any device that already shows ✓ — including the one that asked for it, on
      // its next ordinary pull — so the ✓ would silently come back. This is set for ANY
      // explicit clear (the hub's done-toggle as well as adminSet), not just admin ones.
      state[key] = { v: '0', seq: seqFn(), kind, cleared: true };
      return true;
    }
    return false;
  }

  if (kind === 'anki') {
    const incoming = (change.v && typeof change.v === 'object') ? change.v : {};
    if (change.reset === true) {
      state[key] = { v: { ...incoming }, seq: seqFn(), kind };
      return true;
    }
    const base = (existing && existing.v && typeof existing.v === 'object') ? existing.v : {};
    const merged = { ...base };
    let moved = false;
    for (const [card, ease] of Object.entries(incoming)) {
      const cur = Number(merged[card]) || 0;
      const inc = Number(ease) || 0;
      if (inc > cur) { merged[card] = inc; moved = true; }
    }
    if (!existing || moved) { state[key] = { v: merged, seq: seqFn(), kind }; return true; }
    return false;
  }

  // other: last writer wins, but only actually bump if the value differs.
  if (existing && JSON.stringify(existing.v) === JSON.stringify(change.v)) return false;
  state[key] = { v: change.v, seq: seqFn(), kind };
  return true;
}

function mergeAll(state, changes) {
  let seq = currentSeq(state);
  const seqFn = () => ++seq;
  for (const [key, change] of Object.entries(changes || {})) {
    applyChange(state, key, change, seqFn);
  }
  state.__seq = seq;
  return state;
}

// Entries with seq strictly greater than the client's cursor, plus the current __seq. A cursor
// of 0 (or missing) returns the whole blob — that is the self-healing first sync after upgrade.
function delta(state, cursor) {
  const c = Number(cursor) || 0;
  const cold = c === 0; // a client at cursor 0 has nothing yet → send the whole blob,
  const out = {};       // including legacy {v,t} entries that read as seq 0.
  for (const [k, e] of Object.entries(state)) {
    if (!isDataKey(k) || !e || typeof e !== 'object') continue;
    const seq = Number(e.seq) || 0;
    if (cold || seq > c) {
      out[k] = { v: e.v, seq, kind: e.kind || kindOf(k) };
      // Carry the admin-clear marker through: sync.js needs it to know this particular
      // not-done value may override a locally-done key (see its applyServerState guard).
      if (e.cleared === true) out[k].cleared = true;
    }
  }
  return out;
}

// -----------------------------------------------------------------------------

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
      return json(200, { ok: true, user, token: makeToken(user), admin: isAdmin(user) });
    }

    if (action === 'pull' || action === 'push') {
      if (!USERS[user]) return json(401, { ok: false, error: 'unknown user' });
      if (!verifyToken(body.token, user)) return json(401, { ok: false, error: 'bad or expired token' });

      let state = await readState(user);
      if (action === 'push') {
        state = mergeAll(state, body.changes);
        await writeState(user, state);
      }
      const seq = currentSeq(state);
      // Both responses also carry this caller's own visibility list, so the hub needs no second
      // round-trip. Older clients ignore the extra fields.
      const cfg = await readAdminConfig();
      return json(200, {
        ok: true,
        seq,
        state: delta(state, body.cursor),
        admin: isAdmin(user),
        hidden: Object.keys(cfg.hidden[user] || {}),
      });
    }

    // ---- adminGet: the config plus every user's full progress, for the admin panel ----
    if (action === 'adminGet') {
      if (!USERS[user]) return json(401, { ok: false, error: 'unknown user' });
      if (!verifyToken(body.token, user)) return json(401, { ok: false, error: 'bad or expired token' });
      if (!isAdmin(user)) return json(403, { ok: false, error: 'not an admin' });

      const cfg = await readAdminConfig();
      const users = {};
      for (const u of Object.keys(USERS)) users[u] = await readState(u);
      return json(200, { ok: true, admin: true, config: cfg, users });
    }

    // ---- adminSet: change visibility and/or force a user's done-flag ----
    // body.config   = {hidden:{<user>:{<slug>:true}}}          replaces the visibility config
    // body.progress = {<user>:{ "de.<slug>.done": "1"|"0" }}   merged into that user's blob
    if (action === 'adminSet') {
      if (!USERS[user]) return json(401, { ok: false, error: 'unknown user' });
      if (!verifyToken(body.token, user)) return json(401, { ok: false, error: 'bad or expired token' });
      if (!isAdmin(user)) return json(403, { ok: false, error: 'not an admin' });

      if (body.config && typeof body.config === 'object') {
        const hidden = {};
        for (const u of Object.keys(USERS)) {
          hidden[u] = {};
          const h = body.config.hidden && body.config.hidden[u];
          if (h && typeof h === 'object') {
            for (const [slug, v] of Object.entries(h)) {
              if (v === true && /^[A-Za-z0-9_-]{1,64}$/.test(slug)) hidden[u][slug] = true;
            }
          }
        }
        hidden[ADMIN] = {}; // never hide anything from the admin
        await writeAdminConfig({ hidden });
      }

      // Done-overrides are NOT a parallel storage path: they go through the very same
      // applyChange/mergeAll pipeline as a normal client push, so the seq stamping and the
      // monotonic `done` rule stay in one place. Un-doning uses the sanctioned {clear:true}
      // intent — the only thing allowed to move a done flag backwards. We additionally stamp
      // `cleared:true` on the resulting entry so sync.js's client-side "done is permanent"
      // guard knows this particular revert is a deliberate admin action and applies it.
      if (body.progress && typeof body.progress === 'object') {
        for (const [u, keys] of Object.entries(body.progress)) {
          if (!USERS[u] || !keys || typeof keys !== 'object') continue;
          const changes = {};
          for (const [k, v] of Object.entries(keys)) {
            if (!/^de\.[A-Za-z0-9_-]{1,64}\.done$/.test(k)) continue;
            const on = v === '1' || v === 1 || v === true;
            changes[k] = on ? { v: '1', kind: 'done' } : { v: '0', kind: 'done', clear: true };
          }
          if (!Object.keys(changes).length) continue;
          // applyChange now stamps `cleared:true` for any {clear:true} intent, so there is
          // nothing extra to do here. (A later re-done rewrites the entry without the flag.)
          await writeState(u, mergeAll(await readState(u), changes));
        }
      }

      // Return the CALLER's own fresh state alongside the config. Without this the admin's
      // own browser keeps the pre-change value in localStorage (adminSet writes server-side
      // at a new seq, but the tab that made the change never learns of it), so navigating
      // to the hub showed the stale ✓ — the bug this fixes. `seq` lets the client advance
      // its cursor in the same step, and `state` is the FULL blob, not a delta, so the
      // caller cannot end up behind whatever it just wrote.
      const selfState = await readState(user);
      return json(200, {
        ok: true,
        config: await readAdminConfig(),
        seq: currentSeq(selfState),
        state: delta(selfState, 0),
      });
    }

    return json(400, { ok: false, error: 'unknown action' });
  } catch (e) {
    console.error(e);
    return json(500, { ok: false, error: 'server error' });
  }
};
