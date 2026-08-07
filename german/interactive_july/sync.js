/* German Study — cross-device sync shim.
 *
 * Included by every page BEFORE _engine.js. Fully optional and offline-first: if no user is
 * logged in (or the backend is unreachable) it does nothing and the app runs purely from
 * localStorage — so the raw files never break.
 *
 * How it works
 *  - login.html stores  de.__user, de.__token, de.__syncurl  in localStorage.
 *  - We wrap localStorage.setItem: any write to a "de.<slug>.*" key marks it dirty (with its
 *    kind) and schedules a debounced push. NO client timestamp is recorded — ordering is
 *    server-assigned (see below).
 *  - On load we pull the user's server state (everything newer than our cursor) and apply it
 *    into localStorage BEFORE _engine.init() reads it, so lessons render synced state.
 *
 * Ordering is a SERVER-ASSIGNED sequence, never a client clock. The server owns a monotonic
 * counter (__seq) and stamps every accepted write; the client keeps a `de.__seq` cursor and only
 * receives entries newer than it. This replaces the old "larger client timestamp wins" merge,
 * which let a device with a skewed clock silently overwrite good progress — even on the same
 * device after a pull. Merge rules are semantic and enforced server-side (done = monotonic,
 * anki = per-card forward-only union, other = higher seq wins). See
 * docs/superpowers/specs/2026-07-18-reliable-sync-design.md.
 *
 * State identity is the localStorage key, which is slug-based (de.<slug>.<what>). Reordering or
 * adding videos changes numbers/filenames only — never slugs — so it never disturbs sync.
 */
