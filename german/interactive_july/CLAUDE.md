# German Study — project guide (read this first)

A personal comprehensible-input German study app for two users (Mohamed, Mustafa). Static
HTML/JS lessons, deployed to AWS S3, with cross-device progress sync via one Lambda. Personal
project, **not enterprise** — keep it minimal, resilient, and cheap. Linguistic correctness and
backwards-compatibility matter more than design polish.

Full rationale: `docs/2026-07-13-deployment-and-sync-design.md`. Content pipeline & teaching
stance also live in Claude's long-term memory (project: german-ci-*).

## Layout

```
_engine.css / _engine.js   Shared engine. A lesson sets window.PAGE = {slug, ankiDeck, anki,
                           trainers, checkoff} and calls Engine.init(). Generic; rarely changes.
config.js                  Runtime config (SYNC_URL). AUTO-GENERATED at deploy (make config).
sync.js                    Cross-device sync shim. Wraps localStorage, offline-first. Included
                           on every page BEFORE _engine.js.
login.html                 The login gate/wrapper (shown first). 2 fixed users, static passwords.
index.html                 The hub. Redirects to login.html if not signed in. VIDEOS = [...] array
                           drives the cards. Also renders the signed-in strip.
NN_slug.html               One lesson per file, numbered by display order.
revision.html              Cumulative revision quizzes + "Export ALL cards".
docs/                      Design docs.
infra/                     Terraform (S3 site + state buckets, Lambda, Function URL) + Makefile.
infra/lambda/index.mjs     The sync backend (login/pull/push, per-key newest-wins merge).
```

## The ONE rule that keeps everything backwards-compatible

**A lesson's `slug` is its permanent identity. Never change or reuse a slug.**

- Progress is stored in localStorage as `de.<slug>.done`, `de.<slug>.anki`, etc., and synced
  under those same keys. The sync blob is a flat map `{ "de.<slug>.<what>": {v,t} }`.
- Therefore **reordering or renumbering lessons cannot affect progress** — it only touches
  display numbers (`<title>`, `<h1>`, `num`) and filenames/nav links, never slugs.
- **Adding** a lesson introduces a NEW slug; sync merges it in additively and never rewrites
  existing keys. Merge rule everywhere is newest-timestamp-wins per key.
- If you ever must rename a concept, keep the old slug. Picking a fresh slug silently orphans
  a user's prior progress for that lesson.

## Content rule: EVERY noun shows its plural (not just the article)

German nouns are only half-learned without their plural, and the plural is unpredictable, so
we always teach it. This applies to **every lesson, current and future, whether or not the
video says the plural** — if the video omits it, supply the correct standard plural yourself
(you are the German teacher here; get it right — Duden/DWDS forms, not guesses).

**Canonical format:**
- **Vocab table** (`.w` cell): `Word · die Plural` — e.g. `<td class="w" lang="de">Schrank · die Schränke</td>`.
  The `.art` cell still holds the singular article (`der`/`die`/`das`). The `· die …` shows the
  plural *with its always-`die` article* so learners see the article flip.
- **Anki front**: `der Schrank → die Schränke` (singular w/ article → plural w/ article).
- **Uncountable / singular-only** nouns (e.g. *das Besteck*, *das Salz*, *die Milch*, mass nouns,
  most abstract nouns): write `(kein Plural)` in the table and Anki, don't invent one.
- **Plural-only** nouns (e.g. *die Eltern*, *die Ferien*): mark `(nur Plural)`.
- Non-nouns (verbs, adjectives, phrases) are unaffected — no plural.

**Backward-compatibility:** this is a *display-only* change to the German text inside `.w` cells
and Anki fronts. It never touches a `slug`, a trainer `answer`, `id`, `checkoff` logic, or any
`de.<slug>.*` storage key, so already-done lessons keep syncing and stay marked ✓ done. When
retrofitting, do not change trainer/checkoff `answer` strings (they gate the ✓) — only the
vocab-table and Anki *display* text.

## Adding or reordering a lesson (progress-safe procedure)

