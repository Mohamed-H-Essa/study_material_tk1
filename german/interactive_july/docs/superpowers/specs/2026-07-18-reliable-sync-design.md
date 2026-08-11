# Reliable Sync via Server-Authoritative Versioning — Design

**Date:** 2026-07-18
**Status:** Approved, implemented — **the merge model below is still current and binding**
**Author:** Mohamed + Claude
**Supersedes the sync-merge portion of** `docs/2026-07-13-deployment-and-sync-design.md`.

> **Note (2026-08-11): the hosting moved, the merge model did not.** Where this doc says "the
> Lambda" or "S3", read "the Cloudflare Worker" and "the Durable Object" — AWS was torn down when
> the account expired. The merge engine (`isDataKey`/`kindOf`/`currentSeq`/`applyChange`/
> `mergeAll`/`delta`) was carried across **verbatim and diffed to prove it**, so every rule
> specified here — server-assigned `__seq` ordering, `done` monotonic, `anki` per-card
> forward-only union, other = higher seq wins, lazy `{v,t}` upgrade — holds exactly as written.
>
> The one thing that got *better*: this doc's design assumed a read-modify-write against S3 with
> no compare-and-swap, which was a genuine lost-update race (40 concurrent pushes lost 37). A
> Durable Object's synchronous storage makes that read-modify-write atomic. See CLAUDE.md.

## 1. Problem

Reported symptom: **progress lost even on the same device** — a lesson marked ✓ later reverts
to not-done in the same browser.

Root cause: the sync merge orders writes by **client wall-clock time** (`Date.now()` stamped on
each write, "larger `t` wins" everywhere). This trusts device clocks to agree. They don't. A
device with a skewed/fast clock stamps a write with a time that sits ahead of a legitimately
newer write from another device; on the next pull that stale value wins and overwrites good
progress — including on the device you are looking at, because pull writes server→local whenever
`entry.t > localT`. There is also a same-device race where a pull applies a server entry whose
skewed timestamp beats a value just set locally.

This is **not** a storage-reliability problem. Data already lives in S3, which is reliable. The
defect is entirely in the *ordering/merge* logic. Changing storage backends would not touch it.

(Separately, the 2026-07-13 lost-push bug — a debounced push cancelled on page unload — was
fixed on 2026-07-17 with `keepalive` + `visibilitychange`/`pagehide` flush + startup self-heal.
That fix is retained and folded into this design.)

## 2. Fix: server-authoritative sequence numbers

Replace client-clock ordering with a **server-assigned monotonic sequence**. The Lambda owns one
counter per user (`__seq`); every accepted write gets the next `seq`. Clients never invent
ordering — they report *what* changed and *what kind* it is; the server decides order and applies
semantic merge rules.

### Merge rules (server-side, by key `kind`)

`kind` is derived from the key suffix: `de.<slug>.done` → `done`, `de.<slug>.anki` → `anki`,
anything else → `other`.

1. **`done` — permanent (updated 2026-07-20).**
   - incoming `"1"` → always accepted (set/keep ✓, assign new seq).
   - The server still technically honours an explicit `{clear:true}`, but **nothing sends it**:
     the engine's "clear & redo" button was removed by product decision, so `done` is now
     effectively write-once. In addition `sync.js`'s `applyServerState` refuses to overwrite a
     locally-done key with a not-done value, so a stale delta / old "0" / legacy entry can never
     revert a ✓ on refresh either.
   - Consequence: once a lesson is done it stays done, on every device, across refreshes.
     This kills both the original cross-device bug and the later refresh-reverts-done bug.

2. **`anki` — per-card forward-only union.**
   - `result[card] = max(server_ease[card], incoming_ease[card])` over the union of cards.
   - Explicit `{reset:true}` (deck reset) replaces with the incoming map.
   - Consequence: two devices studying the same deck merge card-by-card; ease only moves up.

3. **`other` — higher server-seq wins**, with the invariant that a pull never overwrites a
   local write the client has not yet had acknowledged (held in `dirty`, re-pushed).

### Idempotency

Server assigns seq and skips a write whose value+kind already matches (no state change ⇒ no new
seq). A retried push (keepalive re-fire, network retry) cannot double-apply or corrupt state.

## 3. Data model

Same flat map, same S3 location `s3://<state-bucket>/users/<user>.json`. New entry shape:

```json
{
  "__seq": 42,
  "de.tea.done":      { "v": "1",       "seq": 12, "kind": "done" },
  "de.hands.anki":    { "v": {"…": 3},  "seq": 40, "kind": "anki" },
  "de.alphabet.done": { "v": "1",       "seq": 5,  "kind": "done" }
}
```

