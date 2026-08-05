/* Exercise the REAL engine export code in a fake DOM and validate the produced files
 * against Anki's text-import rules. Nothing here re-implements the logic — we load
 * _engine.js itself so a regression in the shipped file fails this test.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const captured = [];   // every "download" the engine performs

function makeEl() {
  const e = {
    style: {}, dataset: {}, children: [], className: '', innerHTML: '', textContent: '',
    href: '', download: '', title: '', type: '',
    classList: { add(){}, remove(){}, contains(){return false;} },
    appendChild(c){ this.children.push(c); return c; },
    remove(){}, addEventListener(){}, querySelector(){ return null; },
    querySelectorAll(){ return []; }, focus(){}, setAttribute(){},
    click(){ captured.push({ name: this.download, text: this.__text }); },
  };
  return e;
}

const sandbox = {
  console,
  setTimeout: () => {},
  document: {
    createElement: () => makeEl(),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    body: makeEl(),
    activeElement: { tagName: 'BODY' },
  },
  window: { PAGE: null, scrollBy(){}, scrollTo(){} },
  localStorage: { getItem: () => null, setItem: () => {} },
  Blob: class { constructor(parts){ this.__text = parts.join(''); } },
  URL: {
    createObjectURL(b){ sandbox.__lastBlob = b; return 'blob:x'; },
    revokeObjectURL(){},
  },
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

// Make the anchor remember the blob text so click() can capture it.
const origCreate = sandbox.document.createElement;
sandbox.document.createElement = (tag) => {
  const e = origCreate(tag);
  Object.defineProperty(e, 'href', {
    set(v){ this.__href = v; this.__text = sandbox.__lastBlob ? sandbox.__lastBlob.__text : ''; },
    get(){ return this.__href; },
  });
  return e;
};

// _engine.js declares `const Engine = ...`, which is lexically scoped and never lands on the
// sandbox object, so append an explicit hand-off. In the browser this is a non-issue: other
// <script> tags share the same top-level scope.
vm.runInContext(
  fs.readFileSync(path.join(ROOT, '_engine.js'), 'utf8') + '\n;globalThis.__Engine = Engine;',
  sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'lessons.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'decks.js'), 'utf8'), sandbox);

const Engine = sandbox.__Engine;
const LESSONS = sandbox.window.LESSONS;
const DECKS = sandbox.window.DECKS;

let fails = [];
const check = (cond, msg) => { if (!cond) fails.push(msg); };

// ---------- 1. a single lesson's deck ----------
captured.length = 0;
Engine.exportAll(DECKS.koerper.deck, DECKS.koerper.cards);
check(captured.length === 1, 'single export produced ' + captured.length + ' files');
{
  const f = captured[0];
  const lines = f.text.split('\n');
  check(lines[0] === '#separator:Tab', 'line1 must be #separator:Tab, got ' + JSON.stringify(lines[0]));
  check(lines[1] === '#html:true', 'line2 must be #html:true');
  check(lines[2] === '#deck column:3', 'line3 must be #deck column:3');
  check(/\.txt$/.test(f.name), 'filename should end .txt: ' + f.name);
  const rows = lines.slice(3).filter(Boolean);
  check(rows.length === DECKS.koerper.cards.length,
    'row count ' + rows.length + ' != cards ' + DECKS.koerper.cards.length);
  check(rows.every(r => r.split('\t').length === 3), 'every row must have exactly 3 columns');
}

// ---------- 2. multi-deck export (the hub / revision "all" file) ----------
captured.length = 0;
const groups = LESSONS.map(v => ({ deck: 'Deutsch::' + v.n + ' · ' + v.title, cards: DECKS[v.slug].cards }));
const written = Engine.exportMany('Deutsch_alle_Karten', groups);
check(captured.length === 1, 'multi export produced ' + captured.length + ' files');
{
  const f = captured[0];
  const lines = f.text.split('\n');
  const rows = lines.slice(3).filter(Boolean);
  check(rows.length === written, 'returned count ' + written + ' != rows ' + rows.length);

  // no duplicate fronts (Anki would create duplicate notes)
  const fronts = rows.map(r => r.split('\t')[0]);
  check(new Set(fronts).size === fronts.length, 'duplicate fronts leaked into the ALL export');

  // every row: exactly 3 cols, non-empty front/back, deck starts with Deutsch::
  let badCols = 0, badDeck = 0, emptyField = 0, nested = 0;
  for (const r of rows) {
    const c = r.split('\t');
    if (c.length !== 3) badCols++;
    if (!c[0] || !c[1]) emptyField++;
    if (!/^Deutsch::/.test(c[2])) badDeck++;
    // exactly one "::" — a second would nest a level deeper than intended
    if ((c[2].match(/::/g) || []).length !== 1) nested++;
  }
  check(badCols === 0, badCols + ' rows have wrong column count');
  check(emptyField === 0, emptyField + ' rows have an empty front or back');
  check(badDeck === 0, badDeck + ' rows have a deck not under Deutsch::');
  check(nested === 0, nested + ' rows nest deeper than one level');

  // decks present == lessons
  const decks = new Set(rows.map(r => r.split('\t')[2]));
  check(decks.size === LESSONS.length, 'deck count ' + decks.size + ' != lessons ' + LESSONS.length);

  // no stray tabs/newlines inside fields
  check(!rows.some(r => /\r/.test(r)), 'carriage return found in a row');

  console.log('  ALL export: ' + rows.length + ' unique cards across ' + decks.size + ' decks');
}

// ---------- 3. the "finished lessons only" subset ----------
captured.length = 0;
const finished = LESSONS.slice(0, 10);
const n = Engine.exportMany('Deutsch_meine_Lektionen',
  finished.map(v => ({ deck: 'Deutsch::' + v.n + ' · ' + v.title, cards: DECKS[v.slug].cards })));
{
  const rows = captured[0].text.split('\n').slice(3).filter(Boolean);
  const decks = new Set(rows.map(r => r.split('\t')[2]));
  check(decks.size === 10, 'subset should contain 10 decks, got ' + decks.size);
  check(rows.length === n, 'subset count mismatch');
  console.log('  subset export: ' + rows.length + ' cards across ' + decks.size + ' decks');
}

// ---------- 4. hostile input: tabs / newlines / stray colons must not break the layout ----------
// Note "::" is INTENTIONAL nesting and is preserved; a single ":" inside a title is what gets
// neutralised, so a lesson called "Test: part 2" can't accidentally create a deck level.
captured.length = 0;
Engine.exportMany('edge', [{
  deck: 'Deutsch::Test: part 2',
  cards: [
    { f: 'a\tb', b: 'c\nd' },
    { f: 'dup', b: 'first' },
    { f: 'dup', b: 'second (should be dropped)' },
    { f: '', b: 'empty front should be dropped' },
    { f: 'ok', b: 'fine', ex: 'Ein Beispiel.' },
  ],
}]);
{
  const rows = captured[0].text.split('\n').slice(3).filter(Boolean);
  check(rows.every(r => r.split('\t').length === 3), 'hostile input broke the column layout');
  check(rows.length === 3, 'expected 3 surviving rows (a b, dup, ok), got ' + rows.length);
  const deck = rows[0].split('\t')[2];
  check((deck.match(/::/g) || []).length === 1, 'intended nesting lost or extra level added: ' + deck);
  check(!/[^:]:[^:]/.test(deck), 'a stray single colon survived in the deck name: ' + deck);
  const exRow = rows.find(r => r.startsWith('ok\t'));
  check(/<br><i>Ein Beispiel\.<\/i>/.test(exRow), 'example sentence missing from the back field');
  console.log('  edge cases: layout intact, duplicates and empty fronts dropped');
}

console.log('');
if (fails.length) {
  console.log('FAILURES (' + fails.length + '):');
  fails.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log('ALL EXPORT TESTS PASSED');