1. **Dedupe by YouTube ID** first (`grep youtube.com/watch *.html` + the VIDEOS array). Same
   ID = duplicate, skip it.
2. **Pick a unique, permanent slug** for a new lesson. Place it by comprehensible-input
   difficulty (Stufe 2 scenes easy→hard, before the Stufe 3 grammar files). Reorder freely.
3. **Renumber safely** when inserting: `git mv` files high→low; rewrite filename links with a
   two-phase placeholder swap (old→`@@P#@@`→new) to avoid cascades; bump display numbers in
   `<title>`/`<h1>`; fix the prev/next seams on the two neighbours.
4. **Build the file** from the template of a recent lesson: topnav, video thumb
   (`img.youtube.com/vi/<ID>/hqdefault.jpg`), a `🔁 Revision` block drilling earlier lessons,
   vocab tables (correct der/die/das **+ plural — see the plural rule below**), tips, per-file
   Anki deck (~15-25 cards w/ examples & ⇄ opposites), 2-3 repeating trainers, checkoff
   (pass 0.8). **Include the two sync lines** before `_engine.js`:
   `<script src="config.js"></script><script src="sync.js"></script>`
5. **Update** `index.html` VIDEOS (stage/n/file/id/slug/title/de/tag), renumber shifted `n:`,
   footer count. Add representative items to `revision.html` banks + core cards to `ALL_CARDS`.
6. **Verify** (always): broken-link scan (every local href exists), title/h1 numbering 1..N,
   unique slug per file, trainer mounts == ids, `node --check` engine + inline PAGE scripts.
7. **Redeploy the site only** (no infra change needed for content):
   `cd infra && make site` — new slugs sync automatically.
8. Commit + push.

## Deploy / operate

Prereqs: AWS CLI authenticated, Terraform at `~/.local/bin/terraform`. Real secrets in
`infra/terraform.tfvars` (gitignored). **Credentials note:** this machine authenticates with
`aws login` (cached under `~/.aws/login/`), which Terraform's SDK does not read directly.
Before any terraform/`make` command, export creds into the env:

```
cd infra
export PATH="$HOME/.local/bin:$PATH"
eval "$(aws configure export-credentials --format env)"   # then run terraform/make
make init            # once
make deploy          # apply infra + regenerate config.js + upload site
make outputs         # show site_url / sync_url
```

- **Architecture:** S3 website (public) for the site + **API Gateway (HTTP API) → Lambda** for
  sync + private S3 `state` bucket for per-user blobs. (Not CloudFront / not a Lambda Function
  URL — see the account-verification note below.)
- **Change a password:** edit `pw_mohamed`/`pw_mustafa` in `infra/terraform.tfvars`, then
  `make apply` (updates the Lambda env; no site redeploy needed).
- **Content-only change:** `make site` (skips infra).
- **Entry point:** the site's index document is `login.html`. After login it redirects to
  `index.html`. `config.js` (auto-generated by `make config`) carries the live `SYNC_URL`
  (`<api>/api`); if it's empty the app runs local-only (default password `123`) so the raw
  files still work when opened directly.

### AWS account-verification hold (important)

This account is **unverified**, which blocks **CloudFront** creation and **public Lambda
Function URLs** (both 403) and caps Lambda concurrency at 10. That's why sync uses API Gateway,
not a Function URL, and the site uses plain S3, not CloudFront. To lift it, the owner files a
free account-verification request in the AWS Console Support Center (the Support *API* needs a
paid plan; the console request is free). After verification you may optionally move the site
behind CloudFront — `config.js`'s SYNC_URL is the only client-side thing that changes. The
CloudFront-based Terraform is in git history. See design doc §11.

## Security note (by design)

This is a light gate for two family members, not hardened auth. Passwords live only in the
Lambda env (never in the downloadable files). Tokens are HMAC-signed with 30-day expiry. The
sync Function URL is public (`authorization_type = NONE`) but every pull/push requires a valid
token. Good enough on purpose — don't over-invest.

## Cost

Two users on the free tier: S3 (few MB) + a few thousand Lambda calls/month + tiny transfer →
effectively **$0/month**. See the design doc §8.
