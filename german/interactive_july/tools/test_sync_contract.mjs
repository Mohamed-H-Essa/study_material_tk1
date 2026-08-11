import { CASES } from './sync_contract_cases.mjs';
const URL_ = process.argv[2];
const PW  = process.env.PW_MOHAMED || '123';
const PW2 = process.env.PW_MUSTAFA || '123';
if (!URL_) { console.error('usage: node run.mjs <backend-url>'); process.exit(2); }

async function post(body, method='POST', raw=null) {
  const res = await fetch(URL_, {
    method,
    headers: { 'content-type':'application/json' },
    body: method==='OPTIONS' ? undefined : (raw ?? JSON.stringify(body)),
  });
  const h = {}; res.headers.forEach((v,k)=>h[k.toLowerCase()]=v);
  let j = {}; try { j = await res.json(); } catch {}
  return { j, status: res.status, h };
}

// Fresh token per user.
async function tokens() {
  const a = await post({action:'login',user:'mohamed',pass:PW});
  const b = await post({action:'login',user:'mustafa',pass:PW2});
  return { 1: a.j.token, 2: b.j.token };
}

const T = await tokens();
if (!T[1]) { console.error('could not log in as mohamed — is the password right?'); process.exit(2); }

let pass=0, fail=0; const failures=[];
for (const c of CASES) {
  try { await fetch(URL_.replace(/\/$/,'') + '/__reset', {method:'POST'}); } catch {}
  const saved = {};
  let ok = true, why = '';
  for (const st of c.steps) {
    let body = JSON.parse(JSON.stringify(st.a ?? {}));
    body = JSON.parse(JSON.stringify(body).replace(/"@(\w+)"/g, (m,k)=>saved[k]));
    if (st.auth) body.token = T[st.auth];
    if (body.action && body.pass === 'PW')  body.pass = PW;
    if (body.action && body.pass === 'PW2') body.pass = PW2;
    const r = await post(body, st.method || 'POST', st.raw);
    if (st.save) saved[st.save] = r.j.seq;
    if (st.expect) {
      let got=false; try { got = !!st.expect(r.j, r.status, saved, r.h); } catch(e){ why=String(e); }
      if (!got) { ok=false; why = why || `status=${r.status} body=${JSON.stringify(r.j).slice(0,160)}`; break; }
    }
  }
  if (ok) { pass++; console.log('  PASS ', c.name); }
  else { fail++; failures.push([c.name, why]); console.log('  FAIL ', c.name, '\n         ', why); }
}
console.log(`\n${pass} passed, ${fail} failed, ${CASES.length} total`);
process.exit(fail ? 1 : 0);
