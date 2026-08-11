# Deployment & Cross-Device Sync — Design

**Date:** 2026-07-13
**Status:** PARTLY SUPERSEDED (2026-08-11) — see the banner below
**Author:** Mohamed + Claude

> ### ⚠️ The hosting described here no longer exists
>
> The AWS account was torn down on **2026-08-11** (it was expiring). Nothing in §§4–11 runs any
> more: no S3 buckets, no Lambda, no API Gateway, no Terraform. `infra/` is kept as history only.
>
> **What replaced it**
>
> | Layer | Was | Is now |
> | --- | --- | --- |
> | Static site | S3 website bucket | GitHub Pages, published by `.github/workflows/pages.yml` on push to `main` |
> | Sync backend | API Gateway → Lambda | Cloudflare Worker `german-sync.mhosnytech.workers.dev` |
> | State storage | Private S3 bucket, one JSON blob per user | SQLite-backed Durable Object, same blobs under `user:<name>` / `admin:config` |
> | Deploy | `make deploy` (Terraform + `aws s3 sync`) | `git push` for the site; `npx wrangler deploy` for the backend |
> | Secrets | Lambda env via `terraform.tfvars` | Cloudflare Worker secrets |
>
> The **wire protocol is unchanged**, so §§3 and 12 (the sync model, the merge rules, the
> `de.<slug>.<what>` key format) are still accurate and still binding. §2's principles —
> slug-is-identity, offline-first, additive merges — are the reason the migration was cheap:
> the client's only tie to the backend is `SYNC_URL` in `config.js`, so swapping hosts touched
> one line.
>
> One thing this doc got wrong, worth remembering: §4 says `terraform.tfstate` is committed. It
> never was. That is why a content deploy later failed on a machine without local state, and why
> `config.js` is now a plain committed file rather than generated from infrastructure output.
>
> Two behaviours documented here as AWS constraints are gone with it: the account-verification
> hold (§11, which blocked CloudFront and Lambda Function URLs and forced the API-Gateway design)
> and the unguarded S3 read-modify-write, which was a real lost-update race — 40 concurrent
> pushes lost 37 of them. The Durable Object fixes that structurally; see CLAUDE.md.
>
> **Current, authoritative docs: `CLAUDE.md` → "Hosting: moving off AWS" and "Deploy / operate".**

## 1. What the user asked for (verbatim intent)

> Deploy the German study app so it can be used "from anywhere with just a link." Preserve
> my state (answers, progress) **across devices** — I switch devices often. It must be
> **backwards-compatible / skittable**: if in the future I add a couple of videos, a whole
> section, or reorder things, it must NOT break existing progress. Add a **login screen** as a
> thin wrapper *before* the hub (the hub itself stays unchanged). Only ever **two users**
> (Mohamed, Mustafa), **static** credentials — no signup — password `123` for now, changeable.
> **No server / no EC2** — the most minimal, most resilient AWS architecture. **Minimal cost**,
> I'm on the AWS free tier and don't want to pay. Use **Terraform** in the repo for the
> architecture. **Document everything** (this file + CLAUDE.md) so future edits are seamless.
> Must **support reordering** and multiple per-user memories seamlessly.

## 2. Guiding principles

1. **Slug is identity, forever.** Progress is keyed by a lesson's `slug`, never by its number
   or filename. Reordering/renumbering changes `n:`/filenames only, so it can never disturb
   progress. *Once a slug is assigned to a lesson it is never changed or reused.* This is THE
   backwards-compatibility rule.
2. **Offline-first, sync-second.** Everything works from `localStorage` even with no network.
   Sync is a best-effort background layer on top. If the backend is down or unconfigured, the
   app still fully works locally (this also means the raw files keep working when opened directly).
3. **Additive merges only.** Sync merges per-key; adding a video only *adds* new slug-keyed
   entries. Nothing rewrites or deletes existing keys.
4. **Minimal moving parts.** Static site on S3 + API Gateway (HTTP API) + one Lambda +
   per-user JSON blobs in S3. No EC2, no DynamoDB. (We would have used a bare Lambda Function
   URL, but the account hold in §11 forced API Gateway — still tiny and free.)
