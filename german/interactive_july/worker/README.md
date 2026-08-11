# worker/ — the sync backend (LIVE)

Cloudflare Worker + a SQLite-backed Durable Object. Replaced the AWS Lambda + API Gateway + S3
stack on 2026-08-11 when that account expired.

- **Live at:** `https://german-sync.mhosnytech.workers.dev`
- **Account:** `mhosnytech@gmail.com`, Workers **Free** plan (no card, no phone verification —
  that constraint is why this host was chosen)
- **The site points at it** via `SYNC_URL` in `../config.js`

## Deploy

```
npx wrangler deploy
```

That is the whole thing. There is no build step and no infrastructure state to manage.

## Test before you deploy

```
npx wrangler dev --port 8788 \
  --var TOKEN_SECRET:test --var PW_MOHAMED:x --var PW_MUSTAFA:y \
  --var ALLOW_RESET:1 --var IMPORT_TOKEN:dev-import

PW_MOHAMED=x PW_MUSTAFA=y node ../tools/test_sync_contract.mjs http://localhost:8788   # 24 cases
PW_MOHAMED=x node ../tools/test_sync_race.mjs http://localhost:8788                    # 40/40
```

Durable Objects run locally under `wrangler dev` with no Cloudflare account needed, so the full
suite passes offline. Local state lives in `.wrangler/` (gitignored — its `cf.json` cache carries
IP-derived location data; never commit it).

## Secrets

Exactly three exist in production, and they live **only** in Cloudflare:

```
npx wrangler secret list
npx wrangler secret put PW_MOHAMED     # change a password; takes effect immediately
```

`TOKEN_SECRET` was carried over from the AWS Lambda so existing 30-day login tokens survived the
migration. Changing it just forces everyone to log in again.

**`ALLOW_RESET` and `IMPORT_TOKEN` must NOT exist in production.** They gate `/__reset` and
`action:'import'` — one-shot migration/testing doors that 403 when the secret is absent, which is
the deployed state. `wrangler secret delete` has **no `--force`** and silently prints help instead
of failing on an unknown flag, so pipe `yes |` into it and re-check `secret list` afterwards.

## The one rule to preserve when editing the Durable Object

**Never `await` non-storage I/O between reading and writing state.** The DO is single-threaded and
the *synchronous* `ctx.storage.kv` API makes read-modify-write physically unable to yield, which
is what removed the lost-update race the S3 version had (40 concurrent pushes: 3 survived on the
old design, 40 on this one). Introducing an `await fetch(...)` mid-transaction opens the input
gate and brings the race back. `../tools/test_sync_race.mjs` is the regression test.

Likewise, the merge engine (`isDataKey`/`kindOf`/`currentSeq`/`applyChange`/`mergeAll`/`delta`) is
copied verbatim from the retired Lambda and encodes the product rules. Change it only alongside
`../tools/sync_contract_cases.mjs`.

## Wire protocol

Unchanged from the Lambda, which is why the client needed nothing but a new `SYNC_URL`:

```
login    {user, pass}                    -> {ok, user, token, admin}
pull     {user, token, cursor}           -> {ok, seq, state, admin, hidden}
push     {user, token, cursor, changes}  -> {ok, seq, state, admin, hidden}
adminGet {user, token}                   -> {ok, admin, config, users}
adminSet {user, token, config, progress} -> {ok, config, seq, state}
```

Full rationale for the merge rules: `../CLAUDE.md` and
`../docs/superpowers/specs/2026-07-18-reliable-sync-design.md`.
