/* RideTarget pure helpers. Shared by the app and the node checks. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RideTargetCalc = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var TZ = 'Asia/Kuala_Lumpur';
  var DEFAULT_TARGET = 300;
  var PLATFORMS = Object.freeze([
    'Grab',
    'inDrive',
    'AirAsia Ride',
    'Maxim',
    'Bolt',
    'foodpanda',
    'ShopeeFood',
    'Lalamove',
    'Other'
  ]);
  var CHIPS = Object.freeze([10, 15, 20, 25, 30, 40, 50]);
  var DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

  function dateKey(d) {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(d || new Date());
  }

  function startOfDayTs(key) {
    var p = String(key).split('-').map(Number);
    return Date.UTC(p[0], p[1] - 1, p[2]) - 8 * 3600000;
  }

  function weekdayIndex(key) {
    var ts = startOfDayTs(key) + 12 * 3600000;
    var wd = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' }).format(new Date(ts));
    return { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[wd];
  }

  function addDays(key, n) {
    return dateKey(new Date(startOfDayTs(key) + 12 * 3600000 + n * 86400000));
  }

  function mondayOf(key) {
    var dow = weekdayIndex(key);
    var offset = (dow + 6) % 7;
    return addDays(key, -offset);
  }

  function roundMoney(n) {
    var v = Number(n);
    if (!isFinite(v)) return 0;
    return Math.round(v * 100) / 100;
  }

  function formatRM(n) {
    var v = Number(n);
    if (!isFinite(v)) v = 0;
    var abs = Math.abs(v).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return (v < 0 ? '-RM ' : 'RM ') + abs;
  }

  function formatTime(ts) {
    return new Intl.DateTimeFormat('en-MY', {
      timeZone: TZ,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    }).format(new Date(ts));
  }

  function formatLongDate(key) {
    var ts = startOfDayTs(key) + 12 * 3600000;
    return new Intl.DateTimeFormat('en-MY', {
      timeZone: TZ,
      weekday: 'long',
      day: 'numeric',
      month: 'long'
    }).format(new Date(ts));
  }

  function formatShortDate(key) {
    var ts = startOfDayTs(key) + 12 * 3600000;
    return new Intl.DateTimeFormat('en-MY', {
      timeZone: TZ,
      weekday: 'short',
      day: 'numeric',
      month: 'short'
    }).format(new Date(ts));
  }

  function formatDuration(ms) {
    if (!isFinite(ms) || ms < 0) ms = 0;
    var totalMin = Math.floor(ms / 60000);
    var h = Math.floor(totalMin / 60);
    var m = totalMin % 60;
    if (h <= 0) return m + 'm';
    return h + 'h ' + String(m).padStart(2, '0') + 'm';
  }

  function parseAmount(raw) {
    if (raw == null) return null;
    var original = String(raw).trim();
    if (!original || /[-]/.test(original)) return null;
    var s = original.replace(/,/g, '.').replace(/[^\d.]/g, '');
    if (!s) return null;
    var first = s.indexOf('.');
    if (first !== -1) {
      s = s.slice(0, first + 1) + s.slice(first + 1).replace(/\./g, '');
    }
    var n = Number(s);
    if (!isFinite(n) || n <= 0) return null;
    n = roundMoney(n);
    if (n > 99999.99) return null;
    return n;
  }

  function parseTarget(raw) {
    var n = parseAmount(raw);
    if (n == null || n > 999999.99) return null;
    return n;
  }

  function normalizePay(v) {
    return String(v || '').toLowerCase() === 'credit' ? 'credit' : 'cash';
  }

  function payLabel(pay) {
    return normalizePay(pay) === 'credit' ? 'Credit' : 'Cash';
  }

  function knownPlatform(name) {
    return PLATFORMS.indexOf(name) !== -1;
  }

  function newId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    var hex = '0123456789abcdef';
    var s = '';
    for (var i = 0; i < 36; i++) {
      if (i === 8 || i === 13 || i === 18 || i === 23) s += '-';
      else if (i === 14) s += '4';
      else if (i === 19) s += hex[(Math.random() * 4 | 0) + 8];
      else s += hex[Math.random() * 16 | 0];
    }
    return s;
  }

  function defaultDay() {
    return {
      rides: [],
      tips: 0,
      incentives: 0,
      fuel: 0,
      tolls: 0,
      segments: [],
      celebrated: false
    };
  }

  function defaultPlatforms() {
    return PLATFORMS.slice();
  }

  function defaultState() {
    return {
      target: DEFAULT_TARGET,
      lastPay: 'cash',
      lastPlatform: 'Grab',
      platforms: defaultPlatforms(),
      days: {},
      settingsDirty: false,
      pendingReset: false,
      rev: 0
    };
  }

  function sanitizeDay(src) {
    var day = defaultDay();
    src = src || {};
    ['tips', 'incentives', 'fuel', 'tolls'].forEach(function (k) {
      var v = Number(src[k]);
      day[k] = isFinite(v) && v >= 0 ? roundMoney(v) : 0;
      if (day[k] > 999999.99) day[k] = 999999.99;
    });
    day.celebrated = !!src.celebrated;
    if (Array.isArray(src.segments)) {
      day.segments = src.segments.map(function (seg) {
        var start = Number(seg && seg.start);
        var end = seg && seg.end == null ? null : Number(seg.end);
        if (!isFinite(start) || start <= 0) return null;
        if (end != null && (!isFinite(end) || end < start)) end = start;
        return { start: start, end: end };
      }).filter(Boolean);
    }
    if (Array.isArray(src.rides)) {
      day.rides = src.rides.map(function (r) {
        if (!r || typeof r !== 'object') return null;
        var amount = roundMoney(Number(r.amount));
        if (!isFinite(amount) || amount <= 0 || amount > 99999.99) return null;
        var ts = Number(r.ts);
        if (!isFinite(ts) || ts <= 0) ts = Date.now();
        var id = String(r.id || r.client_id || '').trim();
        if (!id || id.length > 80) id = newId();
        return {
          id: id,
          amount: amount,
          ts: ts,
          pay: normalizePay(r.pay),
          platform: knownPlatform(r.platform) ? r.platform : 'Other',
          deleted: !!r.deleted,
          dirty: !!r.dirty,
          synced: !!r.synced
        };
      }).filter(Boolean);
    }
    return day;
  }

  function uniquePlatforms(list) {
    var seen = {};
    var out = [];
    (list || []).forEach(function (name) {
      if (!knownPlatform(name) || seen[name]) return;
      seen[name] = true;
      out.push(name);
    });
    return out.length ? out : defaultPlatforms();
  }

  function sanitizeState(raw) {
    var base = defaultState();
    if (!raw || typeof raw !== 'object') return base;
    var target = Number(raw.target != null ? raw.target : raw.daily_target);
    if (isFinite(target) && target > 0 && target <= 999999.99) base.target = roundMoney(target);
    base.lastPay = normalizePay(raw.lastPay != null ? raw.lastPay : raw.last_pay);
    base.platforms = uniquePlatforms(raw.platforms);
    var last = raw.lastPlatform != null ? raw.lastPlatform : raw.last_platform;
    base.lastPlatform = knownPlatform(last) && base.platforms.indexOf(last) !== -1
      ? last
      : base.platforms[0];
    base.settingsDirty = !!raw.settingsDirty;
    base.pendingReset = !!raw.pendingReset;
    var rev = Number(raw.rev);
    base.rev = isFinite(rev) && rev >= 0 ? rev : 0;
    var days = raw.days && typeof raw.days === 'object' ? raw.days : {};
    Object.keys(days).forEach(function (key) {
      if (!DAY_KEY.test(key)) return;
      base.days[key] = sanitizeDay(days[key]);
    });
    return base;
  }

  function activeRides(day) {
    return (day && day.rides ? day.rides : []).filter(function (r) { return r && !r.deleted; });
  }

  function rideTotal(day) {
    return roundMoney(activeRides(day).reduce(function (sum, r) {
      return sum + (Number(r.amount) || 0);
    }, 0));
  }

  function gross(day) {
    return roundMoney(rideTotal(day) + (Number(day && day.tips) || 0) + (Number(day && day.incentives) || 0));
  }

  function net(day) {
    return roundMoney(gross(day) - (Number(day && day.fuel) || 0) - (Number(day && day.tolls) || 0));
  }

  function payTotals(day) {
    var cash = 0;
    var credit = 0;
    activeRides(day).forEach(function (r) {
      var amt = Number(r.amount) || 0;
      if (normalizePay(r.pay) === 'credit') credit += amt;
      else cash += amt;
    });
    return { cash: roundMoney(cash), credit: roundMoney(credit) };
  }

  function platformTotals(day) {
    var out = {};
    activeRides(day).forEach(function (r) {
      var name = knownPlatform(r.platform) ? r.platform : 'Other';
      out[name] = roundMoney((out[name] || 0) + (Number(r.amount) || 0));
    });
    return out;
  }

  function isShiftOn(day) {
    var segs = (day && day.segments) || [];
    return segs.length > 0 && segs[segs.length - 1].end == null;
  }

  function shiftMs(day, now) {
    now = now || Date.now();
    var ms = 0;
    ((day && day.segments) || []).forEach(function (seg) {
      var end = seg.end == null ? now : seg.end;
      ms += Math.max(0, end - seg.start);
    });
    return ms;
  }

  function dayHasData(day) {
    if (!day) return false;
    if (activeRides(day).length) return true;
    if (day.tips || day.incentives || day.fuel || day.tolls) return true;
    if ((day.segments || []).length) return true;
    return false;
  }

  function statsFor(day, target, now) {
    var rides = activeRides(day);
    var rt = rideTotal(day);
    var goal = Number(target) || 0;
    var remaining = Math.max(0, roundMoney(goal - rt));
    var count = rides.length;
    var avg = count ? rt / count : 0;
    var est = remaining <= 0 ? 0 : (avg > 0 ? Math.ceil(remaining / avg) : null);
    var ms = shiftMs(day, now);
    var hrs = ms / 3600000;
    var g = gross(day);
    var rph = hrs >= 0.1 ? g / hrs : null;
    return {
      rideTotal: rt,
      remaining: remaining,
      count: count,
      avg: avg,
      est: est,
      ms: ms,
      hours: hrs,
      rph: rph,
      gross: g,
      net: net(day),
      hit: rt >= goal && goal > 0
    };
  }

  function decodeBase64(b64) {
    if (typeof atob === 'function') {
      try { return atob(b64); } catch (e) { /* try buffer */ }
    }
    if (typeof Buffer !== 'undefined') return Buffer.from(b64, 'base64').toString('utf8');
    return '';
  }

  function jwtRole(key) {
    try {
      var parts = String(key || '').split('.');
      if (parts.length < 2) return '';
      var b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4) b64 += '=';
      var json = JSON.parse(decodeBase64(b64));
      return json && json.role ? String(json.role) : '';
    } catch (e) {
      return '';
    }
  }

  function isSecretKey(key) {
    var value = String(key || '').trim();
    if (/^sb_secret_/i.test(value)) return true;
    return jwtRole(value) === 'service_role';
  }

  function configStatus(cfg) {
    var url = cfg && String(cfg.SUPABASE_URL || '').trim();
    var key = cfg && String(cfg.SUPABASE_ANON_KEY || '').trim();
    if (!url || !key) return 'missing';
    if (url.indexOf('YOUR_') !== -1 || key.indexOf('YOUR_') !== -1) return 'missing';
    if (!/^https:\/\/.+/i.test(url) || /\s/.test(url)) return 'missing';
    if (isSecretKey(key)) return 'secret';
    if (/^sb_publishable_/i.test(key)) return 'ok';
    if (key.length < 20 || /\s/.test(key)) return 'missing';
    return 'ok';
  }

  return {
    TZ: TZ,
    DEFAULT_TARGET: DEFAULT_TARGET,
    PLATFORMS: PLATFORMS,
    CHIPS: CHIPS,
    dateKey: dateKey,
    startOfDayTs: startOfDayTs,
    weekdayIndex: weekdayIndex,
    addDays: addDays,
    mondayOf: mondayOf,
    roundMoney: roundMoney,
    formatRM: formatRM,
    formatTime: formatTime,
    formatLongDate: formatLongDate,
    formatShortDate: formatShortDate,
    formatDuration: formatDuration,
    parseAmount: parseAmount,
    parseTarget: parseTarget,
    normalizePay: normalizePay,
    payLabel: payLabel,
    knownPlatform: knownPlatform,
    newId: newId,
    defaultDay: defaultDay,
    defaultState: defaultState,
    sanitizeDay: sanitizeDay,
    sanitizeState: sanitizeState,
    activeRides: activeRides,
    rideTotal: rideTotal,
    gross: gross,
    net: net,
    payTotals: payTotals,
    platformTotals: platformTotals,
    isShiftOn: isShiftOn,
    shiftMs: shiftMs,
    dayHasData: dayHasData,
    statsFor: statsFor,
    configStatus: configStatus,
    jwtRole: jwtRole
  };
});
