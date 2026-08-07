/* Load the REAL pages in a real DOM (jsdom) and drive the buttons the way a user would.
 * This catches wiring mistakes that a syntax check can't: a button that navigates instead
 * of downloading, a mount that never gets filled, a count that reads wrong.
 */
const { JSDOM, VirtualConsole } = require('/tmp/domtest/node_modules/jsdom');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let fails = [];
const check = (c, m) => { if (!c) fails.push(m); };

function boot(file, { done = [], hidden = [] } = {}) {
  const downloads = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => fails.push(file + ': jsdom error: ' + e.message));

  // jsdom won't fetch <script src> without a resource loader, and we don't want network
  // access anyway — inline every LOCAL script so it executes synchronously, exactly in
  // the order the page declares. config.js is stubbed (no backend in a test).
  let html = fs.readFileSync(path.join(ROOT, file), 'utf8');
  html = html.replace(/<script src="([^"]+)"><\/script>/g, (m, src) => {
    if (/^https?:/.test(src)) return m;
    const p = path.join(ROOT, src);
    if (!fs.existsSync(p)) return '<script>/* missing ' + src + ' */</script>';
    return '<script>\n' + fs.readFileSync(p, 'utf8') + '\n</script>';
  });

  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    resources: undefined,          // don't fetch thumbnails
    url: 'http://localhost/' + file,
    virtualConsole: vc,
    beforeParse(w) {
      // Signed in, so the login gate doesn't redirect us away.
      const store = { 'de.__user': 'mohamed', 'de.__token': 't' };
      done.forEach(s => { store['de.' + s + '.done'] = JSON.stringify('1'); });
      Object.defineProperty(w, 'localStorage', {
        value: {
          getItem: k => (k in store ? store[k] : null),
          setItem: (k, v) => { store[k] = String(v); },
          removeItem: k => { delete store[k]; },
          key: i => Object.keys(store)[i],
          get length() { return Object.keys(store).length; },
        },
        configurable: true,
      });
      // Capture downloads instead of performing them.
      w.URL.createObjectURL = (b) => { w.__blob = b; return 'blob:x'; };
      w.URL.revokeObjectURL = () => {};
      const realCreate = w.document.createElement.bind(w.document);
      w.document.createElement = (tag) => {
        const el = realCreate(tag);
        if (tag === 'a') {
          const origClick = el.click.bind(el);
          el.click = function () {
            if (this.download) {
              const b = w.__blob;
              if (b && b.__parts) downloads.push({ name: this.download, text: b.__parts.join('') });
              else downloads.push({ name: this.download, text: '' });
              return;                       // never navigate
            }
            return origClick();
          };
        }
        return el;
      };
      const RealBlob = w.Blob;
      w.Blob = class extends RealBlob {
        constructor(parts, opts) { super(parts, opts); this.__parts = parts; }
      };
      // Pretend sync is present and settled, with the given visibility.
      w.__seedSync = { hidden };
    },
  });
  return { dom, w: dom.window, downloads };
}

// ---------------------------------------------------------------- LESSON PAGE
{
  const { w, downloads } = boot('16_body_parts.html');
  const mounts = w.document.querySelectorAll('.anki-export-mount');
  check(mounts.length === 2, 'lesson: expected 2 export mounts, got ' + mounts.length);

  const btns = w.document.querySelectorAll('.anki-export-btn');
  check(btns.length === 2, 'lesson: engine filled ' + btns.length + '/2 mounts with a button');

  if (btns.length === 2) {
    const nCards = w.PAGE.anki.length;
    check(btns[0].textContent.includes(String(nCards)),
      'lesson: top button should show the card count (' + nCards + ')');
    btns[0].click();
    check(downloads.length === 1, 'lesson: top button produced ' + downloads.length + ' downloads');
    if (downloads[0]) {
      const lines = downloads[0].text.split('\n');
      check(lines[0] === '#separator:Tab', 'lesson: bad header line 1');
      const rows = lines.slice(3).filter(Boolean);
      check(rows.length === nCards, 'lesson: exported ' + rows.length + ' rows, expected ' + nCards);
      console.log('  lesson page: 2 buttons, top click exported ' + rows.length + ' cards -> ' + downloads[0].name);
    }
    downloads.length = 0;
    btns[1].click();
    check(downloads.length === 1, 'lesson: bottom button did not export');
    console.log('  lesson page: bottom button works too');
  }
  // the in-deck export button still works
  const inDeck = w.document.querySelector('.anki-controls .export');
  check(!!inDeck, 'lesson: the in-deck Export button disappeared');
}

