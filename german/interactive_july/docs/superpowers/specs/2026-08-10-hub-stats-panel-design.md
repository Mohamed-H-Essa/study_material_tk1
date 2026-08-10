# Hub stats panel — design

*2026-08-10*

A compact panel at the top of the hub showing what the learner has actually accumulated:
lessons finished, distinct words known, nouns mastered with their plurals, an estimated
level, and a bar showing how much of everyday spoken German their vocabulary covers.

Everything is **derived** from data the hub already loads. The panel adds no new storage
key that carries progress, never writes a `de.<slug>.*` key, and cannot alter done-state.
It is a read-only view.

## 1. Why a separate computation file

The hub already keeps its data outside `index.html` (`lessons.js`, `decks.js`) so the page
stays readable and two consumers can't drift. The stats follow the same pattern:

| File | Contains | Loaded by |
| --- | --- | --- |
| `frequency.js` | `window.FREQ` — the frequency list + lemma map | hub |
| `stats.js` | `window.Stats.compute()` — pure, DOM-free maths | hub |
| `index.html` | markup, CSS, and the wiring that renders the result | — |

`stats.js` takes every input as an argument and touches no globals and no DOM. That makes
it unit-testable in plain node (no jsdom) and means a bug in it can be caught and contained
by the caller rather than taking the hub down with it.

## 2. `frequency.js` — the coverage data

```js
window.FREQ = {
  version: 1,
  note: "...provenance...",
  words: [ {w:"und", cum:0.0312}, {w:"ich", cum:0.0501}, ... ],   // ~700 entries
  lemma: { "hände":"hand", "häuser":"haus", ... }                  // surface → lemma
};
```

- `w` is the lemma, lower-cased, no article.
- `cum` is the **share of everyday spoken German that this single lemma accounts for**.
  Coverage is the sum of `cum` over matched lemmas, not a raw count — knowing *und* and
  *ich* is worth far more than two rare nouns, and a count-based bar would lie about that.
- `lemma` maps inflected surface forms seen in card fronts back to the list's lemma.

**Provenance matters and is recorded in the file's header comment.** The ranks come from
frequency studies of spoken/everyday German (Leipzig-corpus-style rank order, as reflected
in standard A1/A2 frequency lists); the per-word shares are a Zipfian fit normalised so the
whole list sums to the coverage such a list is conventionally credited with (~80% of running
words in everyday speech). This is stated in the file and in the UI tooltip so the number is
never presented as more precise than it is.

## 3. `stats.js` — the computation

One exported function, no side effects:

```js
window.Stats.compute({ lessons, decks, freq, isDone }) -> result
```

`lessons` is the already-visibility-filtered array (so admin-hidden lessons never reach the
denominators), `decks` is `window.DECKS`, `freq` is `window.FREQ` **or null**, and `isDone`
is the hub's existing predicate. Result shape:

```js
{
  lessons: { done, total, pct, byStage: [{stage, name, done, total}] },
  words:   { total, nouns, withPlural, uncountable,
             gender: {der, die, das}, verbs, adjectives, phrases },
  cards:   { unlocked, total },
  coverage: null | { pct, matched, of },        // null when freq is unavailable
  level:   { band, next, why },
  milestones: [ "3 more lessons finishes Stufe 2", ... ]
}
```

### 3.1 Parsing a card front into vocabulary

Card fronts follow the formats CLAUDE.md already mandates, so parsing is deterministic:

| Front | Yields |
| --- | --- |
| `der Schrank → die Schränke` | noun, gender `der`, has plural |
| `das Besteck (kein Plural)` | noun, gender `das`, uncountable |
| `die Eltern (nur Plural)` | noun, gender `die`, plural-only |
| `weich ⇄ hart` | two adjectives |
| `träumen (von)` | verb |
| `über (+ Dativ)` | phrase (grammatical marker) |
| `Wie viel Uhr ist es?` | phrase (ends in `?`, or 3+ words) |
| `ie`, `sch`, `ß` | **skipped** — pronunciation cards, not vocabulary |

Classification order: article-prefixed → noun; `⇄` → split, classify each side; ends in `?`
or contains a `(+ …)` case marker or is 3+ words → phrase; ends in `-en`/`-eln`/`-ern` and
is one word → verb; otherwise adjective/other. The alphabet lesson's phonetic cards are
excluded by a slug-independent rule: a front with no letter-plus-space structure and a back
starting "sounds like"/"pronounced"/"like English" is not vocabulary.

