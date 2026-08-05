/* Shared engine for German CI study files.
   A page defines: window.PAGE = {slug, ankiDeck, anki:[...], trainers:[...], checkoff:{...}}
   Then calls Engine.init(). Everything below is generic. */

const Engine = (() => {
  const $ = (s, r=document) => r.querySelector(s);
  const el = (t, cls, html) => { const e=document.createElement(t); if(cls)e.className=cls; if(html!=null)e.innerHTML=html; return e; };
  const shuffle = a => { a=a.slice(); for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];} return a; };
  let SLUG='';
  const key = s => 'de.'+SLUG+'.'+s;
  const load = (s,d) => { try{const v=localStorage.getItem(key(s));return v==null?d:JSON.parse(v);}catch(e){return d;} };
  const save = (s,v) => { try{localStorage.setItem(key(s),JSON.stringify(v));}catch(e){} };
  const norm = s => String(s).toLowerCase().trim().replace(/\s+/g,' ').replace(/[.!?]$/,'');
  const strip = s => String(s).replace(/<[^>]+>/g,'');

  /* ---------- ANKI ---------- */
  function anki(mount, deckName, cards){
    const box = el('div','anki');
    let idx = 0, showing = false;
    const ease = load('anki', {});           // {front: ease 1..3}
    const order = () => {                     // due first: again(1) before hard(2) before good(3) before new
      const scored = cards.map((c,i)=>({c,i,e:ease[c.f]||0}));
      return scored.sort((a,b)=> (a.e-b.e) || (a.i-b.i)).map(x=>x.c);
    };
    let seq = order();
    function remaining(){ return cards.filter(c=>(ease[c.f]||0)<3).length; }

    function render(){
      box.innerHTML='';
      const top = el('div','anki-top');
      top.innerHTML = `<span>🃏 ${deckName}</span><span>${cards.length-remaining()}/${cards.length} mastered</span>`;
      box.appendChild(top);

      if(remaining()===0){
        box.appendChild(el('div','anki-done','✓ Deck mastered. <span style="color:#8b93a7">Nice.</span>'));
      } else {
        const card = seq[idx % seq.length];
        const cel = el('div','anki-card');
        cel.innerHTML = `<div class="anki-front" lang="de">${card.f}</div>`+
          (card.hint?`<div class="anki-hint">${card.hint}</div>`:'')+
          (showing?`<div class="anki-back"><span lang="de">${card.b}</span>${card.ex?`<div class="ex" lang="de">${card.ex}</div>`:''}</div>`:`<div class="anki-hint">tap to flip</div>`);
        cel.onclick = ()=>{ showing=!showing; render(); };
        box.appendChild(cel);
        if(showing){
          const rate = el('div','anki-rate');
          rate.innerHTML = `<button class="again">Again</button><button class="hard">Hard</button><button class="good">Good</button>`;
          rate.children[0].onclick=()=>grade(card,1);
          rate.children[1].onclick=()=>grade(card,2);
          rate.children[2].onclick=()=>grade(card,3);
          box.appendChild(rate);
        }
      }
      const ctr = el('div','anki-controls');
      ctr.innerHTML = `<button class="reset">↺ Reset deck</button><button class="export">⬇ Export for Anki (TSV)</button>`;
      ctr.children[0].onclick=()=>{ Object.keys(ease).forEach(k=>delete ease[k]); save('anki',ease); seq=order(); idx=0; showing=false; render(); };
      ctr.children[1].onclick=()=>exportTSV(deckName,cards);
      box.appendChild(ctr);
    }
    function grade(card,e){ ease[card.f]=e; save('anki',ease); showing=false; idx++; if(idx%cards.length===0){seq=order();idx=0;} render(); }
    render();
    mount.appendChild(box);
  }

  /* ---------- Anki export ----------
     Output is a tab-separated file with Anki's import header directives (2.1.54+):
       #separator:Tab   the delimiter
       #html:true       so the <br>/<i> we put in the back render as HTML, not literal text
       #deck column:3   column 3 names the destination deck  ("A::B" nests as a subdeck)
     Front and back are columns 1-2. When `deckName` is a plain string every row gets that
     same deck; the multi-deck export instead passes a per-card deck (see exportDecks). */

  // A field must never contain a tab or newline or it would break the column layout.
  const field = s => String(s == null ? '' : s).replace(/[\t\r\n]+/g, ' ').trim();
  const back = c => c.b + (c.ex ? '<br><i>' + c.ex + '</i>' : '');
  // Anki reads "::" as deck nesting ("Deutsch::16 · Body" = subdeck "16 · Body" of "Deutsch").
  // We DO want that, so split on it, clean each segment, and rejoin — a stray "::" inside a
  // lesson title becomes an em dash instead of silently creating an extra nesting level.
  const deckPath = s => String(s || 'Deck')
    .split('::')
    .map(part => part.replace(/:+/g, '—').replace(/[\t\r\n]+/g, ' ').trim())
    .filter(Boolean)
    .join('::') || 'Deck';

  function download(filename, text){
    const blob = new Blob([text], {type:'text/tab-separated-values;charset=utf-8'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    // Chrome needs the object URL to outlive the click; release it on the next tick.
    setTimeout(()=>URL.revokeObjectURL(a.href), 0);
  }

  function tsvHeader(){
    return ['#separator:Tab', '#html:true', '#deck column:3'].join('\n') + '\n';
  }

  // groups: [{deck:"<name>", cards:[{f,b,ex}]}, ...] -> one file, one deck per row.
  // Cards with a front already seen are skipped: the same word is deliberately taught in
  // more than one lesson, but importing it twice would create duplicate notes in Anki.
  function buildTSV(groups){
    const seen = new Set();
    const rows = [];
    for (const g of groups){
      const deck = deckPath(g.deck);
      for (const c of (g.cards||[])){
        const f = field(c.f);
        if (!f || seen.has(f)) continue;
        seen.add(f);
        rows.push(f + '\t' + field(back(c)) + '\t' + deck);
      }
    }
    return { text: tsvHeader() + rows.join('\n') + '\n', count: rows.length };
  }

  const safeName = s => (s||'deck').replace(/[^\wÀ-ɏ]+/g,'_').replace(/^_+|_+$/g,'') || 'deck';

  // One lesson's deck.
  function exportTSV(deckName, cards){
    const { text } = buildTSV([{deck: deckName, cards}]);
    download(safeName(deckName) + '.txt', text);
  }

  // Many decks in a single file, each row carrying its own deck name.
  // Returns how many unique cards were written, so callers can report it.
  function exportDecks(filename, groups){
    const { text, count } = buildTSV(groups);
    download(safeName(filename) + '.txt', text);
    return count;
  }

  /* ---------- TRAINER (long, repeating, explains wrongs) ---------- */
  function trainer(mount, cfg){
    // cfg: {id,title,kind,items:[{q,sub,type:'mc'|'type',opts?,answer,why}], repeat?}
    const box = el('div','ex-block');
    let pool = buildPool(cfg);
    let pos = 0, correct = 0, answered = false;

    function buildPool(cfg){
      let items = cfg.items.slice();
      if(cfg.shuffle!==false) items = shuffle(items);
      const reps = cfg.repeat || 1;
      let out = [];
      for(let r=0;r<reps;r++) out = out.concat(cfg.shuffle!==false? shuffle(cfg.items): cfg.items);
      return out;
    }

    function render(){
      box.innerHTML='';
      const head = el('div','ex-head');
      head.innerHTML = `<div><div class="ex-title">${cfg.title}</div><div class="ex-kind">${cfg.kind||'Training'} · make the mistake till it sticks</div></div><div class="ex-prog">${Math.min(pos+1,pool.length)} / ${pool.length}</div>`;
      box.appendChild(head);
      const pb = el('div','progbar'); const pf=el('div','progfill'); pf.style.width=(pos/pool.length*100)+'%'; pb.appendChild(pf); box.appendChild(pb);

      if(pos>=pool.length){ return results(); }
      const it = pool[pos];
      box.appendChild(el('div','q', it.q));
      if(it.sub) box.appendChild(el('div','qsub', it.sub));

      const fb = el('div','fb');
      if(it.type==='type'){
        const wrap = el('div','typed');
        const inp = el('input'); inp.setAttribute('lang','de'); inp.setAttribute('autocomplete','off'); inp.setAttribute('autocapitalize','off'); inp.setAttribute('spellcheck','false');
        const go = el('button','btn primary','Check');
        wrap.appendChild(inp); wrap.appendChild(go); box.appendChild(wrap); box.appendChild(fb);
        const check=()=>{ if(answered) return; const ok = arr(it.answer).some(a=>norm(a)===norm(inp.value)); mark(ok,it,fb,()=>{inp.classList.add(ok?'right':'wrong');inp.disabled=true;go.disabled=true;}); };
        go.onclick=check; inp.addEventListener('keydown',e=>{if(e.key==='Enter')answered?next():check();}); inp.focus();
      } else {
        const opts = el('div','opts'+(it.opts.length<=2?' two':''));
        const shuffled = it.shuffle===false? it.opts : shuffle(it.opts);
        shuffled.forEach((o,i)=>{
          const b = el('button','opt'); b.setAttribute('lang','de'); b.dataset.val = strip(o);
          b.innerHTML = `<span class="k">${i+1}</span><span>${o}</span>`;
          b.onclick=()=>{ if(answered) return; const ok = arr(it.answer).some(a=>norm(a)===norm(o));
            mark(ok,it,fb,()=>{ [...opts.children].forEach(c=>c.classList.add('disabled'));
              b.classList.add(ok?'right':'wrong');
              if(!ok)[...opts.children].forEach(c=>{ if(arr(it.answer).some(a=>norm(a)===norm(c.dataset.val))) c.classList.add('right'); }); }); };
          opts.appendChild(b);
        });
        box.appendChild(opts); box.appendChild(fb);
      }
      const nav = el('div','ex-nav');
      const next = el('button','btn primary','Next →'); next.disabled=true; next.onclick=()=>gonext();
      nav.appendChild(el('span','')); nav.appendChild(next);
      box.appendChild(nav);
      box._next = next;
    }
    function mark(ok,it,fb,decorate){
      answered=true; decorate(); if(ok)correct++;
      fb.className='fb '+(ok?'ok':'no');
      fb.innerHTML = (ok?'✓ Richtig. ':'✗ Nicht ganz. ') + (it.why?`<span class="why">${it.why}</span>`:'');
      if(box._next) box._next.disabled=false;
    }
    function gonext(){ pos++; answered=false; render(); }
    function next(){ if(box._next && !box._next.disabled) gonext(); }
    function results(){
      const pct = Math.round(correct/pool.length*100);
      const r = el('div','ex-result');
      r.innerHTML = `<div class="ex-score">${correct}<span class="of"> / ${pool.length}</span></div>
        <div class="ex-msg">${pct>=80?'Solid.':pct>=50?'Getting there — run it again.':'Keep drilling, that\'s the point.'}</div>`;
      const again = el('button','btn primary','↻ Run again'); again.onclick=()=>{ pool=buildPool(cfg); pos=0; correct=0; answered=false; render(); };
      r.appendChild(again); box.appendChild(r);
    }
    render(); mount.appendChild(box);
  }

  /* ---------- CHECK-OFF (short; passing marks file done) ---------- */
  function checkoff(mount, cfg){
    // cfg: {intro, pass (fraction, default .8), items:[...same shape...]}
    const box = el('div','checkoff');
    const passFrac = cfg.pass || 0.8;
    let pos=0, correct=0, answered=false;
    const items = cfg.items;

    function header(){ const h=el('h2',null,'✅ Check-off: '+(cfg.title||'Do I know this?')); box.appendChild(h);
      box.appendChild(el('div','co-sub', cfg.intro||'A few quick, repeat-flavoured questions. Pass to mark this video ✓ done on the hub.')); }

    function render(){
      box.innerHTML=''; header();
      if(load('done',0)==='1' || load('done',0)===1){
        return renderDone();
      }
      const pb=el('div','progbar'); const pf=el('div','progfill'); pf.style.width=(pos/items.length*100)+'%'; pb.appendChild(pf); box.appendChild(pb);
      if(pos>=items.length) return grade();
      const it=items[pos];
      box.appendChild(el('div','q',it.q));
      if(it.sub) box.appendChild(el('div','qsub',it.sub));
      const fb=el('div','fb');
      if(it.type==='type'){
        const wrap=el('div','typed'); const inp=el('input'); inp.setAttribute('lang','de'); inp.setAttribute('spellcheck','false'); const go=el('button','btn primary','Check');
        wrap.appendChild(inp); wrap.appendChild(go); box.appendChild(wrap); box.appendChild(fb);
        const check=()=>{ if(answered)return; const ok=arr(it.answer).some(a=>norm(a)===norm(inp.value)); mk(ok,it,fb,()=>{inp.classList.add(ok?'right':'wrong');inp.disabled=true;go.disabled=true;}); };
        go.onclick=check; inp.addEventListener('keydown',e=>{if(e.key==='Enter')answered?nx():check();}); inp.focus();
      } else {
        const opts=el('div','opts'+(it.opts.length<=2?' two':''));
        shuffle(it.opts).forEach((o,i)=>{ const b=el('button','opt'); b.setAttribute('lang','de'); b.dataset.val=strip(o); b.innerHTML=`<span class="k">${i+1}</span><span>${o}</span>`;
          b.onclick=()=>{ if(answered)return; const ok=arr(it.answer).some(a=>norm(a)===norm(o));
            mk(ok,it,fb,()=>{[...opts.children].forEach(c=>c.classList.add('disabled')); b.classList.add(ok?'right':'wrong');
              if(!ok)[...opts.children].forEach(c=>{ if(arr(it.answer).some(a=>norm(a)===norm(c.dataset.val))) c.classList.add('right'); }); }); };
          opts.appendChild(b); });
        box.appendChild(opts); box.appendChild(fb);
      }
      const nav=el('div','ex-nav'); const next=el('button','btn primary','Next →'); next.disabled=true; next.onclick=()=>nx();
      nav.appendChild(el('span','')); nav.appendChild(next); box.appendChild(nav); box._next=next;
    }
    function mk(ok,it,fb,dec){ answered=true; dec(); if(ok)correct++; fb.className='fb '+(ok?'ok':'no');
      fb.innerHTML=(ok?'✓ ':'✗ ')+(it.why?`<span class="why">${it.why}</span>`:(ok?'Richtig.':'Not quite.')); if(box._next)box._next.disabled=false; }
    function nx(){ pos++; answered=false; render(); }
    function grade(){
      const pass = correct/items.length >= passFrac;
      if(pass){ save('done','1'); renderDone(true); return; }
      const r=el('div','ex-result');
      r.innerHTML=`<div class="ex-score">${correct}<span class="of"> / ${items.length}</span></div><div class="ex-msg">Not passed yet (need ${Math.ceil(passFrac*items.length)}). Watch again, then retry.</div>`;
      const again=el('button','btn primary','↻ Retry'); again.onclick=()=>{pos=0;correct=0;answered=false;render();}; r.appendChild(again); box.appendChild(r);
    }
    function renderDone(justNow){
      // DONE IS PERMANENT by design — there is deliberately no un-done / reset control. Once a
      // lesson is ✓ it stays ✓ forever, on every device, across refreshes. (See the matching
      // client guard in sync.js and the server's monotonic `done` rule.) You can still re-watch
      // the video and re-run the drills above; this only fixes the ✓ so it can never be lost.
      const d=el('div'); d.style.textAlign='center'; d.style.padding='12px 0';
      d.innerHTML=`<span class="co-badge">✓ Marked done</span>`+
        (justNow?'<div class="ex-msg" style="margin-top:12px">Nice — this shows ✓ on the hub, for good.</div>':'');
      box.appendChild(d);
    }
    render(); mount.appendChild(box);
  }

  const arr = x => Array.isArray(x)?x:[x];

  /* ---------- init ---------- */
  function init(){
    // Gate the first render on the initial cross-device sync so we don't paint stale local
    // state (e.g. an un-mastered Anki deck or an un-done check-off) that never repaints once
    // the server data lands. If sync.js isn't present, render immediately.
    if (window.Sync && typeof window.Sync.ready === 'function') window.Sync.ready(render);
    else render();
  }
  // Standalone "download this lesson's deck" buttons. A lesson page puts
  // <div class="anki-export-mount"></div> wherever it wants one (we use top and bottom);
  // every mount gets the same button, so the deck is always one click away.
  function exportButtons(P){
    const mounts = document.querySelectorAll('.anki-export-mount');
    if(!mounts.length || !P.anki || !P.anki.length) return;
    const deck = P.ankiDeck || 'Deck';
    mounts.forEach(m=>{
      m.innerHTML = '';
      const wrap = el('div','anki-export');
      const b = el('button','anki-export-btn', '⬇ Anki-Deck herunterladen <span class="n">'+P.anki.length+' Karten</span>');
      b.title = 'Download this lesson’s flashcards as an Anki-ready file';
      b.onclick = ()=>{
        exportTSV(deck, P.anki);
        const old = b.innerHTML;
        b.innerHTML = '✓ Heruntergeladen';
        b.classList.add('done');
        setTimeout(()=>{ b.innerHTML = old; b.classList.remove('done'); }, 2200);
      };
      wrap.appendChild(b);
      wrap.appendChild(el('span','anki-export-note','Import into Anki — it lands in its own deck.'));
      m.appendChild(wrap);
    });
  }

  function render(){
    const P = window.PAGE; SLUG = P.slug;
    exportButtons(P);
    if(P.anki && P.anki.length){ const m=$('#anki-mount'); if(m) anki(m, P.ankiDeck||'Deck', P.anki); }
    if(P.trainers){ P.trainers.forEach(t=>{ const m = document.getElementById('trainer-'+t.id); if(m) trainer(m,t); }); }
    if(P.checkoff){ const m=$('#checkoff-mount'); if(m) checkoff(m,P.checkoff); }
    // vim-ish scroll
    let g=0;
    document.addEventListener('keydown',e=>{
      if(/^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)) return;
      if(e.key==='j'){window.scrollBy({top:120,behavior:'smooth'});}
      else if(e.key==='k'){window.scrollBy({top:-120,behavior:'smooth'});}
      else if(e.key==='G'){window.scrollTo({top:document.body.scrollHeight,behavior:'smooth'});}
      else if(e.key==='g'){ if(g){window.scrollTo({top:0,behavior:'smooth'});g=0;}else{g=1;setTimeout(()=>g=0,400);} }
    });
  }
  // Public helper so the Revision hub can bundle every deck into one Anki file.
  function exportAll(deckName, cards){ exportTSV(deckName, cards); }
  // Public: one file containing many decks (used by the hub and the revision page).
  function exportMany(filename, groups){ return exportDecks(filename, groups); }
  // Standalone trainer/checkoff mounts for pages that build their own config (e.g. revision.html)
  function mountTrainer(mount, cfg){ trainer(mount, cfg); }

  return {init, exportAll, exportMany, mountTrainer};
})();
