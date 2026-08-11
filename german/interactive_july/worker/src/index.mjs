// German Study — sync backend on Cloudflare Workers + a SQLite-backed Durable Object.
//
// This is a PORT of infra/lambda/index.mjs (AWS Lambda + API Gateway + S3), which is being
// retired with the AWS account. The wire protocol is unchanged, so the client needs nothing but
// a new SYNC_URL:
//
//   login    {user, pass}                    -> {ok, user, token, admin}
//   pull     {user, token, cursor}           -> {ok, seq, state, admin, hidden}
//   push     {user, token, cursor, changes}  -> {ok, seq, state, admin, hidden}
//   adminGet {user, token}                   -> {ok, admin, config, users}
//   adminSet {user, token, config, progress} -> {ok, config, seq, state}
//
// WHAT CHANGED FROM THE LAMBDA, AND WHAT DELIBERATELY DID NOT
//
// Unchanged, copied verbatim: the whole merge engine (isDataKey/kindOf/currentSeq/isDoneValue/
// applyChange/mergeAll/delta) and the token HMAC. That code encodes hard-won product rules —
// done is permanent, anki is a per-card forward-only union, ordering is a server-assigned seq —
// and rewriting it would risk regressing them for no benefit. It is pure JS touching no
// platform API, so it moved across as-is.
//
// Changed: the 4 S3 calls became Durable Object storage, and the Lambda handler signature
// became a Worker fetch handler.
//
// WHY A DURABLE OBJECT RATHER THAN KV — this fixes a real bug
//
// The Lambda did readState -> mergeAll -> writeState against S3 with NO conditional write (no
// ETag / IfMatch). Two overlapping pushes could therefore both read the same blob and the second
// write would silently discard the first — a genuine lost update. Cloudflare KV would inherit
// exactly that hazard (it is eventually consistent, last-write-wins).
//
// A Durable Object removes it structurally: all requests route to ONE object, which is
// single-threaded, and we use the SYNCHRONOUS ctx.storage.kv API. A synchronous
// read-modify-write cannot yield the event loop, so no other request can interleave — a stronger
// guarantee than relying on input gates around async calls. The rule to preserve: never await
// non-storage I/O (e.g. fetch) between reading and writing state, or the gate opens and the race
// returns.
//
// Passwords and the token secret live ONLY as Worker secrets (wrangler secret put), never in
// source and never in the repo.

import { DurableObject } from 'cloudflare:workers';
import crypto from 'node:crypto';

const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

// The single admin. Only this user may read other users' state, hide lessons from them, or
// override their done-flags. Enforced here, not just in the UI.
const ADMIN = 'mohamed';
const isAdmin = (u) => u === ADMIN;

// Fixed users, same two as the Lambda. Passwords come from secrets and fall back to "123" so a
// local `wrangler dev` works with no setup.
const usersOf = (env) => ({
  mohamed: env.PW_MOHAMED || '123',
  mustafa: env.PW_MUSTAFA || '123',
});

// ---- CORS -------------------------------------------------------------------
// The site is served from github.io and calls this Worker cross-origin, so a JSON POST is
// preflighted. These headers must be on EVERY response including errors — without them a 401
// or 403 surfaces in the browser as an opaque CORS failure instead of the real status.
const corsHeaders = (req) => ({
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers':
    req?.headers?.get('access-control-request-headers') || 'content-type',
  'access-control-max-age': '86400',
  vary: 'Origin',
});

const json = (code, obj, req) =>
  new Response(JSON.stringify(obj), {
    status: code,
    headers: { 'content-type': 'application/json', ...corsHeaders(req) },
  });

// ---- tokens (verbatim from the Lambda) --------------------------------------

const sign = (secret, msg) => crypto.createHmac('sha256', secret).update(msg).digest('hex');

function makeToken(secret, user) {
  const exp = Date.now() + TOKEN_TTL_MS;
  const msg = `${user}.${exp}`;
  return `${msg}.${sign(secret, msg)}`;
}

function verifyToken(secret, token, user) {
  if (!token || typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [u, exp, sig] = parts;
  if (u !== user) return false;
  if (sign(secret, `${u}.${exp}`) !== sig) return false;
  if (Number(exp) < Date.now()) return false;
  return true;
}

// ---- merge helpers — COPIED VERBATIM FROM THE LAMBDA -------------------------
// Do not "improve" anything below this line without a matching change in the contract tests
// (tools/test_sync_contract.mjs). These rules are the product.

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
      // its next ordinary pull — so the ✓ would silently come back.
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
      // not-done value may override a locally-done key.
      if (e.cleared === true) out[k].cleared = true;
    }
  }
  return out;
}

