# infra/ — RETIRED. Nothing here runs.

This is the **AWS stack that used to host this project**, kept for history only. The account was
torn down on **2026-08-11** because it was expiring: there are no S3 buckets, no Lambda, no API
Gateway, no IAM roles and no log groups left, in any region. Every `make` target here will fail,
and none of it should be resurrected.

**Where things live now**

| | Where | Deploy with |
| --- | --- | --- |
| Static site | GitHub Pages (`.github/workflows/pages.yml`, repo root) | `git push` to `main` |
| Sync backend | Cloudflare Worker + Durable Object (`../worker/`) | `cd worker && npx wrangler deploy` |

See **`../CLAUDE.md` → "Deploy / operate"** for the current, authoritative runbook.

## Why it is kept

`lambda/index.mjs` is the direct ancestor of `../worker/src/index.mjs`. The ~77-line merge engine
was copied from it **verbatim** — the port was verified byte-identical by diff — because that code
encodes the product rules (done is permanent, anki is a per-card forward-only union, ordering is a
server-assigned sequence) and a subtle rewrite would quietly corrupt progress. If you ever need to
re-derive or re-verify those rules, this is the reference implementation they came from.

It is also the thing the 24 contract cases in `../tools/sync_contract_cases.mjs` were first
validated against, which is what made them a real spec rather than a guess.

## Two things this stack got wrong, worth not repeating

1. **`terraform.tfstate` was never actually committed**, despite a comment in `main.tf` saying it
   was — and `terraform.tfvars` is gitignored. So a deploy from any machine without local state
   simply failed. That is why `config.js` is now a plain committed file instead of being
   generated from infrastructure output: the site must be deployable from a bare checkout.
2. **`readState → mergeAll → writeState` had no conditional write** (no ETag / `IfMatch`), so
   overlapping pushes silently clobbered each other — 40 concurrent pushes lost 37 of them under
   realistic S3 latency. The replacement routes every request to a single-threaded Durable Object
   and uses the synchronous storage API, so the read-modify-write cannot interleave.
   `../tools/test_sync_race.mjs` guards this.
