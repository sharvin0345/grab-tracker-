/* Headless checks for the sales page, both languages, the share card, and the locked screen. */
var assert = require('assert');
var fs = require('fs');
var http = require('http');
var path = require('path');
var puppeteer = require('puppeteer-core');

var ROOT = path.resolve(__dirname, '..');
var OUT = '/opt/cursor/artifacts';
var PORT = 8773;
var USER = '11111111-1111-4111-8111-111111111111';
var SUPABASE = 'https://ridetargettest.supabase.co';

function b64url(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}
function jwt(payload) {
  return b64url({ alg: 'HS256', typ: 'JWT' }) + '.' + b64url(payload) + '.sig';
}
var ANON = jwt({ role: 'anon' });
var ACCESS = jwt({ role: 'authenticated', sub: USER });

function session() {
  return {
    access_token: ACCESS,
    refresh_token: 'refresh-token-value',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    token_type: 'bearer',
    user: {
      id: USER, aud: 'authenticated', role: 'authenticated',
      email: 'driver@example.com',
      app_metadata: { provider: 'email' }, user_metadata: {},
      created_at: '2026-11-01T00:00:00.000Z'
    }
  };
}

function startServer() {
  return new Promise(function (resolve) {
    var server = http.createServer(function (req, res) {
      var urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      if (urlPath === '/') urlPath = '/home.html';
      var file = path.normalize(path.join(ROOT, urlPath));
      if (!file.startsWith(ROOT)) { res.writeHead(403); res.end('no'); return; }
      fs.readFile(file, function (err, buf) {
        if (err) { res.writeHead(404); res.end('missing'); return; }
        var type = 'text/plain';
        if (file.endsWith('.html')) type = 'text/html';
        else if (file.endsWith('.js')) type = 'text/javascript';
        else if (file.endsWith('.css')) type = 'text/css';
        else if (file.endsWith('.svg')) type = 'image/svg+xml';
        else if (file.endsWith('.png')) type = 'image/png';
        res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
        res.end(buf);
      });
    });
    server.listen(PORT, '127.0.0.1', function () { resolve(server); });
  });
}

