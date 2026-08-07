# German Study — project guide (read this first)

A personal comprehensible-input German study app for two users (Mohamed, Mustafa). Static
HTML/JS lessons, deployed to AWS S3, with cross-device progress sync via one Lambda. Personal
project, **not enterprise** — keep it minimal, resilient, and cheap. Linguistic correctness and
backwards-compatibility matter more than design polish.

Full rationale: `docs/2026-07-13-deployment-and-sync-design.md` (architecture) and
`docs/superpowers/specs/2026-07-18-reliable-sync-design.md` (the current sync-merge model).
Content pipeline & teaching stance also live in Claude's long-term memory (project: german-ci-*).

## Layout

```
_engine.css / _engine.js   Shared engine. A lesson sets window.PAGE = {slug, ankiDeck, anki,
                           trainers, checkoff} and calls Engine.init(). Generic; rarely changes.
config.js                  Runtime config (SYNC_URL). AUTO-GENERATED at deploy (make config).
sync.js                    Cross-device sync shim. Wraps localStorage, offline-first. Included
                           on every page BEFORE _engine.js.
login.html                 The login gate/wrapper (shown first). 2 fixed users, static passwords.
lessons.js                 THE lesson catalogue (one entry per lesson). Shared by the hub and the
                           admin panel so the two can never drift. Edit lessons HERE.
decks.js                   Every lesson's Anki cards, keyed by slug. AUTO-GENERATED from the
                           lesson files by `node tools/gen_decks.js` — never hand-edit.
index.html                 The hub. Redirects to login.html if not signed in. Renders from
                           LESSONS, filtered by the caller's hidden list; signed-in strip.
admin.html                 Admin panel (mohamed only). Per-user visibility + done overrides.
NN_slug.html               One lesson per file, numbered by display order.
revision.html              Cumulative revision quizzes + "Export ALL cards".
docs/                      Design docs.
infra/                     Terraform (S3 site + state buckets, Lambda, API Gateway) + Makefile.
infra/lambda/index.mjs     The sync backend (login/pull/push + adminGet/adminSet). Server-assigned
                           sequence numbers order writes; merge is per-key by KIND (done=monotonic,
                           anki=per-card max, other=higher seq). nodejs22.x.
```

## Admin & per-user visibility (added 2026-08)

One admin (`mohamed`, the `ADMIN` constant in the Lambda) can, from `admin.html`:

- **Hide/show any lesson per user.** Stored in a SEPARATE blob `s3://STATE/admin/config.json`
  as `{hidden:{<user>:{<slug>:true}}}`. It is an **opt-out list**: a slug that is absent (or a
  missing blob entirely) means visible, so an older backend or a fresh deploy behaves exactly
  as before the feature existed. Visibility never touches a `de.<slug>.*` key, so hiding a
  lesson **keeps** that user's progress — flip it back on and the ✓ is still there.
- **Force a lesson done / not-done for a user.** This is the one sanctioned exception to
  "done is permanent". It reuses the ordinary `applyChange`/`mergeAll` pipeline rather than a
  parallel path: un-doning sends the `{clear:true}` intent, and the resulting entry is stamped
  `cleared:true` so `sync.js`'s client-side guard knows to apply this particular revert. A bare
  `"0"` from a stale device still cannot un-done anything.
- The admin is never hideable from himself — enforced server-side, not just in the UI.

`pull`/`push` responses also carry `{admin, hidden}` so the hub needs no extra round-trip; older
clients ignore the extra fields. Auth is enforced in the Lambda (403 for non-admins), not the UI.

## The ONE rule that keeps everything backwards-compatible

**A lesson's `slug` is its permanent identity. Never change or reuse a slug.**

- Progress is stored in localStorage as `de.<slug>.done`, `de.<slug>.anki`, etc., and synced
  under those same keys. The sync blob is a flat map `{ "__seq": <n>,
  "de.<slug>.<what>": {v, seq, kind} }`.
- Therefore **reordering or renumbering lessons cannot affect progress** — it only touches
  display numbers (`<title>`, `<h1>`, `num`) and filenames/nav links, never slugs.
- **Adding** a lesson introduces a NEW slug; sync merges it in additively and never rewrites
  existing keys.
- If you ever must rename a concept, keep the old slug. Picking a fresh slug silently orphans
  a user's prior progress for that lesson.

## How sync merges (server-authoritative, not clock-based)

Ordering is a **server-assigned monotonic sequence** (`__seq`), never a client wall-clock —
client clocks disagree and the old timestamp merge let a skewed device silently overwrite good
progress. The client keeps a `de.__seq` cursor and only receives entries newer than it. The
Lambda merges each pushed key by its **kind** (derived from the suffix):

- **`.done` → permanent.** Once ✓, a lesson stays ✓ forever — on every device, across
  refreshes. Three layers enforce this: the server's `done` merge is monotonic; `sync.js`'s
  `applyServerState` refuses to overwrite a locally-done key with a not-done value; and the
  engine has **no un-done UI** (the old "clear & redo" button was removed by explicit decision).
  `Sync.clearDone(slug)` still exists in `sync.js` but is intentionally unwired — nothing calls
  it, so nothing can revert a completion.
- **`.anki` → per-card forward-only union.** `max(existing, incoming)` per card; a deck reset
  (`Sync.resetAnki(slug, map)`) sends `{reset:true}`.
- **other → higher server seq wins.**

