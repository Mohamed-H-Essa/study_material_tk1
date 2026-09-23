/* Tests for the sentence-based lesson format (sentence blocks + sentence cards).
 *
 *   1. stats.js counts a sentence card's `w` word, never the sentence itself
 *   2. the real engine, on a real reworked lesson (44), adds the 🔊 buttons and the
 *      hide-English toggle, keeps that toggle out of the synced de.* namespace, and
 *      renders the word gloss on the back of a sentence card
 *   3. the Anki export puts the word gloss on the back of a sentence card
 *
 * Run: node tools/test_sentences.js   (needs jsdom in /tmp/domtest, like the other DOM tests)
 */
const { JSDOM } = require('/tmp/domtest/node_modules/jsdom');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const fails = [];
const check = (c, m) => { if (!c) fails.push(m); else process.stdout.write('.'); };

// ---------------------------------------------------------------------------
// 1. stats: the word, not the sentence
// ---------------------------------------------------------------------------
global.window = {};
require(path.join(ROOT, 'frequency.js'));
require(path.join(ROOT, 'stats.js'));
const { FREQ, Stats } = global.window;

const decks = { s: { deck: 'x', cards: [
  { f: 'Sie will lieber zum <b>See</b> gehen.', b: 'She’d rather go to the lake.', w: 'der See → die Seen', wm: 'lake' },
  { f: 'Lisa findet das sehr <b>langweilig</b>.', b: 'Lisa finds that boring.', w: 'langweilig ⇄ spannend', wm: 'boring ⇄ exciting' },
] } };
const r = Stats.compute({ lessons: [{ slug: 's', stage: 1, n: 1, title: 't', file: 'f' }],
  decks, freq: FREQ, isDone: () => true, stageNames: { 1: 'S' } });
check(r.words.total === 3, 'sentence cards should yield 3 words (See, langweilig, spannend), got ' + r.words.total);
check(r.words.nouns === 1 && r.words.withPlural === 1, 'der See → die Seen should count as one noun with plural');

// ---------------------------------------------------------------------------
// 2 + 3. the engine on lesson 44
// ---------------------------------------------------------------------------
const html = fs.readFileSync(path.join(ROOT, '44_tennis_match.html'), 'utf8')
  // load only the engine + the PAGE block; config/sync are not under test here
  .replace(/<script src="[^"]+"><\/script>/g, '');
const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/44_tennis_match.html' });
const w = dom.window;
const spoken = [];
w.speechSynthesis = { cancel() {}, getVoices: () => [], speak: (u) => spoken.push(u.text) };
w.SpeechSynthesisUtterance = function (t) { this.text = t; };
const downloads = [];
w.URL.createObjectURL = (b) => { downloads.push(b); return 'blob:x'; };
w.URL.revokeObjectURL = () => {};
w.HTMLAnchorElement.prototype.click = function () {};
const RealBlob = w.Blob;
w.Blob = function (parts, o) { const b = new RealBlob(parts, o); b.__text = parts.join(''); return b; };

w.eval(fs.readFileSync(path.join(ROOT, '_engine.js'), 'utf8') + '\n;window.Engine = Engine;');
const pageScript = html.match(/<script>\s*(window\.PAGE[\s\S]*?)<\/script>/)[1];
w.eval(pageScript);
const d = w.document;

const blocks = d.querySelectorAll('.sents');
const sents = d.querySelectorAll('.sent');
check(blocks.length >= 1 && sents.length >= 10, 'lesson 44 should have sentence blocks');
check(d.querySelectorAll('.sents-bar').length === blocks.length, 'one toggle bar per block');
check(d.querySelectorAll('.sent .say').length === sents.length, 'one 🔊 per sentence');

// 🔊 speaks the German sentence without the button's own glyph
d.querySelector('.sent .say').click();
check(spoken.length === 1 && /Samstag/.test(spoken[0]) && !/🔊/.test(spoken[0]), 'speaks the sentence: ' + spoken[0]);

// hide-English: toggles every block, persists OUTSIDE de.* (logout wipes de.*; it must not sync)
d.querySelector('.sents-toggle').click();
check([...blocks].every(b => b.classList.contains('hide-en')), 'toggle hides English in every block');
check(w.localStorage.getItem('ui.hideEnglish') === '1', 'toggle persisted under ui.hideEnglish');
check(!Object.keys(w.localStorage).some(k => /^de\..*hide/i.test(k)), 'toggle must not write a de.* key');
const en = d.querySelector('.sent .en');
en.click();
check(en.classList.contains('peek'), 'tapping a hidden line peeks at it');

// running the render path twice must not duplicate the bars / buttons
w.Engine.init();
check(d.querySelectorAll('.sents-bar').length === blocks.length, 'no duplicate bars after re-render');
check(d.querySelectorAll('.sent .say').length === sents.length, 'no duplicate 🔊 after re-render');

// sentence card back shows the word gloss
const card = d.querySelector('.anki-card');
check(/anki-front sentence/.test(card.innerHTML), 'sentence card uses the smaller front');
card.click();
check(/class="gloss"/.test(d.querySelector('.anki-card').innerHTML), 'flipped sentence card shows the word gloss');

// export: the word travels on the back
d.querySelector('.anki-export-btn').click();
const tsv = downloads.length ? downloads[downloads.length - 1].__text : '';
const row = tsv.split('\n').find(l => l.includes('Museum</b> eine interessante'));
check(row && /<b>das Museum → die Museen<\/b> = museum/.test(row.split('\t')[1]), 'export back carries the word gloss: ' + row);

console.log();
if (fails.length) { console.error('FAILED:\n  ' + fails.join('\n  ')); process.exit(1); }
console.log('ALL SENTENCE TESTS PASSED');
