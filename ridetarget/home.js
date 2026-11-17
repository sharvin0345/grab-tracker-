/* Landing page: language, prices, and the WhatsApp buy link. */
(function () {
  'use strict';
  var T = window.RideTargetI18n;
  if (!T) return;

  function fillPrices() {
    var price = T.prices();
    Array.prototype.forEach.call(document.querySelectorAll('[data-price="launch"]'), function (node) {
      node.textContent = 'RM' + price.launch;
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-price="full"]'), function (node) {
      node.textContent = 'RM' + price.full;
    });
  }

  function fillWhatsApp() {
    var href = T.whatsAppHref();
    Array.prototype.forEach.call(document.querySelectorAll('[data-whatsapp]'), function (node) {
      node.href = href;
      node.target = '_blank';
      node.rel = 'noopener';
    });
  }

  function render() {
    T.apply(document);
    fillPrices();
    fillWhatsApp();
    var title = T.lang() === 'ms'
      ? 'RideTarget — Capai target harian'
      : 'RideTarget — Hit your daily target';
    document.title = title;
  }

  document.addEventListener('click', function (event) {
    var btn = event.target.closest ? event.target.closest('[data-set-lang]') : null;
    if (!btn) return;
    T.setLang(btn.getAttribute('data-set-lang'));
  });
  T.onChange(render);
  render();
})();
