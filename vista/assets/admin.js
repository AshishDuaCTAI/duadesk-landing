// Admin page: sign in with the platform login (Supabase Auth); only users in vista_review.admins see data.
(function () {
  const { SB_URL, SB_KEY, VERDICTS, V, rpc, loadSlides, mountSlide, esc, fmtTime } = window.VistaReview;
  const $ = id => document.getElementById(id);
  const SKEY = 'vista.admin.session';
  let session = null, D = null, content = null, tab = 'people';

  // ---------- auth (Supabase GoTrue REST) ----------
  const ss = { get() { try { return JSON.parse(sessionStorage.getItem(SKEY)); } catch { return null; } }, set(v) { try { v ? sessionStorage.setItem(SKEY, JSON.stringify(v)) : sessionStorage.removeItem(SKEY); } catch { } } };
  async function auth(grant, body) {
    const res = await fetch(`${SB_URL}/auth/v1/token?grant_type=${grant}`, { method: 'POST', headers: { apikey: SB_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error_description || data.msg || data.message || 'Sign-in failed');
    return { access_token: data.access_token, refresh_token: data.refresh_token, expires_at: Date.now() + (data.expires_in - 60) * 1000, email: data.user && data.user.email };
  }
  async function token() {
    if (!session) throw new Error('Signed out');
    if (Date.now() > session.expires_at) { session = await auth('refresh_token', { refresh_token: session.refresh_token }); ss.set(session); }
    return session.access_token;
  }
  const call = async (fn, args) => rpc(fn, args, await token());

  $('signinForm').onsubmit = async e => {
    e.preventDefault();
    const st = $('signinStatus'); st.textContent = 'Signing in…'; st.className = 'status wait';
    try {
      session = await auth('password', { email: $('email').value.trim(), password: $('password').value });
      $('password').value = '';
      ss.set(session); await boot();
    } catch (err) { st.textContent = err.message; st.className = 'status err'; }
  };
  $('signOutBtn').onclick = async () => {
    try { await fetch(`${SB_URL}/auth/v1/logout`, { method: 'POST', headers: { apikey: SB_KEY, Authorization: 'Bearer ' + session.access_token } }); } catch { }
    session = null; ss.set(null); location.reload();
  };

  async function boot() {
    session = session || ss.get();
    if (!session) { $('signin').classList.remove('hidden'); return; }
    try {
      const w = await call('vista_admin_whoami');
      if (!w.admin) throw new Error('This login is not an admin for the Vista review.');
    } catch (e) {
      session = null; ss.set(null);
      $('signin').classList.remove('hidden'); $('signinStatus').textContent = e.message; $('signinStatus').className = 'status err'; return;
    }
    $('signin').classList.add('hidden'); $('app').classList.remove('hidden'); $('signOutBtn').classList.remove('hidden');
    $('who').textContent = session.email || '';
    await load();
  }

  async function load() {
    D = await call('vista_admin_overview', { p_deck: 'vista-blueprint' });
    D.byReviewer = Object.fromEntries(D.reviewers.map(r => [r.id, r]));
    D.bySlide = {};
    D.reviews.forEach(v => { (D.bySlide[v.slide] = D.bySlide[v.slide] || []).push(v); });
    const opts = '<option value="">Everyone</option>' + D.reviewers.map(r => `<option value="${r.id}">${esc(r.name)}</option>`).join('');
    const keep = [$('slideWho').value, $('logWho').value];
    $('slideWho').innerHTML = opts; $('logWho').innerHTML = opts;
    $('slideWho').value = keep[0]; $('logWho').value = keep[1];
    render();
  }
  $('refreshBtn').onclick = () => load().catch(e => alertLine(e.message));
  function alertLine(m) { $('addStatus').textContent = m; $('addStatus').className = 'status err'; }

  // ---------- render ----------
  const active = () => D.reviewers.filter(r => !r.revoked_at);
  function render() {
    const n = D.slides.length, act = active();
    const submitted = act.filter(r => r.submitted_at).length;
    const counts = Object.fromEntries(VERDICTS.map(v => [v.id, 0]));
    D.reviews.forEach(v => { if (!D.byReviewer[v.reviewer_id].revoked_at) counts[v.verdict]++; });
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    $('kpis').innerHTML =
      `<div><span class="muted">Reviewers</span><b>${act.length}</b></div>` +
      `<div><span class="muted">Submitted</span><b>${submitted} of ${act.length}</b></div>` +
      `<div><span class="muted">Slide answers</span><b>${total} of ${n * act.length}</b></div>` +
      `<div><span class="muted">Answers by view</span><div class="stack" style="margin-top:12px">${VERDICTS.map(v => `<i title="${v.label}: ${counts[v.id]}" style="width:${total ? counts[v.id] / total * 100 : 0}%;background:${v.color}"></i>`).join('')}</div><span class="muted" style="font-size:12px">${VERDICTS.map(v => `${v.short} ${counts[v.id]}`).join(' · ')}</span></div>`;
    renderPeople(); renderSlides(); renderOverall(); renderLog();
  }

  function renderPeople() {
    const n = D.slides.length;
    $('peopleTable').innerHTML = `<tr><th>Name</th><th class="hide-sm">Designation</th><th>Progress</th><th class="hide-sm">Opened</th><th class="hide-sm">Last active</th><th>Status</th><th>Link</th></tr>` +
      (D.reviewers.map(r => `<tr${r.revoked_at ? ' style="opacity:.5"' : ''}>
        <td><b>${esc(r.name)}</b>${r.email ? `<br><span class="muted" style="font-size:12px">${esc(r.email)}</span>` : ''}</td>
        <td class="hide-sm">${esc(r.designation || '')}</td>
        <td>${r.done} / ${n}<div class="stack" style="margin-top:4px;max-width:160px"><i style="width:${r.done / n * 100}%;background:var(--blue)"></i></div></td>
        <td class="hide-sm">${r.first_seen_at ? fmtTime(r.first_seen_at) : '<span class="muted">Not yet</span>'}</td>
        <td class="hide-sm">${fmtTime(r.last_seen_at)}</td>
        <td>${r.revoked_at ? 'Link withdrawn' : r.submitted_at ? `<span class="pill" style="--c:${r.overall_verdict ? V[r.overall_verdict].color : '#2E7D4F'}">Submitted</span><br><span class="muted" style="font-size:12px">${fmtTime(r.submitted_at)}</span>` : 'In progress'}</td>
        <td><div class="row">
          <button class="btn small" data-act="newlink" data-id="${r.id}">New link</button>
          ${r.submitted_at && !r.revoked_at ? `<button class="btn small" data-act="reopen" data-id="${r.id}">Reopen</button>` : ''}
          ${!r.revoked_at ? `<button class="btn small" data-act="revoke" data-id="${r.id}">Withdraw</button>` : ''}
        </div></td></tr>`).join('') || `<tr><td colspan="7" class="muted">No reviewers yet. Add each Vista leader above; each gets a personal link.</td></tr>`);
  }
  function showLink(name, tok) {
    const url = `${location.origin}/vista/#k=${tok}`;
    const msg = `Dear ${name.split(' ')[0]}, please review the Vista EPC Platform blueprint here. For each slide you can agree, agree with feedback, ask to discuss, or disagree. Your answers save as you go: ${url}`;
    $('linkOut').innerHTML = `<div class="linkbox"><b>Personal link for ${esc(name)}</b> <span class="muted" style="font-size:12px">Shown once. Use “New link” later if it is lost; the old one then stops working.</span>
      <input id="linkVal" readonly value="${esc(url)}" style="margin:8px 0">
      <div class="row"><button class="btn small" id="copyLink">Copy link</button><button class="btn small" id="copyMsg">Copy message</button>
      <a class="btn small" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(msg)}">Send on WhatsApp</a>
      <a class="btn small" href="mailto:?subject=${encodeURIComponent('Vista EPC Platform: blueprint review')}&body=${encodeURIComponent(msg)}">Send by email</a></div></div>`;
    const copy = async (t, b) => { try { await navigator.clipboard.writeText(t); b.textContent = 'Copied'; } catch { $('linkVal').select(); } };
    $('copyLink').onclick = e => copy(url, e.target); $('copyMsg').onclick = e => copy(msg, e.target);
  }
  $('addForm').onsubmit = async e => {
    e.preventDefault();
    const st = $('addStatus'); st.textContent = 'Creating…'; st.className = 'status wait';
    try {
      const name = $('nName').value.trim();
      const r = await call('vista_admin_add_reviewer', { p_name: name, p_designation: $('nDesig').value, p_email: $('nEmail').value, p_deck: 'vista-blueprint' });
      st.textContent = ''; showLink(name, r.token);
      $('addForm').reset(); await load();
    } catch (err) { st.textContent = err.message; st.className = 'status err'; }
  };
  $('peopleTable').onclick = async e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const r = D.byReviewer[b.dataset.id], act = b.dataset.act;
    if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = 'Confirm'; setTimeout(() => { if (b.isConnected) { b.dataset.armed = ''; b.textContent = act === 'newlink' ? 'New link' : act === 'reopen' ? 'Reopen' : 'Withdraw'; } }, 4000); return; }
    try {
      if (act === 'newlink') { const x = await call('vista_admin_new_link', { p_reviewer: r.id }); showLink(r.name, x.token); window.scrollTo(0, 0); }
      else await call('vista_admin_set_reviewer', { p_reviewer: r.id, p_action: act === 'revoke' ? 'revoke' : 'reopen' });
      await load();
    } catch (err) { alertLine(err.message); }
  };

  function renderSlides() {
    const f = $('slideFilter').value, who = $('slideWho').value, act = active();
    const rows = D.slides.map(s => {
      let list = (D.bySlide[s.id] || []).filter(v => !D.byReviewer[v.reviewer_id].revoked_at);
      if (who) list = list.filter(v => v.reviewer_id === who);
      const c = Object.fromEntries(VERDICTS.map(v => [v.id, 0])); list.forEach(v => c[v.verdict]++);
      const withFb = list.filter(v => v.feedback);
      if (f === 'flag' && !(c.discuss || c.not_agreed)) return '';
      if (f === 'fb' && !withFb.length) return '';
      if (f === 'pending' && list.length >= (who ? 1 : act.length)) return '';
      const tot = list.length || 1;
      return `<tr><td>${s.n}</td><td><a href="#" data-pv="${esc(s.id)}">${esc(s.title)}</a><br><span class="muted" style="font-size:12px">${esc(s.section)}</span></td>
        <td><div class="stack">${VERDICTS.map(v => `<i style="width:${c[v.id] / tot * 100}%;background:${v.color}"></i>`).join('')}</div>
        <span class="muted" style="font-size:12px">${VERDICTS.filter(v => c[v.id]).map(v => `${v.short} ${c[v.id]}`).join(' · ') || 'No answers yet'}</span></td>
        <td>${list.length} / ${who ? 1 : act.length}</td></tr>` +
        (withFb.length ? `<tr class="fbrow"><td></td><td colspan="3">${withFb.map(v => `<div class="fbitem" style="--c:${V[v.verdict].color}"><b>${esc(D.byReviewer[v.reviewer_id].name)} · ${esc(V[v.verdict].label)}</b> <span class="muted" style="font-size:12px">${fmtTime(v.at)}</span><div>${esc(v.feedback).replace(/\n/g, '<br>')}</div></div>`).join('')}</td></tr>` : '');
    }).join('');
    $('slideTable').innerHTML = `<tr><th>#</th><th>Slide</th><th>Views</th><th>Answered</th></tr>` + (rows || `<tr><td colspan="4" class="muted">Nothing matches this filter.</td></tr>`);
  }
  $('slideFilter').onchange = renderSlides; $('slideWho').onchange = renderSlides;

  function renderOverall() {
    $('overallTable').innerHTML = `<tr><th>Reviewer</th><th>Overall view</th><th>Comment</th><th>Submitted</th></tr>` +
      (D.reviewers.filter(r => r.submitted_at).map(r => `<tr><td><b>${esc(r.name)}</b><br><span class="muted" style="font-size:12px">${esc(r.designation || '')}</span></td>
        <td>${r.overall_verdict ? `<span class="pill" style="--c:${V[r.overall_verdict].color}">${esc(V[r.overall_verdict].label)}</span>` : ''}</td>
        <td>${esc(r.overall_comment || '').replace(/\n/g, '<br>')}</td><td>${fmtTime(r.submitted_at)}</td></tr>`).join('') || `<tr><td colspan="4" class="muted">No one has submitted yet.</td></tr>`);
  }

  function renderLog() {
    const who = $('logWho').value, title = Object.fromEntries(D.slides.map(s => [s.id, `${s.n}. ${s.title}`]));
    const rows = D.log.filter(l => !who || l.reviewer_id === who).slice().reverse();
    $('logTable').innerHTML = `<tr><th>When</th><th>Reviewer</th><th>What</th><th>Slide</th><th>View</th><th>Feedback at that moment</th></tr>` +
      (rows.map(l => `<tr><td style="white-space:nowrap">${fmtTime(l.at)}</td><td>${esc((D.byReviewer[l.reviewer_id] || {}).name || '')}</td><td>${esc(l.event)}</td>
        <td>${esc(title[l.slide] || '')}</td><td>${l.verdict ? `<span class="pill" style="--c:${V[l.verdict].color}">${esc(V[l.verdict].short)}</span>` : ''}</td>
        <td>${esc(l.feedback || '').replace(/\n/g, '<br>')}</td></tr>`).join('') || `<tr><td colspan="6" class="muted">No activity yet.</td></tr>`);
  }
  $('logWho').onchange = renderLog;

  $('tabs').onclick = e => {
    const b = e.target.closest('button'); if (!b) return; tab = b.dataset.t;
    document.querySelectorAll('#tabs button').forEach(x => x.classList.toggle('on', x === b));
    ['people', 'slides', 'overall', 'log'].forEach(t => $('tab-' + t).classList.toggle('hidden', t !== tab));
  };

  // ---------- slide preview ----------
  document.addEventListener('click', async e => {
    const a = e.target.closest('[data-pv]'); if (!a) return; e.preventDefault();
    try {
      if (!content) { const c = await call('vista_admin_content'); content = Object.fromEntries((await loadSlides(c.file, c.key)).map(s => [s.id, s])); }
      const s = content[a.dataset.pv]; $('pvTitle').textContent = `${s.n}. ${s.title}`;
      $('preview').classList.remove('hidden'); mountSlide($('pvBox'), s.html);
    } catch (err) { alertLine(err.message); }
  });
  $('pvClose').onclick = () => $('preview').classList.add('hidden');
  $('preview').onclick = e => { if (e.target.id === 'preview') $('preview').classList.add('hidden'); };

  // ---------- CSV ----------
  const csvCell = v => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const csvGuard = v => (/^[=+\-@]/.test(String(v ?? '')) ? "'" : '') + (v ?? ''); // stop spreadsheet formulas
  function download(name, rows) {
    const text = '﻿' + rows.map(r => r.map(x => csvCell(csvGuard(x))).join(',')).join('\r\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' })); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  const stamp = () => new Date().toISOString().slice(0, 10);
  $('csvBtn').onclick = () => {
    const rows = [['Slide no', 'Slide', 'Section', 'Reviewer', 'Designation', 'View', 'Feedback', 'Saved at']];
    D.slides.forEach(s => (D.bySlide[s.id] || []).forEach(v => { const r = D.byReviewer[v.reviewer_id]; rows.push([s.n, s.title, s.section, r.name, r.designation || '', V[v.verdict].label, v.feedback || '', v.at]); }));
    D.reviewers.filter(r => r.submitted_at).forEach(r => rows.push(['', 'OVERALL', '', r.name, r.designation || '', r.overall_verdict ? V[r.overall_verdict].label : '', r.overall_comment || '', r.submitted_at]));
    download(`vista-review-answers-${stamp()}.csv`, rows);
  };
  $('csvLogBtn').onclick = () => {
    const title = Object.fromEntries(D.slides.map(s => [s.id, s.title])), num = Object.fromEntries(D.slides.map(s => [s.id, s.n]));
    const rows = [['When', 'Reviewer', 'Event', 'Slide no', 'Slide', 'View', 'Feedback']];
    D.log.forEach(l => rows.push([l.at, (D.byReviewer[l.reviewer_id] || {}).name || '', l.event, num[l.slide] || '', title[l.slide] || '', l.verdict ? V[l.verdict].label : '', l.feedback || '']));
    download(`vista-review-changes-${stamp()}.csv`, rows);
  };

  boot();
})();