// ---- the Durable Object -----------------------------------------------------
// One instance holds every blob, replacing the S3 keys one-for-one:
//   users/<user>.json   -> kv key `user:<user>`
//   admin/config.json   -> kv key `admin:config`
//
// Every method below reads and writes with the SYNCHRONOUS storage.kv API and never awaits
// anything in between, so a read-modify-write is atomic with respect to other requests. This is
// the property the S3 version lacked.

export class StateDO extends DurableObject {
  #readUser(user) {
    const v = this.ctx.storage.kv.get(`user:${user}`);
    return v && typeof v === 'object' ? v : {};
  }

  #writeUser(user, state) {
    this.ctx.storage.kv.put(`user:${user}`, state);
  }

  // `hidden` is an OPT-OUT list, which is what keeps this backwards-compatible: a slug that is
  // absent (or a missing blob entirely) means "visible", exactly the behaviour before the
  // feature existed. Visibility lives OUTSIDE the progress blob, so hiding a lesson never
  // touches a de.<slug>.* key and a user's progress survives being hidden.
  #readAdminConfig(userNames) {
    const raw = this.ctx.storage.kv.get('admin:config');
    const hidden = {};
    for (const u of userNames) {
      hidden[u] = {};
      const h = raw && raw.hidden && raw.hidden[u];
      if (h && typeof h === 'object') {
        for (const [slug, v] of Object.entries(h)) if (v === true) hidden[u][slug] = true;
      }
    }
    hidden[ADMIN] = {}; // the admin is never hidden from his own hub
    return { hidden };
  }

  // --- RPC methods used by the Worker ---

  async pull(user, cursor, userNames) {
    const state = this.#readUser(user);
    const cfg = this.#readAdminConfig(userNames);
    return {
      seq: currentSeq(state),
      state: delta(state, cursor),
      hidden: Object.keys(cfg.hidden[user] || {}),
    };
  }

  // Read → merge → write with no await in between: atomic, no lost updates.
  async push(user, cursor, changes, userNames) {
    const merged = mergeAll(this.#readUser(user), changes);
    this.#writeUser(user, merged);
    const cfg = this.#readAdminConfig(userNames);
    return {
      seq: currentSeq(merged),
      state: delta(merged, cursor),
      hidden: Object.keys(cfg.hidden[user] || {}),
    };
  }

  async adminGet(userNames) {
    const users = {};
    for (const u of userNames) users[u] = this.#readUser(u);
    return { config: this.#readAdminConfig(userNames), users };
  }

  async adminSet(caller, config, progress, userNames) {
    if (config && typeof config === 'object') {
      const hidden = {};
      for (const u of userNames) {
        hidden[u] = {};
        const h = config.hidden && config.hidden[u];
        if (h && typeof h === 'object') {
          for (const [slug, v] of Object.entries(h)) {
            if (v === true && /^[A-Za-z0-9_-]{1,64}$/.test(slug)) hidden[u][slug] = true;
          }
        }
      }
      hidden[ADMIN] = {}; // never hide anything from the admin
      this.ctx.storage.kv.put('admin:config', { hidden });
    }

    // Done-overrides are NOT a parallel storage path: they go through the very same
    // applyChange/mergeAll pipeline as a normal client push, so seq stamping and the monotonic
    // `done` rule stay in one place. Un-doning uses the sanctioned {clear:true} intent.
    if (progress && typeof progress === 'object') {
      for (const [u, keys] of Object.entries(progress)) {
        if (!userNames.includes(u) || !keys || typeof keys !== 'object') continue;
        const changes = {};
        for (const [k, v] of Object.entries(keys)) {
          if (!/^de\.[A-Za-z0-9_-]{1,64}\.done$/.test(k)) continue;
          const on = v === '1' || v === 1 || v === true;
          changes[k] = on ? { v: '1', kind: 'done' } : { v: '0', kind: 'done', clear: true };
        }
        if (!Object.keys(changes).length) continue;
        this.#writeUser(u, mergeAll(this.#readUser(u), changes));
      }
    }

    // Return the CALLER's own fresh FULL state (delta from 0, not a delta from their cursor).
    // Without this the admin's own browser keeps the pre-change value in localStorage, so
    // navigating to the hub shows a stale ✓ — the bug this mirrors from the Lambda.
    const selfState = this.#readUser(caller);
    return {
      config: this.#readAdminConfig(userNames),
      seq: currentSeq(selfState),
      state: delta(selfState, 0),
    };
  }

  // One-shot import of the blobs rescued from S3. Guarded by a secret and refuses to clobber a
  // user that already has data, so it cannot silently destroy progress if called twice.
  async importState(blobs) {
    const report = {};
    for (const [key, blob] of Object.entries(blobs || {})) {
      const existing = this.ctx.storage.kv.get(key);
      if (existing && Object.keys(existing).length) { report[key] = 'skipped (already present)'; continue; }
      this.ctx.storage.kv.put(key, blob);
      report[key] = 'imported';
    }
    return report;
  }

  // Test-only: wipe everything. Refused unless the Worker passes the dev flag.
  async __reset() {
    this.ctx.storage.kv.delete('admin:config');
    for (const k of ['mohamed', 'mustafa']) this.ctx.storage.kv.delete(`user:${k}`);
    return { ok: true };
  }
}

// ---- the Worker -------------------------------------------------------------

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return json(200, { ok: true }, request);

    const USERS = usersOf(env);
    const userNames = Object.keys(USERS);
    const SECRET = env.TOKEN_SECRET || 'dev-secret-change-me';
    // All state lives in one object. With two users this is exactly right; sharding by user
    // would scatter the blobs and make adminGet fan out across stubs for no gain.
    const stub = env.STATE.getByName('global');

    // Test-only reset hook, mirroring the local Lambda harness. Only ever enabled when
    // ALLOW_RESET is set, which production never sets.
    if (new URL(request.url).pathname === '/__reset') {
      if (env.ALLOW_RESET !== '1') return json(403, { ok: false, error: 'forbidden' }, request);
      return json(200, await stub.__reset(), request);
    }

    let body;
    try {
      body = JSON.parse((await request.text()) || '{}');
    } catch {
      return json(400, { ok: false, error: 'bad json' }, request);
    }

    const action = body.action;
    const user = String(body.user || '').toLowerCase().trim();

    try {
      if (action === 'login') {
        const pass = String(body.pass ?? '');
        if (!USERS[user] || USERS[user] !== pass) {
          return json(401, { ok: false, error: 'wrong user or password' }, request);
        }
        return json(200, {
          ok: true, user, token: makeToken(SECRET, user), admin: isAdmin(user),
        }, request);
      }

      if (action === 'pull' || action === 'push') {
        if (!USERS[user]) return json(401, { ok: false, error: 'unknown user' }, request);
        if (!verifyToken(SECRET, body.token, user)) {
          return json(401, { ok: false, error: 'bad or expired token' }, request);
        }
        const r = action === 'push'
          ? await stub.push(user, body.cursor, body.changes, userNames)
          : await stub.pull(user, body.cursor, userNames);
        return json(200, {
          ok: true, seq: r.seq, state: r.state, admin: isAdmin(user), hidden: r.hidden,
        }, request);
      }

      if (action === 'adminGet') {
        if (!USERS[user]) return json(401, { ok: false, error: 'unknown user' }, request);
        if (!verifyToken(SECRET, body.token, user)) {
          return json(401, { ok: false, error: 'bad or expired token' }, request);
        }
        if (!isAdmin(user)) return json(403, { ok: false, error: 'not an admin' }, request);
        const r = await stub.adminGet(userNames);
        return json(200, { ok: true, admin: true, config: r.config, users: r.users }, request);
      }

      if (action === 'adminSet') {
        if (!USERS[user]) return json(401, { ok: false, error: 'unknown user' }, request);
        if (!verifyToken(SECRET, body.token, user)) {
          return json(401, { ok: false, error: 'bad or expired token' }, request);
        }
        if (!isAdmin(user)) return json(403, { ok: false, error: 'not an admin' }, request);
        const r = await stub.adminSet(user, body.config, body.progress, userNames);
        return json(200, { ok: true, config: r.config, seq: r.seq, state: r.state }, request);
      }

      // One-shot migration of the S3 blobs. Requires the IMPORT_TOKEN secret, so it is not a
      // back door: without that secret set (production, after the import) it always 403s.
      if (action === 'import') {
        if (!env.IMPORT_TOKEN || body.importToken !== env.IMPORT_TOKEN) {
          return json(403, { ok: false, error: 'forbidden' }, request);
        }
        return json(200, { ok: true, report: await stub.importState(body.blobs) }, request);
      }

      return json(400, { ok: false, error: 'unknown action' }, request);
    } catch (e) {
      console.error(e);
      return json(500, { ok: false, error: 'server error' }, request);
    }
  },
};
