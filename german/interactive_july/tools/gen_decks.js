/* Generate decks.js — every lesson's Anki deck, extracted from its own PAGE block.
 *
 * The lesson HTML files remain the single source of truth for their cards; this script
 * just lifts them into one shared file so the hub and the revision page can offer
 * "export everything you've finished" without fetching and parsing 57 HTML documents.
 * Re-run it whenever a lesson's anki[] changes.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

global.window = {};
require(path.join(ROOT, 'lessons.js'));
const LESSONS = global.window.LESSONS;

const out = {};
for (const L of LESSONS) {
  const src = fs.readFileSync(path.join(ROOT, L.file), 'utf8');
  const m = src.match(/window\.PAGE\s*=\s*([\s\S]*?);\s*\nEngine\.init\(\);/);
  if (!m) throw new Error('no PAGE block in ' + L.file);
  const ctx = { window: {} };
  vm.createContext(ctx);
  vm.runInContext('window.PAGE=' + m[1] + ';', ctx);
  const p = ctx.window.PAGE;
  if (p.slug !== L.slug) throw new Error('slug mismatch in ' + L.file);
  if (!p.anki || !p.anki.length) throw new Error('no cards in ' + L.file);
  out[L.slug] = { deck: p.ankiDeck || ('DE · ' + L.title), cards: p.anki };
}

const lines = [];
lines.push('/* German Study — every lesson\'s Anki deck in one place.');
lines.push(' *');
lines.push(' * AUTO-GENERATED from the lesson files\' own window.PAGE blocks. Do not hand-edit:');
lines.push(' * add or change cards in the lesson HTML, then re-run the generator.');
lines.push(' *');
lines.push(' * Why this file exists: a lesson\'s deck used to live only inside its own page, so');
lines.push(' * the hub had no way to offer "export everything I\'ve finished" without fetching and');
lines.push(' * parsing every lesson. Keyed by the permanent slug, same as lessons.js.');
lines.push(' *   DECKS[slug] = { deck: "<deck name>", cards: [{f, b, ex?}, ...] }');
lines.push(' */');
lines.push('window.DECKS = {');
const slugs = Object.keys(out);
slugs.forEach((slug, i) => {
  const d = out[slug];
  lines.push('  ' + JSON.stringify(slug) + ': {');
  lines.push('    deck: ' + JSON.stringify(d.deck) + ',');
  lines.push('    cards: [');
  lines.push(d.cards.map((c) => '      ' + JSON.stringify(c)).join(',\n'));
  lines.push('    ]');
  lines.push('  }' + (i === slugs.length - 1 ? '' : ','));
});
lines.push('};');
lines.push('');

fs.writeFileSync(path.join(ROOT, 'decks.js'), lines.join('\n'));

const total = slugs.reduce((n, s) => n + out[s].cards.length, 0);
console.log('wrote decks.js:', slugs.length, 'decks,', total, 'cards');
