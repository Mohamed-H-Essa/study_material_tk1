/* Tests for the hub's derived stats panel.
 *
 * Two halves:
 *   1. the PURE computation in stats.js — no DOM needed, so these are plain node
 *   2. the hub's RESILIENCE — real index.html in jsdom, with stats.js/frequency.js
 *      broken or absent, proving the lessons still render either way.
 *
 * Run: node tools/test_stats.js
 */
const { JSDOM, VirtualConsole } = require('/tmp/domtest/node_modules/jsdom');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let fails = [];
const check = (c, m) => { if (!c) fails.push(m); else process.stdout.write('.'); };

// ---------------------------------------------------------------------------
// 1. Pure computation
// ---------------------------------------------------------------------------
global.window = {};
require(path.join(ROOT, 'lessons.js'));
require(path.join(ROOT, 'decks.js'));
require(path.join(ROOT, 'frequency.js'));
require(path.join(ROOT, 'stats.js'));
const { LESSONS, DECKS, FREQ, Stats } = global.window;

const SN = { 1: 'Stufe 1 · Foundations', 2: 'Stufe 2 · Vocabulary (concrete nouns &amp; scenes)',
             3: 'Stufe 3 · Grammar', 4: 'Stufe 4 · Speaking', 5: 'Stufe 5 · Stories',
             6: 'Stufe 6 · Culture' };

const run = (opts = {}) => Stats.compute(Object.assign(
  { lessons: LESSONS, decks: DECKS, freq: FREQ, isDone: () => false, stageNames: SN }, opts));

// --- card-front parsing, per the formats CLAUDE.md mandates ---
const cl = Stats._classify;

let n = cl('der Schrank → die Schränke');
check(n && n.kind === 'noun' && n.gender === 'der' && n.plural === true && n.key === 'schrank',
  'noun w/ plural: ' + JSON.stringify(n));

n = cl('das Besteck (kein Plural)');
check(n && n.kind === 'noun' && n.gender === 'das' && n.uncountable === true && n.key === 'besteck',
  'uncountable noun: ' + JSON.stringify(n));

n = cl('die Eltern (nur Plural)');
check(n && n.kind === 'noun' && n.gender === 'die' && n.plural === true,
  'plural-only noun: ' + JSON.stringify(n));

n = cl('träumen (von)');
check(n && n.kind === 'verb' && n.key === 'träumen', 'verb w/ gloss: ' + JSON.stringify(n));

n = cl('über (+ Dativ)');
check(n && n.kind === 'phrase', 'case-marked pattern is a phrase: ' + JSON.stringify(n));

n = cl('Wie viel Uhr ist es?');
check(n && n.kind === 'phrase', 'question is a phrase: ' + JSON.stringify(n));

n = cl('bunt');
check(n && n.kind === 'adjective' && n.key === 'bunt', 'adjective: ' + JSON.stringify(n));

// "weich ⇄ hart" must yield TWO adjectives, not one card
const deckArrow = { X: { deck: 'x', cards: [{ f: 'weich ⇄ hart', b: 'soft vs hard' }] } };
let r = Stats.compute({ lessons: [{ slug: 'X', stage: 1 }], decks: deckArrow, freq: null,
                        isDone: () => true, stageNames: SN });
check(r.words.total === 2 && r.words.adjectives === 2,
  '⇄ splits into two words, got ' + r.words.total);

// --- non-vocabulary cards must be excluded ---
const nv = Stats._isNotVocab;
check(nv('ie', 'one long \'ee\''), 'phonetic card excluded');
check(nv('sch', 'like English \'sh\''), 'digraph excluded');
check(nv('ä (kurz)', 'sounds like a short English \'e\''), 'phonetic w/ paren excluded');
check(nv('-ung', 'always die'), 'gender-rule suffix excluded');
check(nv('___ Buch', 'das'), 'fill-in-the-blank excluded');
check(nv('60 Prozent', 'of Germans'), 'bare figure excluded');
check(!nv('der Schrank → die Schränke', 'the cupboard'), 'a real noun is NOT excluded');

// the alphabet lesson is pronunciation: it must contribute almost nothing
const alpha = Stats.compute({ lessons: [{ slug: 'alphabet', stage: 1 }], decks: DECKS,
                              freq: FREQ, isDone: () => true, stageNames: SN });
check(alpha.words.total <= 3,
  'alphabet lesson yields ~no vocabulary, got ' + alpha.words.total);

