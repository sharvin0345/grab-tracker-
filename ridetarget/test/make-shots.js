/* Render real RideTarget screens with demo data for the landing page. */
var fs = require('fs');
var http = require('http');
var path = require('path');
var puppeteer = require('puppeteer-core');
var C = require('../calc.js');

var ROOT = path.resolve(__dirname, '..');
var PORT = 8771;
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
      id: USER,
      aud: 'authenticated',
      role: 'authenticated',
      email: 'driver@example.com',
      app_metadata: { provider: 'email' },
      user_metadata: {},
      created_at: '2026-11-01T00:00:00.000Z'
    }
  };
}

function demo() {
  var today = C.dateKey(new Date());
  var rides = [];
  function add(day, amount, pay, platform, hour) {
    var base = C.startOfDayTs(day) + hour * 3600000;
    rides.push({
      client_id: 'shot-' + rides.length,
      day_key: day,
      amount: amount,
      pay: pay,
      platform: platform,
      ts: new Date(base).toISOString(),
      deleted: false,
      user_id: USER
    });
  }
  add(today, 32, 'cash', 'Grab', 9);
  add(today, 28, 'credit', 'inDrive', 10);
  add(today, 24, 'cash', 'AirAsia Ride', 11);
  add(today, 30, 'cash', 'Maxim', 12);
  add(today, 18, 'credit', 'Bolt', 13);
  add(today, 22, 'cash', 'foodpanda', 14);
  add(today, 16, 'credit', 'Lalamove', 15);
  add(today, 26, 'cash', 'ShopeeFood', 16);
  var past = [310, 180, 240, 90, 275, 140];
  past.forEach(function (total, index) {
    var day = C.addDays(today, -(index + 1));
    add(day, Math.round(total * 0.6), 'cash', 'Grab', 10);
    add(day, total - Math.round(total * 0.6), 'credit', 'inDrive', 14);
  });
  var days = {};
  days[today] = {
    tips: 12,
    incentives: 18,
    fuel: 30,
    tolls: 7,
    celebrated: false,
    segments: [{ start: Date.now() - 4 * 3600000, end: Date.now() - 15 * 60000 }]
  };
  return { rides: rides, days: days, today: today };
}

function startServer() {
  return new Promise(function (resolve) {
    var server = http.createServer(function (req, res) {
      var urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      if (urlPath === '/') urlPath = '/index.html';
      var file = path.normalize(path.join(ROOT, urlPath));
      if (!file.startsWith(ROOT)) {
        res.writeHead(403); res.end('no'); return;
      }
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
  var data = demo();
  var server = await startServer();
  var browser = await puppeteer.launch({
    executablePath: '/usr/local/bin/google-chrome',
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
  });
  var page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.setRequestInterception(true);
  page.on('request', function (req) {
    var url = req.url();
    if (url.indexOf('cdn.jsdelivr.net') !== -1 && fs.existsSync('/tmp/supabase.js')) {
      req.respond({ status: 200, contentType: 'text/javascript', body: fs.readFileSync('/tmp/supabase.js') });
      return;
    }
    if (url.indexOf('/config.js') !== -1) {
      req.respond({
        status: 200,
        contentType: 'text/javascript',
        body: 'window.RIDETARGET_CONFIG={SUPABASE_URL:"' + SUPABASE + '",SUPABASE_ANON_KEY:"' + ANON + '",WHATSAPP_NUMBER:"60123456789",PRICE_RM:20,LAUNCH_PRICE_RM:15};'
      });
      return;
    }
    if (url.indexOf(SUPABASE) === 0) {
      var cors = {
        'access-control-allow-origin': '*',
        'access-control-allow-headers': '*',
        'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
        'content-type': 'application/json'
      };
      if (req.method() === 'OPTIONS') { req.respond({ status: 204, headers: cors }); return; }
      var pathName = url.slice(SUPABASE.length).split('?')[0];
      if (pathName === '/rest/v1/profiles') {
        req.respond({ status: 200, headers: cors, body: JSON.stringify([{ id: USER, email: 'driver@example.com', approved: true, is_admin: false, created_at: '2026-11-01T00:00:00.000Z' }]) });
        return;
      }
      if (pathName === '/rest/v1/settings' && req.method() === 'GET') {
        req.respond({
          status: 200,
          headers: cors,
          body: JSON.stringify([{
            user_id: USER,
            daily_target: 300,
            last_pay: 'cash',
            last_platform: 'Grab',
            platforms: ['Grab', 'inDrive', 'AirAsia Ride', 'Maxim', 'Bolt', 'foodpanda', 'ShopeeFood', 'Lalamove', 'Other'],
            days: data.days
          }])
        });
        return;
      }
      if (pathName === '/rest/v1/rides' && req.method() === 'GET') {
        req.respond({ status: 200, headers: cors, body: JSON.stringify(data.rides) });
        return;
      }
      req.respond({ status: 201, headers: cors, body: req.postData() || '[]' });
      return;
    }
    req.continue();
  });
  await page.evaluateOnNewDocument(function (payload) {
    localStorage.setItem('ridetarget-auth', JSON.stringify(payload));
    localStorage.setItem('ridetarget.lang', 'en');
  }, session());
  await page.goto('http://127.0.0.1:' + PORT + '/index.html', { waitUntil: 'networkidle0', timeout: 30000 });
  await page.waitForFunction(function () {
    var total = document.getElementById('ringTotal');
    return total && total.textContent.indexOf('196.00') !== -1;
  }, { timeout: 15000 });
  await page.evaluate(function () { document.getElementById('screen-today').scrollTop = 0; });
  fs.mkdirSync(path.join(ROOT, 'media'), { recursive: true });
  var todayShot = await page.screenshot({ type: 'png' });
  fs.writeFileSync(path.join(ROOT, 'media', 'today.png'), todayShot);
  await page.click('button[data-screen="history"]');
  await page.waitForFunction(function () {
    return document.getElementById('headerTitle').textContent === 'History'
      && document.getElementById('weekTotal').textContent.indexOf('RM') !== -1;
  });
  await page.evaluate(function () { document.getElementById('screen-history').scrollTop = 0; });
  var historyShot = await page.screenshot({ type: 'png' });
  fs.writeFileSync(path.join(ROOT, 'media', 'history.png'), historyShot);
  await browser.close();
  server.close();
  console.log('shots', todayShot.length, historyShot.length);
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
