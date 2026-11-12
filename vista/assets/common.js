// Shared helpers for the Vista blueprint review pages.
(function () {
  const SB_URL = 'https://fwcaseevhntcgqhosdel.supabase.co';
  const SB_KEY = 'sb_publishable_LHmdFb60Z-7nvlnWEiHVqA_NGWYt_KX'; // publishable key: safe in the browser; data is reachable only through token-checked functions

  const VERDICTS = [
    { id: 'agree', label: 'Completely agree', short: 'Agree', color: '#2E7D4F', key: '1' },
    { id: 'agree_feedback', label: 'Agree, with feedback', short: 'Agree + feedback', color: '#1F5F99', key: '2' },
    { id: 'discuss', label: 'Need to discuss', short: 'Discuss', color: '#B7791F', key: '3' },
    { id: 'not_agreed', label: 'Not agreed', short: 'Not agreed', color: '#B4412F', key: '4' },
  ];
  const V = Object.fromEntries(VERDICTS.map(v => [v.id, v]));
  // Process reviews only: 'Not applicable' (no button on blueprint or data pages)
  V.na = { id: 'na', label: 'Not applicable', short: 'N/A', color: '#7A8494', key: '5' };

  async function rpc(fn, args, accessToken) {
    const headers = { apikey: SB_KEY, 'Content-Type': 'application/json' };
    if (accessToken) headers.Authorization = 'Bearer ' + accessToken;
    let res;
    try {
      res = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers, body: JSON.stringify(args || {}) });
    } catch (e) {
      const err = new Error('No connection. Check your internet and try again.'); err.network = true; throw err;
    }
    const text = await res.text();
    let data = null; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) {
      const msg = (data && (data.message || data.hint)) || `Error ${res.status}`;
      const err = new Error(msg); err.status = res.status; err.code = data && data.code; throw err;
    }
    return data;
  }

  function b64ToBytes(b64) { const s = atob(b64); const a = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a; }

  // The slide content is stored encrypted next to this page; the key is handed out only to valid review links.
  async function loadSlides(file, keyB64) {
    const res = await fetch('/vista/' + encodeURIComponent(file), { cache: 'force-cache' });
    if (!res.ok) throw new Error('Could not load the slides (' + res.status + ').');
    const buf = new Uint8Array(await res.arrayBuffer());
    const key = await crypto.subtle.importKey('raw', b64ToBytes(keyB64), 'AES-GCM', false, ['decrypt']);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf.slice(0, 12) }, key, buf.slice(12));
    return JSON.parse(new TextDecoder().decode(plain));
  }

  // Render a 1920x1080 slide into a box, scaled to its width, in a sandboxed frame (no scripts).
  function mountSlide(box, html) {
    box.innerHTML = '';
    const f = document.createElement('iframe');
    f.setAttribute('sandbox', '');
    f.setAttribute('title', 'Slide');
    f.setAttribute('loading', 'eager');
    f.className = 'slide-frame';
    f.srcdoc = window.vistaSlideDoc(html);
    box.appendChild(f);
    const fit = () => { const s = box.clientWidth / 1920; f.style.transform = `scale(${s})`; box.style.height = (1080 * s) + 'px'; };
    fit();
    if (box._ro) box._ro.disconnect();
    box._ro = new ResizeObserver(fit); box._ro.observe(box);
  }

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { } },
    del(k) { try { localStorage.removeItem(k); } catch { } },
  };
  const fmtTime = iso => iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';

  window.VistaReview = { SB_URL, SB_KEY, VERDICTS, V, rpc, loadSlides, mountSlide, esc, store, fmtTime };

  // When the person came through the review portal, offer a way back to it.
  document.addEventListener('DOMContentLoaded', () => {
    if (location.pathname.startsWith('/vistareview') || /\/admin\/?$/.test(location.pathname) || !store.get('vistareview.s')) return;
    const top = document.querySelector('header.top');
    const a = document.createElement('a'); a.href = '/vistareview/'; a.textContent = '← My reviews';
    if (top) { a.style.cssText = 'color:#E3A13B;font-weight:700;font-size:13px;text-decoration:none;white-space:nowrap;order:-1;margin-right:4px'; top.insertBefore(a, top.firstChild); }
    else { a.style.cssText = 'position:fixed;top:12px;left:14px;z-index:99;background:#13233A;color:#E3A13B;font:700 13px/1 IBM Plex Sans,Arial,sans-serif;padding:8px 12px;border-radius:999px;text-decoration:none'; document.body.appendChild(a); }
  });
})();
