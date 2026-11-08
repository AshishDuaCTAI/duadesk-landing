// Process review: each reviewer gives a view on every step of one area. Many reviewers per area, each with a personal link.
(function () {
  const { V, rpc, loadSlides, esc, store, fmtTime } = window.VistaReview;
  const CFG = window.VISTA_PROC; // { slug, area }
  const $ = id => document.getElementById(id);
  const screens = ['screenLoading', 'screenError', 'screenWelcome', 'screenList', 'screenFinish', 'screenDone'];
  const show = id => { screens.forEach(s => $(s).classList.toggle('hidden', s !== id)); window.scrollTo(0, 0); };
  const SV = [
    { id: 'agree', label: 'Agree', color: '#2E7D4F' },
    { id: 'agree_feedback', label: 'Agree with changes', color: '#1F5F99' },
    { id: 'discuss', label: 'Need to discuss', color: '#B7791F' },
    { id: 'not_agreed', label: 'Not agreed', color: '#B4412F' },
  ];
  const SVL = Object.fromEntries(SV.map(v => [v.id, v]));
  const ZC = { 'Local server': 'L', 'Cloud': 'C', 'Both': 'X' };
  const ZCOL = { L: '#C98A1E', C: '#1F5F99', X: '#7A5BA6' };
  const PROMPT = { agree_feedback: 'What should change?', discuss: 'What do you want to discuss?', not_agreed: 'What is wrong, and how should it work at Vista?' };
  const TK = CFG.slug + '.k';

  const S = { token: null, data: null, A: null, steps: [], byId: {}, sub: {}, md: {}, reviews: {}, drafts: {}, locked: false, filter: 'all', q: '', timers: {} };

  function readToken() {
    const h = new URLSearchParams(location.hash.slice(1));
    let t = h.get('k');
    if (t) { store.set(TK, t); history.replaceState(null, '', location.pathname); }
    else t = store.get(TK);
    return t && /^[0-9a-f]{32,128}$/i.test(t) ? t : null;
  }
  const dKey = () => CFG.slug + '.drafts.' + S.token.slice(0, 12);
  const saveDrafts = () => store.set(dKey(), JSON.stringify(S.drafts));

  async function start() {
    S.token = readToken();
    if (!S.token) return show('screenError');
    try { S.data = await rpc('vista_proc_open', { p_token: S.token }); }
    catch (e) {
      if (e.code === '28000' || /invalid link/.test(e.message)) { store.del(TK); $('errText').textContent = 'This link is not valid for this review. It may have been replaced by a newer one, or it belongs to another area.'; }
      else $('errText').textContent = e.message;
      return show('screenError');
    }
    try { S.A = await loadSlides(S.data.content.file, S.data.content.key); }
    catch (e) { $('errText').textContent = 'Could not open the process content: ' + e.message; return show('screenError'); }
    S.A.md.forEach(m => { S.md[m.code] = m; });
    const nProc = S.A.subs.length, nRep = (S.A.reports || []).length;
    if (nRep) S.A.subs.push({ id: 'R', name: 'Report formats for approval', steps: S.A.reports, isReports: true });
    const nMob = (S.A.mobile || []).filter(m => m.kind === 'mobile').length;
    if (S.A.mobile && S.A.mobile.length) S.A.subs.push({ id: 'M', name: 'Mobile app for approval', steps: S.A.mobile, isMobile: true });
    if (S.A.audit && S.A.audit.length) S.A.subs.push({ id: 'AT', name: 'Audit trail', steps: S.A.audit, isAudit: true });
    S.A.subs.forEach(sub => sub.steps.forEach(st => { st.sub = sub.id; S.steps.push(st); S.byId[st.id] = st; }));
    const nSteps = S.steps.length - nRep - (S.A.mobile || []).length - (S.A.audit || []).length;
    S.reviews = S.data.reviews || {};
    try { S.drafts = JSON.parse(store.get(dKey()) || '{}'); } catch { S.drafts = {}; }
    for (const id of Object.keys(S.drafts)) if (!S.byId[id]) delete S.drafts[id];
    S.locked = !!S.data.reviewer.submitted_at || !S.data.deck.is_open;
    const r = S.data.reviewer;
    $('who').textContent = r.name + (r.designation ? ' · ' + r.designation : '');
    $('welcomeTitle').textContent = 'Dear ' + r.name.split(' ')[0] + ',';
    $('scope').textContent = S.A.scope;
    $('counts').innerHTML = `<b>${nProc}</b> sub-processes with <b>${nSteps}</b> steps, <b>${nRep}</b> report formats, and <b>${nMob}</b> mobile app screens with the mobility rules.`;
    $('others').textContent = S.A.reviewers.map(x => x[0]).join(', ');
    if (r.submitted_at) return showDone();
    const done = Object.keys(S.reviews).length;
    $('startBtn').textContent = done ? `Continue (${done} of ${S.steps.length} done)` : 'Start the review';
    show('screenWelcome');
  }

  // ---------- list ----------
  const state = id => { const x = S.drafts[id] || S.reviews[id] || { verdict: null, feedback: '' }; return { ...x, extra: x.extra || {} }; };
  const isAuto = st => st.auto === 'AI autonomous';
  const qMissing = (st, ex) => (isAuto(st) && !ex.approval) || (st.ext && !ex.format);
  const needText = s => (s.verdict && s.verdict !== 'agree') || s.extra.approval === 'limit' || s.extra.format === 'own' || s.extra.format === 'party';
  const AQ = [['alone', 'No: act alone and report'], ['each', 'Yes: approve each time'], ['limit', 'Only above a limit']];
  const FQ = [['ok', 'Yes, as proposed'], ['own', 'Use our template'], ['party', 'Use the party’s format']];
  const ACAT = () => Object.fromEntries((S.A.audit_cats || []).map(c => [c.code, c]));
  function marks(st) {
    let m = '';
    if (st.auto) m += `<span class="mk ${isAuto(st) ? 'ai' : st.auto === 'AI-assisted' ? 'as' : 'mn'}">${esc(st.auto)}</span>`;
    if (st.ext) m += `<span class="mk ex">External · ${esc(st.ext.party)}</span>`;
    if (st.audit && st.audit.length) m += `<span class="mk au">Audit trail</span>`;
    return m ? `<div class="mks">${m}</div>` : '';
  }
  function qHtml(st, s, dis) {
    let h = '';
    if (isAuto(st)) {
      const a = st.autoinfo;
      h += `<div class="gov ai"><b>Proposed to run on its own (AI autonomous)</b>
        <div class="gacts">${esc(a.acts)}</div>
        <ul><li><b>Productivity:</b> ${esc(a.productivity)}</li><li><b>Better decisions:</b> ${esc(a.decisions)}</li><li><b>Impact:</b> ${esc(a.impact)}</li><li><b>Proposed human checkpoint:</b> ${esc(a.checkpoint)}</li></ul>
        <div class="q">Does a person need to approve before the agent acts?</div>
        <div class="qopts">${AQ.map(([k, l]) => `<button class="xo ${s.extra.approval === k ? 'on' : ''}" data-x="approval" data-o="${k}" ${dis}>${esc(l)}</button>`).join('')}</div>
        ${s.extra.approval === 'limit' ? '<div class="qhint">Write the limit in the comment below (for example: above ₹ 5 lakh, or more than 3 reminders).</div>' : ''}</div>`;
    }
    if (st.ext) {
      const e = st.ext;
      h += `<div class="gov ex"><b>External-facing: ${esc(e.party)}</b> · ${esc(e.doc)} (${e.dir === 'Both' ? 'in and out' : e.dir === 'In' ? 'received by Vista' : 'sent by Vista'})
        <div class="gacts">Proposed format: ${esc(e.fmt)}</div>
        <div class="q">Is this the right format?</div>
        <div class="qopts">${FQ.map(([k, l]) => `<button class="xo ${s.extra.format === k ? 'on' : ''}" data-x="format" data-o="${k}" ${dis}>${esc(l)}</button>`).join('')}</div>
        ${s.extra.format === 'own' || s.extra.format === 'party' ? '<div class="qhint">Name the template in the comment below, and email the file to Ashish.</div>' : ''}</div>`;
    }
    return h;
  }
  function auditHtml(st) {
    if (!st.audit) return '';
    const C = ACAT();
    return `<div><span>Audit trail</span>${st.audit.length ? st.audit.map(c => esc(C[c] ? C[c].name : c)).join('; ') : 'Standard activity log'}</div>`;
  }
  const cls = id => S.drafts[id] ? 'draft' : S.reviews[id] ? 'v-' + S.reviews[id].verdict : '';
  function visible(st) {
    const f = S.filter, rv = S.reviews[st.id];
    if (f === 'open' && rv) return false;
    if (f === 'L' && ZC[st.zone] === 'C') return false;
    if (f === 'auto' && !isAuto(st)) return false;
    if (f === 'ext' && !st.ext) return false;
    if (f === 'flag' && !(rv && rv.verdict !== 'agree') && !(S.drafts[st.id] && S.drafts[st.id].verdict !== 'agree')) return false;
    if (S.q) {
      const hay = [st.id, st.title, st.what, st.who.join(' '), st.agent, st.control || '', st.notes || '', (st.columns || []).join(' '), (st.receivers || []).join(' '), st.md.map(m => m.code + ' ' + m.name).join(' ')].join(' ').toLowerCase();
      if (!hay.includes(S.q)) return false;
    }
    return true;
  }
  function mdHtml(st) {
    if (!st.md.length) return 'None';
    return st.md.map(m => {
      const o = S.md[m.code];
      return `<div class="md"><b>${esc(m.code)} ${esc(m.name)}</b> · ${esc(m.act)}${o ? `<div class="own">Held on: ${esc(o.zone)} · Created by: ${esc(o.creates)} · Maintained by: ${esc(o.maintains)} · Approved by: ${esc(o.approves)}</div>` : ''}</div>`;
    }).join('');
  }
  function stepHtml(st) {
    const s = state(st.id), dis = S.locked ? 'disabled' : '', saved = S.reviews[st.id], z = ZC[st.zone];
    const need = needText(s);
    const box = need || (s.feedback || '').trim() ? `<div class="cbox"><label for="fb-${esc(st.id)}">${esc(PROMPT[s.verdict] || 'Comment (optional)')}</label>
      <textarea id="fb-${esc(st.id)}" data-fb="${esc(st.id)}" maxlength="4000" ${dis} placeholder="Write in your own words. Hindi or English is fine.">${esc(s.feedback || '')}</textarea></div>` : '';
    let status = '';
    if (S.locked) status = saved ? 'Saved' : '';
    else if (S.drafts[st.id]) status = !s.verdict ? 'Choose a view, to save' : need && !(s.feedback || '').trim() ? 'Add a comment to save' : 'Not saved yet';
    else if (saved && qMissing(st, s.extra)) status = 'Please answer the question above';
    else if (saved) status = 'Saved ' + fmtTime(saved.at);
    const scls = S.drafts[st.id] ? (/^(Add|Choose)/.test(status) ? 'err' : 'wait') : status.startsWith('Please') ? 'err' : 'ok';
    const vrow = `<div class="vrow">${SV.map(v => `<button class="vb ${s.verdict === v.id ? 'on' : ''}" data-v="${v.id}" style="--c:${v.color}" ${dis}>${esc(v.label)}</button>`).join('')}
        <span class="sstatus ${scls}" id="st-${esc(st.id)}">${esc(status)}</span></div>${box}`;
    if (st.kind === 'audit') return `<article class="step ${cls(st.id)}" id="s-${esc(st.id)}" data-id="${esc(st.id)}">
      <div class="stop"><div class="stitle"><span class="id">${esc(st.id)}</span>${esc(st.title)}</div></div>
      <p class="swhat">${esc(st.what)}</p>
      <div class="rscroll"><table><tr><th>What is audited</th><th>What is recorded</th><th>Where kept</th><th>Kept for</th><th>Steps</th></tr>${st.cats.map(c => `<tr><td><b>${esc(c.name)}</b></td><td>${esc(c.what)}</td><td>${esc(c.where)}</td><td>${esc(c.keep)}</td><td>${c.steps.length ? esc(c.steps.join(', ')) : '—'}</td></tr>`).join('')}</table></div>${vrow}</article>`;
    if (st.kind === 'mrule') return `<article class="step ${cls(st.id)}" id="s-${esc(st.id)}" data-id="${esc(st.id)}">
      <div class="stop"><div class="stitle"><span class="id">${esc(st.id)}</span>${esc(st.title)}</div></div>
      <p class="swhat">${esc(st.what)}</p>
      <ol class="mrules">${st.rules.map(([k, v]) => `<li><b>${esc(k)}.</b> ${esc(v)}</li>`).join('')}</ol>${vrow}</article>`;
    if (st.kind === 'mobile') return `<article class="step ${cls(st.id)}" id="s-${esc(st.id)}" data-id="${esc(st.id)}">
      <div class="mob"><img src="data:image/jpeg;base64,${st.img}" alt="Illustrative phone screen: ${esc(st.title)}">
      <div class="mtext"><div class="stop"><div class="stitle"><span class="id">${esc(st.id)}</span>${esc(st.title)}</div><span class="zone ${z}">${z === 'L' ? 'Local server · Vista VPN only' : 'Cloud · offline: ' + esc(st.offline)}</span></div>
      <p class="swhat">${esc(st.what)}</p>
      ${marks(st)}<div class="sgrid" style="grid-template-columns:1fr"><div><span>Who uses it</span>${esc(st.users)}</div><div><span>Kept on the phone</span>${esc(st.stores)}</div></div>${qHtml(st, s, dis)}${vrow}</div></div></article>`;
    if (st.kind === 'report') return `<article class="step ${cls(st.id)}" id="s-${esc(st.id)}" data-id="${esc(st.id)}">
      <div class="stop"><div class="stitle"><span class="id">${esc(st.id)}</span>${esc(st.title)}</div><span class="zone ${z}">Data held: ${esc(st.zone)}</span></div>
      ${marks(st)}<p class="swhat">${esc(st.what)}</p>
      <div class="sgrid">
        <div><span>Who receives it</span>${st.receivers.map(esc).join('<br>')}</div>
        <div><span>How often</span>${esc(st.freq)}</div>
        <div><span>Prepared by</span>${esc(st.owner)}<br>AI agent: ${esc(st.agent)}</div>
        <div><span>How it is delivered</span>${esc(st.delivery)}</div>
        <div><span>Filters</span>${esc(st.filters)}</div>
        <div><span>Highlights and rules</span>${esc(st.notes)}</div>
      </div>
      <div class="rlay"><span>Proposed layout · sample values, for illustration only</span><div class="rscroll"><table><tr>${st.columns.map(c => `<th>${esc(c)}</th>`).join('')}</tr>${st.sample.map(r => `<tr>${r.map(v => `<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</table></div></div>
      ${qHtml(st, s, dis)}${vrow}</article>`;
    return `<article class="step ${cls(st.id)}" id="s-${esc(st.id)}" data-id="${esc(st.id)}">
      <div class="stop"><div class="stitle"><span class="id">${esc(st.id)}</span>${esc(st.title)}</div><span class="zone ${z}">Data held: ${esc(st.zone)}</span></div>
      ${marks(st)}<p class="swhat">${esc(st.what)}</p>
      <div class="sgrid">
        <div><span>Who does it</span>${st.who.length ? st.who.map(esc).join('<br>') : 'Automatic (platform)'}</div>
        <div><span>AI agent · ${esc(st.auto || '')}</span>${esc(st.agent && st.agent !== '—' ? st.agent : 'None')}</div>
        <div><span>Master data (who creates and maintains it)</span>${mdHtml(st)}</div>
        <div><span>Control and timing</span>${esc(st.control || '—')}</div>
        ${auditHtml(st)}
      </div>
      ${qHtml(st, s, dis)}${vrow}</article>`;
  }
  function flowHtml(sub) {
    if (sub.isAudit) return '';
    if (sub.isMobile) return '<p class="muted" style="margin:4px 0 10px;font-size:14px">Illustrative screens: sample values, not Vista data. Blue = cloud (works offline). Amber = local server, opened only over Vista VPN, nothing saved on the phone.</p>';
    if (sub.isReports) return '<p class="muted" style="margin:4px 0 10px;font-size:14px">For each report: is it the right report, for the right people, at the right time, with the right columns? Say what to add, remove or change.</p>';
    return `<div class="flow">${sub.steps.map((st, i) => {
      const rv = S.reviews[st.id], c = rv ? (rv.verdict === 'agree' ? 'ok' : 'no') : '';
      return (i ? '<span class="arr">→</span>' : '') + `<a href="#s-${esc(st.id)}" data-jump="${esc(st.id)}" class="${c}" style="--zc:${ZCOL[ZC[st.zone]]}"><b>${esc(st.id)} · ${esc(st.zone)}${isAuto(st) ? ' · <i class="fai">AI auto</i>' : ''}${st.ext ? ' · <i class="fex">Ext</i>' : ''}</b>${esc(st.title)}</a>`;
    }).join('')}</div>`;
  }
  function render() {
    $('subs').innerHTML = S.A.subs.map(sub => {
      const vis = sub.steps.filter(visible); if (!vis.length) return '';
      const done = sub.steps.filter(st => S.reviews[st.id]).length;
      const left = sub.steps.filter(st => !S.reviews[st.id] && !S.drafts[st.id] && !qMissing(st, {})).length;
      return `<section class="sub" id="sub-${esc(sub.id)}"><div class="shead"><h2>${esc(sub.id)} · ${esc(sub.name)}</h2>
        <div class="smeta"><span>${sub.steps.length} steps · ${done} answered</span>
        ${!S.locked && left ? `<button class="btn small bulk" data-bulk="${esc(sub.id)}">Agree with the ${left} not yet answered</button>` : ''}</div></div>
        ${flowHtml(sub)}${vis.map(stepHtml).join('')}</section>`;
    }).join('') || '<p class="muted">Nothing matches.</p>';
    progress();
  }
  function rerow(id) { const el = $('s-' + id); if (el) el.outerHTML = stepHtml(S.byId[id]); progress(); }
  function progress() {
    const n = S.steps.length, vals = Object.values(S.reviews);
    $('progBar').innerHTML = SV.map(v => `<i style="width:${vals.filter(x => x.verdict === v.id).length / n * 100}%;background:${v.color}"></i>`).join('');
    $('progText').textContent = `${vals.length} of ${n} answered`;
    $('finishNote').textContent = vals.length < n ? `${n - vals.length} still to answer` : 'All answered';
    $('finishBtn').disabled = S.locked;
  }

  // ---------- saving ----------
  async function save(id) {
    clearTimeout(S.timers[id]);
    const d = S.drafts[id]; if (!d || S.locked) return true;
    const fb = (d.feedback || '').trim();
    const ex = d.extra || {};
    if (!d.verdict) return false;
    if (needText({ verdict: d.verdict, extra: ex }) && !fb) return false;
    const st = $('st-' + id); if (st) { st.textContent = 'Saving…'; st.className = 'sstatus wait'; }
    try {
      const res = await rpc('vista_proc_save', { p_token: S.token, p_step: id, p_verdict: d.verdict, p_feedback: fb, p_extra: Object.keys(ex).length ? ex : null });
      S.reviews[id] = { verdict: d.verdict, feedback: fb, extra: ex, at: res.at };
      const now = S.drafts[id];
      if (now && now.verdict === d.verdict && (now.feedback || '').trim() === fb && JSON.stringify(now.extra || {}) === JSON.stringify(ex)) delete S.drafts[id];
      saveDrafts();
      const typing = document.activeElement && document.activeElement.dataset && document.activeElement.dataset.fb === id;
      if (!typing) rerow(id);
      else { const s = $('st-' + id); if (s) { s.textContent = 'Saved ' + fmtTime(res.at); s.className = 'sstatus ok'; } const el = $('s-' + id); if (el) el.className = 'step ' + cls(id); progress(); }
      return true;
    } catch (e) {
      if (/already submitted|closed/.test(e.message)) { S.locked = true; render(); }
      const s = $('st-' + id); if (s) { s.textContent = 'Not saved: ' + e.message; s.className = 'sstatus err'; }
      return false;
    }
  }
  $('subs').addEventListener('click', async e => {
    const b = e.target.closest('.vb'); if (b && !S.locked) {
      const id = b.closest('.step').dataset.id, cur = state(id);
      S.drafts[id] = { verdict: b.dataset.v, feedback: cur.feedback || '', extra: cur.extra };
      saveDrafts(); rerow(id);
      if (!needText(state(id)) || (cur.feedback || '').trim()) save(id);
      else { const ta = $('fb-' + id); if (ta) ta.focus(); }
      return;
    }
    const xo = e.target.closest('.xo'); if (xo && !S.locked) {
      const id = xo.closest('.step').dataset.id, cur = state(id);
      const extra = { ...cur.extra, [xo.dataset.x]: xo.dataset.o };
      S.drafts[id] = { verdict: cur.verdict, feedback: cur.feedback || '', extra };
      saveDrafts(); rerow(id);
      const ns = state(id);
      if (ns.verdict && (!needText(ns) || (ns.feedback || '').trim())) save(id);
      else if (ns.verdict) { const ta = $('fb-' + id); if (ta) ta.focus(); }
      return;
    }
    const j = e.target.closest('[data-jump]'); if (j) { e.preventDefault(); const el = $('s-' + j.dataset.jump); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    const bulk = e.target.closest('[data-bulk]'); if (bulk && !S.locked) {
      if (bulk.dataset.armed !== '1') { bulk.dataset.armed = '1'; bulk.textContent = 'Confirm: agree with all of them'; setTimeout(() => { if (bulk.isConnected && bulk.dataset.armed === '1') render(); }, 5000); return; }
      bulk.dataset.armed = '2'; bulk.disabled = true; bulk.textContent = 'Saving…';
      const sub = S.A.subs.find(x => x.id === bulk.dataset.bulk);
      for (const st of sub.steps) if (!S.reviews[st.id] && !S.drafts[st.id] && !qMissing(st, {})) { S.drafts[st.id] = { verdict: 'agree', feedback: '' }; await save(st.id); }
      render();
    }
  });
  $('subs').addEventListener('input', e => {
    const ta = e.target; if (!ta.dataset || !ta.dataset.fb) return;
    const id = ta.dataset.fb, cur = state(id);
    S.drafts[id] = { verdict: cur.verdict, feedback: ta.value, extra: cur.extra }; saveDrafts();
    const s = $('st-' + id); clearTimeout(S.timers[id]);
    if (!cur.verdict) { if (s) { s.textContent = 'Choose a view, to save'; s.className = 'sstatus err'; } return; }
    if (s) { s.textContent = 'Typing…'; s.className = 'sstatus wait'; }
    S.timers[id] = setTimeout(() => save(id), 1500);
  });
  $('subs').addEventListener('focusout', e => { const ta = e.target; if (ta.dataset && ta.dataset.fb && S.drafts[ta.dataset.fb]) save(ta.dataset.fb); });

  $('filters').onclick = e => { const b = e.target.closest('button'); if (!b) return; S.filter = b.dataset.f; document.querySelectorAll('#filters button').forEach(x => x.classList.toggle('on', x === b)); render(); };
  let qt; $('search').oninput = e => { clearTimeout(qt); qt = setTimeout(() => { S.q = e.target.value.trim().toLowerCase(); render(); }, 200); };
  $('jump').onchange = e => { const el = $('sub-' + e.target.value); if (el) el.scrollIntoView({ block: 'start' }); e.target.value = ''; };
  $('startBtn').onclick = () => openList();
  function openList() {
    show('screenList'); $('prog').classList.remove('hidden');
    $('jump').innerHTML = '<option value="">Go to sub-process…</option>' + S.A.subs.map(s => `<option value="${esc(s.id)}">${esc(s.id)} · ${esc(s.name)}</option>`).join('');
    $('lockedBanner').classList.toggle('hidden', !S.locked);
    if (S.locked) $('lockedBanner').textContent = S.data.reviewer.submitted_at ? `You submitted your review on ${fmtTime(S.data.reviewer.submitted_at)}. Answers are shown read-only.` : 'This review is closed. Answers are shown read-only.';
    render();
  }

  // ---------- finish ----------
  function tally() {
    const vals = Object.values(S.reviews);
    return SV.map(v => `<div style="--c:${v.color}"><b>${vals.filter(x => x.verdict === v.id).length}</b><span class="muted" style="font-size:13px">${esc(v.label)}</span></div>`).join('');
  }
  $('finishBtn').onclick = async () => {
    for (const id of Object.keys(S.drafts)) await save(id);
    $('finishTally').innerHTML = tally();
    const missing = S.steps.filter(st => !S.reviews[st.id] || qMissing(st, S.reviews[st.id].extra || {}));
    $('finishMissing').innerHTML = missing.length ? `<div class="banner"><b>${missing.length} item${missing.length > 1 ? 's' : ''} (steps, reports or screens) still need${missing.length > 1 ? '' : 's'} a view or an answer to its question</b> before you can submit: ${missing.slice(0, 20).map(st => `<a href="#" data-goto="${esc(st.id)}">${esc(st.id)}</a>`).join(', ')}${missing.length > 20 ? '…' : ''}</div>` : '';
    const fl = S.steps.filter(st => S.reviews[st.id] && (S.reviews[st.id].verdict !== 'agree' || (S.reviews[st.id].feedback || '').trim()));
    $('finishFlagged').innerHTML = fl.length ? `<p style="margin:14px 0 0"><b>Your comments</b></p><ul class="list-plain">${fl.map(st => `<li><a href="#" data-goto="${esc(st.id)}">${esc(st.id)} ${esc(st.title)}</a> · <b style="color:${SVL[S.reviews[st.id].verdict].color}">${esc(SVL[S.reviews[st.id].verdict].label)}</b><br><span class="muted">${esc(S.reviews[st.id].feedback || '')}</span></li>`).join('')}</ul>` : '';
    $('overallVerdicts').innerHTML = SV.map(v => `<button class="vbtn ${S.overall === v.id ? 'on' : ''}" data-v="${v.id}" style="--c:${v.color}">${esc(v.id === 'agree' ? 'Approved' : v.id === 'agree_feedback' ? 'Approved with the changes I noted' : v.id === 'discuss' ? 'Need to discuss first' : 'Not approved')}</button>`).join('');
    $('submitBtn').disabled = missing.length > 0; $('submitBtn').textContent = 'Submit my review'; S.confirming = false; $('finishStatus').textContent = '';
    show('screenFinish');
  };
  $('overallVerdicts').onclick = e => { const b = e.target.closest('.vbtn'); if (!b) return; S.overall = b.dataset.v; document.querySelectorAll('#overallVerdicts .vbtn').forEach(x => x.classList.toggle('on', x === b)); };
  document.addEventListener('click', e => {
    const a = e.target.closest('[data-goto]'); if (!a) return; e.preventDefault();
    S.filter = 'all'; S.q = ''; $('search').value = ''; document.querySelectorAll('#filters button').forEach(x => x.classList.toggle('on', x.dataset.f === 'all'));
    openList(); const el = $('s-' + a.dataset.goto); if (el) el.scrollIntoView({ block: 'start' });
  });
  $('backBtn').onclick = () => openList();
  $('submitBtn').onclick = async () => {
    const st = $('finishStatus');
    if (!S.overall) { st.textContent = 'Choose your overall decision.'; st.className = 'status err'; return; }
    const c = $('overallText').value.trim();
    if (S.overall !== 'agree' && !c) { st.textContent = 'Please add an overall comment for this decision.'; st.className = 'status err'; $('overallText').focus(); return; }
    if (!S.confirming) { S.confirming = true; $('submitBtn').textContent = 'Confirm: submit now'; st.textContent = 'After submitting, your answers are locked. Press again to confirm.'; st.className = 'status wait'; return; }
    $('submitBtn').disabled = true; st.textContent = 'Submitting…'; st.className = 'status wait';
    try {
      await rpc('vista_submit', { p_token: S.token, p_overall_verdict: S.overall, p_overall_comment: c });
      S.data.reviewer.submitted_at = new Date().toISOString(); S.data.reviewer.overall_verdict = S.overall; S.locked = true;
      store.del(dKey()); S.drafts = {}; showDone();
    } catch (e) { st.textContent = 'Not submitted: ' + e.message; st.className = 'status err'; $('submitBtn').disabled = false; }
  };
  function showDone() {
    const r = S.data.reviewer;
    $('doneText').innerHTML = `Your review was submitted on ${esc(fmtTime(r.submitted_at))}${r.overall_verdict ? `, with the decision <b>${esc(SVL[r.overall_verdict].label)}</b>` : ''}.`;
    $('doneTally').innerHTML = tally(); $('prog').classList.remove('hidden'); progress();
    show('screenDone');
  }
  $('browseBtn').onclick = () => openList();
  window.addEventListener('beforeunload', () => { for (const id of Object.keys(S.drafts)) save(id); });

  start();
})();
