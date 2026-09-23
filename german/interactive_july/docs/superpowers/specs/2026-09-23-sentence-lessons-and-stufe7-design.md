# Sentence-based lessons & the Stufe 7 restructure — design

**Date:** 2026-09-23
**Status:** Approved by Mohamed, implemented and live (commits `d2dd06b`, `85af781`)
**Author:** Mohamed + Claude

Two changes made on the same day, driven by the same teaching stance (comprehensible input):

1. **Words are taught inside sentences from the video**, not as word tables — lessons 44–58 and 60–76.
2. **Stufe 7 (the German case system, lessons 60–76) was reordered and rebuilt** so every lesson
   matches its video and nothing is tested before it has been taught.

---

## Part 1 — Words inside sentences from the video

### 1.1 Problem

Lessons taught vocabulary as tables: `der See · die Seen = lake`. A table row is decontextualised:
no meaning in use, no sound, and nothing tying the word to the scene the learner just watched.
Mohamed's observation, and the core premise of comprehensible input (Krashen): **sentences stick,
isolated words don't.** A word is acquired when it is met in a message that is understood, and
the most memorable message is the exact line just heard in the video.

### 1.2 Decision

Each lesson now teaches its vocabulary as **cleaned-up lines from the video's own transcript, in
video order**, grouped into 2–4 parts that follow the story. Every line has:

- the German sentence, the taught word(s) in **bold**;
- a natural English translation underneath;
- gloss "chips" for each taught word, **with its plural** (`der See · die Seen = lake`; the
  project-wide plural rule still applies);
- a 🔊 button that reads the line aloud (§1.4).

The old word table is **kept, folded** under the sentences (`<details class="wordlist">`). It
remains useful as a quick reference, and it keeps `verify.py`'s table plural check meaningful.

Reference implementation: `44_tennis_match.html`. The full format spec is in `CLAUDE.md`
("Lesson format: words inside sentences from the video").

### 1.3 Faithful to the video, but readable

Auto-captions have no punctuation, stutter and mishear ("Hamdi Dumpty" for Humpty Dumpty,
"ins gehen" for "ins Museum gehen", "vorjahr" for "Feuer"). Lines are cleaned into proper
written German: capitalisation, punctuation, „…“ quotes, stutters dropped, obvious mishearings
fixed. They are **never invented**. A word the video never says gets a short context sentence
explicitly tagged `bonus`. Where a speaker makes a grammar mistake (e.g. "verzeihst du ihn"),
the line is left out rather than taught.

### 1.4 The voice (🔊) and the "Hide English" toggle

Two small engine features (`_engine.js` → `sentences()`), both of which Mohamed liked:

- **🔊 per sentence** uses the browser's built-in speech synthesis (`speechSynthesis`, `de-DE`,
  rate 0.9, a German voice if the device has one).
  - *Why the browser voice and not clips cut from the video:* zero cost, no hosting, no audio
    files to extract or keep in sync, and it works on every line, bonus lines included.
  - *The trade-off:* it's a synthetic voice, not the speaker's. The video remains the primary
    listening input; 🔊 is for re-hearing a line on demand.
  - The button only appears when the browser supports speech. It speaks the sentence text, not
    its own icon (a test caught that bug).
- **"Hide English"** blurs every translation so the learner reads the German first and taps a line
  to peek. That's the CI loop: attempt comprehension, then confirm. The setting is a per-device
  preference stored as `ui.hideEnglish`, **outside the synced `de.*` namespace**, deliberately:
  it isn't progress, it must never sync, and `Sync.logout()` (which wipes `de.*`) keeps it.

The markup is plain HTML; without JS the sentences still render and read fine.

### 1.5 Anki becomes sentence cards

Card shape: `{f, b, w, wm}`:

- `f` — the video sentence with the word in `<b>` (front),
- `b` — its English translation,
- `w` — the word in the canonical front format (`der See → die Seen`, `gewinnen ⇄ verlieren`),
- `wm` — the word's English meaning.

The card back and the TSV export show `w = wm` under the translation, so the plural still
travels into Anki. Rule cards (`{f, b}`, no `w`) stay allowed for grammar patterns.

**Why a separate `w` field:** the hub's stats (`stats.js`) derive "words known / nouns with
plurals" by parsing card fronts. A sentence front would have counted as a phrase, or broken the
parser. `stats.js` now reads `card.w || card.f`. As part of this it also stopped treating
"article + lowercase word" (`die meisten Leute`) as a noun.

A fill-the-gap trainer (`luecken`, "Lines from the video") was added to each lesson to drill the
same lines.

### 1.6 Scope: only lessons not yet finished

Anki review progress is keyed by card **front** (`ease[card.f]`), so rewriting a deck resets that
lesson's review state. We therefore read Mohamed's live progress (read-only pull) and touched
**only lessons he had not completed**: 44–58 and 60–76. Lessons 1–43 and 59 (✓ done) were left
byte-for-byte unchanged. None of the reworked lessons had any Anki progress, so nothing was lost.
Slugs were never changed, so ✓ state and sync are unaffected.

### 1.7 Transcripts

Transcripts now live in `transcripts/<slug>.txt`: timestamped YouTube captions, with a header
saying manual/auto and the caption language. They are fetched with `youtube-transcript-api`
(fallback `yt-dlp`). They are **not published**: `pages.yml` strips `transcripts/` and refuses
to deploy if it is present.

YouTube rate-limits after ~30 quick fetches (HTTP 429 / IpBlocked). Seven grammar videos (lessons
61, 65, 66, 67, 69, 73, 75) could not be fetched yet. Those lessons were restructured (Part 2) but
don't yet have sentence blocks; add them when the transcripts arrive. Several grammar videos teach
*in English*, so their captions are English with German examples inside.

