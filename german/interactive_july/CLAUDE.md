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
frequency.js               window.FREQ — the everyday-speech frequency list behind the hub's
                           coverage bar. Data only; hand-maintained.
stats.js                   window.Stats.compute() — the hub's derived stats. PURE (no DOM, no
                           globals, no storage), so it is unit-testable and safely wrappable.
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

## Hub: "jump to my next lesson"

A button in the hub's top bar scrolls to the first lesson that is **visible to this user and
not yet done**, in hub order, and rings it briefly so it is obvious which card it meant. It
**scrolls, never navigates** — the point is to show you where you are, not to open anything.
When everything is finished it disables itself and reads "✓ All caught up".

It is refreshed by `updateJump()` alongside `updateBulk()` on every render, so it stays correct
as you toggle lessons done. Cards carry `data-slug` purely so it can find its target again after
a re-render. Covered by `tools/test_done.js`.

## Hub: the derived-stats panel

A compact panel above the export bar showing what has actually accumulated: lessons done,
distinct words known, nouns (and how many came with their plural), an estimated level, Anki
cards unlocked, a coverage bar, and a `▸ more stats` disclosure holding per-Stufe bars, the
der/die/das + word-type breakdown, and the next milestones.

**It is READ-ONLY and derived.** Everything comes from `lessons.js` + `decks.js` + the done
flags. It writes no `de.<slug>.*` key and cannot change done-state — `verify.py` asserts that
`renderStats` contains no such `setItem`. The only thing it stores is `de.__statsopen`, the
disclosure's open/closed state, which is a local UI preference and deliberately **not synced**.

```
frequency.js   window.FREQ — the everyday-speech frequency list + a lemma map.
stats.js       window.Stats.compute({lessons, decks, freq, isDone, stageNames}) -> result.
               PURE: takes every input as an argument, reads no global, touches no DOM,
               writes no storage. Testable in plain node; wrappable in try/catch.
index.html     renderStats(visible) — markup only.
```

`compute()` is called with the **already-visibility-filtered** lesson array, so a lesson the
admin hid from that user is absent from both the numerator and the denominator.

**Fallbacks are the point — a broken stat must never cost the user the hub.** Each is tested:

| Failure | Behaviour |
| --- | --- |
| `frequency.js` missing | coverage bar omitted; every other tile still renders |
| `stats.js` missing | panel hidden entirely; hub behaves as before the feature |
| `compute()` throws | caught; panel hidden; lessons still render |
| `DECKS` missing | word/card tiles zero; lesson counts still correct |
| sync disabled (raw files) | works from localStorage alone |
| nothing done yet | five tiles at zero + copy explaining what fills in; never `NaN` |

### How the coverage bar is grounded (and why it is honest)

The bar answers "how much of everyday spoken German do my words cover?". A small core of
lemmas accounts for most of what people actually say, so **coverage is the SUM of each matched
lemma's share, not a count**. Knowing *und* and *ich* moves it far more than two rare nouns —
a count-based bar would claim otherwise, which is badly false. There is a test asserting that
20 core words beat 20 rare nouns.

`FREQ.words` is ~600 lemmas in rough frequency-rank order with a Zipfian share each,
normalised so the list sums to `totalShare` (0.80). The **order is empirical**; the individual
per-word shares are a smooth model, not measured counts. That is why the UI shows `≈` and
says "estimated". Do not present it as a corpus measurement.

Because the course teaches concrete nouns rather than function words, a learner who finishes
all 59 lessons lands around 35% — that is the true figure for this vocabulary, not a bug.

**Word counting rules** (in `stats.js`, driven by the card-front formats this project already
mandates): `der Schrank → die Schränke` is one noun with gender and a plural;
`weich ⇄ hart` is two adjectives; `über (+ Dativ)` and anything ending in `?` is a phrase;
`(kein Plural)`/`(nur Plural)` set countability. **Excluded as non-vocabulary:** the alphabet
lesson's pronunciation cards (detected from the BACK — "sounds like…" — so it stays
slug-independent), gender-rule suffixes (`-ung`), fill-in-the-blanks (`___ Buch`) and bare
figures (`60 Prozent`). Words are **deduped across lessons** by normalised front, exactly as
the Anki exporter dedupes — `der Wasserhahn` is taught in both *tea* and *kitchen*.

The **level band** (A0/A1/A1+/A2/A2+) is a transparent function of words known, always
rendered with the word *estimated* and a tooltip saying what it is based on. It is a
motivational gauge and explicitly not a CEFR assessment.

`renderStats()` is called from the end of `renderCards()`, so it repaints through the same
path that already handles the first render, `Sync.refresh()` and `visibilitychange` — no
second data path, so the tiles can never disagree with the ✓ ticks beside them.

Covered by `tools/test_stats.js` (pure computation + jsdom resilience).

## Celebration on completion

Passing a check-off for the first time fires a short celebration: confetti, a wave through the
title's letters, and a small tilt of the page. It is deliberately a gimmick — motivation only,
and it must never get in the way:

- **Once only.** It hangs off `renderDone(justNow)`; `justNow` is false when the page merely
  re-renders an already-done lesson, so reloading never re-triggers it.
- **Never blocking.** The confetti is a `position:fixed` canvas at `z-index:9999` with
  `pointer-events:none`, and it removes itself once the pieces settle. It is wrapped in a
  try/catch — a broken party must not break a lesson.
- **Respects `prefers-reduced-motion`.** The engine checks it and returns early; the CSS also
  opts out. Nothing animates for users who asked for that.

