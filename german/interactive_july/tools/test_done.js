/* Reproduce the reported bug in a real DOM and prove it is fixed.
 *
 * Scenario: localStorage says a lesson is NOT done (stale), the SERVER says it IS done
 * (the admin just ticked it). The hub must end up showing ✓ done — that is the whole
 * "backend is the source of truth" requirement.
 */
const { JSDOM, VirtualConsole } = require('/tmp/domtest/node_modules/jsdom');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let fails = [];
const check = (c, m) => { if (!c) fails.push(m); };

function boot({ localDone = [], serverDone = [], hidden = [], captureCalls = null } = {}) {
  let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  html = html.replace(/<script src="([^"]+)"><\/script>/g, (m, src) => {
    if (/^https?:/.test(src)) return m;
    const p = path.join(ROOT, src);
    return fs.existsSync(p) ? '<script>\n' + fs.readFileSync(p, 'utf8') + '\n</script>'
                            : '<script></script>';
  });

  const store = {
    'de.__user': 'mohamed', 'de.__token': 't',
    'de.__syncurl': 'https://api.test/api',      // sync ENABLED
    'de.__seq': '500',                            // cursor already far ahead
  };
  localDone.forEach(s => { store['de.' + s + '.done'] = JSON.stringify('1'); });

  const vc = new VirtualConsole();
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', url: 'http://localhost/index.html', virtualConsole: vc,
    beforeParse(w) {
      Object.defineProperty(w, 'localStorage', {
        configurable: true,
        value: {
          getItem: k => (k in store ? store[k] : null),
          setItem: (k, v) => { store[k] = String(v); },
          removeItem: k => { delete store[k]; },
          key: i => Object.keys(store)[i],
          get length() { return Object.keys(store).length; },
        },
      });
      // Fake backend: the server's view of the world.
      w.fetch = (url, opts) => {
        const body = JSON.parse(opts.body);
        if (captureCalls) captureCalls.push(body);
        const state = {};
        serverDone.forEach(s => { state['de.' + s + '.done'] = { v: '1', seq: 600, kind: 'done' }; });
        if (body.action === 'pull' || body.action === 'push') {
          // A DELTA pull (cursor >= 600) returns nothing — this is what made the bug
          // invisible to a normal sync. Only a forced cursor:0 pull returns everything.
          const isFull = Number(body.cursor) === 0;
          return Promise.resolve({ json: () => Promise.resolve({
            ok: true, seq: 600, state: isFull ? state : {}, admin: true, hidden,
          })});
        }
        return Promise.resolve({ json: () => Promise.resolve({ ok: true }) });
      };
      w.__store = store;
    },
  });
  return { dom, w: dom.window, store };
}