5. **The hub is untouched.** Login is a separate wrapper page. All 22 lessons + revision get
   sync by including one extra script (`sync.js`); their content is not edited.

## 3. Architecture (as built)

```
┌────────────────────────── Browser ──────────────────────────┐
│  login.html  (the gate / wrapper, shown first)              │
│      │ on success: store {user, token} in localStorage      │
│      ▼ redirect                                             │
│  index.html + NN_*.html + revision.html  (UNCHANGED content)│
│      + sync.js  (one <script> line added to each)           │
│         · save()/load() write localStorage first            │
│         · debounced push of changed keys                    │
│         · pull+merge on load                                │
└───────────────┬─────────────────────────────────────────────┘
                │ HTTPS fetch to  <api>/api  (POST JSON)
                ▼
        ┌───────────────────────────────┐
        │  API Gateway (HTTP API)        │  POST /api  (payload format 2.0)
        └───────────────┬────────────────┘
                        │ AWS_PROXY integration
                        ▼
        ┌───────────────────────────────┐
        │  Lambda: german-study-sync    │
        │   {action:login|pull|push}     │
        │   · login: check user+pass     │
        │     (passwords in env vars)    │
        │     → issue HMAC token          │
        │   · pull: return merged blob    │
        │   · push: per-key newest-wins   │
        └───────────────┬────────────────┘
                        │ Get/Put/ListBucket
                        ▼
        ┌───────────────────────────────┐
        │  S3 (private): state bucket    │
        │    users/mohamed.json          │
        │    users/mustafa.json          │
        └───────────────────────────────┘

        ┌───────────────────────────────┐
        │  S3 (public): site bucket      │
        │    static website hosting      │
        │    → stable http URL           │
        └───────────────────────────────┘
```

**Why API Gateway (not a Lambda Function URL, not CloudFront):** this AWS account has an
**unverified-account hold** (see §11) that blocks CloudFront creation *and* public Lambda
Function URLs (both return 403 / "account must be verified"; it also caps Lambda concurrency
at 10). API Gateway HTTP API and public S3 website hosting are **not** blocked, so they are what
we use. API Gateway gives a public HTTPS endpoint and invokes the Lambda server-side, which
sidesteps the Function-URL block entirely. If the account is later verified, the site can move
behind CloudFront (HTTPS + single origin + `/api` behavior) with no client changes — see §11.

**Why a URL, not a static IP:** an IP requires an always-on server (Lightsail/EC2 + Elastic IP),
which is not free. "Access from anywhere with a link" only needs a stable URL.

## 4. State model (the sync blob)

> **Current model (2026-07-18): server-assigned sequence + kind-based merge.** The
> timestamp-based merge originally described here was replaced — client wall-clocks disagree, so
> "larger `t` wins" let a skewed device silently overwrite good progress (even on the same device
> after a pull). See `docs/superpowers/specs/2026-07-18-reliable-sync-design.md` for the full
> rationale. Summary below reflects what is implemented now.

Per user, one JSON object stored at `s3://<state-bucket>/users/<user>.json`:

```json
{
  "__seq": 42,
  "de.tea.done":     { "v": "1",        "seq": 12, "kind": "done" },
  "de.tea.anki":     { "v": {"...": 3}, "seq": 13, "kind": "anki" },
  "de.kitchen.done": { "v": "1",        "seq": 20, "kind": "done" }
}
```

- Keys are the **exact localStorage keys** the engine already uses: `de.<slug>.<what>`
  (`done`, `anki`, plus anything future lessons add). No schema per lesson — it's a flat map.
- `v` = the value (already JSON, matching what `localStorage` holds after `JSON.parse`).
- `__seq` = the per-user monotonic counter the Lambda owns; `seq` = the server-assigned order of
  that write; `kind` = `done` | `anki` | `other` (derived from the key suffix).

**Merge (server-authoritative, by kind):**
- **`done`** — monotonic: `"1"` always sticks; un-done only with an explicit `{clear:true}`.
- **`anki`** — per-card forward-only union: `max(existing, incoming)` per card.
- **`other`** — higher server `seq` wins.