- `__seq` — per-user monotonic counter, server-owned.
- `seq` — replaces `t` as the ordering key. Server-assigned.
- `kind` — `done` | `anki` | `other`, stored explicitly.

**Backward compatibility (no migration):** a pre-existing entry has `{v,t}` and no `seq`. The
server reads a missing `seq` as `0` (oldest) and `kind` is recomposed from the key suffix. On the
next push that touches a key it is re-stamped with a real seq. Keys (`de.<slug>.<what>`) are
unchanged, so slug-identity and all existing progress carry over verbatim. Lessons already ✓ stay
✓. No data is rewritten on deploy; upgrade is lazy and per-key.

**Client cursor:** `de.__seq` in localStorage. Pull/push send it; server returns only entries
with `seq > cursor` plus the new `__seq`. First call after upgrade sends cursor `0` and gets
everything back — self-healing.

## 4. Client protocol (`sync.js`)

Same public surface (`Sync.enabled/user/status/ready/logout/pullThen`), new internals.

- **Write wrap:** `localStorage.setItem` for `de.<data>` keys marks the key `dirty` with its
  `kind`; no client timestamp is authoritative. Debounced push (2s) as before.
- **Push:** `{action:'push', cursor, changes:{key:{v,kind,clear?,reset?}}}` →
  `{ok, seq, state:<entries newer than cursor>}`. Apply returned entries; advance `de.__seq`.
- **Pull:** `{action:'pull', cursor}` → `{ok, seq, state}`; apply through the
  "never overwrite an unacked local write" path.
- **Flush (retained from 2026-07-17):** `keepalive:true` push on
  `visibilitychange`(hidden)/`pagehide`/`beforeunload` so a push cannot die on unload.
- **Self-heal (retained):** first pull with cursor `0` reconciles anything stranded.
- **Status pill:** `synced ✓ / syncing ⏳ / offline ⚠` — unchanged, so save state is visible.

New helpers for explicit intents: `Sync.clearDone(slug)` and `Sync.resetAnki(slug)` — used by
the engine's "clear & redo" / deck reset. Both no-op-safe when sync is disabled (fall back to a
plain local write).

## 5. Engine (`_engine.js`) — minimal change

- "clear & redo" button: instead of `save('done','0')`, call `Sync.clearDone(P.slug)` if present,
  else `save('done','0')`. This is the only path that may legitimately un-done a lesson, and it
  now carries the explicit `{clear:true}` intent the server requires.
- Anki deck reset (if/when triggered): `Sync.resetAnki(P.slug)` similarly.
- Everything else untouched: `save()`/`load()` still hit localStorage; the sync wrap catches all.

## 6. Infrastructure

Unchanged architecture: public S3 website + API Gateway (HTTP API) → Lambda → private state
bucket. **One infra change:** Lambda runtime `nodejs20.x` → `nodejs22.x` (AWS Health EOL notice,
Node 20 support ended 2026-04-30). Terraform `runtime` string updated; `make apply` deploys it.

**Account-verification hold still active (verified 2026-07-18):** Lambda concurrency capped at
10; a public Function URL *config* can be created but invocation returns 403 Forbidden. So
Function URLs and CloudFront remain unusable — API Gateway + public S3 stay the transport.

**Domain:** deferred by decision. A custom domain does not affect sync. The clean version
(custom domain + HTTPS) needs CloudFront, which the hold blocks; revisit after account
verification. Until then the site keeps its plain S3 website URL.

## 7. Testing

Node scripts (run against the real `sync.js`/lambda logic), plus a live end-to-end curl:

- Clock-skew scenario no longer loses data (was the reported bug).
- Stale `done="0"` pull cannot un-done a lesson.
- Two-device anki union takes the per-card max.
- keepalive push survives simulated unload; fires exactly once across overlapping unload events.
- First-pull self-heal (cursor 0) reconciles stranded local progress.
- Idempotent retry: re-pushing an unchanged value assigns no new seq, changes nothing.
- Live: deploy Lambda, curl login→push→pull against the API Gateway URL, confirm round-trip.

## 8. Cost

Unchanged: ~$0/month (2 users, free tier). Same resources.

## 9. Manual data repair done alongside (2026-07-18)

mohamed's blob was missing `de.tea.done` (lost by the 2026-07-13 push bug) and never had
`de.alphabet.done` / `de.kitchen.done`. Lessons 1–4 were confirmed complete by the user, so
`de.alphabet.done`, `de.tea.done`, `de.kitchen.done` were written into the blob (`v:"1"`);
`de.hands.done`/`de.hands.anki` were already present and left untouched. Under the new monotonic
`done` rule these can never be silently un-done again.