**Dedup** is by normalised front (lower-cased, articles and plural tails stripped), matching
what the exporter already does — `der Wasserhahn` is taught in both *tea* and *kitchen* and
must count once.

### 3.2 Coverage

Each known word is lemmatised (strip article, lower-case, apply `FREQ.lemma`, strip common
plural tails `-e/-en/-er/-n/-s` and undo umlaut where the base is in the list), then matched
against `FREQ.words`. `pct = round(100 × Σ cum(matched))`, `matched` = count of list entries
hit, `of` = `FREQ.words.length`. If `freq` is null the whole `coverage` field is `null` and
the caller omits the bar.

### 3.3 Level estimate

A transparent band, from distinct words known and stages finished:

| Words known | Band |
| --- | --- |
| < 100 | `A0` |
| 100–349 | `A1` |
| 350–699 | `A1+` |
| 700–1299 | `A2` |
| ≥ 1300 | `A2+` |

`why` carries the sentence shown on hover ("estimated from 412 words and 17 finished
lessons"), and the label is always rendered with the word *estimated*. It is a motivational
gauge, not a CEFR assessment, and says so.

### 3.4 Milestones

Up to three lines, cheapest-first: lessons remaining in the current Stufe, words to the next
round 50, and lessons to the next round 10. Only milestones that are actually reachable are
emitted; a finished learner gets a single "all caught up" line.

## 4. Rendering

Inserted above the existing `.bulk` bar:

```
┌──────┬──────┬──────┬──────┬──────┐
│ 17   │ 412  │ 228  │ A1+  │ 340  │
│lesson│words │nouns │level │cards │
└──────┴──────┴──────┴──────┴──────┘
████████░░░░░░░░░░  34% of everyday speech
▸ more stats            (Stufe bars · der/die/das · word types · milestones)
```

The disclosure's open/closed state is stored in `de.__statsopen` — a UI preference, not
progress. It is deliberately **not** synced and never matches `de.<slug>.*`.

`renderStats()` is called from the end of `renderCards()`, so it repaints through exactly the
same path that already handles the initial render, `Sync.refresh()`, and `visibilitychange`.
No second data path, so the tiles can never disagree with the ✓ ticks beside them.

## 5. Failure behaviour

Every fallback is a specific, tested failure — not a general hope. The rule: **a broken stat
must never cost the user the hub.**

| Failure | Behaviour |
| --- | --- |
| `frequency.js` absent / fails to parse | `FREQ` undefined → coverage bar omitted, all other tiles render |
| `stats.js` absent | `window.Stats` undefined → panel hidden, hub unchanged |
| `compute()` throws | caught by the caller → panel hidden, lessons still render |
| `DECKS` absent | word/card tiles show `—`, lesson tiles still correct |
| Sync disabled (raw files) | `isDone` reads localStorage as today; stats work fully offline |
| Admin-hidden lessons | excluded from both numerator and denominator |
| Nothing done yet | zeroes plus a first-lesson prompt; never `NaN` or an empty panel |

## 6. Backwards compatibility

- No `slug` is read for identity beyond the existing `de.<slug>.done` lookup.
- No new synced key. `de.__statsopen` is local-only UI state.
- The panel is additive markup above `.bulk`; nothing existing is restructured, so the
  done-toggle, jump button, bulk export and their tests are untouched.
- Older deploys without `frequency.js`/`stats.js` degrade to the current hub exactly.

## 7. Testing

`tools/test_stats.js`:

1. **Pure computation** (no DOM): noun/gender/plural parsing across all mandated formats,
   `⇄` splitting, phonetic-card exclusion, cross-lesson dedup, hidden-lesson exclusion,
   zero-state, and coverage weighting (a learner knowing only high-frequency function words
   must score higher than one knowing the same number of rare nouns).
2. **Hub resilience** (jsdom, real `index.html`): renders with `FREQ` absent; renders with
   `Stats.compute` throwing; in both cases the lesson cards and the existing bulk/jump
   controls still work.

`tools/verify.py` gains a check that the hub loads `frequency.js` and `stats.js` before its
inline script, so a future edit can't silently drop them.