The client keeps a `de.__seq` cursor and receives only entries newer than it. This is:
- **reorder-safe** (keys are slug-based, untouched by reordering),
- **add-safe** (new slugs = new keys, merged in additively),
- **collision-safe** (different lessons on two devices both survive; a `done` can never regress),
- **clock-safe** (ordering is server-assigned, so device clock skew is irrelevant).

Backward-compatible: pre-existing `{v,t}` entries read as `seq:0`, `kind` recomposed from the
suffix, re-stamped with a real seq on next touch. No migration; upgrade is lazy and per-key.

## 5. Client integration (`sync.js`)

Included by every page via a single `<script src="sync.js"></script>` line placed **before**
`_engine.js`. It:

1. Reads `{user, token, syncUrl}` from `localStorage` (set by login.html). If none → no-op
   (pure local mode, nothing breaks).
2. Wraps `localStorage.setItem` for `de.<slug>.*` keys to mark them dirty (with their `kind`) and
   schedule a debounced `push` (2s) of the changed keys, carrying the `de.__seq` cursor. No
   client timestamp is recorded — ordering is server-assigned.
3. On page load, does one `pull` (sending the cursor), applies the returned delta into
   `localStorage` before `_engine.init()` runs, and advances the cursor. A pull never overwrites
   a local write still pending in `dirty`.
4. Flushes pending pushes on `visibilitychange`(hidden)/`pagehide`/`beforeunload` with
   `keepalive:true`, so a just-earned ✓ can't die when the page unloads.
5. Exposes `Sync.clearDone(slug)` / `Sync.resetAnki(slug,map)` for the only paths allowed to move
   progress backwards, a status pill (synced ✓ / syncing ⏳ / offline ⚠), and "log out".

The engine's `save()/load()` are **not changed** — they already go through `localStorage`,
so wrapping `localStorage` catches everything, including future lesson types.

## 6. Login gate (`login.html`)

- Two fixed users. The page posts `{action:'login', user, pass}` to the Lambda.
- Lambda checks against env vars `PW_MOHAMED`, `PW_MUSTAFA` (default `123`), returns an
  HMAC-signed token (`user.expiry.sig`) so push/pull can verify without a session store.
- On success: store `de.__user`, `de.__token`, `de.__syncurl` in localStorage, redirect to
  `index.html`. On failure: inline error.
- Passwords are **only** in the Lambda's env (server-side), never in the downloadable static
  files. Changing a password = update one Terraform variable + `terraform apply`.
- Security honesty: this is a light gate for 2 family users, not hardened auth. Good enough
  by explicit decision; documented so nobody mistakes it for production security.

## 7. Infrastructure (Terraform, in `infra/`)

Resources:
- `aws_s3_bucket.site` — static site, website hosting, public read (bucket policy).
- `aws_s3_bucket.state` — private, per-user JSON blobs.
- `aws_iam_role` + policy — Lambda may Get/Put under `state/users/*` and ListBucket on the
  state bucket (GetObject on a missing key triggers a ListBucket 404-vs-403 check).
- `aws_lambda_function.sync` — Node.js 20, packaged from `infra/lambda/`.
- `aws_apigatewayv2_api/integration/route/stage` — HTTP API, `POST /api`, AWS_PROXY to Lambda.
- `aws_lambda_permission.apigw` — lets API Gateway invoke the Lambda.
- Outputs: `site_url`, `sync_url` (= `<api>/api`), `site_bucket`, `state_bucket`.

Terraform uses a **local backend** (`infra/terraform.tfstate`). The *architecture* is stored in
git via the `.tf` files (the request to "store the architecture in git"). The **tfstate itself is
gitignored** because it holds the Lambda env vars in plaintext (TOKEN_SECRET, PW_MOHAMED,
PW_MUSTAFA) — committing it would leak the passwords. `terraform.tfvars` (the real secrets) is
gitignored too, with `terraform.tfvars.example` committed as a template. The `.tf` files fully
recreate the infra with `make deploy`.

