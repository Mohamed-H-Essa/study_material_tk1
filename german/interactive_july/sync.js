/* German Study — cross-device sync shim.
 *
 * Included by every page BEFORE _engine.js. It is fully optional and offline-first:
 * if no user is logged in (or the backend is unreachable) it does nothing and the app
 * works purely from localStorage — so the raw files never break.
 *
 * How it works
 *  - login.html stores  de.__user, de.__token, de.__syncurl  in localStorage.
 *  - We wrap localStorage.setItem: any write to a "de.<slug>.*" key also records a
 *    timestamp (de.__ts.<key>) and schedules a debounced push of changed keys.
 *  - On load we pull the user's server state and merge newest-wins into localStorage
 *    BEFORE _engine.init() reads it (this script runs first), so lessons show synced state.
 *
 * State identity is the localStorage key, which is slug-based (de.<slug>.<what>). Reordering
 * or adding videos changes numbers/filenames only — never slugs — so it never disturbs sync.
 * See docs/2026-07-13-deployment-and-sync-design.md.
 */
(function () {
  var LS = window.localStorage;
  var USER = LS.getItem('de.__user');
  var TOKEN = LS.getItem('de.__token');
  var URL = LS.getItem('de.__syncurl');

  // Public namespace (status pill, logout, manual sync).
  var Sync = (window.Sync = {
    enabled: !!(USER && TOKEN && URL),
    user: USER,
    status: 'idle',
    // Set true once the initial pull has finished (or timed out / been skipped).
    // Consumers use Sync.ready(cb) below rather than reading this directly.
    initialized: false,
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
  function tsKey(k) { return 'de.__ts.' + k; }

  // ---- wrap setItem so every engine write is timestamped + queued ----
  var rawSet = LS.setItem.bind(LS);
  var dirty = {};
  var pushTimer = null;
  LS.setItem = function (k, v) {
    rawSet(k, v);
    if (isDataKey(k)) {
      rawSet(tsKey(k), String(Date.now()));
      dirty[k] = true;
      if (Sync.enabled) schedulePush();
    }
  };

  function collectChanges(keys) {
    var changes = {};
    keys.forEach(function (k) {
      var raw = LS.getItem(k);
      if (raw == null) return;
      var val;
      try { val = JSON.parse(raw); } catch (e) { val = raw; }
      var t = Number(LS.getItem(tsKey(k))) || Date.now();
      changes[k] = { v: val, t: t };
    });
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
      // keepalive lets a push outlive the page. Without it the browser cancels the request
      // when you navigate away, silently losing a just-earned ✓ (see pushNow/flush below).
      keepalive: !!keepalive,
      body: JSON.stringify(Object.assign({ action: action, user: USER, token: TOKEN }, extra)),
    }).then(function (r) { return r.json(); });
  }

  function applyServerState(state) {
    if (!state) return false;
    var changed = false;
    Object.keys(state).forEach(function (k) {
      if (!isDataKey(k)) return;
      var entry = state[k];
      if (!entry || typeof entry !== 'object') return;
      var localT = Number(LS.getItem(tsKey(k))) || 0;
      if (Number(entry.t) > localT) {
        rawSet(k, typeof entry.v === 'string' ? entry.v : JSON.stringify(entry.v));
        rawSet(tsKey(k), String(entry.t));
        changed = true;
      }
    });
    return changed;
  }

  // Self-heal: queue any local progress the server doesn't have (or has an older copy of).
  //
  // Historically a push could die with the page (see the flush notes below), leaving a lesson
  // ✓ done in this browser but absent from the server — invisible on every other device. The
  // pull merge alone never repairs that: it only copies server→local, never local→server.
  // So after the first pull we walk local data keys and re-queue anything newer than (or
  // missing from) the server's copy. Same newest-wins rule as everywhere else, so this can
  // never clobber fresher progress made on another device.
  function queueUnsyncedLocal(serverState) {
    var state = serverState || {};
    Object.keys(LS).forEach(function (k) {
      if (!isDataKey(k)) return;
      var localT = Number(LS.getItem(tsKey(k))) || 0;
      if (!localT) return;                 // never written through the wrapper; nothing to date it by
      var remote = state[k];
      if (!remote || localT > Number(remote.t)) dirty[k] = true;
    });
    if (Object.keys(dirty).length) schedulePush();
  }

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
    dirty = {};
    setStatus('syncing');
    post('push', { changes: collectChanges(keys) }, keepalive)
      .then(function (res) {
        if (res && res.ok) { applyServerState(res.state); setStatus('synced'); }
        else if (res && /token/.test(res.error || '')) Sync.logout();
        else { keys.forEach(function (k) { dirty[k] = true; }); setStatus('offline'); }
      })
      .catch(function () { keys.forEach(function (k) { dirty[k] = true; }); setStatus('offline'); });
  }

  // ---- initial pull+merge, synchronously before the engine reads state ----
  // We block just long enough to merge; if it fails we proceed with local state.
  Sync.pullThen = function (done) {
    if (!Sync.enabled) { done && done(); return; }
    setStatus('syncing');
    var finished = false;
    var t = setTimeout(function () { if (!finished) { finished = true; setStatus('offline'); done && done(); } }, 4000);
    post('pull', {})
      .then(function (res) {
        if (finished) return;
        finished = true; clearTimeout(t);
        if (res && res.ok) {
          applyServerState(res.state);
          queueUnsyncedLocal(res.state);   // repair anything a lost push stranded locally
          setStatus('synced');
        }
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
  // Pages must not render done-state / decks until the initial pull has merged, or they
  // paint stale local state and never repaint (the sync race). Sync.ready(cb) runs cb once
  // the initial pull has settled — succeeded, failed, timed out, or (if sync is disabled)
  // right away. Callers registered after readiness fire immediately.
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
  // This is the moment progress used to get lost: passing a check-off queues a debounced push,
  // and clicking straight back to the hub unloaded the page before the 2s timer fired. The old
  // beforeunload flush issued a normal fetch, which the browser cancels on unload — so the ✓
  // lived in localStorage but never reached the server, and other devices never saw it.
  //
  // Two things make the flush actually land:
  //  - keepalive:true, so the request survives the page being torn down;
  //  - visibilitychange (hidden), which — unlike beforeunload — reliably fires on mobile and
  //    on tab close/switch. pagehide covers bfcache navigations.
  // pushNow() clears `dirty` up front, so overlapping triggers can't double-send.
  function flush() { if (Object.keys(dirty).length) pushNow(true); }
  window.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') flush();
  });
  window.addEventListener('pagehide', flush);
  window.addEventListener('beforeunload', flush);

  // Kick off the pull immediately. When it settles (merge done, or offline/timeout), release
  // any renders waiting on Sync.ready(). If sync is disabled, we're ready at once with local
  // state. A hard 5s backstop guarantees the page never hangs even if pullThen misbehaves.
  if (!Sync.enabled) {
    markReady();
  } else {
    setTimeout(markReady, 5000); // backstop; pullThen's own 4s timeout normally fires first
    Sync.pullThen(markReady);
  }
})();