async function main() {
  assert.ok(fs.existsSync(path.join(ROOT, 'media/today.png')));
  assert.ok(fs.existsSync(path.join(ROOT, 'media/history.png')));
  assert.ok(fs.existsSync(path.join(ROOT, 'og.png')));
  fs.mkdirSync(OUT, { recursive: true });
  var server = await startServer();
  var browser = await puppeteer.launch({
    executablePath: '/usr/local/bin/google-chrome',
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
  });
  var mode = 'approved';
  var page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  await page.setRequestInterception(true);
  page.on('request', function (req) {
    var url = req.url();
    if (url.indexOf('cdn.jsdelivr.net') !== -1 && fs.existsSync('/tmp/supabase.js')) {
      req.respond({ status: 200, contentType: 'text/javascript', body: fs.readFileSync('/tmp/supabase.js') });
      return;
    }
    var api = url.indexOf(SUPABASE) === 0 || url.indexOf('https://mzpatcmydulgknegjkzu.supabase.co') === 0;
    if (!api) { req.continue(); return; }
    var cors = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': '*',
      'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
      'content-type': 'application/json'
    };
    if (req.method() === 'OPTIONS') { req.respond({ status: 204, headers: cors }); return; }
    var pathName = url.replace(/^https:\/\/[^/]+/, '').split('?')[0];
    var approved = mode === 'approved';
    if (pathName === '/rest/v1/profiles') {
      req.respond({ status: 200, headers: cors, body: JSON.stringify([{ id: USER, email: 'driver@example.com', approved: approved, is_admin: false, created_at: '2026-11-01T00:00:00.000Z' }]) });
      return;
    }
    if (pathName === '/rest/v1/settings') {
      req.respond({ status: 200, headers: cors, body: JSON.stringify([{ user_id: USER, daily_target: 300, last_pay: 'cash', last_platform: 'Grab', platforms: ['Grab', 'inDrive', 'Other'], days: {} }]) });
      return;
    }
    if (pathName === '/rest/v1/rides') {
      req.respond({ status: 200, headers: cors, body: '[]' });
      return;
    }
    req.respond({ status: 200, headers: cors, body: '{}' });
  });

  await page.goto('http://127.0.0.1:' + PORT + '/home.html', { waitUntil: 'networkidle0', timeout: 20000 });
  var en = await page.evaluate(function () { return document.body.innerText; });
  assert.ok(en.indexOf('Hit your daily target. Every app. One tracker.') !== -1, en.slice(0, 200));
  assert.ok(en.indexOf('RM15') !== -1);
  assert.ok(en.indexOf('RM20') !== -1);
  assert.ok(/launch price/i.test(en));
  assert.ok(en.toLowerCase().indexOf('testimonial') === -1);
  assert.ok(en.indexOf('00B14F') === -1);
  var wa = await page.$eval('[data-whatsapp]', function (a) { return a.href; });
  assert.ok(wa.indexOf('https://wa.me/60123456789?text=') === 0, wa);
  assert.ok(decodeURIComponent(wa).indexOf('Hi, I want to buy RideTarget. My registered email is:') !== -1);
  var signup = await page.$eval('a[href="index.html"]', function (a) { return a.getAttribute('href'); });
  assert.strictEqual(signup, 'index.html');
  var og = await page.$eval('meta[property="og:image"]', function (el) { return el.content; });
  assert.ok(og.indexOf('/ridetarget/og.png') !== -1, og);
  await page.screenshot({ path: path.join(OUT, 'ridetarget-home-en.png') });
  await page.screenshot({ path: path.join(OUT, 'ridetarget-home-en-full.png'), fullPage: true });

  await page.click('[data-set-lang="ms"]');
  await page.waitForFunction(function () {
    return document.body.innerText.indexOf('Capai target harian') !== -1;
  });
  var ms = await page.evaluate(function () { return document.body.innerText; });
  assert.ok(ms.indexOf('Beli sekarang') !== -1, ms.slice(0, 300));
  assert.ok(ms.indexOf('Cuba daftar') !== -1);
  assert.ok(/harga lancar/i.test(ms));
  var saved = await page.evaluate(function () { return localStorage.getItem('ridetarget.lang'); });
  assert.strictEqual(saved, 'ms');
  var waMs = await page.$eval('[data-whatsapp]', function (a) { return decodeURIComponent(a.href); });
  assert.ok(waMs.indexOf('saya nak beli RideTarget') !== -1, waMs);
  await page.evaluate(function () { window.scrollTo(0, 0); });
  await page.screenshot({ path: path.join(OUT, 'ridetarget-home-ms.png') });
  await page.screenshot({ path: path.join(OUT, 'ridetarget-home-ms-full.png'), fullPage: true });
  await page.reload({ waitUntil: 'networkidle0' });
  var still = await page.evaluate(function () { return document.body.innerText.indexOf('Capai target harian') !== -1; });
  assert.strictEqual(still, true);

  mode = 'locked';
  await page.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.evaluate(function (payload) {
    localStorage.setItem('ridetarget-auth', JSON.stringify(payload));
    localStorage.setItem('ridetarget.lang', 'en');
  }, session());
  await page.reload({ waitUntil: 'networkidle0', timeout: 20000 });
  await page.waitForFunction(function () {
    return document.body.innerText.indexOf('waiting for activation') !== -1;
  }, { timeout: 10000 });
  var lockedText = await page.evaluate(function () { return document.body.innerText; });
  assert.ok(lockedText.indexOf('Your account is waiting for activation. After payment, send your registered email to the seller.') !== -1);
  assert.ok(lockedText.indexOf('What is RideTarget?') !== -1);
  var lockedWa = await page.$eval('#btnWhatsApp', function (a) { return a.href; });
  assert.ok(lockedWa.indexOf('https://wa.me/60123456789') === 0, lockedWa);
  assert.ok(decodeURIComponent(lockedWa).indexOf('driver@example.com') !== -1, lockedWa);
  var homeLink = await page.$eval('#panel-locked a[href="home.html"]', function (a) { return a.getAttribute('href'); });
  assert.strictEqual(homeLink, 'home.html');
  await page.click('.gate-tools [data-set-lang="ms"]');
  await page.waitForFunction(function () {
    return document.getElementById('lockedMessage').textContent.indexOf('menunggu pengaktifan') !== -1;
  });
  var msLocked = await page.$eval('#lockedMessage', function (el) { return el.textContent; });
  assert.ok(msLocked.indexOf('hantar email') !== -1, msLocked);

  mode = 'approved';
  await page.evaluate(function () { localStorage.setItem('ridetarget.lang', 'en'); });
  await page.reload({ waitUntil: 'networkidle0', timeout: 20000 });
  await page.waitForFunction(function () {
    var title = document.getElementById('headerTitle');
    return title && title.textContent === 'Today' && !document.getElementById('app').hidden;
  }, { timeout: 10000 });
  var card = await page.evaluate(function () {
    var canvas = window.__ridetarget.drawShareCard();
    var sample = canvas.getContext('2d').getImageData(100, 120, 1, 1).data;
    return { w: canvas.width, h: canvas.height, url: canvas.toDataURL('image/png'), r: sample[0], g: sample[1], b: sample[2] };
  });
  assert.strictEqual(card.w, 1080);
  assert.strictEqual(card.h, 1080);
  assert.ok(card.url.indexOf('data:image/png') === 0);
  assert.ok(card.url.length > 5000);
  fs.writeFileSync('/tmp/rt-share-card.png', Buffer.from(card.url.split(',')[1], 'base64'));
  await page.click('#btnShare');
  await page.click('button[data-screen="settings"]');
  await page.click('#screen-settings [data-set-lang="ms"]');
  await page.waitForFunction(function () {
    return document.getElementById('addBtn').textContent.indexOf('Tambah') !== -1;
  });
  var bmApp = await page.evaluate(function () {
    return {
      add: document.getElementById('addBtn').textContent,
      cash: document.getElementById('payCash').textContent,
      share: document.getElementById('btnShare').textContent,
      lang: localStorage.getItem('ridetarget.lang')
    };
  });
  assert.strictEqual(bmApp.lang, 'ms');
  assert.ok(bmApp.add.indexOf('Tambah') !== -1, bmApp.add);
  assert.strictEqual(bmApp.cash, 'Tunai');
  assert.ok(bmApp.share.indexOf('Kongsi') !== -1, bmApp.share);

  await browser.close();
  server.close();
  console.log('landing tests passed');
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
