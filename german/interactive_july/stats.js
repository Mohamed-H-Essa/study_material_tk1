/* German Study — the hub's derived statistics.
 *
 * Loaded as a plain script; defines one global: Stats. One entry point:
 *
 *     Stats.compute({ lessons, decks, freq, isDone }) -> result
 *
 * PURE. It takes every input as an argument, reads no global, touches no DOM and
 * writes no storage. That is deliberate:
 *   - it can be unit-tested in plain node with no jsdom, and
 *   - the caller can wrap it in try/catch, so a bug in here hides the stats panel
 *     rather than taking the whole hub down with it.
 *
 * It derives everything from data the hub already loads (lessons.js + decks.js +
 * the done-flags). It never writes a de.<slug>.* key and cannot alter done-state.
 *
 * `lessons` MUST be the already-visibility-filtered array, so a lesson the admin
 * hid from this user is absent from both the numerator and the denominator.
 */
window.Stats = (function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Parsing a card front into vocabulary
  // ---------------------------------------------------------------------------
  // Fronts follow the formats CLAUDE.md mandates, so this is deterministic rather
  // than guesswork. See the table in the design doc.

  var ARTICLES = { der: 'der', die: 'die', das: 'das' };

  /* Cards that are NOT vocabulary and must never inflate the word count:
       - pronunciation cards from the alphabet lesson ("ie", "sch", "ß", "ä (kurz)")
       - gender-rule cards ("-ung", "-chen", "-schaft")
       - fill-in-the-blank prompts ("___ Buch")
       - bare figures ("60 Prozent", "10,3 Millionen")
       - usage/rule annotations ("an (usage)", "aus (rule)")
     A pronunciation card is recognised from its BACK, which always explains a
     sound; that is slug-independent, so a future lesson gets the same treatment. */
  var SOUND_BACK = /^(sounds? like|say |pronounced|like english|silent|makes the vowel|barely spoken|one long|sharp s)/i;

  function isNotVocab(front, back) {
    var f = String(front || '').trim();
    if (!f) return true;
    if (/^-/.test(f)) return true;                       // "-ung", "-ig (Wortende)"
    if (/^_+/.test(f) || /_{2,}/.test(f)) return true;   // "___ Buch"
    if (/^[\d.,]+\s/.test(f)) return true;               // "60 Prozent", "10,3 Millionen"
    if (/\((usage|rule|regel|nach |wortende)/i.test(f)) return true;
    if (SOUND_BACK.test(String(back || ''))) return true;
    // A single "word" of 1-3 chars with no article is a letter/digraph, not a word.
    if (f.length <= 3 && !/\s/.test(f) && !ARTICLES[f.toLowerCase()]) return true;
    return false;
  }

  /* Split a front into the individual vocabulary items it teaches.
     "weich ⇄ hart" is two adjectives; "stehen / hängen / liegen" is three verbs.
     A slash inside a noun phrase ("aus Holz / aus Metall") splits the same way. */
  function pieces(front) {
    return String(front)
      .split(/\s*⇄\s*|\s*\/\s*/)
      .map(function (p) { return p.trim(); })
      .filter(Boolean);
  }

  /* Classify one piece and return {key, kind, gender, plural} or null.
     `key` is the dedup identity: lower-cased, article-free, plural-tail removed. */
  function classify(piece) {
    var p = piece.trim();
    if (!p) return null;

    // Strip the plural half: "der Schrank → die Schränke" teaches ONE noun.
    var hadArrow = /→/.test(p);
    p = p.replace(/\s*→.*$/, '').trim();

    // "(kein Plural)" / "(nur Plural)" mark countability, then come off.
    var uncountable = /\(kein\s+Plural\)/i.test(piece);
    var pluralOnly = /\(nur\s+Plural\)/i.test(piece);
    p = p.replace(/\s*\((kein|nur)\s+Plural\)\s*/gi, ' ').trim();

    // A case marker means it is being taught as a grammatical pattern.
    var hasCase = /\(\+\s*(Dativ|Akk|Akkusativ|Genitiv)/i.test(p);
    p = p.replace(/\s*\(\+[^)]*\)/g, ' ').trim();
    // Any other trailing parenthetical is a gloss, not part of the word.
    p = p.replace(/\s*\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
    if (!p) return null;

    var words = p.split(/\s+/);
    var first = words[0].toLowerCase();

    // ---- noun: starts with an article ----
    if (ARTICLES[first] && words.length >= 2) {
      var noun = words.slice(1).join(' ');
      return {
        key: noun.toLowerCase(),
        kind: 'noun',
        gender: ARTICLES[first],
        plural: hadArrow || pluralOnly,
        uncountable: uncountable,
        surface: noun
      };
    }

    // ---- phrase: a question, a case pattern, an ellipsis, or simply long ----
    if (/\?$/.test(p) || hasCase || /…|\.\.\./.test(p) || words.length >= 3) {
      return { key: p.toLowerCase(), kind: 'phrase', surface: p };
    }

    // ---- verb: an infinitive, one word (possibly reflexive "sich …") ----
    var lead = words.length === 2 && first === 'sich' ? words[1] : (words.length === 1 ? words[0] : null);
    if (lead && /(en|eln|ern|n)$/.test(lead) && lead.length > 3) {
      return { key: lead.toLowerCase(), kind: 'verb', surface: lead };
    }

    // ---- two words that are not a noun/verb: treat as a phrase ----
    if (words.length > 1) return { key: p.toLowerCase(), kind: 'phrase', surface: p };

    // ---- otherwise an adjective / adverb / particle ----
    return { key: p.toLowerCase(), kind: 'adjective', surface: p };
  }

  /* Every distinct vocabulary item taught by a set of decks.
     Deduped by `key` across lessons — "der Wasserhahn" is deliberately taught in
     both `tea` and `kitchen` and must count once, exactly as the exporter dedupes.
     The FIRST occurrence wins, so a noun keeps its gender even if a later lesson
     teaches the bare word. */
  function vocabulary(slugs, decks) {
    var out = {}, order = [];
    if (!decks) return { map: out, list: order };
    for (var i = 0; i < slugs.length; i++) {
      var d = decks[slugs[i]];
      if (!d || !d.cards) continue;
      for (var c = 0; c < d.cards.length; c++) {
        var card = d.cards[c];
        if (isNotVocab(card.f, card.b)) continue;
        var ps = pieces(card.f);
        for (var p = 0; p < ps.length; p++) {
          var item = classify(ps[p]);
          if (!item || !item.key) continue;
          if (!out[item.key]) { out[item.key] = item; order.push(item); }
        }
      }
    }
    return { map: out, list: order };
  }

  // ---------------------------------------------------------------------------
  // Coverage against the frequency list
  // ---------------------------------------------------------------------------

  /* Reduce a surface form to the lemma the frequency list would carry. The
     explicit FREQ.lemma map is applied FIRST (it handles the irregulars); the
     generic rules below only need to catch the regular tails. */
  function lemmatise(word, freq, inList) {
    var w = String(word || '').toLowerCase().trim();
    if (!w) return null;
    if (inList(w)) return w;

    var mapped = freq.lemma && freq.lemma[w];
    if (mapped && inList(mapped)) return mapped;
    if (mapped) w = mapped;

    // regular plural / inflection tails, longest first
    var tails = ['nen', 'en', 'er', 'es', 'se', 'n', 'e', 's'];
    for (var i = 0; i < tails.length; i++) {
      var t = tails[i];
      if (w.length > t.length + 2 && w.slice(-t.length) === t) {
        var base = w.slice(0, -t.length);
        if (inList(base)) return base;
        var un = base.replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u');
        if (un !== base && inList(un)) return un;
      }
    }
    var plain = w.replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u');
    if (plain !== w && inList(plain)) return plain;
    return null;
  }

  function coverage(vocabList, freq) {
    if (!freq || !freq.words || !freq.words.length) return null;

    var index = {};
    for (var i = 0; i < freq.words.length; i++) index[freq.words[i].w] = freq.words[i];
    var inList = function (w) { return Object.prototype.hasOwnProperty.call(index, w); };

    var hit = {}, share = 0, matched = 0;
    for (var v = 0; v < vocabList.length; v++) {
      var lem = lemmatise(vocabList[v].surface || vocabList[v].key, freq, inList);
      if (!lem || hit[lem]) continue;
      hit[lem] = true; matched++; share += index[lem].s;
    }

    var totalShare = freq.totalShare || 0.8;
    return {
      pct: Math.round(share * 100),
      // how far through the list's OWN ceiling we are — this is what fills the bar
      fill: Math.max(0, Math.min(100, Math.round((share / totalShare) * 100))),
      matched: matched,
      of: freq.words.length,
      ceiling: Math.round(totalShare * 100)
    };
  }

  // ---------------------------------------------------------------------------
  // Level estimate — transparent bands, always labelled an estimate
  // ---------------------------------------------------------------------------
  var BANDS = [
    { max: 99,   band: 'A0', next: 'A1' },
    { max: 349,  band: 'A1', next: 'A1+' },
    { max: 699,  band: 'A1+', next: 'A2' },
    { max: 1299, band: 'A2', next: 'A2+' },
    { max: Infinity, band: 'A2+', next: null }
  ];

  function level(wordCount, lessonsDone) {
    var b = BANDS[BANDS.length - 1];
    for (var i = 0; i < BANDS.length; i++) {
      if (wordCount <= BANDS[i].max) { b = BANDS[i]; break; }
    }
    return {
      band: b.band,
      next: b.next,
      why: 'Estimated from ' + wordCount + ' distinct word' + (wordCount === 1 ? '' : 's') +
           ' across ' + lessonsDone + ' finished lesson' + (lessonsDone === 1 ? '' : 's') +
           '. A rough gauge, not a formal CEFR assessment.'
    };
  }

  // ---------------------------------------------------------------------------
  // Milestones — only ones that are actually reachable
  // ---------------------------------------------------------------------------
  function milestones(byStage, doneCount, totalLessons, wordCount) {
    var out = [];
    if (doneCount >= totalLessons && totalLessons > 0) {
      return ['Every lesson finished — nothing left but revision. 🎉'];
    }
    // nearest unfinished Stufe
    for (var i = 0; i < byStage.length; i++) {
      var s = byStage[i];
      if (s.done < s.total) {
        var left = s.total - s.done;
        out.push(left + ' more lesson' + (left === 1 ? '' : 's') + ' finishes ' + s.name + '.');
        break;
      }
    }
    if (wordCount > 0) {
      var nextWords = Math.ceil((wordCount + 1) / 50) * 50;
      out.push((nextWords - wordCount) + ' more word' + (nextWords - wordCount === 1 ? '' : 's') +
               ' takes you past ' + nextWords + '.');
    }
    var nextLessons = Math.ceil((doneCount + 1) / 10) * 10;
    if (nextLessons <= totalLessons) {
      out.push((nextLessons - doneCount) + ' more lesson' + (nextLessons - doneCount === 1 ? '' : 's') +
               ' reaches ' + nextLessons + ' of ' + totalLessons + '.');
    }
    return out.slice(0, 3);
  }

  // ---------------------------------------------------------------------------
  // The entry point
  // ---------------------------------------------------------------------------
  function compute(opts) {
    opts = opts || {};
    var lessons = opts.lessons || [];
    var decks = opts.decks || null;
    var freq = opts.freq || null;
    var isDone = typeof opts.isDone === 'function' ? opts.isDone : function () { return false; };
    var stageNames = opts.stageNames || {};

    var doneLessons = [], doneSlugs = [], allSlugs = [];
    for (var i = 0; i < lessons.length; i++) {
      allSlugs.push(lessons[i].slug);
      if (isDone(lessons[i].slug)) { doneLessons.push(lessons[i]); doneSlugs.push(lessons[i].slug); }
    }

    // per-Stufe, in the hub's own stage order
    var stageMap = {}, stageOrder = [];
    for (var l = 0; l < lessons.length; l++) {
      var st = lessons[l].stage;
      if (!stageMap[st]) { stageMap[st] = { stage: st, done: 0, total: 0 }; stageOrder.push(st); }
      stageMap[st].total++;
      if (isDone(lessons[l].slug)) stageMap[st].done++;
    }
    stageOrder.sort(function (a, b) { return a - b; });
    var byStage = stageOrder.map(function (st) {
      var raw = String(stageNames[st] || ('Stufe ' + st));
      // stage names carry HTML entities (&amp;) and a " · subtitle" — keep it short
      var name = raw.replace(/&amp;/g, '&').split('·')[0].trim();
      return { stage: st, name: name, done: stageMap[st].done, total: stageMap[st].total,
               pct: stageMap[st].total ? Math.round(stageMap[st].done / stageMap[st].total * 100) : 0 };
    });

    var known = vocabulary(doneSlugs, decks);
    var all = vocabulary(allSlugs, decks);

    var w = { total: known.list.length, nouns: 0, withPlural: 0, uncountable: 0,
              gender: { der: 0, die: 0, das: 0 }, verbs: 0, adjectives: 0, phrases: 0 };
    for (var k = 0; k < known.list.length; k++) {
      var it = known.list[k];
      if (it.kind === 'noun') {
        w.nouns++;
        if (it.gender && w.gender[it.gender] !== undefined) w.gender[it.gender]++;
        if (it.plural) w.withPlural++;
        if (it.uncountable) w.uncountable++;
      } else if (it.kind === 'verb') w.verbs++;
      else if (it.kind === 'phrase') w.phrases++;
      else w.adjectives++;
    }

    var cardsUnlocked = 0, cardsTotal = 0;
    if (decks) {
      for (var a = 0; a < allSlugs.length; a++) {
        var d = decks[allSlugs[a]];
        if (!d || !d.cards) continue;
        cardsTotal += d.cards.length;
        if (isDone(allSlugs[a])) cardsUnlocked += d.cards.length;
      }
    }

    return {
      lessons: {
        done: doneLessons.length,
        total: lessons.length,
        pct: lessons.length ? Math.round(doneLessons.length / lessons.length * 100) : 0,
        byStage: byStage
      },
      words: w,
      vocabTotal: all.list.length,
      cards: { unlocked: cardsUnlocked, total: cardsTotal },
      coverage: coverage(known.list, freq),
      level: level(known.list.length, doneLessons.length),
      milestones: milestones(byStage, doneLessons.length, lessons.length, known.list.length)
    };
  }

  return {
    compute: compute,
    // exposed for the tests; not part of the hub's contract
    _classify: classify,
    _isNotVocab: isNotVocab,
    _lemmatise: lemmatise
  };
})();

/* Node (tests) can require this file directly. Browsers ignore it. */
if (typeof module !== 'undefined' && module.exports) module.exports = window.Stats;