(function () {
  var LS = window.localStorage;
  var USER = LS.getItem('de.__user');
  var TOKEN = LS.getItem('de.__token');
  var URL = LS.getItem('de.__syncurl');

  var CURSOR_KEY = 'de.__seq';

  // Public namespace (status pill, logout, explicit clear/reset intents).
  var Sync = (window.Sync = {
    enabled: !!(USER && TOKEN && URL),
    user: USER,
    status: 'idle',
    // Set true once the initial pull has finished (or timed out / been skipped).
    // Consumers use Sync.ready(cb) below rather than reading this directly.
    initialized: false,
    // ---- admin / visibility (filled in by the pull response) ----
    // isAdmin: the server says this user may open admin.html.
    // hidden:  slugs the admin has hidden FROM THIS USER. Empty means show everything, which is
    //          exactly how the hub behaved before this feature existed — so a missing or older
    //          backend degrades to "all lessons visible" rather than a blank hub.
    isAdmin: false,
    hidden: [],
    isHidden: function (slug) { return Sync.hidden.indexOf(slug) !== -1; },
    // Authenticated POST for the admin panel (adminGet / adminSet). Rejects when sync is off.
    // adminSet's reply carries the caller's own fresh state, so apply it — otherwise the tab
    // that just changed something keeps showing the old value.
    call: function (action, extra) {
      if (!Sync.enabled) return Promise.reject(new Error('sync disabled'));
      return post(action, extra).then(function (res) {
        if (res && res.ok && res.state) applyServerState(res.state, res.seq);
        return res;
      });
    },

    // Force a FULL re-read from the server, ignoring our cursor, and treat the answer as
    // authoritative. This is the "backend is the source of truth" escape hatch: a delta pull
    // only carries what changed since our cursor, so anything that went stale for another
    // reason (an admin edit made in this very tab, a half-finished earlier sync) would never
    // be corrected. `cb` runs after the state has been applied.
    refresh: function (cb) {
      if (!Sync.enabled) { cb && cb(); return; }
      setStatus('syncing');
      post('pull', { cursor: 0 })
        .then(function (res) {
          if (res && res.ok) {
            applyServerState(res.state, res.seq, /*authoritative=*/true);
            applyAdminFields(res);
            setStatus('synced');
          } else setStatus('offline');
          cb && cb();
        })
        .catch(function () { setStatus('offline'); cb && cb(); });
    },
    logout: function () {
      // Wipe ALL local progress + auth so the next user on this device does not inherit it.
      // (Progress is safe in the cloud under this user's blob; the next login pulls fresh.)
      Object.keys(LS).filter(function (k) { return k.indexOf('de.') === 0; })
        .forEach(function (k) { LS.removeItem(k); });
      location.href = 'login.html';
    },
  });

  // A "de." data key we actually sync (exclude our own internal de.__* bookkeeping).
  function isDataKey(k) { return k && k.indexOf('de.') === 0 && k.indexOf('de.__') !== 0; }

  // kind is intrinsic to the key suffix; the server relies on the same mapping.
  function kindOf(k) {
    if (/\.done$/.test(k)) return 'done';
    if (/\.anki$/.test(k)) return 'anki';
    return 'other';
  }

  function cursor() { return Number(LS.getItem(CURSOR_KEY)) || 0; }
  function setCursor(n) { if (Number(n) > cursor()) rawSet(CURSOR_KEY, String(Number(n))); }

  // ---- wrap setItem so every engine write is queued for push ----
  // `dirty` maps key -> intent {v, kind, clear?, reset?}. Ordinary engine writes produce a plain
  // {v,kind}; explicit clear/reset intents are injected by clearDone()/resetAnki() below.
  var rawSet = LS.setItem.bind(LS);
  var dirty = {};
  var pushTimer = null;

  function queue(k, intent) {
    dirty[k] = intent;
    if (Sync.enabled) schedulePush();
  }

  LS.setItem = function (k, v) {
    rawSet(k, v);
    if (isDataKey(k)) {
      // Don't clobber a richer intent (clear/reset) already queued for this key in this tick.
      var prev = dirty[k];
      if (prev && (prev.clear || prev.reset)) return;
      queue(k, { v: parse(v), kind: kindOf(k) });
    }
  };

  function parse(raw) {
    if (raw == null) return raw;
    try { return JSON.parse(raw); } catch (e) { return raw; }
  }

  // Explicit intents. The engine calls these instead of a bare local write when the user
  // genuinely means to un-done a lesson or reset a deck — the only paths allowed to move a
  // `done` flag backwards. Safe when sync is disabled: they still write locally.
  Sync.clearDone = function (slug) {
    var k = 'de.' + slug + '.done';
    rawSet(k, JSON.stringify('0'));
    queue(k, { v: '0', kind: 'done', clear: true });
  };
  // Mark a lesson done / not-done and push it immediately (no 2s debounce), resolving once
  // the SERVER has accepted it. The hub's per-card toggle uses this, so what you see after
  // it settles is what the backend actually stores — not an optimistic local guess.
  // Un-doning rides the same sanctioned {clear:true} intent as Sync.clearDone.
  Sync.setDone = function (slug, on) {
    var k = 'de.' + slug + '.done';
    rawSet(k, JSON.stringify(on ? '1' : '0'));
    var intent = on ? { v: '1', kind: 'done' } : { v: '0', kind: 'done', clear: true };
    dirty[k] = intent;
    if (!Sync.enabled) return Promise.resolve({ ok: true, local: true });
    var sent = {}; sent[k] = intent;
    delete dirty[k];
    setStatus('syncing');
    return post('push', { changes: sent })
      .then(function (res) {
        if (res && res.ok) {
          // Trust the server's answer for this key rather than our optimistic write.
          applyServerState(res.state, res.seq, /*authoritative=*/true);
          setStatus('synced');
        } else { requeue(sent); setStatus('offline'); }
        return res;
      })
      .catch(function (e) { requeue(sent); setStatus('offline'); throw e; });
  };

  Sync.resetAnki = function (slug, map) {
    var k = 'de.' + slug + '.anki';
    var v = map && typeof map === 'object' ? map : {};
    rawSet(k, JSON.stringify(v));
    queue(k, { v: v, kind: 'anki', reset: true });
  };

  function collectChanges(keys) {
    var changes = {};
    keys.forEach(function (k) { if (dirty[k]) changes[k] = dirty[k]; });
    return changes;
  }

  function schedulePush() {
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(pushNow, 2000);
  }

  function post(action, extra, keepalive) {
    return fetch(URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // keepalive lets a push outlive the page. Without it the browser cancels the request when
      // you navigate away, silently losing a just-earned ✓ (see the flush notes below).
      keepalive: !!keepalive,
      body: JSON.stringify(Object.assign({ action: action, user: USER, token: TOKEN, cursor: cursor() }, extra)),
    }).then(function (r) { return r.json(); });
  }

  // Apply a server delta (entries newer than our cursor) into localStorage. We NEVER overwrite a
  // key that still has an unacknowledged local write pending (it's in `dirty`) — that write will
  // be (re)pushed and the server decides the merge. Everything else is applied verbatim, because
  // the server already resolved ordering by seq. Advances the cursor.
  // A localStorage value that means "done" (the engine writes "1"; JSON-parsed it may be 1).
  function localIsDone(k) {
    var raw = LS.getItem(k);
    if (raw == null) return false;
    var v; try { v = JSON.parse(raw); } catch (e) { v = raw; }
    return v === '1' || v === 1 || v === true;
  }
  function entryIsDone(entry) {
    var v = entry && entry.v;
    return v === '1' || v === 1 || v === true;
  }

  // `authoritative` = this is a deliberate full re-read (Sync.refresh), so the server's
  // answer wins outright. The done-is-permanent guard below exists to stop STALE data from
  // silently un-doing a lesson; a full pull we just asked for is not stale, and honouring it
  // is the whole point of "the backend is the source of truth".
  function applyServerState(state, serverSeq, authoritative) {
    if (state) {
      Object.keys(state).forEach(function (k) {
        if (!isDataKey(k)) return;
        if (dirty[k]) return; // local write not yet acked — don't stomp it
        var entry = state[k];
        if (!entry || typeof entry !== 'object') return;
        // DONE IS PERMANENT. Never let an incoming value revert a locally-done lesson back to
        // not-done — not on refresh, not from any device. Once ✓, it stays ✓. (The server is
        // also monotonic, but this client guard makes the guarantee hold even against a stale
        // delta, an old "0" left in the blob, or a legacy entry.)
        //
        // The ONE sanctioned exception is an explicit admin clear. The server marks such an
        // entry `cleared:true` — it only ever sets that on an `adminSet` un-done, which is a
        // deliberate human action by the admin, not a stale or racing write. Without this the
        // admin's override would apply on every device EXCEPT the ones that already show ✓,
        // i.e. exactly the devices the override is meant to fix.
        if (!authoritative &&
            /\.done$/.test(k) && localIsDone(k) && !entryIsDone(entry) && entry.cleared !== true) return;
        rawSet(k, typeof entry.v === 'string' ? entry.v : JSON.stringify(entry.v));
      });
    }
    // On an authoritative full re-read the server's blob is the COMPLETE picture, so a
    // de.<slug>.* key we hold locally but the server has never heard of is local-only
    // debris (a write that never landed, or state left by an older build). Drop it —
    // otherwise "the backend is the source of truth" would only be half true: we would
    // adopt every value the server HAS, but keep phantom ones it does not.
    // Keys with an unacked local write (dirty) are left alone; they are about to be pushed.
    if (authoritative && state) {
      // Snapshot the key list first — removing while iterating localStorage is unsafe.
      var localKeys = [];
      for (var i = 0; i < LS.length; i++) localKeys.push(LS.key(i));
      localKeys.forEach(function (k) {
        if (!isDataKey(k) || dirty[k] || state[k]) return;
        LS.removeItem(k);
      });
    }
    if (serverSeq != null) setCursor(serverSeq);
    return true;
  }

  // Absorb the admin/visibility fields that pull & push responses carry alongside `state`. Both
  // are optional: an older Lambda omits them and we keep the permissive defaults. They are cached
  // under de.__* keys — NOT de.<slug>.* — so they never enter the synced progress blob, and a
  // cold offline load still paints the same hub the user saw last time.
  function applyAdminFields(res) {
    if (!res) return;
    if (typeof res.admin === 'boolean') {
      Sync.isAdmin = res.admin;
      try { rawSet('de.__admin', res.admin ? '1' : '0'); } catch (e) {}
    }
    if (Array.isArray(res.hidden)) {
      Sync.hidden = res.hidden.slice();
      try { rawSet('de.__hidden', JSON.stringify(Sync.hidden)); } catch (e) {}
    }
  }

  // Seed from the last known values so an offline load doesn't flash the wrong set of cards.
  try {
    Sync.isAdmin = LS.getItem('de.__admin') === '1';
    var cachedHidden = JSON.parse(LS.getItem('de.__hidden') || '[]');
    if (Array.isArray(cachedHidden)) Sync.hidden = cachedHidden;
  } catch (e) {}

  function setStatus(s) {
    Sync.status = s;
    var pill = document.getElementById('sync-pill');
    if (pill) {
      var map = { synced: 'sync ✓', syncing: 'syncing ⏳', offline: 'offline ⚠', idle: '' };
      pill.textContent = map[s] || '';
      pill.dataset.state = s;
    }
  }

  function pushNow(keepalive) {
    if (!Sync.enabled) return;
    if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; }
    var keys = Object.keys(dirty);
    if (!keys.length) return;
    var sent = collectChanges(keys);
    dirty = {};
    setStatus('syncing');
    post('push', { changes: sent }, keepalive)
      .then(function (res) {
        if (res && res.ok) { applyServerState(res.state, res.seq); applyAdminFields(res); setStatus('synced'); }
        else if (res && /token/.test(res.error || '')) Sync.logout();
        else { requeue(sent); setStatus('offline'); }
      })
      .catch(function () { requeue(sent); setStatus('offline'); });
  }

  // Put failed changes back, without clobbering a newer intent queued in the meantime.
  function requeue(sent) {
    Object.keys(sent).forEach(function (k) { if (!dirty[k]) dirty[k] = sent[k]; });
  }

  // ---- initial pull, before the engine reads state ----
  // We block just long enough to apply the delta; if it fails we proceed with local state. The
  // first pull after upgrade has cursor 0, so the server returns the whole blob (self-healing).
  Sync.pullThen = function (done) {
    if (!Sync.enabled) { done && done(); return; }
    setStatus('syncing');
    var finished = false;
    var t = setTimeout(function () { if (!finished) { finished = true; setStatus('offline'); done && done(); } }, 4000);
    post('pull', {})
      .then(function (res) {
        if (finished) return;
        finished = true; clearTimeout(t);
        if (res && res.ok) { applyServerState(res.state, res.seq); applyAdminFields(res); setStatus('synced'); }
        else if (res && /token/.test(res.error || '')) return Sync.logout();
        else setStatus('offline');
        done && done();
      })
      .catch(function () {
        if (finished) return;
        finished = true; clearTimeout(t); setStatus('offline'); done && done();
      });
  };

  // ---- readiness gate ----
  // Pages must not render done-state / decks until the initial pull has applied, or they paint
  // stale local state and never repaint (the sync race). Sync.ready(cb) runs cb once the initial
  // pull has settled — succeeded, failed, timed out, or (if sync is disabled) right away.
  var readyCbs = [];
  function markReady() {
    if (Sync.initialized) return;
    Sync.initialized = true;
    var cbs = readyCbs; readyCbs = [];
    cbs.forEach(function (cb) { try { cb(); } catch (e) {} });
  }
  Sync.ready = function (cb) {
    if (typeof cb !== 'function') return;
    if (Sync.initialized) cb();
    else readyCbs.push(cb);
  };

  // Flush pending writes when leaving the page.
  //
  // This is a moment progress used to get lost: passing a check-off queues a debounced push, and
  // clicking straight back to the hub unloaded the page before the 2s timer fired. A normal fetch
  // is cancelled by the browser on unload — so the ✓ lived in localStorage but never reached the
  // server. Two things make the flush land: keepalive:true (survives teardown) and
  // visibilitychange(hidden), which — unlike beforeunload — reliably fires on mobile and tab
  // close. pagehide covers bfcache navigations. pushNow() empties `dirty` up front, so overlapping
  // triggers can't double-send.
  function flush() { if (Object.keys(dirty).length) pushNow(true); }
  window.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') flush();
  });
  window.addEventListener('pagehide', flush);
  window.addEventListener('beforeunload', flush);

  // Kick off the pull immediately. When it settles, release renders waiting on Sync.ready(). A
  // hard 5s backstop guarantees the page never hangs even if pullThen misbehaves.
  if (!Sync.enabled) {
    markReady();
  } else {
    setTimeout(markReady, 5000); // backstop; pullThen's own 4s timeout normally fires first
    Sync.pullThen(markReady);
  }
})();
