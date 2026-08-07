/* Drive a real lesson's check-off to a PASS in a real DOM and assert the celebration fires
 * exactly once, does not fire on a reload of an already-done lesson, and is suppressed under
 * prefers-reduced-motion. Also asserts it can never break the lesson or block clicks.
 */
const { JSDOM, VirtualConsole } = require('/tmp/domtest/node_modules/jsdom');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let fails = [];
const check = (c, m) => { if (!c) fails.push(m); };

function boot(file, { done = false, reduceMotion = false } = {}) {
  let html = fs.readFileSync(path.join(ROOT, file), 'utf8');
  html = html.replace(/<script src="([^"]+)"><\/script>/g, (m, src) => {
    if (/^https?:/.test(src)) return m;
    const p = path.join(ROOT, src);
    return fs.existsSync(p) ? '<script>\n' + fs.readFileSync(p, 'utf8') + '\n</script>'
                            : '<script></script>';
  });

  const store = { 'de.__user': 'm', 'de.__token': 't' };   // sync DISABLED: pure local
  // Seed BEFORE the page scripts run — setting it after boot is too late, the engine has
  // already rendered from an empty store.
  if (done) store['de.koerper.done'] = JSON.stringify('1');
  const vc = new VirtualConsole();
  const errors = [];
  vc.on('jsdomError', e => errors.push(e.message));

  const dom = new JSDOM(html, {
    runScripts: 'dangerously', url: 'http://localhost/' + file,
    pretendToBeVisual: true,            // gives us requestAnimationFrame
    virtualConsole: vc,
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
      w.matchMedia = q => ({
        matches: reduceMotion && /reduce/.test(q),
        addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){},
      });
      // jsdom has no canvas backend; stub just enough for the confetti loop to run.
      w.HTMLCanvasElement.prototype.getContext = function () {
        return { setTransform(){}, clearRect(){}, save(){}, restore(){},
                 translate(){}, rotate(){}, fillRect(){}, set fillStyle(v){}, set globalAlpha(v){} };
      };
    },
  });
  return { dom, w: dom.window, store, errors };
}

// Answer every check-off question correctly until the block reports done.
function passCheckoff(w) {
  const box = w.document.querySelector('#checkoff-mount');
  for (let guard = 0; guard < 60; guard++) {
    if (box.querySelector('.co-badge')) return true;     // passed
    const opts = [...box.querySelectorAll('.opt')];
    const input = box.querySelector('.typed input');
    if (opts.length) {
      // PAGE holds the answers; find the option whose text matches.
      const q = box.querySelector('.q').textContent;
      const item = w.PAGE.checkoff.items.find(i => box.querySelector('.q').innerHTML.includes(i.q) ||
                                                   i.q.replace(/<[^>]+>/g,'') === q);
      const answers = item ? [].concat(item.answer) : [];
      const hit = opts.find(o => answers.some(a =>
        String(a).toLowerCase().trim() === o.dataset.val.toLowerCase().trim()));
      (hit || opts[0]).click();
    } else if (input) {
      const q = box.querySelector('.q').textContent;
      const item = w.PAGE.checkoff.items.find(i => i.q.replace(/<[^>]+>/g,'') === q);
      input.value = item ? [].concat(item.answer)[0] : '';
      box.querySelector('.typed .btn').click();
    } else return false;
    const next = box.querySelector('.ex-nav .btn');
    if (next && !next.disabled) next.click();
  }
  return !!box.querySelector('.co-badge');
}

const settle = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  // ---------- 1. passing a check-off celebrates ----------
  {
    const { w, store, errors } = boot('16_body_parts.html');
    await settle(200);
    const passed = passCheckoff(w);
    check(passed, 'celebrate: could not drive the check-off to a pass');
    await settle(120);

    check(store['de.koerper.done'] === JSON.stringify('1'),
      'celebrate: lesson was not actually marked done');
    check(!!w.document.querySelector('canvas.de-confetti'),
      'celebrate: no confetti canvas was created');
    check(w.document.querySelectorAll('.de-letter').length > 3,
      'celebrate: the title letters were not split for the wave');
    check(w.document.querySelector('.wrap').classList.contains('de-party'),
      'celebrate: the page tilt class was not applied to .wrap');
    check(!w.document.body.classList.contains('de-party'),
      'celebrate: the tilt must NOT be on <body> — it would break the fixed confetti canvas');

    const cv = w.document.querySelector('canvas.de-confetti');
    check(/pointer-events:\s*none/.test(cv.style.cssText),
      'celebrate: the confetti canvas must be click-through');
    check(Number(cv.style.zIndex) >= 999, 'celebrate: confetti should sit above the page');
    check(errors.length === 0, 'celebrate: page errors: ' + errors.join('; '));

    // the title still reads the same after being split into letters
    const h1 = w.document.querySelector('h1 .de');
    check(h1.textContent.trim().length > 3, 'celebrate: the title text was lost');
    console.log('  pass -> confetti + ' + w.document.querySelectorAll('.de-letter').length +
                ' dancing letters + page tilt; title intact');
  }

  // ---------- 2. reloading an already-done lesson does NOT celebrate ----------
  {
    const { w } = boot('16_body_parts.html', { done: true });
    await settle(250);
    check(!!w.document.querySelector('.co-badge'), 'reload: lesson should render as done');
    check(!w.document.querySelector('canvas.de-confetti'),
      'reload: confetti fired again on an already-done lesson');
    check(!w.document.querySelector('.wrap').classList.contains('de-party'),
      'reload: page tilt fired again on an already-done lesson');
    console.log('  reload of a done lesson: no confetti, no tilt (correct)');
  }

  // ---------- 3. prefers-reduced-motion suppresses everything ----------
  {
    const { w } = boot('16_body_parts.html', { reduceMotion: true });
    await settle(200);
    passCheckoff(w);
    await settle(120);
    check(!w.document.querySelector('canvas.de-confetti'),
      'reduced-motion: confetti must not run');
    check(!w.document.querySelector('.wrap').classList.contains('de-party'),
      'reduced-motion: page tilt must not run');
    check(w.document.querySelectorAll('.de-letter').length === 0,
      'reduced-motion: letters must not be animated');
    console.log('  prefers-reduced-motion: nothing animates (respected)');
  }

  console.log('');
  if (fails.length) {
    console.log('FAILURES (' + fails.length + '):');
    fails.forEach(f => console.log('  - ' + f));
    process.exit(1);
  }
  console.log('ALL CELEBRATION TESTS PASSED');
})();