Backward-compatible: old `{v,t}` entries read as `seq:0` and upgrade lazily on next touch; keys
are unchanged. Full rationale: `docs/superpowers/specs/2026-07-18-reliable-sync-design.md`.

**Done is permanent by product decision — do not add any UI or code path that un-dones a
lesson.** A bare local write to `de.<slug>.done = "0"` is ignored by the server AND blocked by
the client apply guard, so it would not work anyway. (`Sync.resetAnki` for deck resets is still
available; only `done` is locked.)

## Done-state: the backend is the source of truth

The hub used to read `localStorage` and render once. That broke in a specific way: you tick a
lesson done in **admin.html**, click through to the hub, and it still shows not-done. Two causes,
both fixed — and neither was browser cache:

1. **`adminSet` returned no state.** It writes to the target user's blob server-side, but the tab
   that made the change never learned of it, so its `localStorage` kept the old value. `adminSet`
   now returns the caller's own fresh `state` + `seq`, and `Sync.call` applies it.
2. **A delta pull could not heal it.** `pull` only returns entries newer than the client's cursor;
   an admin write can sit at a seq this browser has already passed. `Sync.refresh()` forces a
   **full** read (`cursor:0`) and applies it **authoritatively**.

"Authoritatively" means two things beyond a normal pull, and both matter:
- It **bypasses the done-is-permanent guard.** That guard exists to stop *stale* data un-doing a
  lesson; a full pull we just asked for is not stale. (`done` is still permanent against every
  other path — see the section above.)
- It **prunes local-only keys.** A `de.<slug>.*` key the server has never heard of is debris;
  keeping it would make "source of truth" only half true. Keys with an unacked local write are
  left alone.

The hub renders once immediately (never a blank page), then again after `Sync.refresh()`, and
again on `visibilitychange` — so returning from the admin tab always repaints. **When sync is
disabled** (raw files, no backend) `refresh()` is a no-op and nothing is pruned, so offline-only
use keeps its local progress. There is a test for exactly that.

Hovering a hub card also gives a **done toggle** next to the Anki button. It calls
`Sync.setDone(slug, on)`, which pushes immediately (no debounce), resolves only once the **server**
has accepted, and repaints from the server's answer — so the button shows stored state, not an
optimistic guess. Un-doning uses the sanctioned `{clear:true}` intent. On failure it shows
`✗ Failed` rather than lying.

Covered by `tools/test_done.js` (jsdom, real pages, fake backend).

**The overlay must never eat clicks.** The done-card tint is an absolutely-positioned layer on
top of the thumbnail. It originally had no `pointer-events:none`, so on a *finished* lesson it
covered the hover buttons and every click fell through to the card's `<a>` — the toggle AND the
Anki download both silently opened the lesson instead. Both `.card.done .thumb::before/::after`
are now `pointer-events:none`, the controls sit at `z-index:3` above them, and there is a test
asserting it. If you add another overlay, give it `pointer-events:none` too.

**Two subtleties in that click path**, both of which caused a regression while fixing this:
- The card-level capture handler calls `preventDefault()` **only**. Adding `stopPropagation()`
  there also stops the buttons' own handlers from ever running — capture fires first.
- Button labels are written into an inner `<span>` (`tgLabel()`), not via `textContent` on the
  button. `textContent` destroys the children, and the span carries `pointer-events:none` so a
  click always resolves to the button itself rather than a text node.

**`authoritative` vs `complete`** in `applyServerState` are different flags and must not be
conflated: a `push` reply is a DELTA (authoritative, not complete), a `refresh`/`adminSet` reply
is the whole blob (both). Pruning happens only when `complete` — pruning on a delta would delete
every key that merely had not changed.

## Anki export

Three ways out, all producing ONE tab-separated file that Anki imports directly:

- **Per lesson** — a button at the **top and bottom** of every lesson page, plus the one inside
  the flashcard widget. Mounted by the engine into any `<div class="anki-export-mount"></div>`.
- **Per lesson from the hub** — hover a card and a `⬇ Anki` button appears over the thumbnail.
  The card is an `<a>`, so that button *must* `preventDefault()` + `stopPropagation()` or the
  click navigates instead of downloading.
- **Everything you've finished** — the bar at the top of the hub exports every lesson that is
  both ✓ done and visible to that user. `revision.html` does the same for all 57.

The file carries Anki's import directives (2.1.54+): `#separator:Tab`, `#html:true` and
`#deck column:3`. Columns are `front / back / deck`. Because the deck travels per row, a
collective export lands as one tidy subdeck per lesson (`Deutsch::16 · Parts of the Body`)
rather than one undifferentiated pile — which is why this beats emitting N separate files.

Two invariants the exporter enforces, both covered by tests:
- **Dedup by front.** Some words are deliberately taught in two lessons (e.g. `der Wasserhahn`
  in both *tea* and *kitchen*); exporting both would create duplicate Anki notes.
- **`::` is nesting, a single `:` is not.** `deckPath()` splits on `::`, cleans each segment,
  and rejoins, so a colon inside a lesson title can't invent an extra deck level.

**When you change a lesson's `anki:[]`, re-run `node tools/gen_decks.js`** — `decks.js` is what
the hub and revision page read, and `verify.py` fails if it drifts.

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
API Gateway route is public (no authorizer) but every pull/push requires a valid token. Good
enough on purpose — don't over-invest.

## Cost

Two users on the free tier: S3 (few MB) + a few thousand Lambda calls/month + tiny transfer →
effectively **$0/month**. See the design doc §8.