// ---------------------------------------------------------------- HUB
{
  const doneSlugs = ['alphabet', 'tea', 'kitchen'];
  const { w, downloads } = boot('index.html', { done: doneSlugs });

  const cards = w.document.querySelectorAll('.card');
  check(cards.length === w.LESSONS.length,
    'hub: rendered ' + cards.length + ' cards, expected ' + w.LESSONS.length);

  const dls = w.document.querySelectorAll('.dl');
  check(dls.length === w.LESSONS.length, 'hub: ' + dls.length + ' download buttons, expected one per card');

  // per-card download must NOT navigate
  const before = w.location.href;
  dls[0].click();
  check(w.location.href === before, 'hub: clicking the card download navigated away');
  check(downloads.length === 1, 'hub: per-card download produced ' + downloads.length + ' files');
  if (downloads[0]) {
    const rows = downloads[0].text.split('\n').slice(3).filter(Boolean);
    const firstSlug = w.LESSONS[0].slug;
    check(rows.length === w.DECKS[firstSlug].cards.length, 'hub: per-card export has the wrong card count');
    const decks = new Set(rows.map(r => r.split('\t')[2]));
    check(decks.size === 1, 'hub: a single lesson export should contain exactly one deck');
    console.log('  hub: per-card button exported ' + rows.length + ' cards, no navigation');
  }

  // collective export reflects exactly the finished lessons
  downloads.length = 0;
  const btn = w.document.getElementById('bulkBtn');
  check(btn && !btn.disabled, 'hub: bulk button should be enabled with 3 lessons done');
  const what = w.document.getElementById('bulkWhat').textContent;
  check(/3 finished lessons/.test(what), 'hub: bulk label wrong: ' + what);
  btn.click();
  check(downloads.length === 1, 'hub: bulk export produced ' + downloads.length + ' files');
  if (downloads[0]) {
    const rows = downloads[0].text.split('\n').slice(3).filter(Boolean);
    const decks = [...new Set(rows.map(r => r.split('\t')[2]))];
    check(decks.length === 3, 'hub: bulk export has ' + decks.length + ' decks, expected 3');
    // Expected = UNIQUE fronts, not the naive sum: a word deliberately taught in two
    // lessons (e.g. "der Wasserhahn" in both tea and kitchen) is exported once, so Anki
    // doesn't create a duplicate note. Compute the same way the exporter does.
    const uniq = new Set();
    doneSlugs.forEach(s => w.DECKS[s].cards.forEach(c => uniq.add(c.f)));
    check(rows.length === uniq.size, 'hub: bulk rows ' + rows.length + ' != unique ' + uniq.size);
    const naive = doneSlugs.reduce((n, s) => n + w.DECKS[s].cards.length, 0);
    check(naive > uniq.size, 'hub: this fixture should exercise dedup (naive ' + naive + ')');
    console.log('  hub: dedup verified — ' + naive + ' cards across the 3 decks, ' +
                uniq.size + ' unique exported');
    check(decks.every(d => d.startsWith('Deutsch::')), 'hub: bulk decks not under Deutsch::');
    console.log('  hub: bulk exported ' + rows.length + ' cards across ' + decks.length + ' decks');
    console.log('        decks: ' + decks.join(' | '));
  }
}

// ---------------------------------------------------------------- HUB, nothing done
{
  const { w } = boot('index.html', { done: [] });
  const btn = w.document.getElementById('bulkBtn');
  check(btn.disabled, 'hub: bulk button must be disabled when no lesson is finished');
  const what = w.document.getElementById('bulkWhat').textContent;
  check(/Finish a lesson/.test(what), 'hub: empty-state message wrong: ' + what);
  console.log('  hub: empty state disables the bulk button correctly');
}

// ---------------------------------------------------------------- REVISION
{
  const { w, downloads } = boot('revision.html');
  const btn = w.document.getElementById('exportAll');
  check(!!btn, 'revision: export-all button missing');
  btn.click();
  check(downloads.length === 1, 'revision: export produced ' + downloads.length + ' files');
  if (downloads[0]) {
    const rows = downloads[0].text.split('\n').slice(3).filter(Boolean);
    const decks = new Set(rows.map(r => r.split('\t')[2]));
    check(decks.size === w.LESSONS.length,
      'revision: exported ' + decks.size + ' decks, expected ' + w.LESSONS.length);
    console.log('  revision: exported ' + rows.length + ' cards across ' + decks.size + ' decks');
  }
}

console.log('');
if (fails.length) {
  console.log('FAILURES (' + fails.length + '):');
  fails.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log('ALL DOM TESTS PASSED');
