/* Builder checks. Not used by the app. */
var assert = require('assert');
var C = require('../calc.js');

function b64url(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

var day = C.sanitizeDay({
  tips: 10,
  incentives: 5,
  fuel: 20,
  tolls: 7,
  rides: [
    { id: 'a', amount: 40, ts: 1000, pay: 'cash', platform: 'Grab' },
    { id: 'b', amount: 60, ts: 2000, pay: 'credit', platform: 'inDrive' },
    { id: 'c', amount: 15, ts: 3000, pay: 'cash', platform: 'Nope' },
    { id: 'd', amount: 10, ts: 4000, pay: 'cash', platform: 'Grab', deleted: true }
  ]
});

assert.strictEqual(C.rideTotal(day), 115);
assert.strictEqual(C.gross(day), 130);
assert.strictEqual(C.net(day), 103);
assert.deepStrictEqual(C.payTotals(day), { cash: 55, credit: 60 });
assert.strictEqual(C.platformTotals(day).Grab, 40);
assert.strictEqual(C.platformTotals(day).inDrive, 60);
assert.strictEqual(C.platformTotals(day).Other, 15);
assert.strictEqual(C.platformTotals(day).GrabDeleted, undefined);
assert.strictEqual(C.activeRides(day).length, 3);

var stats = C.statsFor(day, 300);
assert.strictEqual(stats.hit, false);
assert.strictEqual(stats.remaining, 185);
assert.strictEqual(stats.count, 3);
assert.strictEqual(stats.est, 5);

assert.strictEqual(C.parseAmount('10,50'), 10.5);
assert.strictEqual(C.parseAmount('RM 20'), 20);
assert.strictEqual(C.parseAmount('0'), null);
assert.strictEqual(C.parseAmount('-5'), null);
assert.strictEqual(C.formatRM(12), 'RM 12.00');
assert.strictEqual(C.formatRM(-3), '-RM 3.00');
assert.strictEqual(C.normalizePay('Credit'), 'credit');
assert.strictEqual(C.defaultState().target, 300);

var cleaned = C.sanitizeState({ target: '450', lastPay: 'credit', platforms: ['Bolt', 'Bolt', 'nope'], days: { bad: {}, '2026-11-17': { rides: [] } } });
assert.strictEqual(cleaned.target, 450);
assert.strictEqual(cleaned.lastPay, 'credit');
assert.deepStrictEqual(cleaned.platforms, ['Bolt']);
assert.strictEqual(cleaned.lastPlatform, 'Bolt');
assert.ok(cleaned.days['2026-11-17']);
assert.ok(!cleaned.days.bad);
var fallback = C.sanitizeState({ platforms: ['nope'] });
assert.deepStrictEqual(fallback.platforms, C.PLATFORMS.slice());

var kept = C.sanitizeState({ platforms: ['foodpanda', 'Lalamove'], lastPlatform: 'Lalamove' });
assert.deepStrictEqual(kept.platforms, ['foodpanda', 'Lalamove']);
assert.strictEqual(kept.lastPlatform, 'Lalamove');

assert.strictEqual(C.dateKey(new Date('2026-11-17T15:59:00Z')), '2026-11-17');
assert.strictEqual(C.dateKey(new Date('2026-11-17T16:00:00Z')), '2026-11-18');
assert.strictEqual(C.weekdayIndex('2026-11-17'), 2);
assert.strictEqual(C.mondayOf('2026-11-17'), '2026-11-16');
assert.strictEqual(C.addDays('2026-11-17', 1), '2026-11-18');

var on = C.sanitizeDay({ segments: [{ start: 1_700_000_000_000, end: null }] });
assert.strictEqual(C.isShiftOn(on), true);
assert.ok(C.shiftMs(on, 1_700_000_060_000) >= 60000);

assert.strictEqual(C.configStatus({ SUPABASE_URL: 'YOUR_SUPABASE_URL', SUPABASE_ANON_KEY: 'YOUR_SUPABASE_ANON_KEY' }), 'missing');
assert.strictEqual(C.configStatus({ SUPABASE_URL: 'https://abc.supabase.co', SUPABASE_ANON_KEY: 'short' }), 'missing');
var anon = b64url({ alg: 'none' }) + '.' + b64url({ role: 'anon' }) + '.sig';
var secret = b64url({ alg: 'none' }) + '.' + b64url({ role: 'service_role' }) + '.sig';
assert.strictEqual(C.configStatus({ SUPABASE_URL: 'https://abc.supabase.co', SUPABASE_ANON_KEY: anon }), 'ok');
assert.strictEqual(C.configStatus({ SUPABASE_URL: 'https://abc.supabase.co/', SUPABASE_ANON_KEY: secret }), 'secret');
assert.strictEqual(C.configStatus({
  SUPABASE_URL: 'https://mzpatcmydulgknegjkzu.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_aMt-fwevnccXe_JaXLYJnQ_-LeqXjuM'
}), 'ok');
assert.strictEqual(C.configStatus({
  SUPABASE_URL: 'https://abc.supabase.co',
  SUPABASE_ANON_KEY: 'sb_secret_abcdefghijklmnopqrstuvwxyz'
}), 'secret');
assert.strictEqual(C.configStatus({
  SUPABASE_URL: 'https://abc.supabase.co',
  SUPABASE_ANON_KEY: 'sb_secret_short'
}), 'secret');
assert.strictEqual(C.PLATFORMS.length, 9);
assert.ok(C.PLATFORMS.indexOf('Grab') !== -1);
assert.ok(C.PLATFORMS.indexOf('AirAsia Ride') !== -1);
assert.ok(C.PLATFORMS.indexOf('ShopeeFood') !== -1);

console.log('calc tests passed');
