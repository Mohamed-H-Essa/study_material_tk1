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
    logout: function () {
      ['de.__user', 'de.__token', 'de.__syncurl'].forEach(function (k) { LS.removeItem(k); });
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

  function post(action, extra) {
    return fetch(URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
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

  function setStatus(s) {
    Sync.status = s;
    var pill = document.getElementById('sync-pill');
    if (pill) {
      var map = { synced: 'sync ✓', syncing: 'syncing ⏳', offline: 'offline ⚠', idle: '' };
      pill.textContent = map[s] || '';
      pill.dataset.state = s;
    }
  }

  function pushNow() {
    if (!Sync.enabled) return;
    var keys = Object.keys(dirty);
    if (!keys.length) return;
    dirty = {};
    setStatus('syncing');
    post('push', { changes: collectChanges(keys) })
      .then(function (res) {
        if (res && res.ok) { applyServerState(res.state); setStatus('synced'); }
        else if (res && /token/.test(res.error || '')) Sync.logout();
        else setStatus('offline');
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
        if (res && res.ok) { applyServerState(res.state); setStatus('synced'); }
        else if (res && /token/.test(res.error || '')) return Sync.logout();
        else setStatus('offline');
        done && done();
      })
      .catch(function () {
        if (finished) return;
        finished = true; clearTimeout(t); setStatus('offline'); done && done();
      });
  };

  // Flush pending writes when leaving the page.
  window.addEventListener('beforeunload', function () { if (Object.keys(dirty).length) pushNow(); });

  // Kick off the pull immediately (engine init runs after this script; the merge lands first
  // in the common case, and any late-arriving server data still updates localStorage).
  Sync.pullThen();
})();