const settle = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  // ---------- 1. THE REPORTED BUG ----------
  {
    const calls = [];
    const { w } = boot({ localDone: [], serverDone: ['koerper'], captureCalls: calls });
    await settle(300);

    const card = [...w.document.querySelectorAll('.card')]
      .find(c => c.getAttribute('href') === '16_body_parts.html');
    check(!!card, 'bug: could not find the body-parts card');
    check(card.classList.contains('done'),
      'BUG NOT FIXED: server says done, hub still shows NOT done');

    const tg = card.querySelector('.tg');
    check(tg && /Done/.test(tg.textContent), 'bug: toggle does not read "✓ Done"');

    const full = calls.filter(c => c.action === 'pull' && Number(c.cursor) === 0);
    check(full.length >= 1, 'bug: hub never issued a FULL (cursor:0) pull');
    console.log('  reported bug: server-done + stale local -> hub shows ✓ done  (full pulls: ' +
                full.length + ')');
  }

  // ---------- 2. the reverse: server says NOT done, local wrongly says done ----------
  {
    const { w } = boot({ localDone: ['koerper'], serverDone: [] });
    await settle(300);
    const card = [...w.document.querySelectorAll('.card')]
      .find(c => c.getAttribute('href') === '16_body_parts.html');
    check(!card.classList.contains('done'),
      'admin un-done did not reach the hub (guard blocked an authoritative refresh)');
    console.log('  reverse case: server-not-done overrides a stale local ✓');
  }

  // ---------- 3. the toggle button round-trips to the server ----------
  {
    const calls = [];
    const { w } = boot({ localDone: [], serverDone: [], captureCalls: calls });
    await settle(300);
    const card = [...w.document.querySelectorAll('.card')]
      .find(c => c.getAttribute('href') === '16_body_parts.html');
    const tg = card.querySelector('.tg');
    check(!card.classList.contains('done'), 'toggle: card should start not-done');

    calls.length = 0;
    tg.click();
    await settle(300);

    const push = calls.find(c => c.action === 'push');
    check(!!push, 'toggle: no push was sent to the server');
    if (push) {
      const k = 'de.koerper.done';
      check(push.changes && push.changes[k], 'toggle: push did not include the done key');
      check(push.changes[k].v === '1', 'toggle: push should set v="1"');
      check(push.changes[k].kind === 'done', 'toggle: push should carry kind:done');
      console.log('  toggle ON  -> push ' + JSON.stringify(push.changes[k]));
    }

    // and OFF again — must use the sanctioned clear intent
    calls.length = 0;
    const { w: w2 } = boot({ localDone: ['koerper'], serverDone: ['koerper'], captureCalls: calls });
    await settle(300);
    const card2 = [...w2.document.querySelectorAll('.card')]
      .find(c => c.getAttribute('href') === '16_body_parts.html');
    calls.length = 0;
    card2.querySelector('.tg').click();
    await settle(300);
    const push2 = calls.find(c => c.action === 'push');
    if (push2) {
      const e = push2.changes['de.koerper.done'];
      check(e && e.v === '0' && e.clear === true,
        'toggle OFF must send the sanctioned {clear:true} intent, got ' + JSON.stringify(e));
      console.log('  toggle OFF -> push ' + JSON.stringify(e));
    } else fails.push('toggle: no push on un-done');
  }

  // ---------- 3b. a click must NEVER navigate, whatever it lands on ----------
  // The reported symptom was "clicking done opens the lesson instead". A click can land on
  // the button's inner <span>, and a re-render can replace the element a listener was bound
  // to — so the card-level capture handler, not the button's own, is what must veto it.
  {
    const { w } = boot({ localDone: [], serverDone: [] });
    await settle(300);
    const card = [...w.document.querySelectorAll('.card')]
      .find(c => c.getAttribute('href') === '16_body_parts.html');

    for (const [label, el] of [
      ['button itself', card.querySelector('.tg')],
      ['inner span',    card.querySelector('.tg span')],
      ['anki button',   card.querySelector('.dl')],
      ['acts wrapper',  card.querySelector('.acts')],
    ]) {
      if (!el) { fails.push('nav: missing ' + label); continue; }
      const ev = new w.MouseEvent('click', { bubbles: true, cancelable: true });
      el.dispatchEvent(ev);
      check(ev.defaultPrevented,
        'nav: a click on the ' + label + ' would NAVIGATE to the lesson');
    }
    console.log('  navigation: clicks on button, inner span, anki and wrapper all vetoed');

    // and the overlays must never swallow clicks
    const css = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const overlay = css.slice(css.indexOf('.card.done .thumb::after'), css.indexOf('.card.done .num'));
    check((overlay.match(/pointer-events:none/g) || []).length >= 2,
      'the done-overlays must both be pointer-events:none or they block the buttons');
    console.log('  done-overlays are pointer-events:none (cannot block clicks)');
  }

  // ---------- 3c. the buttons must work on a DONE card ----------
  // This is the exact reported failure: on a finished lesson the green overlay sat above
  // the buttons (it had no pointer-events:none), so every click fell through to the <a>
  // and opened the lesson. Neither the toggle NOR the Anki download worked — but only on
  // done cards, which is what made it look like a toggle-specific bug.
  {
    const calls = [];
    const { w } = boot({ localDone: ['koerper'], serverDone: ['koerper'], captureCalls: calls });
    await settle(300);
    const card = [...w.document.querySelectorAll('.card')]
      .find(c => c.getAttribute('href') === '16_body_parts.html');
    check(card.classList.contains('done'), 'done-card: fixture should start done');

    for (const sel of ['.tg', '.dl', '.tg span']) {
      const el = card.querySelector(sel);
      if (!el) { fails.push('done-card: missing ' + sel); continue; }
      const ev = new w.MouseEvent('click', { bubbles: true, cancelable: true });
      el.dispatchEvent(ev);
      check(ev.defaultPrevented, 'done-card: click on ' + sel + ' would navigate');
    }

    // The probes above fire real clicks, which leave the button mid-flight (`busy`) — the
    // handler deliberately ignores a click while one is in progress. Use a fresh page for
    // the functional half so we are not fighting our own probe.
    const calls2 = [];
    const { w: w3 } = boot({ localDone: ['koerper'], serverDone: ['koerper'], captureCalls: calls2 });
    await settle(300);
    const card3 = [...w3.document.querySelectorAll('.card')]
      .find(c => c.getAttribute('href') === '16_body_parts.html');
    check(card3.classList.contains('done'), 'done-card: fresh fixture should be done');
    calls2.length = 0;
    card3.querySelector('.tg').click();
    await settle(300);
    const push = calls2.find(c => c.action === 'push');
    check(!!push, 'done-card: toggle sent no push');
    if (push) {
      // The card starts done, so this click clears it. What matters here is that a click
      // on a DONE card reaches the server at all — that is what the overlay used to block.
      const e = push.changes['de.koerper.done'];
      check(!!e, 'done-card: push carried no done key');
      check(e && e.v === '0' && e.clear === true,
        'done-card: clearing a done card must send {clear:true}, got ' + JSON.stringify(e));
      console.log('  DONE card: buttons clickable, un-done reaches the server');
    }
  }

  // ---------- 4. the Anki button still works and does not navigate ----------
  {
    const { w } = boot({ localDone: [], serverDone: [] });
    await settle(300);
    const card = w.document.querySelector('.card');
    check(!!card.querySelector('.dl'), 'the Anki button disappeared');
    check(!!card.querySelector('.tg'), 'the toggle button is missing');
    check(!!card.querySelector('.acts'), 'buttons are not wrapped in .acts');
    console.log('  both hover buttons present and wrapped');
  }

  console.log('');
  if (fails.length) {
    console.log('FAILURES (' + fails.length + '):');
    fails.forEach(f => console.log('  - ' + f));
    process.exit(1);
  }
  console.log('ALL DONE-STATE TESTS PASSED');
})();
