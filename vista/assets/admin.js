// Admin page: sign in with the platform login (Supabase Auth); only users in vista_review.admins see data.
(function () {
  const { SB_URL, SB_KEY, VERDICTS, V, rpc, loadSlides, mountSlide, esc, fmtTime } = window.VistaReview;
  const $ = id => document.getElementById(id);
  const SKEY = 'vista.admin.session';
  let session = null, D = null, content = null, tab = 'people';
  const DECK = window.VISTA_DECK || 'vista-blueprint', IS_DATA = DECK === 'vista-data', IS_PROC = DECK.startsWith('vista-proc-');
  const PROC = { 'vista-proc-d': ['vistabidding', 'D. Sales and bidding'], 'vista-proc-a': ['vistaprojects', 'A. Projects'], 'vista-proc-b': ['vistaprocurement', 'B. Procurement'], 'vista-proc-c': ['vistahr', 'C. HR'] };
  const PV = { agree: 'Agree', agree_feedback: 'Agree with changes', discuss: 'Need to discuss', not_agreed: 'Not agreed' };
  const VL = id => IS_PROC ? PV[id] : V[id].label;
  let PSTEP = {}, PMD = {};
  const VS = () => IS_DATA ? VERDICTS.filter(v => v.id === 'agree' || v.id === 'not_agreed') : VERDICTS;
  const ZONE = { L: 'Local server', C: 'Cloud' }, ALT = { local: 'Local server', cloud: 'Cloud', split: 'Split between the two' };

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
    if (IS_PROC && !Object.keys(PSTEP).length) {
      const c = await call('vista_admin_proc_content', { p_deck: DECK }); const A = await loadSlides(c.file, c.key);
      A.md.forEach(m => { PMD[m.code] = m; }); A.subs.forEach(sub => sub.steps.forEach(st => { PSTEP[st.id] = st; }));
    }
    D = await call('vista_admin_overview', { p_deck: DECK });
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
      `<div><span class="muted">${IS_DATA ? 'Row answers' : IS_PROC ? 'Step answers' : 'Slide answers'}</span><b>${total} of ${n * act.length}</b></div>` +
      `<div><span class="muted">Answers by view</span><div class="stack" style="margin-top:12px">${VS().map(v => `<i title="${v.label}: ${counts[v.id]}" style="width:${total ? counts[v.id] / total * 100 : 0}%;background:${v.color}"></i>`).join('')}</div><span class="muted" style="font-size:12px">${VS().map(v => `${v.short} ${counts[v.id]}`).join(' · ')}</span></div>`;
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
    const IS_VIDEO = DECK === 'vista-video';
    const url = `${location.origin}/${IS_PROC ? PROC[DECK][0] : IS_VIDEO ? 'vistavideo' : IS_DATA ? 'vistadata' : 'vista'}/#k=${tok}`;
    const msg = IS_PROC
      ? `Dear ${name.split(' ')[0]}, here is your personal link to review the Vista process for ${PROC[DECK][1]}. For each step, choose Agree, Agree with changes, Need to discuss or Not agreed, and add your comment. Your answers save as you go: ${url}`
      : IS_VIDEO
      ? `Dear ${name.split(' ')[0]}, here is a 13-minute film on the Vista EPC Platform, prepared for the Board of Directors: ${url}`
      : IS_DATA
      ? `Dear ${name.split(' ')[0]}, here is the list of every data element in the Vista EPC Platform, with where we propose to keep it: on Vista's own servers or on the cloud. For each row, please mark Agree or Not agree. Your answers save as you go: ${url}`
      : `Dear ${name.split(' ')[0]}, please review the Vista EPC Platform blueprint here. For each slide you can agree, agree with feedback, ask to discuss, or disagree. Your answers save as you go: ${url}`;
    $('linkOut').innerHTML = `<div class="linkbox"><b>Personal link for ${esc(name)}</b> <span class="muted" style="font-size:12px">Shown once. Use “New link” later if it is lost; the old one then stops working.</span>
      <input id="linkVal" readonly value="${esc(url)}" style="margin:8px 0">
      <div class="row"><button class="btn small" id="copyLink">Copy link</button><button class="btn small" id="copyMsg">Copy message</button>
      <a class="btn small" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(msg)}">Send on WhatsApp</a>
      <a class="btn small" href="mailto:?subject=${encodeURIComponent(IS_PROC ? 'Vista process review: ' + PROC[DECK][1] : IS_VIDEO ? 'Vista EPC Platform: film for the Board' : IS_DATA ? 'Vista EPC Platform: where each data element is stored' : 'Vista EPC Platform: blueprint review')}&body=${encodeURIComponent(msg)}">Send by email</a></div></div>`;
    const copy = async (t, b) => { try { await navigator.clipboard.writeText(t); b.textContent = 'Copied'; } catch { $('linkVal').select(); } };
    $('copyLink').onclick = e => copy(url, e.target); $('copyMsg').onclick = e => copy(msg, e.target);
  }
  $('addForm').onsubmit = async e => {
    e.preventDefault();
    const st = $('addStatus'); st.textContent = 'Creating…'; st.className = 'status wait';
    try {
      const name = $('nName').value.trim();
      const r = await call('vista_admin_add_reviewer', { p_name: name, p_designation: $('nDesig').value, p_email: $('nEmail').value, p_deck: DECK });
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
      const P = PSTEP[s.id];
      return `<tr><td>${IS_DATA || IS_PROC ? esc(s.id) : s.n}</td><td>${IS_PROC ? `<b>${esc(s.title)}</b> ${P ? `<span class="zone ${P.zone === 'Local server' ? 'L' : P.zone === 'Cloud' ? 'C' : 'X'}">${esc(P.zone)}</span>` : ''}<br><span class="muted" style="font-size:12px">${esc(s.section)}${P ? ' · ' + esc(P.what) : ''}${P && P.md.length ? '<br>Master data: ' + P.md.map(m => esc(m.code + ' ' + m.name + ' (' + m.act.toLowerCase() + (PMD[m.code] ? '; maintained by ' + PMD[m.code].maintains : '') + ')')).join('; ') : ''}</span>` : IS_DATA ? `<b>${esc(s.title)}</b> <span class="zone ${s.d.zone}">${ZONE[s.d.zone]}</span><br><span class="muted" style="font-size:12px">${esc(s.d.includes)}</span>` : `<a href="#" data-pv="${esc(s.id)}">${esc(s.title)}</a><br><span class="muted" style="font-size:12px">${esc(s.section)}</span>`}</td>
        <td><div class="stack">${VERDICTS.map(v => `<i style="width:${c[v.id] / tot * 100}%;background:${v.color}"></i>`).join('')}</div>
        <span class="muted" style="font-size:12px">${VS().filter(v => c[v.id]).map(v => `${v.short} ${c[v.id]}`).join(' · ') || 'No answers yet'}</span></td>
        <td>${list.length} / ${who ? 1 : act.length}</td></tr>` +
        (withFb.length ? `<tr class="fbrow"><td></td><td colspan="3">${withFb.map(v => `<div class="fbitem" style="--c:${V[v.verdict].color}"><b>${esc(D.byReviewer[v.reviewer_id].name)} · ${esc(IS_DATA && v.verdict === 'not_agreed' ? 'Not agreed' : VL(v.verdict))}${v.alt ? ' · should be: ' + esc(ALT[v.alt]) : ''}</b> <span class="muted" style="font-size:12px">${fmtTime(v.at)}</span><div>${esc(v.feedback).replace(/\n/g, '<br>')}</div></div>`).join('')}</td></tr>` : '');
    }).join('');
    $('slideTable').innerHTML = `<tr><th>#</th><th>${IS_DATA ? 'Data element and proposed location' : IS_PROC ? 'Step' : 'Slide'}</th><th>Views</th><th>Answered</th></tr>` + (rows || `<tr><td colspan="4" class="muted">Nothing matches this filter.</td></tr>`);
  }
  $('slideFilter').onchange = renderSlides; $('slideWho').onchange = renderSlides;

  function renderOverall() {
    $('overallTable').innerHTML = `<tr><th>Reviewer</th><th>Overall view</th><th>Comment</th><th>Submitted</th></tr>` +
      (D.reviewers.filter(r => r.submitted_at).map(r => `<tr><td><b>${esc(r.name)}</b><br><span class="muted" style="font-size:12px">${esc(r.designation || '')}</span></td>
        <td>${r.overall_verdict ? `<span class="pill" style="--c:${V[r.overall_verdict].color}">${esc(IS_PROC ? { agree: 'Approved', agree_feedback: 'Approved with changes', discuss: 'Discuss first', not_agreed: 'Not approved' }[r.overall_verdict] : V[r.overall_verdict].label)}</span>` : ''}</td>
        <td>${esc(r.overall_comment || '').replace(/\n/g, '<br>')}</td><td>${fmtTime(r.submitted_at)}</td></tr>`).join('') || `<tr><td colspan="4" class="muted">No one has submitted yet.</td></tr>`);
  }

  function renderLog() {
    const who = $('logWho').value, title = Object.fromEntries(D.slides.map(s => [s.id, `${IS_DATA || IS_PROC ? s.id : s.n + '.'} ${s.title}`]));
    const rows = D.log.filter(l => !who || l.reviewer_id === who).slice().reverse();
    $('logTable').innerHTML = `<tr><th>When</th><th>Reviewer</th><th>What</th><th>Slide</th><th>View</th><th>Feedback at that moment</th></tr>` +
      (rows.map(l => `<tr><td style="white-space:nowrap">${fmtTime(l.at)}</td><td>${esc((D.byReviewer[l.reviewer_id] || {}).name || '')}</td><td>${esc(l.event)}</td>
        <td>${esc(title[l.slide] || '')}</td><td>${l.verdict ? `<span class="pill" style="--c:${V[l.verdict].color}">${esc(IS_PROC ? PV[l.verdict] : V[l.verdict].short)}</span>` : ''}</td>
        <td>${l.alt ? `<b>Should be: ${esc(ALT[l.alt])}</b><br>` : ''}${esc(l.feedback || '').replace(/\n/g, '<br>')}</td></tr>`).join('') || `<tr><td colspan="6" class="muted">No activity yet.</td></tr>`);
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
    const rows = [[IS_DATA ? 'Row' : IS_PROC ? 'Step' : 'Slide no', IS_DATA ? 'Data element' : IS_PROC ? 'Step name' : 'Slide', IS_PROC ? 'Sub-process' : 'Section', IS_PROC ? 'Data held' : 'Proposed location', 'Reviewer', 'Designation', 'View', 'Should be', 'Feedback', 'Saved at']];
    D.slides.forEach(s => (D.bySlide[s.id] || []).forEach(v => { const r = D.byReviewer[v.reviewer_id]; rows.push([IS_DATA || IS_PROC ? s.id : s.n, s.title, s.section, IS_PROC ? (PSTEP[s.id] || {}).zone || '' : s.d ? ZONE[s.d.zone] : '', r.name, r.designation || '', IS_DATA && v.verdict === 'not_agreed' ? 'Not agreed' : VL(v.verdict), v.alt ? ALT[v.alt] : '', v.feedback || '', v.at]); }));
    D.reviewers.filter(r => r.submitted_at).forEach(r => rows.push(['', 'OVERALL', '', '', r.name, r.designation || '', r.overall_verdict ? V[r.overall_verdict].label : '', '', r.overall_comment || '', r.submitted_at]));
    download(`${DECK}-answers-${stamp()}.csv`, rows);
  };
  $('csvLogBtn').onclick = () => {
    const title = Object.fromEntries(D.slides.map(s => [s.id, s.title])), num = Object.fromEntries(D.slides.map(s => [s.id, s.n]));
    const rows = [['When', 'Reviewer', 'Event', IS_DATA ? 'Row' : 'Slide no', IS_DATA ? 'Data element' : 'Slide', 'View', 'Should be', 'Feedback']];
    D.log.forEach(l => rows.push([l.at, (D.byReviewer[l.reviewer_id] || {}).name || '', l.event, IS_DATA || IS_PROC ? (l.slide || '') : (num[l.slide] || ''), title[l.slide] || '', l.verdict ? VL(l.verdict) : '', l.alt ? ALT[l.alt] : '', l.feedback || '']));
    download(`${DECK}-changes-${stamp()}.csv`, rows);
  };

  boot();
})();