**The tilt goes on `.wrap`, never `<body>`.** A CSS transform on an ancestor makes
`position:fixed` descendants resolve against *that ancestor* instead of the viewport — tilting
`<body>` would drag the confetti canvas along and rotate it with the page. The canvas is a
direct child of `<body>`, which stays untransformed. jsdom cannot catch this (it does no
layout), so there is an explicit assertion that the class lands on `.wrap` and not on `<body>`.

Covered by `tools/test_celebrate.js`, which drives a real lesson's check-off to an actual pass.

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

## Hosting: moving off AWS (2026-08-11)

The AWS account is expiring. The move is in **two independent halves**, because the site and the
sync backend have almost no coupling: the frontend's only tie to AWS is the single generated line
in `config.js`, and every internal link is relative.

**Half 1 — the static site → GitHub Pages. DONE.** `.github/workflows/pages.yml` publishes on
every push to `main` that touches `german/interactive_july/**`. Deploying is now just `git push`;
`make site` is no longer needed. Live at
`https://mohamed-h-essa.github.io/study_material_tk1/`.

Why Pages over the alternatives (researched 2026-08-11, the constraint being **Egypt: no card,
no phone verification**): the repo already exists and is already public, so there is no new
signup and therefore no new identity check. GitLab Pages is disqualified because its builds run
on shared CI runners that require **card validation** — directly in the deploy path. Netlify's
post-2025 free tier is 300 credits/month with production deploys at 15 credits each, so ~20
deploys exhaust the month. Vercel's Hobby plan is non-commercial-only, worded broadly enough
that even accepting donations breaches it. Cloudflare Pages is the viable runner-up (truly
unlimited static bandwidth, email-only signup) if a custom domain is ever wanted.

Two things the workflow is deliberate about, both learned from the S3 deploy:
- It publishes **only** `german/interactive_july/`. The repo also holds unrelated
  `saa_c03_material/`, which must never reach the public site.
- It deletes `infra/`, `tools/`, `docs/`, `backup/` and `*.md` **from a copy**, then runs a guard
  step that hard-fails if any forbidden dir survives or a required file is missing. `tools/` was
  once caught being published by an S3 `--dryrun`; that near-miss is now a build-time assertion
  rather than a habit.

**The site root is `index.html` (the hub), not `login.html`.** S3 needed `login.html` as its index
document; Pages does not, and no file was renamed — the hub's first inline script already does
`location.replace('login.html')` when `de.__user`/`de.__token` are absent, so the gate still
fires. This was verified both ways in jsdom (signed-out → redirects; signed-in → renders all 59
cards). Renaming would have meant rewriting 137 `index.html` references across 66 files for no
behavioural gain.

**Half 2 — the sync backend → NOT DONE.** Pages is static-only and cannot host it. Until a new
backend exists, `sync.js` degrades to localStorage-only: progress is per-browser and does not
follow you across devices. This is safe — a failed pull hits `.catch()` and never calls
`applyServerState`, so nothing is pruned — but note two hazards:

- **Do not use the logout button while there is no backend.** `Sync.logout()` wipes every local
  `de.*` key on the assumption that progress is safe in the cloud. Once AWS is gone that
  assumption is false and logging out destroys local progress.
- **`de.__syncurl` is written into localStorage at login**, so after the backend moves, a browser
  keeps calling the dead AWS URL until the user logs out and back in (or the key is cleared).

The pre-migration cloud state (28 lessons done, 24 anki decks) is committed at
`backup/sync-state-2026-08-11/` — the three S3 blobs verbatim, to be imported into whatever
replaces the Lambda. It contains only slugs, done flags and card ease values; no secrets.

The recommended replacement is **Cloudflare Workers + a SQLite-backed Durable Object**: no card
at signup, never sleeps, transactional storage, and `node:crypto`'s `createHmac` ports verbatim
under `nodejs_compat`. Durable Objects specifically rather than KV, because the current handler
does an unguarded `readState → mergeAll → writeState` with **no ETag/`IfMatch`** — a real
lost-update race that KV would inherit and a DO removes structurally. The ~100-line merge engine
(`applyChange`/`mergeAll`/`delta`) is pure JS touching no platform API and moves across
unchanged; it was extracted and run standalone off-AWS, reproducing done-is-permanent, the
sanctioned `{clear:true}`, and the per-card anki union exactly. Only the 4 S3 calls and the
handler signature change (~60 of 367 lines). `sync.js` and the lesson pages need nothing but a
new `SYNC_URL`.

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

### Deploying content when Terraform state is unavailable (2026-08-11)

`make site` asks Terraform for the bucket name, so it fails on a machine with no state:
`terraform.tfstate` was **never actually committed** despite the comment in `main.tf` saying it
is, and `infra/terraform.tfvars` is gitignored. On this machine `terraform` also lives at
`/opt/homebrew/bin/terraform`, not the `~/.local/bin/terraform` the Makefile assumes.

A **content-only** deploy does not need Terraform at all — the bucket names are stable:

```
cd <repo root of the site>
eval "$(aws configure export-credentials --format env)"
aws s3 sync . s3://german-study-site-321209672840 --delete \
  --exclude ".git/*" --exclude "infra/*" --exclude "docs/*" --exclude "tools/*" \
  --exclude "*.md" --exclude ".gitignore" --exclude ".DS_Store"
```

Always `--dryrun` first: `--delete` is destructive, and the dry run is what caught `tools/`
(the test scripts) being published to the public site — now excluded in the Makefile too.
Check `config.js` matches what is already deployed before syncing, so a stale local copy can
never point the live site at the wrong SYNC_URL. Anything touching the **Lambda or infra**
still needs real Terraform state + `terraform.tfvars`.

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
