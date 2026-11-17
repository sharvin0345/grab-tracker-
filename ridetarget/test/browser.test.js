/* Headless checks for the config gate, the locked screen, and the tracker. */
var assert = require('assert');
var fs = require('fs');
var http = require('http');
var path = require('path');
var puppeteer = require('puppeteer-core');

var ROOT = path.resolve(__dirname, '..');
var PORT = 8765;
var USER = '11111111-1111-4111-8111-111111111111';
var SUPABASE = 'https://ridetargettest.supabase.co';

function b64url(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

function jwt(payload) {
  return b64url({ alg: 'HS256', typ: 'JWT' }) + '.' + b64url(payload) + '.sig';
}

var ANON = jwt({ role: 'anon', iss: 'ridetarget-test' });
var ACCESS = jwt({ role: 'authenticated', sub: USER, email: 'driver@example.com' });

function session() {
  return {
    access_token: ACCESS,
    refresh_token: 'refresh-token-value',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 60 * 60,
    token_type: 'bearer',
    user: {
      id: USER,
      aud: 'authenticated',
      role: 'authenticated',
      email: 'driver@example.com',
      app_metadata: { provider: 'email' },
      user_metadata: {},
      created_at: '2026-11-17T00:00:00.000Z'
    }
  };
}

function startServer() {
  return new Promise(function (resolve) {
    var server = http.createServer(function (req, res) {
      var urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      if (urlPath === '/') urlPath = '/index.html';
      var file = path.join(ROOT, urlPath);
      if (!file.startsWith(ROOT)) {
        res.writeHead(403);
        res.end('no');
        return;
      }
      fs.readFile(file, function (err, buf) {
        if (err) {
          res.writeHead(404);
          res.end('missing');
          return;
        }
        var type = 'text/plain';
        if (file.endsWith('.html')) type = 'text/html';
        else if (file.endsWith('.js')) type = 'text/javascript';
        else if (file.endsWith('.css')) type = 'text/css';
        else if (file.endsWith('.json')) type = 'application/json';
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
  var server = await startServer();
  var hits = [];
  var rides = [];
  var mode = 'config';
  var browser = await puppeteer.launch({
    executablePath: '/usr/local/bin/google-chrome',
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
  });

  function cors(extra) {
    return Object.assign({
      'access-control-allow-origin': '*',
      'access-control-allow-headers': '*',
      'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
      'access-control-max-age': '600',
      'content-type': 'application/json'
    }, extra || {});
  }

  async function arm(page) {
    await page.setRequestInterception(true);
    page.on('request', function (req) {
      var url = req.url();
      if (url.indexOf('cdn.jsdelivr.net') !== -1) {
        req.respond({
          status: 200,
          contentType: 'text/javascript; charset=utf-8',
          body: fs.readFileSync('/tmp/supabase.js')
        });
        return;
      }
      if (url.indexOf('/config.js') !== -1 && mode !== 'config') {
        req.respond({
          status: 200,
          contentType: 'text/javascript; charset=utf-8',
          body: 'window.RIDETARGET_CONFIG={SUPABASE_URL:"' + SUPABASE + '",SUPABASE_ANON_KEY:"' + ANON + '"};'
        });
        return;
      }
      if (url.indexOf(SUPABASE) === 0) {
        hits.push(req.method() + ' ' + url);
        if (req.method() === 'OPTIONS') {
          req.respond({ status: 204, headers: cors() });
          return;
        }
        var pathName = url.slice(SUPABASE.length).split('?')[0];
        var approved = mode === 'approved';
        var profile = {
          id: USER,
          email: 'driver@example.com',
          approved: approved,
          is_admin: approved,
          created_at: '2026-11-17T00:00:00.000Z'
        };
        if (pathName === '/rest/v1/profiles') {
          req.respond({ status: 200, headers: cors(), body: JSON.stringify([profile]) });
          return;
        }
        if (pathName === '/rest/v1/settings' && req.method() === 'GET') {
          req.respond({
            status: 200,
            headers: cors(),
            body: JSON.stringify([{
              user_id: USER,
              daily_target: 300,
              last_pay: 'cash',
              last_platform: 'Grab',
              platforms: ['Grab', 'inDrive', 'AirAsia Ride', 'Maxim', 'Bolt', 'foodpanda', 'ShopeeFood', 'Lalamove', 'Other'],
              days: {}
            }])
          });
          return;
        }
        if (pathName === '/rest/v1/settings') {
          req.respond({ status: 201, headers: cors(), body: req.postData() || '{}' });
          return;
        }
        if (pathName === '/rest/v1/rides' && req.method() === 'GET') {
          req.respond({ status: 200, headers: cors(), body: JSON.stringify(rides.filter(function (ride) { return !ride.deleted; })) });
          return;
        }
        if (pathName === '/rest/v1/rides' && (req.method() === 'POST' || req.method() === 'PATCH')) {
          var body = JSON.parse(req.postData() || '[]');
          var rows = Array.isArray(body) ? body : [body];
          rows.forEach(function (row) {
            rides = rides.filter(function (ride) { return ride.client_id !== row.client_id; });
            rides.push(row);
          });
          req.respond({ status: 201, headers: cors(), body: JSON.stringify(rows) });
          return;
        }
        if (pathName === '/rest/v1/rides' && req.method() === 'DELETE') {
          rides = [];
          req.respond({ status: 200, headers: cors(), body: '[]' });
          return;
        }
        if (pathName.indexOf('/auth/v1/user') === 0) {
          req.respond({ status: 200, headers: cors(), body: JSON.stringify(session().user) });
          return;
        }
        req.respond({ status: 200, headers: cors(), body: '{}' });
        return;
      }
      req.continue();
    });
    await page.evaluateOnNewDocument(function () {
      var fake = {
        register: function () { return Promise.resolve({ scope: './' }); },
        getRegistrations: function () { return Promise.resolve([]); },
        ready: Promise.resolve({}),
        addEventListener: function () {},
        removeEventListener: function () {}
      };
      Object.defineProperty(navigator, 'serviceWorker', { configurable: true, get: function () { return fake; } });
    });
  }

  async function shot(page, name) {
    var file = '/tmp/rt-' + name + '.png';
    await page.screenshot({ path: file });
    return file;
  }

  var failures = [];
  try {
    var page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    var errors = [];
    page.on('pageerror', function (err) { errors.push(String(err)); });
    await arm(page);

    mode = 'config';
    await page.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil: 'load', timeout: 20000 });
    await page.waitForFunction(function () {
      return document.body.innerText.indexOf('not connected yet') !== -1;
    }, { timeout: 10000 });
    var configText = await page.evaluate(function () { return document.body.innerText; });
    assert.ok(configText.indexOf('RideTarget is not connected yet') !== -1, configText);
    assert.ok(configText.indexOf('config.js') !== -1);
    await shot(page, 'config');

    await page.goto('http://127.0.0.1:' + PORT + '/admin.html', { waitUntil: 'load', timeout: 20000 });
    await page.waitForFunction(function () {
      return document.body.innerText.indexOf('not connected yet') !== -1;
    }, { timeout: 10000 });
    await shot(page, 'admin-config');
    await page.close();

    mode = 'locked';
    rides = [];
    hits = [];
    var locked = await browser.newPage();
    await locked.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    locked.on('pageerror', function (err) { errors.push('locked ' + err); });
    await arm(locked);
    await locked.evaluateOnNewDocument(function (payload) {
      localStorage.setItem('ridetarget-auth', JSON.stringify(payload));
    }, session());
    await locked.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil: 'networkidle0', timeout: 20000 });
    await locked.waitForFunction(function () {
      return document.body.innerText.indexOf('Your account is waiting for activation') !== -1
        || document.body.innerText.indexOf("Can't reach") !== -1
        || document.body.innerText.indexOf('Log in') !== -1;
    }, { timeout: 10000 });
    var lockedText = await locked.evaluate(function () { return document.body.innerText; });
    if (lockedText.indexOf('Your account is waiting for activation. After payment, send your registered email to the seller.') === -1) {
      throw new Error('Locked screen missing.\nTEXT:\n' + lockedText + '\nHITS:\n' + hits.join('\n') + '\nERRORS:\n' + errors.join('\n'));
    }
    assert.ok(lockedText.indexOf('driver@example.com') !== -1);
    assert.ok(lockedText.indexOf('Refresh') !== -1);
    var appHidden = await locked.$eval('#app', function (el) { return el.hidden; });
    assert.strictEqual(appHidden, true);
    await shot(locked, 'locked');
    await locked.close();

    mode = 'approved';
    rides = [];
    hits = [];
    var app = await browser.newPage();
    await app.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    app.on('pageerror', function (err) { errors.push('app ' + err); });
    await arm(app);
    await app.evaluateOnNewDocument(function (payload) {
      localStorage.setItem('ridetarget-auth', JSON.stringify(payload));
    }, session());
    await app.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil: 'networkidle0', timeout: 20000 });
    await app.waitForFunction(function () {
      var title = document.getElementById('headerTitle');
      return title && title.textContent === 'Today' && document.getElementById('app') && !document.getElementById('app').hidden;
    }, { timeout: 10000 });
    var todayText = await app.evaluate(function () { return document.body.innerText; });
    if (todayText.indexOf('RM 300.00') === -1) {
      throw new Error('Target missing.\n' + todayText + '\n' + hits.join('\n') + '\n' + errors.join('\n'));
    }
    await shot(app, 'today-top');
    assert.ok(todayText.indexOf('Grab') !== -1);
    assert.ok(todayText.indexOf('Cash') !== -1);
    assert.ok(todayText.indexOf('Credit') !== -1);
    var addBg = await app.$eval('#addBtn', function (el) { return getComputedStyle(el).backgroundColor; });
    assert.ok(addBg.indexOf('245, 185, 66') !== -1, addBg);
    var green = await app.evaluate(function () {
      return document.documentElement.innerHTML.toLowerCase().indexOf('00b14f') !== -1;
    });
    assert.strictEqual(green, false);

    await app.click('#fareInput');
    await app.type('#fareInput', '25');
    await app.click('#addBtn');
    await app.waitForFunction(function () {
      return document.getElementById('rideList').innerText.indexOf('25.00') !== -1;
    }, { timeout: 5000 });
    await app.evaluate(function () {
      var credit = document.getElementById('payCredit');
      credit.click();
      var chip = Array.prototype.find.call(document.querySelectorAll('.chip'), function (btn) {
        return btn.textContent === 'RM10';
      });
      chip.click();
    });
    await app.waitForFunction(function () {
      return document.getElementById('ringTotal').textContent.indexOf('35.00') !== -1;
    }, { timeout: 5000 });
    var afterAdd = await app.evaluate(function () { return document.getElementById('screen-today').innerText; });
    assert.ok(afterAdd.indexOf('Credit') !== -1);
    assert.ok(afterAdd.indexOf('Grab') !== -1);
    await new Promise(function (resolve) { setTimeout(resolve, 350); });
    await shot(app, 'today');

    await app.click('button[data-screen="history"]');
    await app.waitForFunction(function () {
      return document.getElementById('headerTitle').textContent === 'History';
    });
    var historyText = await app.evaluate(function () {
      var el = document.getElementById('screen-history');
      return JSON.stringify({
        className: el.className,
        text: el.textContent,
        inner: el.innerText,
        hidden: el.hidden,
        appHidden: document.getElementById('app').hidden
      });
    });
    var historyInfo = JSON.parse(historyText);
    if ((historyInfo.text || '').indexOf('35.00') === -1) {
      throw new Error('History missing total ' + historyText);
    }
    assert.ok(historyInfo.text.indexOf('Cash') !== -1, historyInfo.text);
    assert.ok(historyInfo.text.indexOf('Credit') !== -1, historyInfo.text);
    assert.ok(historyInfo.text.indexOf('Grab') !== -1, historyInfo.text);
    await new Promise(function (resolve) { setTimeout(resolve, 200); });
    await shot(app, 'history');

    await app.click('button[data-screen="settings"]');
    await app.waitForFunction(function () {
      return document.getElementById('headerTitle').textContent === 'Settings';
    });
    var targetValue = await app.$eval('#targetInput', function (el) { return el.value; });
    assert.strictEqual(targetValue, '300');
    var settingsText = await app.evaluate(function () { return document.getElementById('screen-settings').textContent; });
    assert.ok(settingsText.indexOf('foodpanda') !== -1, settingsText);
    assert.ok(settingsText.indexOf('AirAsia Ride') !== -1, settingsText);
    assert.ok(settingsText.indexOf('driver@example.com') !== -1, settingsText);
    assert.ok(settingsText.indexOf('Owner page') !== -1, settingsText);
    await new Promise(function (resolve) { setTimeout(resolve, 200); });
    await shot(app, 'settings');

    await new Promise(function (resolve) { setTimeout(resolve, 800); });
    if (!rides.length) {
      throw new Error('Ride was not synced.\nHITS:\n' + hits.join('\n'));
    }
    assert.strictEqual(Number(rides[0].amount), 25);
    assert.strictEqual(rides[0].platform, 'Grab');
    assert.ok(rides.some(function (ride) { return ride.pay === 'credit' && Number(ride.amount) === 10; }));
    if (errors.length) throw new Error(errors.join('\n'));
    console.log('browser tests passed');
    console.log('requests', hits.length);
  } catch (err) {
    failures.push(err);
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) {
    console.error(failures[0]);
    process.exit(1);
  }
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