// --- dedup across lessons: der Wasserhahn is taught in BOTH tea and kitchen ---
const two = Stats.compute({ lessons: [{ slug: 'tea', stage: 2 }, { slug: 'kitchen', stage: 2 }],
                            decks: DECKS, freq: FREQ, isDone: () => true, stageNames: SN });
const teaOnly = Stats.compute({ lessons: [{ slug: 'tea', stage: 2 }], decks: DECKS,
                                freq: FREQ, isDone: () => true, stageNames: SN });
const kitchenOnly = Stats.compute({ lessons: [{ slug: 'kitchen', stage: 2 }], decks: DECKS,
                                    freq: FREQ, isDone: () => true, stageNames: SN });
check(two.words.total < teaOnly.words.total + kitchenOnly.words.total,
  'cross-lesson dedup: ' + two.words.total + ' should be < ' +
  (teaOnly.words.total + kitchenOnly.words.total));

// --- only DONE lessons count ---
const none = run({ isDone: () => false });
check(none.words.total === 0 && none.cards.unlocked === 0,
  'nothing done → no words, got ' + none.words.total);
check(none.cards.total > 0, 'card TOTAL still counts undone lessons');
check(none.lessons.done === 0 && none.lessons.total === LESSONS.length, 'lesson counts at zero');
check(none.level.band === 'A0', 'zero state is A0, got ' + none.level.band);
check(Array.isArray(none.milestones) && none.milestones.length > 0, 'zero state still nudges');
check(!/NaN/.test(JSON.stringify(none)), 'zero state contains no NaN');

// --- monotonicity: more lessons done can never mean fewer words ---
let prevWords = -1, prevCov = -1;
for (const k of [0, 1, 5, 10, 20, 35, LESSONS.length]) {
  const doneSet = new Set(LESSONS.slice(0, k).map(l => l.slug));
  const s = run({ isDone: slug => doneSet.has(slug) });
  check(s.words.total >= prevWords, `words monotonic at ${k}: ${s.words.total} < ${prevWords}`);
  check(s.coverage.pct >= prevCov, `coverage monotonic at ${k}`);
  prevWords = s.words.total; prevCov = s.coverage.pct;
}

// --- admin-hidden lessons leave BOTH numerator and denominator ---
const half = LESSONS.slice(0, 10);
const hid = Stats.compute({ lessons: half, decks: DECKS, freq: FREQ,
                            isDone: () => true, stageNames: SN });
check(hid.lessons.total === 10 && hid.lessons.done === 10,
  'hidden lessons excluded from both sides, got ' + hid.lessons.done + '/' + hid.lessons.total);
check(hid.lessons.pct === 100, 'a user shown 10 lessons who did all 10 is at 100%');

// --- coverage is WEIGHTED, not counted: this is the whole point of the bar ---
const mkDeck = ws => ({ D: { deck: 'd',
  cards: ws.map(x => ({ f: 'der ' + x.charAt(0).toUpperCase() + x.slice(1), b: 'gloss' })) } });
const CORE = ['und','ich','sein','haben','nicht','mit','auf','für','auch','werden',
              'können','aber','wie','noch','nur','wenn','sehr','schon','mehr','machen'];
const RARE = ['ahornblatt','atomkraftwerk','gedächtnis','gespenst','faultier','bilderbuch',
              'bücherregal','augenlid','brötchen','besteck','gewitter','gesetz','etui',
              'fell','dach','grab','büro','fach','blatt','schornstein'];
const L1 = [{ slug: 'D', stage: 1 }];
const covCore = Stats.compute({ lessons: L1, decks: mkDeck(CORE), freq: FREQ, isDone: () => true, stageNames: SN });
const covRare = Stats.compute({ lessons: L1, decks: mkDeck(RARE), freq: FREQ, isDone: () => true, stageNames: SN });
check(covCore.coverage.pct > covRare.coverage.pct,
  `weighting: ${CORE.length} core words (${covCore.coverage.pct}%) must beat ` +
  `${RARE.length} rare nouns (${covRare.coverage.pct}%)`);
check(covCore.words.total === covRare.words.total,
  'both test decks teach the same NUMBER of words — only their frequency differs');

// --- coverage never exceeds the list's own ceiling ---
const allDone = run({ isDone: () => true });
check(allDone.coverage.pct <= allDone.coverage.ceiling,
  'coverage cannot exceed its ceiling');