Site upload: a `make deploy` / documented `aws s3 sync` copies the HTML/JS/CSS to the site
bucket. (Kept out of Terraform so content redeploys don't churn infra state.)

## 8. Cost (2 users, free tier)

- S3: a few MB storage + a few thousand GET/PUT per month → effectively $0 (free tier: 5GB,
  20k GET, 2k PUT/month for 12 months; pennies after).
- Lambda: a few thousand invocations, 128MB, <200ms each → far under the perpetual free tier
  (1M requests + 400k GB-s/month, always free).
- Data transfer: kilobytes per sync → negligible.
- **Expected: $0.00/month.** Worst case a few cents.

## 9. Adding / reordering videos later (progress-safe procedure)

See CLAUDE.md → "Adding or reordering a lesson." In short: pick a NEW unique slug for a new
lesson (never reuse an old one), place/reorder by editing numbers + `index.html` only, run the
verification checks, `aws s3 sync` to redeploy the site. No backend change needed — new slugs
sync automatically. Existing progress is untouched because slugs are stable.

**Content standard — every noun shows its plural.** See CLAUDE.md → "Content rule: EVERY noun
shows its plural." Vocab tables use `Word · die Plural` in the `.w` cell and Anki fronts use
`der Singular → die Plural`; supply the correct plural even when the video omits it, and mark
`(kein Plural)` / `(nur Plural)` for uncountable / plural-only nouns. This is display-only text
inside `.w` cells and Anki fronts — it never touches a slug, a trainer/checkoff `answer`, or a
`de.<slug>.*` sync key, so it is fully backward-compatible: already-done lessons keep syncing
and stay marked ✓ done.

## 10. Rejected alternatives

- **Per-device localStorage only** — rejected: user switches devices often, wants sync.
- **DynamoDB** — rejected: overkill for 2 users; S3 blob is simpler.
- **Browser writes S3 directly** — rejected: embedding write creds in a static page is
  insecure and makes password logic ugly.
- **Lightsail/EC2 + Elastic IP** (real static IP) — rejected: not free, always-on server to
  maintain; a stable URL meets the actual need.
- **Last-write-wins whole blob** — rejected: loses progress when two devices edit different
  lessons before syncing.

## 11. AWS account state & the "hope" cleanup (2026-07-13)

**Unverified-account hold.** During deploy we hit three symptoms with one root cause:
- CloudFront `CreateDistribution` → 403 *"Your account must be verified before you can add new
  CloudFront resources."*
- Lambda public Function URL → 403 `AccessDenied` despite a correct resource policy.
- `lambda get-account-settings` → `ConcurrentExecutions: 10` (verified accounts start at 1000).

These are all the same account-verification hold. **Resolution:** the owner must open a free
account-verification case in the AWS Console Support Center (the Support *API* needs a paid
plan, but filing a verification request from the console is free). Until then we deliberately
use **API Gateway + public S3 website hosting**, which are not affected.

**Re-probed 2026-07-18 — hold still active.** Lambda concurrency is still capped at 10. A public
Function URL *config* can now be created, but invoking it returns **403 Forbidden**, so Function
URLs remain unusable; API Gateway stays the transport. The Lambda runtime was bumped
**nodejs20.x → nodejs22.x** (AWS Health EOL notice; Node 20 support ended 2026-04-30). A custom
domain was considered and **deferred**: it does not affect sync, and the clean version (custom
domain + HTTPS) needs CloudFront, which this hold still blocks — revisit after verification.

**Migrating to CloudFront after verification (optional, no client change):** make the site
bucket private with an OAC, add a CloudFront distribution with the S3 site as default origin
and the Lambda (via a Function URL or the API Gateway) as an `/api/*` behavior, and point
`config.js`'s SYNC_URL at `<cloudfront>/api`. The client already calls a configurable SYNC_URL,
so nothing else changes. The earlier CloudFront Terraform is preserved in git history.

**"hope" project deletion.** The account also held an unrelated older project ("hope"). It was
backed up in full to `../_aws_backup_20260713/` (Lambda code zips, 66 DynamoDB items, 100 S3
objects, IAM role + policy — see `RESTORE.md`) and then deleted: Lambdas `hope_session_api`,
`hope_ingest`; DynamoDB `hope-sessions`; S3 `hope-data-321209672840`; IAM role
`hope-lambda-role`. Deletion log: `../_aws_backup_20260713/DELETION-LOG.txt`. (Deleting it did
NOT lift the concurrency cap, confirming the hold is account-level, not resource contention.)
