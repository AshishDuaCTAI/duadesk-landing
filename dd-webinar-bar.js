/* DuaDesk upcoming-webinar bar \u00b7 add to any page:
   <script src="https://duadesk.com/dd-webinar-bar.js" defer></script>
   Options (attributes on the script tag):
     data-product="AI CFO"   prefer the next webinar about this product
     data-mode="bar|list"    bar (default) = slim top bar; list = cards inside <div id="dd-webinars"></div>
     data-ref="icai-gurugram" partner tracking code added to registration links                         */
(function () {
  var me = document.currentScript || document.querySelector('script[src*="dd-webinar-bar.js"]');
  if (!me) return;
  var BASE = new URL(me.src, location.href).origin;
  var product = me.getAttribute('data-product') || '', mode = me.getAttribute('data-mode') || 'bar', ref = me.getAttribute('data-ref') || '';
  var KEY = 'dd-wbar-closed';
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function link(w) { return BASE + '/webinars.html' + (ref ? '?ref=' + encodeURIComponent(ref) : '') + '#' + w.slug; }
  function when(w) { var d = new Date(w.starts_at); return d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short' }) + ', ' + d.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true }).toUpperCase() + ' IST'; }
  function closed(slug) { try { return localStorage.getItem(KEY) === slug; } catch (e) { return false; } }
  function css() {
    if (document.getElementById('dd-wbar-css')) return;
    var s = document.createElement('style'); s.id = 'dd-wbar-css';
    s.textContent = '.dd-wbar{position:relative;z-index:9999;background:linear-gradient(90deg,#0b1424,#13203a);color:#e8ecf3;font:14px/1.4 Inter,system-ui,Arial,sans-serif;border-bottom:1px solid rgba(214,174,85,.45)}' +
      '.dd-wbar .in{max-width:1200px;margin:0 auto;padding:9px 44px 9px 16px;display:flex;gap:10px 16px;align-items:center;justify-content:center;flex-wrap:wrap;text-align:center}' +
      '.dd-wbar b{color:#f0d18a}.dd-wbar .k{font-size:11px;font-weight:800;letter-spacing:.14em;color:#d6ae55;text-transform:uppercase}' +
      '.dd-wbar a.go{background:#d6ae55;color:#0b1424;text-decoration:none;font-weight:800;padding:6px 12px;border-radius:8px;white-space:nowrap}' +
      '.dd-wbar .cd{color:#a9b4c7;font-size:12.5px;white-space:nowrap}.dd-wbar button.x{position:absolute;right:10px;top:50%;transform:translateY(-50%);background:none;border:0;color:#a9b4c7;font-size:20px;cursor:pointer;line-height:1}' +
      '.dd-wlist{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px;font-family:Inter,system-ui,Arial,sans-serif}' +
      '.dd-wlist .c{background:#0f1a2e;border:1px solid #23314d;border-radius:14px;padding:16px;color:#e8ecf3;display:flex;flex-direction:column;gap:6px}' +
      '.dd-wlist .d{color:#d6ae55;font-weight:800;font-size:12.5px;letter-spacing:.06em;text-transform:uppercase}.dd-wlist h4{margin:0;font:600 19px/1.25 Newsreader,Georgia,serif}' +
      '.dd-wlist p{margin:0;color:#a9b4c7;font-size:13.5px}.dd-wlist a{margin-top:auto;align-self:flex-start;background:#d6ae55;color:#0b1424;text-decoration:none;font-weight:800;padding:7px 12px;border-radius:8px;font-size:13.5px}' +
      '@media(max-width:600px){.dd-wbar .in{font-size:13px;padding-right:38px}.dd-wbar .cd{display:none}}';
    document.head.appendChild(s);
  }
  function countdown(w) { var ms = new Date(w.starts_at) - Date.now(); if (ms < 0) return 'Starting now'; var d = Math.floor(ms / 864e5), h = Math.floor(ms % 864e5 / 36e5); return d > 0 ? 'in ' + d + ' day' + (d > 1 ? 's' : '') + (h ? ' ' + h + ' h' : '') : 'in ' + h + ' h ' + Math.floor(ms % 36e5 / 6e4) + ' min'; }
  function bar(list) {
    var up = list.filter(function (w) { return w.status === 'published' && w.starts_at && new Date(w.starts_at) > Date.now() && w.format !== 'roundtable'; });
    if (!up.length) return;
    var pick = product && up.find(function (w) { return (w.products || []).some(function (p) { return p.name.toLowerCase() === product.toLowerCase(); }); }) || up[0];
    if (closed(pick.slug)) return;
    css();
    var el = document.createElement('div'); el.className = 'dd-wbar'; el.setAttribute('translate', 'no'); el.classList.add('notranslate'); // webinars are in English; the site's Hindi/Punjabi switch leaves this alone el.setAttribute('role', 'region'); el.setAttribute('aria-label', 'Upcoming webinar');
    el.innerHTML = '<div class="in"><span class="k">Free webinar</span><span><b>' + esc(pick.title) + '</b> \u00b7 ' + esc(when(pick)) + '</span><span class="cd">' + esc(countdown(pick)) + '</span><a class="go" href="' + esc(link(pick)) + '">Register free</a></div><button class="x" type="button" aria-label="Close">\u00d7</button>';
    el.querySelector('.x').onclick = function () { try { localStorage.setItem(KEY, pick.slug); } catch (e) { } el.remove(); };
    document.body.insertBefore(el, document.body.firstChild);
  }
  function cards(list) {
    var box = document.getElementById('dd-webinars'); if (!box) return;
    var up = list.filter(function (w) { return w.status === 'published' && w.starts_at && new Date(w.starts_at) > Date.now(); }).slice(0, +(me.getAttribute('data-count') || 3));
    if (!up.length) return;
    css();
    box.setAttribute('translate', 'no'); box.classList.add('notranslate');
    box.innerHTML = '<div class="dd-wlist">' + up.map(function (w) { return '<div class="c"><span class="d">' + esc(when(w)) + '</span><h4>' + esc(w.title) + '</h4><p>' + esc(w.subtitle || '') + '</p><a href="' + esc(link(w)) + '">' + (w.format === 'roundtable' ? 'Request an invitation' : 'Register free') + '</a></div>'; }).join('') + '</div>';
  }
  fetch(BASE + '/api/webinars?action=list').then(function (r) { return r.json(); }).then(function (j) {
    var list = (j.webinars || []).sort(function (a, b) { return new Date(a.starts_at) - new Date(b.starts_at); });
    if (mode === 'list') cards(list); else bar(list);
  }).catch(function () { });
})();