check(allDone.coverage.fill <= 100, 'bar fill is clamped to 100');
check(allDone.lessons.byStage.every(s => s.done === s.total), 'all stages complete when all done');
check(allDone.milestones.length === 1 && /Every lesson finished/.test(allDone.milestones[0]),
  'finished learner gets the completion line');

// --- FALLBACK: no frequency list → no coverage, everything else intact ---
const noFreq = run({ freq: null, isDone: () => true });
check(noFreq.coverage === null, 'freq absent → coverage is null');
check(noFreq.words.total > 0 && noFreq.level.band, 'freq absent → other stats still computed');

// --- FALLBACK: no decks → lesson counts survive ---
const noDecks = run({ decks: null, isDone: () => true });
check(noDecks.words.total === 0 && noDecks.cards.total === 0, 'decks absent → zero words');
check(noDecks.lessons.done === LESSONS.length, 'decks absent → lesson counts still right');

// --- level bands are ordered and labelled as estimates ---
check(/[Ee]stimated/.test(allDone.level.why) && /not a formal CEFR/.test(allDone.level.why),
  'level is explicitly an estimate, not a CEFR claim');

// --- gender split must add up to the noun count ---
const g = allDone.words.gender;
check(g.der + g.die + g.das === allDone.words.nouns,
  `gender split ${g.der}+${g.die}+${g.das} must equal nouns ${allDone.words.nouns}`);
check(allDone.words.withPlural <= allDone.words.nouns, 'plural count cannot exceed noun count');
check(allDone.words.nouns + allDone.words.verbs + allDone.words.adjectives +
      allDone.words.phrases === allDone.words.total, 'word kinds partition the total');

// ---------------------------------------------------------------------------
// 2. Hub resilience (jsdom, the real index.html)
// ---------------------------------------------------------------------------
function boot({ omit = [], breakStats = false, done = [] } = {}) {
  let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  html = html.replace(/<script src="([^"]+)"><\/script>/g, (m, src) => {
    if (/^https?:/.test(src)) return m;
    if (omit.includes(src)) return '<script></script>';       // simulate a missing file
    const p = path.join(ROOT, src);
    let body = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
    if (src === 'stats.js' && breakStats) {
      body = 'window.Stats={compute:function(){throw new Error("boom");}};';
    }
    return '<script>\n' + body + '\n</script>';
  });

  const store = { 'de.__user': 'mohamed', 'de.__token': 't' };  // sync DISABLED (no syncurl)
  done.forEach(s => { store['de.' + s + '.done'] = JSON.stringify('1'); });

  const vc = new VirtualConsole();          // swallow expected console.warn from the catch
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://x.test/index.html',
                                virtualConsole: vc });
  const w = dom.window;
  // jsdom's localStorage is real; seed it before scripts run is not possible here, so we
  // reload after seeding via the constructor's storage quota-free implementation.
  return { dom, w, store };
}

/* Seeding localStorage before the inline scripts run requires injecting it first. */
function bootSeeded({ omit = [], breakStats = false, done = [] } = {}) {
  let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const seed = { 'de.__user': 'mohamed', 'de.__token': 't' };
  done.forEach(s => { seed['de.' + s + '.done'] = JSON.stringify('1'); });
  const seedScript = '<script>(function(){var s=' + JSON.stringify(seed) +
    ';for(var k in s)localStorage.setItem(k,s[k]);})();</script>';
  html = html.replace('<script src="config.js"></script>', seedScript + '<script></script>');
  html = html.replace(/<script src="([^"]+)"><\/script>/g, (m, src) => {
    if (/^https?:/.test(src)) return m;
    if (omit.includes(src)) return '<script></script>';
    const p = path.join(ROOT, src);
    let body = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
    if (src === 'stats.js' && breakStats) {
      body = 'window.Stats={compute:function(){throw new Error("boom");}};';
    }
    return '<script>\n' + body + '\n</script>';
  });
  const vc = new VirtualConsole();
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://x.test/index.html',
                                virtualConsole: vc });
  return dom.window;
}

// --- normal: the panel renders and shows real numbers ---
let W = bootSeeded({ done: ['tea', 'kitchen', 'hands'] });
let panel = W.document.getElementById('stats');
check(panel && panel.classList.contains('on'), 'panel renders when everything is present');
check(/words known/.test(panel.textContent), 'panel shows the words tile');
check(/Everyday-speech coverage/.test(panel.textContent), 'coverage bar present with FREQ');
check(W.document.querySelectorAll('.card').length > 0, 'lessons still render alongside stats');
const tileText = panel.querySelector('.tile b').textContent;
check(/3/.test(tileText), 'lessons tile reflects the 3 done lessons, got ' + tileText);

