/* RideTarget app: tracker, account gate, and sync. */
(function () {
  'use strict';

  var C = window.RideTargetCalc;
  var client = null;
  var userId = null;
  var userEmail = '';
  var isAdmin = false;
  var approved = false;
  var loadedFor = null;
  var state = null;
  var currentScreen = 'today';
  var undo = null;
  var toastTimer = null;
  var sheetField = null;
  var lastDateKey = null;
  var shiftTimer = null;
  var confettiAnim = null;
  var syncTimer = null;
  var syncing = false;
  var syncAgain = false;
  var recoveryMode = false;
  var routeGen = 0;
  var platformSig = '';
  var bound = false;
  var RING_C = 2 * Math.PI * 86;

  function $(id) { return document.getElementById(id); }

  function delay(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }

  function redirectUrl() {
    var url = new URL(window.location.href);
    url.hash = '';
    url.search = '';
    return url.toString();
  }

  function cacheKey(uid) { return 'ridetarget.v1.' + uid; }
  function profileKey(uid) { return 'ridetarget.profile.v1.' + uid; }

  function readProfile(uid) {
    try {
      var raw = localStorage.getItem(profileKey(uid));
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function writeProfile(uid, profile) {
    if (!uid || !profile) return;
    try {
      localStorage.setItem(profileKey(uid), JSON.stringify({
        email: profile.email || '',
        approved: !!profile.approved,
        isAdmin: !!profile.is_admin,
        at: Date.now()
      }));
    } catch (e) { /* storage full */ }
  }

  function loadState(uid) {
    try {
      var raw = localStorage.getItem(cacheKey(uid));
      if (!raw) return null;
      return C.sanitizeState(JSON.parse(raw));
    } catch (e) {
      return null;
    }
  }

  function saveLocal() {
    if (!userId || !state) return;
    try {
      localStorage.setItem(cacheKey(userId), JSON.stringify(state));
    } catch (e) {
      showToast('Could not save on this phone. Storage may be full.');
    }
  }

  function setGateError(msg) {
    var el = $('gateError');
    if (el) el.textContent = msg || '';
  }

  function showPanel(name) {
    document.body.classList.add('gate-open');
    $('gate').hidden = false;
    $('app').hidden = true;
    if (shiftTimer) {
      clearInterval(shiftTimer);
      shiftTimer = null;
    }
    ['config', 'secret', 'library', 'loading', 'auth', 'confirm', 'locked', 'recovery', 'unreachable', 'missing'].forEach(function (panel) {
      var el = $('panel-' + panel);
      if (el) el.hidden = panel !== name;
    });
    setGateError('');
  }

  function showAuth(which) {
    showPanel('auth');
    showAuthForm(which || 'login');
  }

  function showAuthForm(which) {
    $('formLogin').hidden = which !== 'login';
    $('formSignup').hidden = which !== 'signup';
    $('formForgot').hidden = which !== 'forgot';
    $('tabLogin').classList.toggle('active', which !== 'signup');
    $('tabSignup').classList.toggle('active', which === 'signup');
    $('tabLogin').setAttribute('aria-selected', which !== 'signup' ? 'true' : 'false');
    $('tabSignup').setAttribute('aria-selected', which === 'signup' ? 'true' : 'false');
    setGateError('');
  }

  function showApp() {
    document.body.classList.remove('gate-open');
    $('gate').hidden = true;
    $('app').hidden = false;
    lastDateKey = C.dateKey();
    render();
    syncShiftTimer();
    setSync(hasDirty() ? 'pending' : 'saved');
  }

  function friendlyAuth(error) {
    var msg = String(error && error.message || '');
    var lower = msg.toLowerCase();
    if (lower.indexOf('invalid') !== -1 || lower.indexOf('credentials') !== -1) return 'Email or password is not right.';
    if (lower.indexOf('already') !== -1) return 'That email is already registered. Log in instead.';
    if (lower.indexOf('confirm') !== -1) return 'Confirm your email first, then log in.';
    if (lower.indexOf('password') !== -1 && lower.indexOf('weak') !== -1) return 'Use at least 6 characters.';
    if (lower.indexOf('rate') !== -1 || lower.indexOf('too many') !== -1) return 'Too many tries. Wait a minute and try again.';
    return msg || 'Something went wrong. Try again.';
  }

  function isOfflineError(err) {
    var msg = String(err && (err.message || err) || '').toLowerCase();
    return msg.indexOf('fetch') !== -1 || msg.indexOf('network') !== -1 || msg.indexOf('load failed') !== -1 || (err && err.name === 'TypeError');
  }

  function isAuthError(err) {
    if (!err) return false;
    var status = err.status || err.statusCode;
    if (status === 401) return true;
    var code = String(err.code || '');
    if (code === 'PGRST301' || code === '401') return true;
    return String(err.message || '').toLowerCase().indexOf('jwt') !== -1;
  }

  function setFormBusy(form, busy) {
    Array.prototype.forEach.call(form.querySelectorAll('button, input'), function (node) {
      node.disabled = busy;
    });
  }

  function cleanEmail(value) {
    return String(value || '').trim().toLowerCase();
  }

  async function fetchProfile(uid) {
    var res = await client.from('profiles').select('id,email,approved,is_admin,created_at').eq('id', uid).maybeSingle();
    if (res.error) throw res.error;
    if (!res.data) {
      await delay(700);
      res = await client.from('profiles').select('id,email,approved,is_admin,created_at').eq('id', uid).maybeSingle();
      if (res.error) throw res.error;
    }
    return res.data;
  }

  async function routeSession(session) {
    var gen = ++routeGen;
    if (recoveryMode) {
      showPanel('recovery');
      return;
    }
    if (!session || !session.user) {
      userId = null;
      approved = false;
      loadedFor = null;
      showAuth('login');
      return;
    }
    var uid = session.user.id;
    var email = session.user.email || '';
    var cached = readProfile(uid);
    var cachedState = loadState(uid);
    var offlineGrace = cached && cached.approved && cachedState && navigator.onLine === false;
    if (offlineGrace) {
      userId = uid;
      userEmail = email || cached.email || '';
      isAdmin = !!cached.isAdmin;
      approved = true;
      state = cachedState;
      loadedFor = uid;
      showApp();
      setSync('offline');
    } else {
      showPanel('loading');
    }
    try {
      var profile = await fetchProfile(uid);
      if (gen !== routeGen) return;
      if (!profile) {
        approved = false;
        showPanel('missing');
        return;
      }
      writeProfile(uid, profile);
      userEmail = profile.email || email;
      isAdmin = !!profile.is_admin;
      var lockedEmail = $('lockedEmail');
      if (lockedEmail) lockedEmail.textContent = userEmail;
      if (!profile.approved) {
        approved = false;
        userId = uid;
        showPanel('locked');
        return;
      }
      approved = true;
      userId = uid;
      if (loadedFor !== uid || !state) {
        state = loadState(uid) || C.defaultState();
        loadedFor = uid;
      }
      showApp();
      syncNow(false);
    } catch (err) {
      if (gen !== routeGen) return;
      if (cached && cached.approved && cachedState && isOfflineError(err)) {
        userId = uid;
        userEmail = email || cached.email || '';
        isAdmin = !!cached.isAdmin;
        approved = true;
        state = state || cachedState;
        loadedFor = uid;
        showApp();
        setSync('offline');
        return;
      }
      showPanel('unreachable');
    }
  }

  function startAuth() {
    var cfg = window.RIDETARGET_CONFIG || {};
    var url = String(cfg.SUPABASE_URL || '').trim().replace(/\/$/, '');
    var key = String(cfg.SUPABASE_ANON_KEY || '').trim();
    recoveryMode = /type=recovery/.test(window.location.hash) || /type=recovery/.test(window.location.search);
    client = supabase.createClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: 'implicit',
        storageKey: 'ridetarget-auth'
      }
    });
    var sawInitial = false;
    client.auth.onAuthStateChange(function (event, session) {
      if (event === 'PASSWORD_RECOVERY') {
        recoveryMode = true;
        showPanel('recovery');
        return;
      }
      if (event === 'SIGNED_OUT') {
        if (recoveryMode) return;
        sawInitial = true;
        routeSession(null);
        return;
      }
      if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN') {
        sawInitial = true;
        if (recoveryMode) {
          showPanel('recovery');
          return;
        }
        routeSession(session);
      }
    });
    client.auth.getSession().then(function (res) {
      setTimeout(function () {
        if (!sawInitial) routeSession(res.data && res.data.session);
      }, 400);
    });
  }

  /* ---------- tracker data ---------- */

  function readToday() {
    if (!state) return C.defaultDay();
    return state.days[C.dateKey()] || C.defaultDay();
  }

  function ensureDay(key) {
    if (!state.days[key]) state.days[key] = C.defaultDay();
    return state.days[key];
  }

  function today() {
    return ensureDay(C.dateKey());
  }

  function findRide(id) {
    var keys = Object.keys(state.days);
    for (var i = 0; i < keys.length; i++) {
      var rides = state.days[keys[i]].rides || [];
      for (var j = 0; j < rides.length; j++) {
        if (rides[j].id === id) {
          return { key: keys[i], day: state.days[keys[i]], ride: rides[j], index: j };
        }
      }
    }
    return null;
  }

  function hasDirty() {
    if (!state) return false;
    if (state.settingsDirty || state.pendingReset) return true;
    var keys = Object.keys(state.days);
    for (var i = 0; i < keys.length; i++) {
      var rides = state.days[keys[i]].rides || [];
      for (var j = 0; j < rides.length; j++) {
        if (rides[j].dirty) return true;
      }
    }
    return false;
  }

  function touchSettings() {
    state.settingsDirty = true;
    state.rev += 1;
    saveLocal();
    scheduleSync();
  }

  function maybeCelebrate(day) {
    if (!day.celebrated && C.rideTotal(day) >= state.target && state.target > 0) {
      day.celebrated = true;
      state.settingsDirty = true;
      burstConfetti();
      showToast('Target hit — nice work!');
    }
  }

  function addRide(amount, ts, pay, platform) {
    var n = typeof amount === 'number' ? amount : C.parseAmount(amount);
    if (n == null) return false;
    rolloverIfNeeded();
    var day = today();
    var type = C.normalizePay(pay != null ? pay : state.lastPay);
    var plat = platform || state.lastPlatform;
    if (!C.knownPlatform(plat) || state.platforms.indexOf(plat) === -1) plat = state.platforms[0];
    day.rides.push({
      id: C.newId(),
      amount: n,
      ts: ts || Date.now(),
      pay: type,
      platform: plat,
      deleted: false,
      dirty: true,
      synced: false
    });
    state.rev += 1;
    maybeCelebrate(day);
    saveLocal();
    render();
    scheduleSync();
    buzz(10);
    return true;
  }

  function deleteRide(id) {
    var located = findRide(id);
    if (!located || located.ride.deleted) return;
    var ride = located.ride;
    undo = {
      key: located.key,
      index: located.index,
      ride: JSON.parse(JSON.stringify(ride))
    };
    if (!ride.synced) {
      located.day.rides.splice(located.index, 1);
    } else {
      ride.deleted = true;
      ride.dirty = true;
    }
    if (C.rideTotal(located.day) < state.target && located.day.celebrated) {
      located.day.celebrated = false;
      state.settingsDirty = true;
    }
    state.rev += 1;
    saveLocal();
    render();
    scheduleSync();
    showToast('Ride removed', true);
    buzz(8);
  }

  function undoLast() {
    if (!undo || !state) return;
    var day = ensureDay(undo.key);
    var existing = null;
    for (var i = 0; i < day.rides.length; i++) {
      if (day.rides[i].id === undo.ride.id) existing = day.rides[i];
    }
    if (existing) {
      existing.deleted = false;
      existing.dirty = true;
    } else {
      var ride = undo.ride;
      ride.deleted = false;
      ride.dirty = true;
      day.rides.splice(Math.min(undo.index, day.rides.length), 0, ride);
    }
    undo = null;
    state.rev += 1;
    maybeCelebrate(day);
    saveLocal();
    hideToast();
    render();
    scheduleSync();
    buzz(10);
  }

  function setExtra(field, value) {
    var n = Number(value);
    if (!isFinite(n) || n < 0) n = 0;
    n = C.roundMoney(n);
    if (n > 999999.99) n = 999999.99;
    today()[field] = n;
    touchSettings();
    render();
  }

  function setTarget(value) {
    var n = C.parseTarget(value);
    if (n == null) return false;
    state.target = n;
    var day = readToday();
    if (state.days[C.dateKey()]) {
      if (C.rideTotal(day) < state.target) state.days[C.dateKey()].celebrated = false;
      else maybeCelebrate(state.days[C.dateKey()]);
    }
    state.settingsDirty = true;
    state.rev += 1;
    saveLocal();
    render();
    scheduleSync();
    return true;
  }

  function setPayType(pay) {
    state.lastPay = C.normalizePay(pay);
    touchSettings();
    render();
    buzz(8);
  }

  function setPlatform(name) {
    if (state.platforms.indexOf(name) === -1) return;
    if (state.lastPlatform === name) return;
    state.lastPlatform = name;
    touchSettings();
    render();
    buzz(8);
  }

  function togglePlatform(name) {
    if (!C.knownPlatform(name)) return;
    var on = state.platforms.indexOf(name) !== -1;
    if (on) {
      if (state.platforms.length <= 1) {
        showToast('Keep at least one platform');
        return;
      }
      state.platforms = state.platforms.filter(function (item) { return item !== name; });
      if (state.lastPlatform === name) state.lastPlatform = state.platforms[0];
    } else {
      state.platforms = C.PLATFORMS.filter(function (item) {
        return state.platforms.indexOf(item) !== -1 || item === name;
      });
    }
    platformSig = '';
    touchSettings();
    render();
  }

  function toggleShift() {
    rolloverIfNeeded();
    var day = today();
    if (C.isShiftOn(day)) day.segments[day.segments.length - 1].end = Date.now();
    else day.segments.push({ start: Date.now(), end: null });
    touchSettings();
    render();
    buzz(12);
  }

  function closeStaleShifts() {
    if (!state) return false;
    var todayKey = C.dateKey();
    var changed = false;
    Object.keys(state.days).forEach(function (key) {
      if (key >= todayKey) return;
      var day = state.days[key];
      if (day && C.isShiftOn(day)) {
        day.segments[day.segments.length - 1].end = C.startOfDayTs(C.addDays(key, 1));
        changed = true;
      }
    });
    if (changed) {
      state.settingsDirty = true;
      state.rev += 1;
      saveLocal();
      scheduleSync();
    }
    return changed;
  }

  function rolloverIfNeeded() {
    if (!state) return false;
    var stale = closeStaleShifts();
    var nowKey = C.dateKey();
    if (lastDateKey == null) {
      lastDateKey = nowKey;
      return stale;
    }
    if (nowKey === lastDateKey) return stale;
    lastDateKey = nowKey;
    return true;
  }

  function resetAll() {
    var rev = (state && state.rev || 0) + 1;
    state = C.defaultState();
    state.pendingReset = true;
    state.settingsDirty = true;
    state.rev = rev;
    undo = null;
    platformSig = '';
    saveLocal();
    render();
    scheduleSync();
  }

  function exportJSON() {
    var days = {};
    Object.keys(state.days).forEach(function (key) {
      var day = state.days[key];
      days[key] = {
        tips: day.tips,
        incentives: day.incentives,
        fuel: day.fuel,
        tolls: day.tolls,
        segments: day.segments,
        celebrated: !!day.celebrated,
        rides: C.activeRides(day).map(function (ride) {
          return { id: ride.id, amount: ride.amount, ts: ride.ts, pay: ride.pay, platform: ride.platform };
        })
      };
    });
    return JSON.stringify({
      version: 2,
      exportedAt: new Date().toISOString(),
      target: state.target,
      lastPay: state.lastPay,
      lastPlatform: state.lastPlatform,
      platforms: state.platforms,
      days: days
    }, null, 2);
  }

  function importJSON(text) {
    var obj = JSON.parse(text);
    if (!obj || typeof obj !== 'object') throw new Error('Invalid backup');
    var next = C.sanitizeState(obj);
    Object.keys(next.days).forEach(function (key) {
      next.days[key].rides.forEach(function (ride) {
        ride.dirty = true;
        ride.deleted = false;
        ride.synced = false;
      });
    });
    next.settingsDirty = true;
    next.pendingReset = true;
    next.rev = (state && state.rev || 0) + 1;
    state = next;
    platformSig = '';
    saveLocal();
    render();
    scheduleSync();
  }

  function exportCSV() {
    var lines = [];
    lines.push('Date,Rides,Ride Total (RM),Cash (RM),Credit (RM),Tips (RM),Incentives (RM),Fuel (RM),Tolls (RM),Gross (RM),Net (RM),Hours,RM per Hour,Target (RM),Hit');
    var keys = Object.keys(state.days).sort();
    keys.forEach(function (key) {
      var day = state.days[key];
      if (!C.dayHasData(day)) return;
      var stats = C.statsFor(day, state.target);
      var pt = C.payTotals(day);
      var hrs = stats.ms / 3600000;
      lines.push([
        key,
        stats.count,
        stats.rideTotal.toFixed(2),
        pt.cash.toFixed(2),
        pt.credit.toFixed(2),
        (day.tips || 0).toFixed(2),
        (day.incentives || 0).toFixed(2),
        (day.fuel || 0).toFixed(2),
        (day.tolls || 0).toFixed(2),
        stats.gross.toFixed(2),
        stats.net.toFixed(2),
        hrs.toFixed(2),
        stats.rph == null ? '' : Number(stats.rph).toFixed(2),
        Number(state.target).toFixed(2),
        stats.hit ? 'Yes' : 'No'
      ].join(','));
    });
    lines.push('');
    lines.push('Date,Platform,Rides,Total (RM)');
    keys.forEach(function (key) {
      var day = state.days[key];
      var totals = C.platformTotals(day);
      C.PLATFORMS.forEach(function (name) {
        if (!totals[name]) return;
        var count = C.activeRides(day).filter(function (ride) { return ride.platform === name; }).length;
        lines.push([key, csvCell(name), count, totals[name].toFixed(2)].join(','));
      });
    });
    lines.push('');
    lines.push('Date,Time,Platform,Pay,Ride Amount (RM)');
    keys.forEach(function (key) {
      C.activeRides(state.days[key]).forEach(function (ride) {
        lines.push([
          key,
          csvCell(C.formatTime(ride.ts)),
          csvCell(ride.platform),
          C.payLabel(ride.pay),
          Number(ride.amount).toFixed(2)
        ].join(','));
      });
    });
    return lines.join('\n');
  }

  function csvCell(value) {
    var text = String(value == null ? '' : value);
    if (/[",\n]/.test(text)) return '"' + text.replace(/"/g, '""') + '"';
    return text;
  }

  function downloadFile(filename, mime, text) {
    var file = new File([text], filename, { type: mime });
    if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: filename }).catch(function (err) {
        if (err && err.name === 'AbortError') return;
        downloadBlob(filename, mime, text);
      });
      return;
    }
    downloadBlob(filename, mime, text);
  }

  function downloadBlob(filename, mime, text) {
    var blob = new Blob([text], { type: mime });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }

  /* ---------- sync ---------- */

  function scheduleSync() {
    if (!userId || !approved || !client) return;
    if (!navigator.onLine) {
      setSync('offline');
      return;
    }
    if (syncing) {
      syncAgain = true;
      setSync('pending');
      return;
    }
    setSync('pending');
    clearTimeout(syncTimer);
    syncTimer = setTimeout(function () { syncNow(false); }, 450);
  }

  function buildSettingsPayload() {
    var days = {};
    Object.keys(state.days).forEach(function (key) {
      var day = state.days[key];
      days[key] = {
        tips: day.tips || 0,
        incentives: day.incentives || 0,
        fuel: day.fuel || 0,
        tolls: day.tolls || 0,
        segments: day.segments || [],
        celebrated: !!day.celebrated
      };
    });
    return {
      user_id: userId,
      daily_target: state.target,
      last_pay: state.lastPay,
      last_platform: state.lastPlatform,
      platforms: state.platforms.slice(),
      days: days
    };
  }

  function collectDirtyRows() {
    var rows = [];
    Object.keys(state.days).forEach(function (key) {
      (state.days[key].rides || []).forEach(function (ride) {
        if (!ride.dirty) return;
        rows.push({
          user_id: userId,
          client_id: ride.id,
          day_key: key,
          amount: ride.amount,
          pay: ride.pay,
          platform: ride.platform,
          ts: new Date(ride.ts).toISOString(),
          deleted: !!ride.deleted
        });
      });
    });
    return rows;
  }

  function markPushed(rows) {
    rows.forEach(function (row) {
      var found = findRide(row.client_id);
      if (!found) return;
      var ride = found.ride;
      if (!!ride.deleted !== !!row.deleted) return;
      if (Number(ride.amount) !== Number(row.amount)) return;
      if (ride.pay !== row.pay || ride.platform !== row.platform) return;
      if (found.key !== String(row.day_key).slice(0, 10)) return;
      ride.dirty = false;
      ride.synced = true;
    });
    saveLocal();
  }

  async function pushDirty(rev) {
    if (state.pendingReset) {
      var deleted = await client.from('rides').delete().eq('user_id', userId);
      if (deleted.error) throw deleted.error;
      if (state.rev !== rev) return;
    }
    var rows = collectDirtyRows();
    var i;
    for (i = 0; i < rows.length; i += 200) {
      var up = await client.from('rides').upsert(rows.slice(i, i + 200), { onConflict: 'user_id,client_id' });
      if (up.error) throw up.error;
      if (state.rev !== rev) return;
    }
    if (state.rev !== rev) return;
    if (rows.length) markPushed(rows);
    if (state.settingsDirty || state.pendingReset) {
      var saved = await client.from('settings').upsert(buildSettingsPayload());
      if (saved.error) throw saved.error;
      if (state.rev !== rev) return;
      state.settingsDirty = false;
      state.pendingReset = false;
      saveLocal();
    }
  }

  async function fetchAllRides() {
    var all = [];
    var from = 0;
    var page = 1000;
    while (true) {
      var res = await client.from('rides')
        .select('client_id,day_key,amount,pay,platform,ts,deleted')
        .eq('deleted', false)
        .order('ts', { ascending: true })
        .range(from, from + page - 1);
      if (res.error) throw res.error;
      var batch = res.data || [];
      all = all.concat(batch);
      if (batch.length < page) break;
      from += page;
    }
    return all;
  }

  function applyRemote(remoteRides, remoteSettings) {
    var keepSettings = !!(state.settingsDirty || state.pendingReset);
    var dirty = {};
    Object.keys(state.days).forEach(function (key) {
      (state.days[key].rides || []).forEach(function (ride) {
        if (ride.dirty) dirty[ride.id] = { key: key, ride: ride };
      });
    });
    var days = {};
    var remoteDays = remoteSettings && remoteSettings.days && typeof remoteSettings.days === 'object' ? remoteSettings.days : {};
    Object.keys(remoteDays).forEach(function (key) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return;
      var clean = C.sanitizeDay(remoteDays[key]);
      clean.rides = [];
      days[key] = clean;
    });
    (remoteRides || []).forEach(function (row) {
      if (!row || row.deleted) return;
      var key = String(row.day_key).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return;
      if (dirty[row.client_id]) return;
      if (!days[key]) days[key] = C.defaultDay();
      days[key].rides.push({
        id: String(row.client_id),
        amount: Number(row.amount),
        ts: new Date(row.ts).getTime(),
        pay: row.pay,
        platform: row.platform,
        deleted: false,
        dirty: false,
        synced: true
      });
    });
    Object.keys(dirty).forEach(function (id) {
      var item = dirty[id];
      if (!days[item.key]) days[item.key] = C.defaultDay();
      days[item.key].rides = (days[item.key].rides || []).filter(function (ride) { return ride.id !== id; });
      days[item.key].rides.push(item.ride);
    });
    if (keepSettings) {
      Object.keys(state.days).forEach(function (key) {
        if (!days[key]) days[key] = C.defaultDay();
        days[key].tips = state.days[key].tips;
        days[key].incentives = state.days[key].incentives;
        days[key].fuel = state.days[key].fuel;
        days[key].tolls = state.days[key].tolls;
        days[key].segments = state.days[key].segments;
        days[key].celebrated = state.days[key].celebrated;
      });
    }
    Object.keys(days).forEach(function (key) {
      days[key].rides.sort(function (a, b) { return a.ts - b.ts || String(a.id).localeCompare(String(b.id)); });
    });
    state = C.sanitizeState({
      target: keepSettings ? state.target : remoteSettings.daily_target,
      lastPay: keepSettings ? state.lastPay : remoteSettings.last_pay,
      lastPlatform: keepSettings ? state.lastPlatform : remoteSettings.last_platform,
      platforms: keepSettings ? state.platforms : remoteSettings.platforms,
      days: days,
      settingsDirty: state.settingsDirty,
      pendingReset: state.pendingReset,
      rev: state.rev
    });
    platformSig = '';
    saveLocal();
    render();
  }

  async function pullRemote(rev) {
    var remoteRides = await fetchAllRides();
    if (state.rev !== rev) return;
    var settingsRes = await client.from('settings')
      .select('daily_target,last_pay,last_platform,platforms,days')
      .eq('user_id', userId)
      .maybeSingle();
    if (settingsRes.error) throw settingsRes.error;
    if (state.rev !== rev) return;
    if (!settingsRes.data) {
      state.settingsDirty = true;
      syncAgain = true;
      return;
    }
    applyRemote(remoteRides, settingsRes.data);
  }

  async function syncNow(manual) {
    if (!client || !userId || !approved) return;
    if (syncing) {
      syncAgain = true;
      return;
    }
    if (!navigator.onLine) {
      setSync('offline');
      if (manual) showToast('You are offline');
      return;
    }
    clearTimeout(syncTimer);
    syncing = true;
    setSync('saving');
    try {
      var profile = await fetchProfile(userId);
      if (!profile || !profile.approved) {
        if (profile) writeProfile(userId, profile);
        approved = false;
        showPanel('locked');
        var lockedEmail = $('lockedEmail');
        if (lockedEmail) lockedEmail.textContent = (profile && profile.email) || userEmail;
        return;
      }
      isAdmin = !!profile.is_admin;
      writeProfile(userId, profile);
      do {
        syncAgain = false;
        var rev = state.rev;
        await pushDirty(rev);
        if (state.rev !== rev) {
          syncAgain = true;
          continue;
        }
        await pullRemote(rev);
        if (state.rev !== rev) syncAgain = true;
      } while (syncAgain);
      setSync(hasDirty() ? 'pending' : 'saved');
      if (manual && !hasDirty()) showToast('Synced');
    } catch (err) {
      if (isAuthError(err)) {
        showToast('Please log in again');
        client.auth.signOut();
        return;
      }
      if (isOfflineError(err)) {
        setSync('offline');
        if (manual) showToast('You are offline');
        return;
      }
      setSync('error');
      if (manual) showToast('Could not sync yet');
    } finally {
      syncing = false;
      if (syncAgain && approved) scheduleSync();
    }
  }

  /* ---------- UI ---------- */

  function buzz(ms) {
    try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) {}
  }

  function showToast(msg, withUndo) {
    var el = $('toast');
    if (!el) return;
    el.innerHTML = '';
    var span = document.createElement('span');
    span.textContent = msg;
    el.appendChild(span);
    if (withUndo) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = 'Undo';
      btn.addEventListener('click', undoLast);
      el.appendChild(btn);
    }
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, withUndo ? 6000 : 2800);
  }

  function hideToast() {
    var el = $('toast');
    if (el) el.classList.remove('show');
    clearTimeout(toastTimer);
  }

  function setSync(mode) {
    var pill = $('syncPill');
    if (!pill) return;
    pill.className = 'sync-pill ' + mode;
    var labels = { saved: 'Synced', saving: 'Saving…', offline: 'Offline', pending: 'Will sync', error: 'Not synced' };
    pill.textContent = labels[mode] || 'Synced';
  }

  function openSheet(field, title, current) {
    sheetField = field;
    $('sheetTitle').textContent = title;
    $('sheetInput').value = current ? String(current) : '';
    $('overlay').classList.add('show');
    $('sheet').classList.add('show');
    setTimeout(function () {
      $('sheetInput').focus();
      $('sheetInput').select();
    }, 220);
  }

  function closeSheet() {
    $('overlay').classList.remove('show');
    $('sheet').classList.remove('show');
    sheetField = null;
    if ($('sheetInput')) $('sheetInput').blur();
  }

  function saveSheet() {
    var raw = $('sheetInput').value;
    var n = String(raw).trim() === '' ? 0 : Number(String(raw).trim().replace(/,/g, '.'));
    if (!isFinite(n) || n < 0) {
      shake($('sheetInput').parentElement);
      return;
    }
    n = C.roundMoney(n);
    if (sheetField === 'target') {
      if (!setTarget(n)) {
        shake($('sheetInput').parentElement);
        return;
      }
      showToast('Daily target set to ' + C.formatRM(state.target));
    } else if (sheetField) {
      setExtra(sheetField, n);
    }
    closeSheet();
  }

  function shake(el) {
    if (!el) return;
    el.classList.remove('shake');
    void el.offsetWidth;
    el.classList.add('shake');
  }

  function goTo(name) {
    if (name !== 'today' && name !== 'history' && name !== 'settings') return;
    Array.prototype.forEach.call(document.querySelectorAll('.screen'), function (el) {
      el.classList.toggle('active', el.id === 'screen-' + name);
    });
    currentScreen = name;
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (tab) {
      tab.classList.toggle('active', tab.getAttribute('data-screen') === name);
    });
    if (name !== 'today' && $('fareInput')) $('fareInput').blur();
    renderHeader();
    if (name === 'history') renderHistory();
    if (name === 'settings') renderSettings();
  }

  function renderHeader() {
    var key = C.dateKey();
    if (currentScreen === 'today') {
      $('headerDate').textContent = C.formatLongDate(key);
      $('headerTitle').textContent = 'Today';
    } else if (currentScreen === 'history') {
      $('headerDate').textContent = 'This week and past days';
      $('headerTitle').textContent = 'History';
    } else {
      $('headerDate').textContent = 'RideTarget';
      $('headerTitle').textContent = 'Settings';
    }
  }

  function renderShiftBits() {
    var day = readToday();
    var stats = C.statsFor(day, state.target);
    var on = C.isShiftOn(day);
    $('statHours').textContent = (stats.ms > 0 || on) ? C.formatDuration(stats.ms) : '—';
    $('statRph').textContent = stats.rph == null ? '—' : C.formatRM(stats.rph);
    $('shiftBtn').classList.toggle('on', on);
    $('shiftLabel').textContent = on
      ? 'End shift · ' + C.formatDuration(stats.ms)
      : (stats.ms > 0 ? 'Start shift again' : 'Start shift');
  }

  function renderToday() {
    var day = readToday();
    var stats = C.statsFor(day, state.target);
    var pct = state.target > 0 ? Math.min(1, stats.rideTotal / state.target) : 0;
    var ring = $('progressRing');
    ring.setAttribute('stroke-dasharray', String(RING_C));
    ring.setAttribute('stroke-dashoffset', String(RING_C * (1 - pct)));
    ring.style.opacity = pct <= 0.001 ? '0' : '1';
    $('ring').classList.toggle('hit', stats.hit);
    $('ringTotal').textContent = C.formatRM(stats.rideTotal);
    if (stats.hit) {
      var over = C.roundMoney(stats.rideTotal - state.target);
      $('ringRemain').textContent = over > 0
        ? C.formatRM(over) + ' over ' + C.formatRM(state.target)
        : 'Target reached';
    } else {
      $('ringRemain').textContent = C.formatRM(stats.remaining) + ' left of ' + C.formatRM(state.target);
    }
    $('ringTargetBtn').classList.toggle('hit', stats.hit);
    $('badgeHit').classList.toggle('show', stats.hit);
    $('statRides').textContent = String(stats.count);
    $('statAvg').textContent = stats.count ? C.formatRM(stats.avg) : '—';
    $('statLeft').textContent = stats.hit ? '0' : (stats.est == null ? '—' : String(stats.est));
    renderShiftBits();

    var pay = C.payTotals(day);
    $('cashTotal').textContent = C.formatRM(pay.cash);
    $('creditTotal').textContent = C.formatRM(pay.credit);
    $('payCash').classList.toggle('active', state.lastPay === 'cash');
    $('payCredit').classList.toggle('active', state.lastPay === 'credit');
    $('payCash').setAttribute('aria-pressed', state.lastPay === 'cash' ? 'true' : 'false');
    $('payCredit').setAttribute('aria-pressed', state.lastPay === 'credit' ? 'true' : 'false');
    renderPlatformPicker();
    renderPlatformTotals(day);

    $('netValue').textContent = C.formatRM(stats.net);
    $('netValue').classList.toggle('neg', stats.net < 0);
    $('extraTips').textContent = C.formatRM(day.tips || 0);
    $('extraIncentives').textContent = C.formatRM(day.incentives || 0);
    $('extraFuel').textContent = C.formatRM(day.fuel || 0);
    $('extraTolls').textContent = C.formatRM(day.tolls || 0);

    var list = $('rideList');
    list.innerHTML = '';
    var rides = C.activeRides(day).slice().reverse();
    if (!rides.length) {
      var empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'No rides yet. Add your first fare above.';
      list.appendChild(empty);
    } else {
      rides.forEach(function (ride) { list.appendChild(rideRow(ride)); });
    }
    $('rideCountLabel').textContent = stats.count ? (stats.count + (stats.count === 1 ? ' ride' : ' rides')) : '';
  }

  function renderPlatformPicker() {
    var sig = state.platforms.join('|') + '::' + state.lastPlatform;
    var row = $('platformRow');
    if (sig === platformSig && row.childElementCount === state.platforms.length) {
      Array.prototype.forEach.call(row.children, function (btn) {
        var on = btn.getAttribute('data-platform') === state.lastPlatform;
        btn.classList.toggle('active', on);
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      return;
    }
    platformSig = sig;
    row.innerHTML = '';
    state.platforms.forEach(function (name) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'plat-btn' + (name === state.lastPlatform ? ' active' : '');
      btn.setAttribute('data-platform', name);
      btn.setAttribute('aria-pressed', name === state.lastPlatform ? 'true' : 'false');
      btn.textContent = name;
      btn.addEventListener('click', function () { setPlatform(name); });
      row.appendChild(btn);
    });
  }

  function renderPlatformTotals(day) {
    var box = $('platformTotals');
    var head = box.previousElementSibling;
    box.innerHTML = '';
    var totals = C.platformTotals(day);
    var any = false;
    C.PLATFORMS.forEach(function (name) {
      if (!totals[name]) return;
      any = true;
      var row = document.createElement('div');
      row.className = 'plat-total';
      var label = document.createElement('div');
      label.className = 'plat-total-name';
      label.textContent = name;
      var value = document.createElement('div');
      value.className = 'plat-total-val';
      value.textContent = C.formatRM(totals[name]);
      row.appendChild(label);
      row.appendChild(value);
      box.appendChild(row);
    });
    box.hidden = !any;
    if (head && head.classList.contains('section-head')) head.hidden = !any;
  }

  function rideRow(ride) {
    var wrap = document.createElement('div');
    wrap.className = 'ride';
    var inner = document.createElement('div');
    inner.className = 'ride-inner';
    var left = document.createElement('div');
    left.className = 'ride-time-wrap';
    var time = document.createElement('div');
    time.className = 'ride-time';
    time.textContent = C.formatTime(ride.ts);
    var platform = document.createElement('span');
    platform.className = 'plat-badge';
    platform.textContent = ride.platform;
    var badge = document.createElement('span');
    badge.className = 'pay-badge ' + C.normalizePay(ride.pay);
    badge.textContent = C.payLabel(ride.pay);
    left.appendChild(time);
    left.appendChild(platform);
    left.appendChild(badge);
    var amount = document.createElement('div');
    amount.className = 'ride-amt';
    amount.textContent = C.formatRM(ride.amount);
    var del = document.createElement('button');
    del.type = 'button';
    del.className = 'ride-del';
    del.setAttribute('aria-label', 'Delete ride');
    del.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg>';
    del.addEventListener('click', function (event) {
      event.stopPropagation();
      deleteRide(ride.id);
    });
    inner.appendChild(left);
    inner.appendChild(amount);
    inner.appendChild(del);
    wrap.appendChild(inner);
    bindSwipe(inner, ride.id);
    return wrap;
  }

  function bindSwipe(inner, id) {
    var startX = 0;
    var startY = 0;
    var dx = 0;
    var tracking = false;
    var locked = null;
    function onStart(x, y) {
      startX = x;
      startY = y;
      dx = 0;
      tracking = true;
      locked = null;
      inner.style.transition = 'none';
    }
    function onMove(x, y, event) {
      if (!tracking) return;
      var mx = x - startX;
      var my = y - startY;
      if (locked == null && (Math.abs(mx) > 8 || Math.abs(my) > 8)) {
        locked = Math.abs(mx) > Math.abs(my) ? 'x' : 'y';
      }
      if (locked !== 'x') return;
      if (event && event.cancelable) event.preventDefault();
      dx = Math.min(0, mx);
      inner.style.transform = 'translateX(' + dx + 'px)';
    }
    function onEnd() {
      if (!tracking) return;
      tracking = false;
      inner.style.transition = '';
      if (dx < -88) {
        inner.style.transform = 'translateX(-120%)';
        setTimeout(function () { deleteRide(id); }, 140);
      } else {
        inner.style.transform = '';
      }
    }
    inner.addEventListener('touchstart', function (event) {
      var touch = event.changedTouches[0];
      onStart(touch.clientX, touch.clientY);
    }, { passive: true });
    inner.addEventListener('touchmove', function (event) {
      var touch = event.changedTouches[0];
      onMove(touch.clientX, touch.clientY, event);
    }, { passive: false });
    inner.addEventListener('touchend', onEnd);
    inner.addEventListener('touchcancel', onEnd);
  }

  function chipList(totals, pay) {
    var row = document.createElement('div');
    row.className = 'chip-row';
    function add(text) {
      var chip = document.createElement('span');
      chip.className = 'mini-chip';
      chip.textContent = text;
      row.appendChild(chip);
    }
    if (pay) {
      add('Cash ' + C.formatRM(pay.cash));
      add('Credit ' + C.formatRM(pay.credit));
    }
    C.PLATFORMS.forEach(function (name) {
      if (totals && totals[name]) add(name + ' ' + C.formatRM(totals[name]));
    });
    return row;
  }

  function renderHistory() {
    var key = C.dateKey();
    var monday = C.mondayOf(key);
    var weekTotal = 0;
    var weekRides = 0;
    var weekPlat = {};
    var i;
    for (i = 0; i < 7; i++) {
      var weekKey = C.addDays(monday, i);
      var weekDay = state.days[weekKey];
      if (!weekDay) continue;
      weekTotal += C.rideTotal(weekDay);
      weekRides += C.activeRides(weekDay).length;
      var part = C.platformTotals(weekDay);
      Object.keys(part).forEach(function (name) {
        weekPlat[name] = C.roundMoney((weekPlat[name] || 0) + part[name]);
      });
    }
    $('weekTotal').textContent = C.formatRM(weekTotal);
    $('weekMeta').textContent = weekRides + (weekRides === 1 ? ' ride' : ' rides');
    var weekBox = $('weekPlatforms');
    weekBox.innerHTML = '';
    var weekChips = chipList(weekPlat, null);
    while (weekChips.firstChild) weekBox.appendChild(weekChips.firstChild);

    var last7 = [];
    var maxVal = state.target || 1;
    for (i = 6; i >= 0; i--) {
      var dayKey = C.addDays(key, -i);
      var total = C.rideTotal(state.days[dayKey] || C.defaultDay());
      if (total > maxVal) maxVal = total;
      last7.push({
        key: dayKey,
        total: total,
        hit: total >= state.target && state.target > 0,
        isToday: dayKey === key
      });
    }
    var chart = $('weekChart');
    chart.innerHTML = '';
    last7.forEach(function (bar) {
      var col = document.createElement('div');
      col.className = 'bar-col' + (bar.isToday ? ' today' : '');
      var track = document.createElement('div');
      track.className = 'bar-track';
      var fill = document.createElement('div');
      fill.className = 'bar-fill' + (bar.hit ? ' hit' : '') + (bar.isToday ? ' today' : '');
      var height = maxVal > 0 ? Math.max(4, Math.round((bar.total / maxVal) * 100)) : 4;
      fill.style.height = (bar.total > 0 ? height : 4) + '%';
      fill.title = C.formatShortDate(bar.key) + ' · ' + C.formatRM(bar.total);
      track.appendChild(fill);
      var label = document.createElement('div');
      label.className = 'bar-lbl';
      var short = C.formatShortDate(bar.key).split(' ')[0].replace(/,/g, '');
      label.textContent = bar.isToday ? 'Today' : short;
      col.appendChild(track);
      col.appendChild(label);
      chart.appendChild(col);
    });

    var list = $('historyList');
    var openKey = null;
    var openCard = list.querySelector('.day-card.open');
    if (openCard) openKey = openCard.getAttribute('data-day');
    list.innerHTML = '';
    var shown = 0;
    Object.keys(state.days).sort().reverse().forEach(function (dayKey) {
      var day = state.days[dayKey];
      if (!C.dayHasData(day)) return;
      shown += 1;
      var stats = C.statsFor(day, state.target);
      var card = document.createElement('button');
      card.type = 'button';
      card.className = 'day-card' + (dayKey === openKey ? ' open' : '');
      card.setAttribute('data-day', dayKey);
      var top = document.createElement('div');
      top.className = 'day-top';
      var name = document.createElement('div');
      name.className = 'day-name';
      name.textContent = dayKey === key ? 'Today · ' + C.formatShortDate(dayKey) : C.formatShortDate(dayKey);
      var badge = document.createElement('div');
      badge.className = 'day-badge ' + (stats.hit ? 'hit' : 'miss');
      badge.textContent = stats.hit ? 'Hit' : 'Miss';
      top.appendChild(name);
      top.appendChild(badge);
      var amt = document.createElement('div');
      amt.className = 'day-amt';
      amt.textContent = C.formatRM(stats.rideTotal);
      var metaBits = [stats.count + (stats.count === 1 ? ' ride' : ' rides')];
      if (stats.ms > 0) {
        metaBits.push(C.formatDuration(stats.ms));
        if (stats.rph != null) metaBits.push(C.formatRM(stats.rph) + '/h');
      }
      metaBits.push('Net ' + C.formatRM(stats.net));
      var meta = document.createElement('div');
      meta.className = 'day-meta';
      meta.textContent = metaBits.join(' · ');
      var chips = chipList(C.platformTotals(day), C.payTotals(day));
      var ridesBox = document.createElement('div');
      ridesBox.className = 'day-rides';
      var rides = C.activeRides(day).slice().reverse();
      if (!rides.length) {
        var none = document.createElement('div');
        none.className = 'day-ride';
        none.textContent = 'No individual rides logged';
        ridesBox.appendChild(none);
      } else {
        rides.forEach(function (ride) {
          var line = document.createElement('div');
          line.className = 'day-ride';
          var when = document.createElement('span');
          when.textContent = C.formatTime(ride.ts) + ' · ' + ride.platform;
          var how = document.createElement('span');
          how.className = 'pay-badge ' + C.normalizePay(ride.pay);
          how.textContent = C.payLabel(ride.pay);
          var value = document.createElement('span');
          value.textContent = C.formatRM(ride.amount);
          line.appendChild(when);
          line.appendChild(how);
          line.appendChild(value);
          ridesBox.appendChild(line);
        });
      }
      card.appendChild(top);
      card.appendChild(amt);
      card.appendChild(meta);
      card.appendChild(chips);
      card.appendChild(ridesBox);
      card.addEventListener('click', function () { card.classList.toggle('open'); });
      list.appendChild(card);
    });
    if (!shown) {
      var empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'No history yet. Log rides today and they will show up here.';
      list.appendChild(empty);
    }
  }

  function renderSettings() {
    var input = $('targetInput');
    if (document.activeElement !== input) input.value = String(state.target);
    $('accountEmail').textContent = userEmail || '';
    $('adminLink').hidden = !isAdmin;
    var box = $('platformSettings');
    box.innerHTML = '';
    C.PLATFORMS.forEach(function (name) {
      var on = state.platforms.indexOf(name) !== -1;
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'switch-row';
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      var label = document.createElement('span');
      label.textContent = name;
      var knob = document.createElement('span');
      knob.className = 'switch' + (on ? ' on' : '');
      btn.appendChild(label);
      btn.appendChild(knob);
      btn.addEventListener('click', function () { togglePlatform(name); });
      box.appendChild(btn);
    });
  }

  function render() {
    if (!state || $('app').hidden) return;
    rolloverIfNeeded();
    renderHeader();
    renderToday();
    if (currentScreen === 'history') renderHistory();
    if (currentScreen === 'settings') renderSettings();
    syncShiftTimer();
  }

  function syncShiftTimer() {
    if (!state || $('app').hidden) return;
    var on = C.isShiftOn(readToday());
    if (on && !shiftTimer) {
      shiftTimer = setInterval(function () {
        if ($('app').hidden) return;
        if (rolloverIfNeeded()) render();
        else renderShiftBits();
      }, 1000);
    } else if (!on && shiftTimer) {
      clearInterval(shiftTimer);
      shiftTimer = null;
    }
  }

  function burstConfetti() {
    var canvas = $('confetti');
    if (!canvas || !canvas.getContext) return;
    var ctx = canvas.getContext('2d');
    if (!ctx) return;
    var ratio = window.devicePixelRatio || 1;
    var w = canvas.width = window.innerWidth * ratio;
    var h = canvas.height = window.innerHeight * ratio;
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = window.innerHeight + 'px';
    canvas.style.display = 'block';
    var colors = ['#F5B942', '#FFD27A', '#3DDCB2', '#FFFFFF', '#7EB6FF', '#F4F7FB'];
    var parts = [];
    for (var i = 0; i < 90; i++) {
      parts.push({
        x: w * Math.random(),
        y: -20 - Math.random() * h * 0.2,
        r: 4 + Math.random() * 6,
        c: colors[i % colors.length],
        vx: (Math.random() - 0.5) * 7,
        vy: 3 + Math.random() * 7,
        rot: Math.random() * 6,
        vr: (Math.random() - 0.5) * 0.3,
        life: 1
      });
    }
    var start = performance.now();
    if (confettiAnim) cancelAnimationFrame(confettiAnim);
    function tick(now) {
      var t = (now - start) / 1000;
      ctx.clearRect(0, 0, w, h);
      parts.forEach(function (part) {
        part.vy += 0.18;
        part.x += part.vx;
        part.y += part.vy;
        part.rot += part.vr;
        if (t > 1.2) part.life -= 0.02;
        ctx.save();
        ctx.globalAlpha = Math.max(0, part.life);
        ctx.translate(part.x, part.y);
        ctx.rotate(part.rot);
        ctx.fillStyle = part.c;
        ctx.fillRect(-part.r, -part.r / 2, part.r * 2, part.r);
        ctx.restore();
      });
      if (t < 2.4) confettiAnim = requestAnimationFrame(tick);
      else {
        ctx.clearRect(0, 0, w, h);
        canvas.style.display = 'none';
        confettiAnim = null;
      }
    }
    confettiAnim = requestAnimationFrame(tick);
  }

  function celebratedNow(before) {
    var day = state && state.days[C.dateKey()];
    return !!(day && day.celebrated && !before);
  }

  function onAdd() {
    var input = $('fareInput');
    var before = !!(state.days[C.dateKey()] && state.days[C.dateKey()].celebrated);
    var ok = addRide(input.value);
    if (!ok) {
      shake(input.parentElement);
      input.focus();
      return;
    }
    input.value = '';
    if (!celebratedNow(before)) {
      showToast('Added ride · ' + C.payLabel(state.lastPay) + ' · ' + state.lastPlatform);
    }
  }

  function bindUi() {
    if (bound) return;
    bound = true;
    $('shiftBtn').addEventListener('click', toggleShift);
    $('addBtn').addEventListener('click', onAdd);
    $('payCash').addEventListener('click', function () { setPayType('cash'); });
    $('payCredit').addEventListener('click', function () { setPayType('credit'); });
    $('fareInput').addEventListener('keydown', function (event) {
      if (event.key === 'Enter') {
        event.preventDefault();
        onAdd();
      }
    });
    var chips = $('chips');
    C.CHIPS.forEach(function (amount) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chip';
      btn.textContent = 'RM' + amount;
      btn.addEventListener('click', function () {
        var before = !!(state.days[C.dateKey()] && state.days[C.dateKey()].celebrated);
        addRide(amount);
        if (!celebratedNow(before)) {
          showToast('Added ' + C.formatRM(amount) + ' · ' + C.payLabel(state.lastPay) + ' · ' + state.lastPlatform);
        }
      });
      chips.appendChild(btn);
    });
    Array.prototype.forEach.call(document.querySelectorAll('.extra'), function (btn) {
      btn.addEventListener('click', function () {
        var field = btn.getAttribute('data-field');
        var titles = { tips: 'Tips today', incentives: 'Incentives today', fuel: 'Fuel today', tolls: 'Tolls today' };
        var day = readToday();
        openSheet(field, titles[field] || field, day[field] || 0);
      });
    });
    $('ringTargetBtn').addEventListener('click', function () {
      openSheet('target', 'Daily target', state ? state.target : C.DEFAULT_TARGET);
    });
    $('overlay').addEventListener('click', closeSheet);
    $('sheetCancel').addEventListener('click', closeSheet);
    $('sheetSave').addEventListener('click', saveSheet);
    $('sheetInput').addEventListener('keydown', function (event) {
      if (event.key === 'Enter') { event.preventDefault(); saveSheet(); }
      if (event.key === 'Escape') closeSheet();
    });
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (tab) {
      tab.addEventListener('click', function () { goTo(tab.getAttribute('data-screen')); });
    });
    $('targetInput').addEventListener('change', function () {
      if (!setTarget(this.value)) {
        shake(this.parentElement);
        this.value = String(state.target);
        showToast('Enter a target greater than 0');
      } else {
        showToast('Daily target set to ' + C.formatRM(state.target));
      }
    });
    $('btnExportCsv').addEventListener('click', function () {
      downloadFile('ridetarget-' + C.dateKey() + '.csv', 'text/csv;charset=utf-8', exportCSV());
      showToast('CSV ready');
    });
    $('btnExportJson').addEventListener('click', function () {
      downloadFile('ridetarget-backup-' + C.dateKey() + '.json', 'application/json;charset=utf-8', exportJSON());
      showToast('Backup ready');
    });
    $('btnImportJson').addEventListener('click', function () { $('fileImport').click(); });
    $('fileImport').addEventListener('change', function () {
      var file = this.files && this.files[0];
      this.value = '';
      if (!file) return;
      if (!confirm('Replace the rides on this account with this backup?')) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          importJSON(String(reader.result || ''));
          showToast('Backup restored');
        } catch (err) {
          showToast('Could not restore that file');
        }
      };
      reader.readAsText(file);
    });
    $('btnReset').addEventListener('click', function () {
      if (confirm('Erase all rides and history for this account? This cannot be undone.')) {
        resetAll();
        showToast('All data cleared');
      }
    });
    $('btnSync').addEventListener('click', function () { syncNow(true); });
    $('btnLogout').addEventListener('click', function () { logout(); });

    $('tabLogin').addEventListener('click', function () { showAuthForm('login'); });
    $('tabSignup').addEventListener('click', function () { showAuthForm('signup'); });
    $('linkForgot').addEventListener('click', function () { showAuthForm('forgot'); });
    $('linkForgotBack').addEventListener('click', function () { showAuthForm('login'); });
    $('formLogin').addEventListener('submit', onLogin);
    $('formSignup').addEventListener('submit', onSignup);
    $('formForgot').addEventListener('submit', onForgot);
    $('formRecovery').addEventListener('submit', onRecovery);
    $('btnRefresh').addEventListener('click', onRefresh);
    $('btnCopyEmail').addEventListener('click', copyEmail);
    $('btnLockedLogout').addEventListener('click', function () { logout(); });
    $('btnMissingLogout').addEventListener('click', function () { logout(); });
    $('btnConfirmLogin').addEventListener('click', function () { showAuth('login'); });
    $('btnRetry').addEventListener('click', async function () {
      var res = await client.auth.getSession();
      routeSession(res.data && res.data.session);
    });

    document.addEventListener('visibilitychange', function () {
      if (document.hidden || !approved) return;
      if (rolloverIfNeeded()) render();
      syncNow(false);
    });
    window.addEventListener('online', function () { if (approved) syncNow(false); });
    window.addEventListener('offline', function () { if (approved) setSync('offline'); });
    setInterval(function () {
      if (!approved) return;
      if (rolloverIfNeeded()) render();
    }, 15000);
  }

  async function onLogin(event) {
    event.preventDefault();
    var form = $('formLogin');
    var email = cleanEmail($('loginEmail').value);
    var password = $('loginPassword').value;
    if (!email || !password) {
      setGateError('Enter your email and password.');
      return;
    }
    setFormBusy(form, true);
    setGateError('');
    var res = await client.auth.signInWithPassword({ email: email, password: password });
    setFormBusy(form, false);
    if (res.error) setGateError(friendlyAuth(res.error));
  }

  async function onSignup(event) {
    event.preventDefault();
    var form = $('formSignup');
    var email = cleanEmail($('signupEmail').value);
    var password = $('signupPassword').value;
    if (!email || password.length < 6) {
      setGateError('Use a valid email and at least 6 characters.');
      return;
    }
    setFormBusy(form, true);
    setGateError('');
    var res = await client.auth.signUp({
      email: email,
      password: password,
      options: { emailRedirectTo: redirectUrl() }
    });
    setFormBusy(form, false);
    if (res.error) {
      setGateError(friendlyAuth(res.error));
      return;
    }
    if (!res.data.session) {
      $('confirmEmail').textContent = email;
      showPanel('confirm');
    }
  }

  async function onForgot(event) {
    event.preventDefault();
    var form = $('formForgot');
    var email = cleanEmail($('forgotEmail').value);
    if (!email) {
      setGateError('Enter your email.');
      return;
    }
    setFormBusy(form, true);
    var res = await client.auth.resetPasswordForEmail(email, { redirectTo: redirectUrl() });
    setFormBusy(form, false);
    if (res.error) {
      setGateError(friendlyAuth(res.error));
      return;
    }
    setGateError('');
    showToastOnGate('If that email is registered, a reset link is on its way.');
  }

  function showToastOnGate(msg) {
    setGateError('');
    var el = $('gateError');
    el.style.color = 'var(--teal)';
    el.textContent = msg;
    setTimeout(function () { el.style.color = ''; }, 4000);
  }

  async function onRecovery(event) {
    event.preventDefault();
    var a = $('recoveryPassword').value;
    var b = $('recoveryPassword2').value;
    if (a.length < 6) {
      setGateError('Use at least 6 characters.');
      return;
    }
    if (a !== b) {
      setGateError('Passwords do not match.');
      return;
    }
    var form = $('formRecovery');
    setFormBusy(form, true);
    var res = await client.auth.updateUser({ password: a });
    setFormBusy(form, false);
    if (res.error) {
      setGateError(friendlyAuth(res.error));
      return;
    }
    recoveryMode = false;
    if (window.history && window.history.replaceState) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
    var sessionRes = await client.auth.getSession();
    routeSession(sessionRes.data && sessionRes.data.session);
  }

  async function onRefresh() {
    $('btnRefresh').disabled = true;
    var res = await client.auth.getSession();
    await routeSession(res.data && res.data.session);
    $('btnRefresh').disabled = false;
  }

  async function copyEmail() {
    var text = ($('lockedEmail') && $('lockedEmail').textContent) || userEmail || '';
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        $('btnCopyEmail').textContent = 'Copied';
        return;
      }
    } catch (e) { /* fall through */ }
    setGateError(text ? 'Select and copy: ' + text : 'No email to copy');
  }

  async function logout() {
    routeGen += 1;
    approved = false;
    userId = null;
    loadedFor = null;
    recoveryMode = false;
    state = null;
    if (client) {
      try { await client.auth.signOut(); } catch (e) { /* still leave */ }
    }
    showAuth('login');
  }

  function registerSw() {
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return;
    navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(function () {});
  }

  function init() {
    if (!C) {
      showPanel('library');
      return;
    }
    bindUi();
    var status = C.configStatus(window.RIDETARGET_CONFIG || {});
    if (status === 'missing') {
      showPanel('config');
      registerSw();
      return;
    }
    if (status === 'secret') {
      showPanel('secret');
      registerSw();
      return;
    }
    if (typeof supabase === 'undefined' || !supabase.createClient) {
      showPanel('library');
      return;
    }
    showPanel('loading');
    startAuth();
    registerSw();
  }

  window.__ridetarget = {
    addRide: function (amount, ts, pay, platform) { return addRide(amount, ts, pay, platform); },
    getState: function () { return state; },
    formatRM: C.formatRM
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
