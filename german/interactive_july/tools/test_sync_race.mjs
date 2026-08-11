// Lost-update regression test. The old Lambda did readState -> mergeAll -> writeState against S3
// with no conditional write, so concurrent pushes silently clobbered each other: with realistic
// S3 latency this test lost 37 of 40 writes. A Durable Object's SYNCHRONOUS read-modify-write
// cannot interleave, so all 40 must survive. If this ever regresses, someone has introduced an
// `await` between reading and writing state in the DO.
//
//   PW_MOHAMED=<pw> node tools/test_sync_race.mjs http://localhost:8788

const URL_ = process.argv[2];
const N = 40;
await fetch(URL_.replace(/\/$/,'') + '/__reset', {method:'POST'}).catch(()=>{});
const login = await (await fetch(URL_, {method:'POST',headers:{'content-type':'application/json'},
  body: JSON.stringify({action:'login',user:'mohamed',pass:process.env.PW_MOHAMED})})).json();
if (!login.token) { console.error('login failed'); process.exit(2); }

const slugs = Array.from({length:N}, (_,i)=>`race${i}`);
await Promise.all(slugs.map(s => fetch(URL_, {
  method:'POST', headers:{'content-type':'application/json'},
  body: JSON.stringify({action:'push',user:'mohamed',token:login.token,cursor:0,
    changes:{[`de.${s}.done`]:{v:'1'}}}),
})));

const final = await (await fetch(URL_, {method:'POST',headers:{'content-type':'application/json'},
  body: JSON.stringify({action:'pull',user:'mohamed',token:login.token,cursor:0})})).json();
const got = slugs.filter(s => final.state[`de.${s}.done`]?.v === '1').length;
console.log(`  concurrent pushes: ${N}`);
console.log(`  survived:          ${got}`);
console.log(`  LOST UPDATES:      ${N-got}`);
console.log(got===N ? '\n  PASS — no lost updates.' : '\n  FAIL — writes were silently dropped.');
process.exit(got===N?0:1);
