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
    { id: 'na', label: 'Not applicable', color: '#7A8494' },
  ];
  const SVL = Object.fromEntries(SV.map(v => [v.id, v]));
  const OVL = { agree: 'Approved', agree_feedback: 'Approved with the changes I noted', discuss: 'Need to discuss first', not_agreed: 'Not approved' };
  const ZC = { 'Local server': 'L', 'Cloud': 'C', 'Both': 'X' };
  const ZCOL = { L: '#C98A1E', C: '#1F5F99', X: '#7A5BA6' };
  const PROMPT = { agree_feedback: 'What should change?', discuss: 'What do you want to discuss?', not_agreed: 'What is wrong, and how should it work at Vista?', na: 'Why it does not apply to you (optional)' };
  const TK = CFG.slug + '.k';

  const S = { token: null, data: null, A: null, steps: [], byId: {}, sub: {}, md: {}, reviews: {}, drafts: {}, locked: false, filter: 'all', q: '', timers: {} };

  function readToken() {
    const h = new URLSearchParams(location.hash.slice(1));
    let t = h.get('k');
    if (t) { store.set(TK, t); history.replaceState(null, '', location.pathname); }
    else t = store.get(TK);
    return t && /^[0-9a-f]{32,128}$/i.test(t) ? t : null;
  }
  const dKey = () => CFG.slug + '.drafts.' + ((S.data && S.data.reviewer && S.data.reviewer.name) || S.token.slice(0, 12)).replace(/\W+/g, '_');
  const saveDrafts = () => store.set(dKey(), JSON.stringify(S.drafts));

  async function start() {
    S.token = readToken();
    if (!S.token) return show('screenError');
    try { S.data = await rpc('vista_proc_open', { p_token: S.token }); }
    catch (e) {
      if ((e.code === '28000' || /invalid link/.test(e.message)) && store.get('vistareview.s')) { store.del(TK); location.replace('/vistareview/'); return; }
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
    if (CFG.slug === 'vistaai') $('counts').innerHTML = `<b>${S.steps.length}</b> items in five parts.`; else if (CFG.slug === 'vistapillars') $('counts').innerHTML = `<b>${S.steps.length - 4}</b> sub-processes and <b>4</b> decisions.`; else $('counts').innerHTML = `<b>${nProc}</b> sub-processes with <b>${nSteps}</b> steps, <b>${nRep}</b> report formats, and <b>${nMob}</b> mobile app screens with the mobility rules.`;
    $('others').textContent = S.A.reviewers.map(x => x[0]).join(', ');
    if (r.submitted_at) return showDone();
    const done = Object.keys(S.reviews).length;
    $('startBtn').textContent = done ? `Continue (${done} of ${S.steps.length} done)` : 'Start the review';
    show('screenWelcome');
  }

  // ---------- list ----------
  const state = id => { const x = S.drafts[id] || S.reviews[id] || { verdict: null, feedback: '' }; return { ...x, extra: x.extra || {} }; };
  const isAuto = st => st.auto === 'AI autonomous';
  // 'Not applicable' needs no answer to the approval or format question
  const qMissing = (st, ex, v) => v !== 'na' && ((isAuto(st) && !(ex || {}).approval) || (st.ext && !(ex || {}).format));
  const needText = s => s.verdict !== 'na' && ((s.verdict && s.verdict !== 'agree') || s.extra.approval === 'limit' || s.extra.format === 'own' || s.extra.format === 'party');
  const AQ = [['alone', 'No: act alone and report'], ['each', 'Yes: approve each time'], ['limit', 'Only above a limit']];
  const FQ = [['ok', 'Yes, as proposed'], ['own', 'Use our template'], ['party', 'Use the party’s format']];
  // A sample of the proposed template for an outside document: fields or a small table per part. Sample values only.
  const TPLK = { vista: 'Vista’s proposed template', party: 'Illustration: the party’s own format governs; these are the fields the platform fills', law: 'Prescribed by law: the platform fills the official format' };
  const tplHtml = t => `<details class="tpl"><summary>See the proposed template: ${esc(t.t)}</summary>
    <div class="tplk">${esc(TPLK[t.k] || '')}</div>
    ${(t.parts || []).map(([h, b]) => `<div class="tplp"><b>${esc(h)}</b><div class="rscroll"><table>${Array.isArray(b)
      ? b.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')
      : `<tr>${b.cols.map(c => `<th>${esc(c)}</th>`).join('')}</tr>${b.rows.map(r => `<tr>${r.map(v => `<td>${esc(v)}</td>`).join('')}</tr>`).join('')}`}</table></div></div>`).join('')}
    ${t.n ? `<div class="qhint">${esc(t.n)}</div>` : ''}
    <div class="qhint">Sample values only, not Vista data. Amounts are shown as [amount]; real figures stay on Vista’s own server.</div></details>`;
  // The proposed format is already the outside party's own (first part before ';'), so "Use the party's format" would repeat "Yes, as proposed".
  const partyFmt = f => { const p = String(f || '').split(';')[0].trim(); return /^(Employer|Contract|OEM|Bank|Tender|Portal|Auditor|Insurer|Client|Vendor|Supplier|Payroll tool)’s\b/i.test(p) || /^(Statutory|Inspection agency|Labour Code)\b/i.test(p); };
  const PCOL = { C: '#2E7D4F', P: '#1F5F99', K: '#6B2FA3', Q: '#B7791F' };
  const CHIPS = { source: ['We use this today', 'We do not use this', 'Login is with someone else', 'Another source to add', 'Discuss in the meeting'],
    chat: ['Add this question:', 'Not needed for this role', 'Should also work on WhatsApp', 'Discuss in the meeting'],
    level: ['Strict', 'Lean', 'Balanced, but stricter for Finance', 'Discuss in the meeting'],
    sod: ['Block it', 'Warn and review', 'Allow at small sites', 'Discuss in the meeting'],
    matrix: ['Change who approves', 'Add a value limit', 'Post is vacant: who covers?', 'Discuss in the meeting'],
    pillar: ['Primary should be Cost reduction', 'Primary should be Profitability', 'Primary should be Controls', 'Primary should be Delivery quality', 'Driver is not right', 'Discuss in the meeting'],
    def: ['Discuss in the meeting', 'Change who does this', 'Keep this on the local server', 'Add an approval step', 'Not needed at Vista', 'Timing is not practical', 'Our format is different'] };
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
        ${e.tpl ? tplHtml(e.tpl) : ''}
        <div class="q">Is this the right format?</div>
        <div class="qopts">${FQ.filter(([k]) => !(k === 'party' && partyFmt(e.fmt) && s.extra.format !== 'party')).map(([k, l]) => `<button class="xo ${s.extra.format === k ? 'on' : ''}" data-x="format" data-o="${k}" ${dis}>${esc(l)}</button>`).join('')}</div>
        ${partyFmt(e.fmt) && s.extra.format !== 'party' ? '<div class="qhint">The proposed format is already the party’s own, so “Yes, as proposed” means using their format.</div>' : ''}
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
    const box = need || s.verdict === 'na' || (s.feedback || '').trim() ? `<div class="cbox"><label for="fb-${esc(st.id)}">${esc(PROMPT[s.verdict] || (need ? 'Comment (required for the choice you made above)' : 'Comment (optional)'))}</label>
      <textarea id="fb-${esc(st.id)}" data-fb="${esc(st.id)}" maxlength="4000" ${dis} placeholder="Write in your own words, or tap a phrase below. Hindi or English is fine.">${esc(s.feedback || '')}</textarea>
      ${S.locked ? '' : `<div class="qchips">${(CHIPS[st.kind] || CHIPS.def).map(c => `<button class="qc" data-qc="${esc(c)}">+ ${esc(c)}</button>`).join('')}</div>`}</div>` : '';
    let status = '';
    if (S.locked) status = saved ? 'Saved' : '';
    else if (S.drafts[st.id]) status = !s.verdict ? 'Choose a view, to save' : need && !(s.feedback || '').trim() ? 'Add a comment to save' : 'Not saved yet';
    else if (saved && qMissing(st, s.extra, s.verdict)) status = 'Please answer the question above';
    else if (saved) status = 'Saved ' + fmtTime(saved.at);
    const scls = S.drafts[st.id] ? (/^(Add|Choose)/.test(status) ? 'err' : 'wait') : status.startsWith('Please') ? 'err' : 'ok';
    const vrow = `<div class="vrow">${SV.map(v => `<button class="vb ${s.verdict === v.id ? 'on' : ''}" data-v="${v.id}" style="--c:${v.color}" ${dis}>${esc(v.label)}</button>`).join('')}
        <span class="sstatus ${scls}" id="st-${esc(st.id)}">${esc(status)}</span></div>${box}`;
    const T = (head, rows) => `<div class="rscroll"><table><tr>${head.map(h => `<th>${esc(h)}</th>`).join('')}</tr>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</table></div>`;
    const top = extra => `<div class="stop"><div class="stitle"><span class="id">${esc(st.id)}</span>${esc(st.title)}</div>${extra || ''}</div>`;
    if (st.kind === 'source') return `<article class="step ${cls(st.id)}" id="s-${esc(st.id)}" data-id="${esc(st.id)}">${top(`<span class="zone ${z}">Held on: ${esc(st.zone)}</span>`)}
      <div class="mks"><span class="mk mn">${esc(st.group)}</span></div>
      <div class="sgrid"><div><span>What we take</span>${esc(st.take)}</div><div><span>How it comes in</span>${esc(st.how)}</div><div><span>How often</span>${esc(st.freq)}</div><div><span>Example</span><i>${esc(st.example)}</i></div></div>
      <div class="gov ex" style="background:#EEF3FA;border-color:#C7D7EC"><b>Please tell us:</b> ${esc(st.ask)}</div>${vrow}</article>`;
    if (st.kind === 'chat') return `<article class="step ${cls(st.id)}" id="s-${esc(st.id)}" data-id="${esc(st.id)}">${top()}
      ${T(['Example question', 'Answer comes from', 'Where and how it is shown'], st.qs.map(q => [`<i>“${esc(q[0])}”</i>`, esc(q[1]), esc(q[2])]))}
      <p class="muted" style="font-size:13px;margin:8px 0 0">Are these the right questions for this role? Add the questions your team really asks in the comment.</p>${vrow}</article>`;
    if (st.kind === 'agents') return `<article class="step ${cls(st.id)}" id="s-${esc(st.id)}" data-id="${esc(st.id)}">${top()}
      ${T(['Agent', 'Meaning', 'What it does', 'Works on'], st.agents.map(a => [`<b>${esc(a[0])}</b>`, esc(a[1]), esc(a[2]), `<span class="zone ${ZC[a[3]]}">${esc(a[3])}</span>`]))}${vrow}</article>`;
    if (st.kind === 'level') return `<article class="step ${cls(st.id)}" id="s-${esc(st.id)}" data-id="${esc(st.id)}">${top()}
      ${T(['Level', 'What it means', 'Trade-off'], st.levels.map(l => [`<b>${esc(l[0])}</b>`, esc(l[1]), esc(l[2])]))}
      <p class="muted" style="font-size:13px;margin:8px 0 0">Agree = adopt Balanced as recommended. For another level choose “Agree with changes” and tap Strict or Lean.</p>${vrow}</article>`;
    if (st.kind === 'sod') return `<article class="step ${cls(st.id)}" id="s-${esc(st.id)}" data-id="${esc(st.id)}">
      <div class="stop"><div class="stitle"><span class="id">${esc(st.id)}</span>${esc(st.a)} <span style="color:#9B2C2C">≠</span> ${esc(st.b)}</div><span class="mk mn">${esc(st.area)}</span></div>
      <div class="sgrid"><div><span>Risk if one person does both</span>${esc(st.risk)}</div><div><span>Proposed (Balanced)</span><b>${esc(st.prop)}</b> · System: ${esc(st.ctl)}</div></div>${vrow}</article>`;
    if (st.kind === 'matrix') return `<article class="step ${cls(st.id)}" id="s-${esc(st.id)}" data-id="${esc(st.id)}">${top()}
      ${T(['Activity', 'Starts', 'Approves', 'Carries out', 'Records / checks', 'Never the same person as'], st.rows.map(r => [`<b>${esc(r[0])}</b>`, esc(r[1]), esc(r[2]), esc(r[3]), esc(r[4]), `<b style="color:#9B2C2C">${esc(r[5])}</b>`]))}${vrow}</article>`;
    if (st.kind === 'metrics') return `<article class="step ${cls(st.id)}" id="s-${esc(st.id)}" data-id="${esc(st.id)}">${top()}
      ${T(['Measure', 'Source', 'Target', 'How often'], st.metrics.map(m => [`<b>${esc(m[0])}</b>`, esc(m[1]), esc(m[2]), esc(m[3])]))}${vrow}</article>`;
    if (st.kind === 'ask') {
      const AV = [['agree_feedback', 'Save my answer', '#1F5F99'], ['discuss', 'Discuss in meeting', '#B7791F'], ['agree', 'No input from me', '#5B6676']];
      return `<article class="step ${cls(st.id)}" id="s-${esc(st.id)}" data-id="${esc(st.id)}">
      <div class="stop"><div class="stitle" style="font-weight:600"><span class="id">${esc(st.id)}</span>${esc(st.title)}</div><span class="mk mn">${esc(st.topic)}</span></div>
      <div class="cbox"><textarea id="fb-${esc(st.id)}" data-fb="${esc(st.id)}" maxlength="4000" ${dis} placeholder="Your answer. Hindi or English is fine.">${esc(s.feedback || '')}</textarea></div>
      <div class="vrow">${AV.map(([v, l, c]) => `<button class="vb ${s.verdict === v ? 'on' : ''}" data-v="${v}" style="--c:${c}" ${dis}>${esc(l)}</button>`).join('')}<span class="sstatus ${scls}" id="st-${esc(st.id)}">${esc(status)}</span></div></article>`;
    }
    if (st.kind === 'confirm') return `<article class="step ${cls(st.id)}" id="s-${esc(st.id)}" data-id="${esc(st.id)}">
      <div class="stop"><div class="stitle"><span class="id">${esc(st.id)}</span>${esc(st.title)}</div></div>${vrow}</article>`;
    if (st.kind === 'pillar') return `<article class="step ${cls(st.id)}" id="s-${esc(st.id)}" data-id="${esc(st.id)}">
      <div class="stop"><div class="stitle"><span class="id">${esc(st.ref)}</span>${esc(st.title)}</div><span class="muted" style="font-size:12px">${st.nsteps} steps in the process pack</span></div>
      <div class="pmini">${(S.A.pillars || []).filter(p => st.map[p.code] && st.map[p.code].level === 2).map(p => `<span style="--pc:${PCOL[p.code]}">● ${esc(p.name)}</span>`).join('')}</div>
      <div class="pgrid">${(S.A.pillars || []).map(p => { const m = st.map[p.code]; return `<div class="pc ${m ? (m.level === 2 ? 'pri' : 'sup') : 'none'}" style="--pc:${PCOL[p.code]}"><b>${esc(p.name)}</b>${m ? `<i>${m.level === 2 ? '● Primary' : '○ Supporting'}</i><span>${esc(m.driver)}</span><small>Steps: ${esc(m.steps)}</small>` : '<span class="muted">—</span>'}</div>`; }).join('')}</div>${vrow}</article>`;
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
      return `<section class="sub" id="sub-${esc(sub.id)}"><div class="shead"><h2>${/vistapillars|vistaai/.test(CFG.slug) ? '' : esc(sub.id) + ' · '}${esc(sub.name)}</h2>
        <div class="smeta"><span>${sub.steps.length} items · ${done} answered</span>
        ${!S.locked && left && sub.steps[0].kind !== 'ask' ? `<button class="btn small bulk" data-bulk="${esc(sub.id)}">Agree with the ${left} not yet answered</button>` : ''}</div></div>
        ${flowHtml(sub)}${vis.map(stepHtml).join('')}</section>`;
    }).join('') || '<p class="muted">Nothing matches.</p>';
    progress();
  }
  function rerow(id) { const el = $('s-' + id); if (!el) return progress(); const open = el.classList.contains('open'); el.outerHTML = stepHtml(S.byId[id]); const n = $('s-' + id); if (n) { if (open) n.classList.add('open'); if (S.cur === id) n.classList.add('cur'); } progress(); }
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
      const res = await rpc('vista_proc_save', { p_token: S.token, p_step: id, p_verdict: d.verdict, p_feedback: fb, p_extra: d.verdict !== 'na' && Object.keys(ex).length ? ex : null });
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
      if (!needText(state(id)) || (cur.feedback || '').trim()) { await save(id); afterAnswer(id); }
      else { const ta = $('fb-' + id); if (ta) ta.focus(); }
      return;
    }
    const qc = e.target.closest('.qc'); if (qc && !S.locked) {
      const id = qc.closest('.step').dataset.id, ta = $('fb-' + id); if (!ta) return;
      const t = ta.value.trim(); ta.value = t ? (/[.!?]$/.test(t) ? t + ' ' : t + '. ') + qc.dataset.qc : qc.dataset.qc;
      ta.dispatchEvent(new Event('input', { bubbles: true })); ta.focus();
      if (state(id).verdict) { await save(id); afterAnswer(id); }
      return;
    }
    const tt = e.target.closest('.stitle'); if (tt && $('subs').classList.contains('quick')) { tt.closest('.step').classList.toggle('open'); return; }
    const xo = e.target.closest('.xo'); if (xo && !S.locked) {
      const id = xo.closest('.step').dataset.id, cur = state(id);
      const extra = { ...cur.extra, [xo.dataset.x]: xo.dataset.o };
      S.drafts[id] = { verdict: cur.verdict, feedback: cur.feedback || '', extra };
      saveDrafts(); rerow(id);
      const ns = state(id);
      if (ns.verdict && (!needText(ns) || (ns.feedback || '').trim())) { await save(id); afterAnswer(id); }
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

  // ---------- easy answering: next item, quick view, keys ----------
  const complete = id => { const st = S.byId[id], s = state(id); return !!(S.reviews[id] && !S.drafts[id] && !qMissing(st, s.extra, s.verdict)); };
  S.auto = store.get('vistareview.auto') !== '0';
  function setCur(id) { document.querySelectorAll('.step.cur').forEach(x => x.classList.remove('cur')); const el = $('s-' + id); if (el) el.classList.add('cur'); S.cur = id; }
  function goNext(fromId) {
    const els = [...document.querySelectorAll('#subs .step')], i = els.findIndex(x => x.dataset.id === fromId);
    const nxt = els.slice(i + 1).concat(els.slice(0, Math.max(i, 0))).find(x => !complete(x.dataset.id));
    if (!nxt) { $('finishNote').textContent = 'All answered — press Finish and submit'; $('finishBtn').focus(); return; }
    nxt.scrollIntoView({ behavior: 'smooth', block: 'start' }); setCur(nxt.dataset.id);
  }
  function afterAnswer(id) { if (S.auto && complete(id)) setTimeout(() => goNext(id), 350); }
  let st0; window.addEventListener('scroll', () => { clearTimeout(st0); st0 = setTimeout(() => {
    if ($('screenList').classList.contains('hidden')) return;
    const el = [...document.querySelectorAll('#subs .step')].find(x => x.getBoundingClientRect().bottom > 170); if (el && el.dataset.id !== S.cur) setCur(el.dataset.id);
  }, 120); }, { passive: true });
  document.addEventListener('keydown', e => {
    if ($('screenList').classList.contains('hidden') || S.locked || e.ctrlKey || e.metaKey || e.altKey) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) return;
    const k = e.key, el = S.cur && $('s-' + S.cur); if (!el) return;
    if ('12345'.includes(k) && k.length === 1) { const b = el.querySelector(`.vb[data-v="${SV[+k - 1].id}"]`); if (b) { e.preventDefault(); b.click(); } }
    else if (k === 'n' || k === 'N') { e.preventDefault(); goNext(S.cur); }
  });
  function addTools() {
    if ($('viewBtn')) return;
    const tb = document.querySelector('.toolbar'), wrap = document.createElement('div'); wrap.className = 'vtools';
    wrap.innerHTML = `<button class="btn small" id="viewBtn"></button><label class="autoj"><input type="checkbox" id="autoChk" ${S.auto ? 'checked' : ''}> Jump to the next item after answering</label>`;
    tb.appendChild(wrap);
    const setView = q => { $('subs').classList.toggle('quick', q); $('viewBtn').textContent = q ? 'Show full detail' : 'Quick view'; store.set('vistareview.quick', q ? '1' : '0'); };
    setView(store.get('vistareview.quick') === '1');
    $('viewBtn').onclick = () => setView(!$('subs').classList.contains('quick'));
    $('autoChk').onchange = e => { S.auto = e.target.checked; store.set('vistareview.auto', S.auto ? '1' : '0'); };
    const nb = document.createElement('button'); nb.className = 'btn'; nb.id = 'nextBtn'; nb.textContent = 'Next unanswered ↓';
    nb.onclick = () => goNext(S.cur || (S.steps[0] && S.steps[0].id));
    $('finishBtn').parentNode.insertBefore(nb, $('finishBtn'));
    const hint = document.createElement('span'); hint.className = 'keyhint'; hint.textContent = 'Keys: 1 Agree · 2 Agree with changes · 3 Discuss · 4 Not agreed · 5 Not applicable · N next';
    $('finishBtn').parentNode.insertBefore(hint, $('finishNote'));
  }
  $('filters').onclick = e => { const b = e.target.closest('button'); if (!b) return; S.filter = b.dataset.f; document.querySelectorAll('#filters button').forEach(x => x.classList.toggle('on', x === b)); render(); };
  let qt; $('search').oninput = e => { clearTimeout(qt); qt = setTimeout(() => { S.q = e.target.value.trim().toLowerCase(); render(); }, 200); };
  $('jump').onchange = e => { const el = $('sub-' + e.target.value); if (el) el.scrollIntoView({ block: 'start' }); e.target.value = ''; };
  $('startBtn').onclick = () => openList();
  function openList() {
    show('screenList'); $('prog').classList.remove('hidden');
    addTools();
    $('jump').innerHTML = '<option value="">Go to sub-process…</option>' + S.A.subs.map(s => `<option value="${esc(s.id)}">${/vistapillars|vistaai/.test(CFG.slug) ? '' : esc(s.id) + ' · '}${esc(s.name)}</option>`).join('');
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
    const missing = S.steps.filter(st => !S.reviews[st.id] || qMissing(st, S.reviews[st.id].extra || {}, S.reviews[st.id].verdict));
    $('finishMissing').innerHTML = missing.length ? `<div class="banner"><b>${missing.length} item${missing.length > 1 ? 's' : ''} (steps, reports or screens) still need${missing.length > 1 ? '' : 's'} a view or an answer to its question</b> before you can submit: ${missing.slice(0, 20).map(st => `<a href="#" data-goto="${esc(st.id)}">${esc(st.id)}</a>`).join(', ')}${missing.length > 20 ? '…' : ''}</div>` : '';
    const fl = S.steps.filter(st => S.reviews[st.id] && (S.reviews[st.id].verdict !== 'agree' || (S.reviews[st.id].feedback || '').trim()));
    $('finishFlagged').innerHTML = fl.length ? `<p style="margin:14px 0 0"><b>Your comments</b></p><ul class="list-plain">${fl.map(st => `<li><a href="#" data-goto="${esc(st.id)}">${esc(st.id)} ${esc(st.title)}</a> · <b style="color:${SVL[S.reviews[st.id].verdict].color}">${esc(SVL[S.reviews[st.id].verdict].label)}</b><br><span class="muted">${esc(S.reviews[st.id].feedback || '')}</span></li>`).join('')}</ul>` : '';
    $('overallVerdicts').innerHTML = SV.filter(v => v.id !== 'na').map(v => `<button class="vbtn ${S.overall === v.id ? 'on' : ''}" data-v="${v.id}" style="--c:${v.color}">${esc(v.id === 'agree' ? 'Approved' : v.id === 'agree_feedback' ? 'Approved with the changes I noted' : v.id === 'discuss' ? 'Need to discuss first' : 'Not approved')}</button>`).join('');
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
    $('doneText').innerHTML = `Your review was submitted on ${esc(fmtTime(r.submitted_at))}${r.overall_verdict ? `, with the decision <b>${esc(OVL[r.overall_verdict])}</b>` : ''}.`;
    $('doneTally').innerHTML = tally(); $('prog').classList.remove('hidden'); progress();
    show('screenDone');
  }
  $('browseBtn').onclick = () => openList();
  window.addEventListener('beforeunload', () => { for (const id of Object.keys(S.drafts)) save(id); });

  start();
})();
