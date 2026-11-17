/* RideTarget owner page. Approval is enforced in the database. */
(function () {
  'use strict';

  var C = window.RideTargetCalc;
  var client = null;
  var users = [];
  var busyId = null;

  function $(id) { return document.getElementById(id); }

  function setError(msg) {
    var el = $('gateError');
    if (el) el.textContent = msg || '';
    var admin = $('adminError');
    if (admin && !$('gate').hidden) return;
    if (admin) admin.textContent = msg || '';
  }

  function showPanel(name) {
    document.body.classList.add('gate-open');
    $('gate').hidden = false;
    $('adminMain').hidden = true;
    ['config', 'secret', 'library', 'loading', 'auth', 'denied'].forEach(function (panel) {
      var el = $('panel-' + panel);
      if (el) el.hidden = panel !== name;
    });
    setError('');
  }

  function showMain() {
    document.body.classList.remove('gate-open');
    $('gate').hidden = true;
    $('adminMain').hidden = false;
  }

  function friendly(error) {
    var msg = String(error && error.message || '');
    var lower = msg.toLowerCase();
    if (lower.indexOf('invalid') !== -1 || lower.indexOf('credentials') !== -1) return 'Email or password is not right.';
    if (lower.indexOf('not allowed') !== -1) return 'Only the owner can do that.';
    if (!msg) return 'Something went wrong. Try again.';
    return msg;
  }

  function redirectUrl() {
    return new URL('index.html', window.location.href).toString().split('#')[0];
  }

  function formatStamp(iso) {
    var date = new Date(iso);
    if (!isFinite(date.getTime())) return '';
    return new Intl.DateTimeFormat('en-MY', {
      timeZone: 'Asia/Kuala_Lumpur',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    }).format(date);
  }

  async function loadList() {
    setError('');
    var res = await client.from('profiles').select('id,email,approved,is_admin,created_at').order('created_at', { ascending: false });
    if (res.error) throw res.error;
    users = res.data || [];
    renderList();
  }

  function renderList() {
    var query = String($('searchInput').value || '').trim().toLowerCase();
    var approved = users.filter(function (user) { return user.approved; }).length;
    $('statTotal').textContent = String(users.length);
    $('statApproved').textContent = String(approved);
    $('statPending').textContent = String(users.length - approved);
    var list = $('userList');
    list.innerHTML = '';
    var shown = 0;
    users.forEach(function (user) {
      var email = user.email || '';
      if (query && email.toLowerCase().indexOf(query) === -1) return;
      shown += 1;
      var card = document.createElement('article');
      card.className = 'user-card';
      var title = document.createElement('div');
      title.className = 'user-email';
      title.textContent = email || '(no email)';
      var meta = document.createElement('div');
      meta.className = 'user-meta';
      meta.textContent = 'Signed up ' + formatStamp(user.created_at);
      var badges = document.createElement('div');
      var status = document.createElement('span');
      status.className = 'status-badge ' + (user.approved ? 'on' : 'off');
      status.textContent = user.approved ? 'Approved' : 'Pending';
      badges.appendChild(status);
      if (user.is_admin) {
        var admin = document.createElement('span');
        admin.className = 'status-badge admin';
        admin.textContent = 'Owner';
        badges.appendChild(admin);
      }
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = user.approved ? 'set-btn danger' : 'gate-btn';
      btn.style.marginTop = '10px';
      btn.textContent = user.approved ? 'Revoke' : 'Approve';
      btn.disabled = busyId === user.id;
      btn.addEventListener('click', function () { setApproved(user, !user.approved); });
      card.appendChild(title);
      card.appendChild(meta);
      card.appendChild(badges);
      card.appendChild(btn);
      list.appendChild(card);
    });
    if (!shown) {
      var empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = users.length ? 'No email matches that search.' : 'No sign-ups yet.';
      list.appendChild(empty);
    }
  }

  async function setApproved(user, makeApproved) {
    if (!makeApproved && !confirm('Lock this account? They cannot open the app. Their rides stay saved.')) return;
    busyId = user.id;
    renderList();
    var res = await client.rpc('admin_set_approved', {
      target_id: user.id,
      make_approved: makeApproved
    });
    busyId = null;
    if (res.error) {
      setError(friendly(res.error));
      renderList();
      return;
    }
    await loadList();
  }

  async function enter(session) {
    if (!session || !session.user) {
      showPanel('auth');
      return;
    }
    showPanel('loading');
    var me = await client.from('profiles').select('id,email,is_admin,approved').eq('id', session.user.id).maybeSingle();
    if (me.error) {
      showPanel('auth');
      setError(friendly(me.error));
      return;
    }
    if (!me.data || !me.data.is_admin) {
      showPanel('denied');
      return;
    }
    showMain();
    $('adminWho').textContent = 'Signed in as ' + (me.data.email || session.user.email || '');
    try {
      await loadList();
    } catch (err) {
      setError(friendly(err));
    }
  }

  function start() {
    var cfg = window.RIDETARGET_CONFIG || {};
    client = supabase.createClient(String(cfg.SUPABASE_URL).trim().replace(/\/$/, ''), String(cfg.SUPABASE_ANON_KEY).trim(), {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: 'implicit',
        storageKey: 'ridetarget-auth'
      }
    });
    client.auth.onAuthStateChange(function (event, session) {
      if (event === 'PASSWORD_RECOVERY') {
        window.location.href = 'index.html' + window.location.hash;
        return;
      }
      if (event === 'SIGNED_OUT') showPanel('auth');
      if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') enter(session);
    });
  }

  function bind() {
    $('formLogin').addEventListener('submit', async function (event) {
      event.preventDefault();
      var email = String($('loginEmail').value || '').trim().toLowerCase();
      var password = $('loginPassword').value;
      setError('');
      var res = await client.auth.signInWithPassword({ email: email, password: password });
      if (res.error) setError(friendly(res.error));
    });
    $('linkForgot').addEventListener('click', function () {
      $('formLogin').hidden = true;
      $('formForgot').hidden = false;
      setError('');
    });
    $('linkForgotBack').addEventListener('click', function () {
      $('formForgot').hidden = true;
      $('formLogin').hidden = false;
      setError('');
    });
    $('formForgot').addEventListener('submit', async function (event) {
      event.preventDefault();
      var email = String($('forgotEmail').value || '').trim().toLowerCase();
      if (!email) {
        setError('Enter your email.');
        return;
      }
      var res = await client.auth.resetPasswordForEmail(email, { redirectTo: redirectUrl() });
      if (res.error) setError(friendly(res.error));
      else setError('If that email is registered, a reset link is on its way. Open it in the driver app.');
    });
    $('btnDeniedLogout').addEventListener('click', function () { client.auth.signOut(); });
    $('btnLogout').addEventListener('click', function () { client.auth.signOut(); });
    $('btnReload').addEventListener('click', function () {
      loadList().catch(function (err) { setError(friendly(err)); });
    });
    $('searchInput').addEventListener('input', renderList);
  }

  function init() {
    bind();
    if (!C) {
      showPanel('library');
      return;
    }
    var status = C.configStatus(window.RIDETARGET_CONFIG || {});
    if (status === 'missing') {
      showPanel('config');
      return;
    }
    if (status === 'secret') {
      showPanel('secret');
      return;
    }
    if (typeof supabase === 'undefined' || !supabase.createClient) {
      showPanel('library');
      return;
    }
    showPanel('loading');
    start();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