### 1.8 Quality process

Ten agents converted lessons in parallel, following a brief that copied the lesson-44 reference.
Three separate reviewer agents then re-read every sentence, card and cloze item as examiners, and
fixed ~25 problems. Most were cloze items where a "wrong" option was also grammatical; there were
also wrong plurals and a few mistranslations. `verify.py` gained checks for plurals in gloss chips
and sentence-card `w` fields; `tools/test_sentences.js` covers the 🔊, toggle, stats and export
paths.

---

## Part 2 — Restructuring Stufe 7 (the case system)

### 2.1 Problems found

Comparing each lesson's title with its actual video (YouTube oEmbed title plus transcript):

| Lesson (old) | Promised | Video actually teaches |
|---|---|---|
| 64 "Which One Is It?" | Akkusativ structured input | Possessive articles in the **Nominativ** (lingoni) |
| 62 "Nominativ" | the Nominativ in general | Subject **pronouns** + verb endings |
| 75 "den Kindern & the Genitiv" | Dativ plural + Genitiv | **Genitiv only** |

The order also fought the videos and itself:

- the Akk pronouns (`mich/dich`, old 73) came 10 lessons after the Akkusativ;
- the Dat pronouns (old 74) came 6 lessons after the Dativ;
- `meinen` (old 66) came before possessives had ever been taught;
- the "first-noun trap" reading drills came before the learner knew most object forms;
- `einem/einer/meiner` (Dativ ein-words) were tested in three lessons but **taught in none**.

### 2.2 Principle

**A lesson may only test what has been taught at or before it.** Each form comes right after the
case it belongs to, the way the source video series (lingoni, Easy German) sequences it. Input
first (sentences from the video), then structured input where the ending *must* be read to answer
(VanPatten), then limited production.

### 2.3 The new order

| n | Lesson | Change |
|---|---|---|
| 60 | Who does what to whom (roles) | — |
| 61 | Word order vs endings | — |
| 62 | Nominativ — ich, du, er | re-centred on its video (pronouns + verb endings) |
| 63 | **mein, dein, sein** | rebuilt from old 64 to match its video |
| 64 | Akkusativ — der → den | was 63 |
| 65 | einen, keinen, meinen | was 66; now builds on 63's possessives |
| 66 | mich, dich, ihn | was 73 |
| 67 | durch, für, gegen, ohne, um | video's extras handled: `bis` bonus, `wider` marked archaic, `entlang` bonus note |
| 68 | The first-noun trap | was 65; absorbs old 64's reading drills now that all Akk forms are known |
| 69 | Dativ — the receiver | was 68; gains the Dativ plural `-n` (from old 75) |
| 70 | mir, dir, ihm | was 74 |
| 71 | The Dativ chant | was 69; gains Dativ ein-words `einem/meiner` (previously taught nowhere) |
| 72 | Dativ verbs | was 70 |
| 73 | Giving: both objects | was 71; teaches the video's pronoun-order rule exactly (`Ich gebe es dem Mann`, `es ihm`) |
| 74 | wo? or wohin? | was 72 |
| 75 | **The Genitiv** | rebuilt: Genitiv only, plus `von` + Dativ as the spoken alternative |
| 76 | All four together | "five habits" → seven, each tied to a lesson |

Filenames and display numbers changed. **Slugs did not**, so progress is unaffected (no Stufe 7
lesson was done). `lessons.js` carries the new order; the hub and admin follow automatically.

### 2.4 What was removed or corrected

- **Items requiring later forms** (e.g. `dem Sofa` in the Nominativ lesson, `einen` in the
  Akkusativ lesson, Dativ distractors in Akk lessons).
- **Distractors that were also correct.** Several dozen items, e.g. `vor die Tür` (grammatical
  with movement), `einen` in "Ich brauche ___" ("I need one"), lower-case `sie` in a formal-you item.
- **Trivia and English-language questions** ("Could English do the same?", "Why is this hard for
  English speakers?").
- **Misleading claims:**
  - "negate a noun with kein" → only nouns that would take *ein* or no article (`Ich sehe den Hund nicht`);
  - "wo/wohin is only a heuristic" → the questions work; what misleads is reading *wohin* as "movement", when the real test is "is there a destination?";
  - "pronouns follow the masculine-only pattern" → only `er → ihn`; `mich/dich/uns/euch` are forms of their own;
  - "the Genitiv is B1, don't produce it" → the video labels it A2.
- **Unverifiable authority claims** (textbook names, a research percentage) were softened.

### 2.5 Added

- A 🔁 **revision warm-up** in every grammar lesson, drilling the 1–3 lessons just before it in
  the new order.
- Rewritten **checkoffs** (6–11 items, pass 0.8) answerable with prior + current knowledge only.
- A **Stufe 7 cumulative block** on `revision.html`, one item per step, each naming its lesson.

### 2.6 Not changed

- **Lessons 31–37** (the earlier Stufe 3 grammar) — completed, so left alone per §1.6.
- **The seven lessons without transcripts** still lack sentence blocks (§1.7).

---

## Extending this

- **New lessons:** follow the pipeline in `CLAUDE.md`. Save the transcript first, build sentence
  blocks and sentence cards from it, and have a second agent review the German before pushing.
- **When the missing transcripts arrive:** add sentence blocks, sentence cards and a `luecken`
  trainer to 61, 65, 66, 67, 69, 73 and 75, respecting the Stufe 7 prerequisite table above.
- **Never rework a completed lesson's deck without asking.** It resets its Anki review state.