// --- frequency.js missing → bar gone, everything else fine ---
W = bootSeeded({ omit: ['frequency.js'], done: ['tea'] });
panel = W.document.getElementById('stats');
check(panel.classList.contains('on'), 'panel still renders without frequency.js');
check(!/Everyday-speech coverage/.test(panel.textContent),
  'coverage bar omitted when frequency.js is missing');
check(/words known/.test(panel.textContent), 'other tiles survive a missing frequency.js');
check(W.document.querySelectorAll('.card').length > 0, 'lessons render without frequency.js');

// --- stats.js missing → panel silently absent, hub unaffected ---
W = bootSeeded({ omit: ['stats.js'], done: ['tea'] });
panel = W.document.getElementById('stats');
check(!panel.classList.contains('on'), 'panel hidden when stats.js is missing');
check(panel.textContent.trim() === '', 'no empty box left behind');
check(W.document.querySelectorAll('.card').length > 0, 'hub fully renders without stats.js');
check(W.document.getElementById('bulkBtn'), 'bulk export still present without stats.js');

// --- compute() throws → caught, panel hidden, hub survives ---
W = bootSeeded({ breakStats: true, done: ['tea'] });
panel = W.document.getElementById('stats');
check(!panel.classList.contains('on'), 'panel hidden when compute() throws');
check(W.document.querySelectorAll('.card').length > 0, 'lessons still render when stats throw');
check(W.document.getElementById('jumpBtn'), 'jump button survives a throwing stats panel');

// --- offline / no sync: stats work from localStorage alone ---
W = bootSeeded({ done: ['tea', 'kitchen'] });
check(W.document.getElementById('stats').classList.contains('on'),
  'stats render with sync disabled (raw files)');

// --- the panel must not interfere with the existing controls ---
W = bootSeeded({ done: [] });
panel = W.document.getElementById('stats');
check(panel.classList.contains('on'), 'panel renders in the zero state too');
check(!/NaN|undefined/.test(panel.textContent), 'zero state shows no NaN/undefined');
const bulkBar = W.document.getElementById('bulk');
check(bulkBar && panel.compareDocumentPosition(bulkBar) & 4,
  'stats panel sits ABOVE the export bar');
check(/Finish a lesson/.test(panel.textContent),
  'zero state explains what the panel is for instead of a dead 0% bar');
check(!/≈0%/.test(panel.textContent), 'zero state does not show a 0% coverage figure');
check(panel.querySelectorAll('.tile').length === 5, 'all five tiles present in zero state');

// --- one lesson done: the coverage bar appears ---
W = bootSeeded({ done: ['tea'] });
panel = W.document.getElementById('stats');
check(/Everyday-speech coverage/.test(panel.textContent),
  'coverage bar appears once something is done');
const lessonTile = panel.querySelector('.tile b');
check(/^1\s*\/\s*\d+$/.test(lessonTile.textContent.replace(/\s+/g, '')) ||
      /1\/\d+/.test(lessonTile.textContent),
  'lessons tile reads "1/N", got ' + JSON.stringify(lessonTile.textContent));
check(panel.querySelector('.tile b i'),
  'the denominator uses <i> so it cannot collide with the .tile span label rule');

// --- the disclosure remembers its state locally and never writes a progress key ---
W = bootSeeded({ done: ['tea'] });
const det = W.document.querySelector('details.more');
check(det, 'the more-stats disclosure exists');
const before = Object.keys(W.localStorage).filter(k => /^de\.[a-z]+\.(done|anki)$/.test(k)).sort();
det.open = true;
det.dispatchEvent(new W.Event('toggle'));
check(W.localStorage.getItem('de.__statsopen') === '1', 'disclosure state remembered');
const after = Object.keys(W.localStorage).filter(k => /^de\.[a-z]+\.(done|anki)$/.test(k)).sort();
check(JSON.stringify(before) === JSON.stringify(after),
  'THE PANEL MUST NEVER WRITE A PROGRESS KEY');

// ---------------------------------------------------------------------------
console.log('\n');
if (fails.length) {
  console.error('FAIL (' + fails.length + '):');
  fails.forEach(f => console.error('  ✗ ' + f));
  process.exit(1);
}
console.log('test_stats.js: all checks passed');
