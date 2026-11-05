// Data residency review: for every data element, Agree / Not agree with the proposed location (local server or cloud).
(function () {
  const { VERDICTS, V, rpc, esc, store, fmtTime } = window.VistaReview;
  const $ = id => document.getElementById(id);
  const screens = ['screenLoading', 'screenError', 'screenWelcome', 'screenList', 'screenFinish', 'screenDone'];
  const show = id => { screens.forEach(s => $(s).classList.toggle('hidden', s !== id)); window.scrollTo(0, 0); };
  const ZONE = { L: 'Local server', C: 'Cloud' };
  const ALT = { local: 'Local server', cloud: 'Cloud', split: 'Split between the two' };

  const S = { token: null, data: null, rows: [], byId: {}, reviews: {}, drafts: {}, locked: false, filter: 'all', q: '', timers: {} };

  function readToken() {
    const h = new URLSearchParams(location.hash.slice(1));
    let t = h.get('k');
    if (t) { store.set('vistadata.k', t); history.replaceState(null, '', location.pathname); }
    else t = store.get('vistadata.k');
    return t && /^[0-9a-f]{32,128}$/i.test(t) ? t : null;
  }
  const dKey = () => 'vistadata.drafts.' + S.token.slice(0, 12);
  const saveDrafts = () => store.set(dKey(), JSON.stringify(S.drafts));

  async function start() {
    S.token = readToken();
    if (!S.token) return show('screenError');
    try { S.data = await rpc('vista_data_open', { p_token: S.token }); }
    catch (e) {
      if (e.code === '28000' || /invalid link/.test(e.message)) { store.del('vistadata.k'); $('errText').textContent = 'This link is not valid for this review. It may have been replaced by a newer one.'; }
      else $('errText').textContent = e.message;
      return show('screenError');
    }
    S.rows = S.data.rows; S.rows.forEach(r => { S.byId[r.id] = r; });
    S.reviews = S.data.reviews || {};
    try { S.drafts = JSON.parse(store.get(dKey()) || '{}'); } catch { S.drafts = {}; }
    for (const id of Object.keys(S.drafts)) if (!S.byId[id] || S.reviews[id]) delete S.drafts[id];
    S.locked = !!S.data.reviewer.submitted_at || !S.data.deck.is_open;
    const r = S.data.reviewer;
    $('who').textContent = r.name + (r.designation ? ' · ' + r.designation : '');
    $('nRows').textContent = `all ${S.rows.length}`;
    const nl = S.rows.filter(x => x.d.zone === 'L').length;
    $('welcomeTally').innerHTML = `<div style="--c:#C98A1E"><b>${nl}</b><span class="muted" style="font-size:13px">proposed on the local server</span></div><div style="--c:#1F5F99"><b>${S.rows.length - nl}</b><span class="muted" style="font-size:13px">proposed on the cloud</span></div>`;
    $('welcomeTitle').textContent = 'Dear ' + r.name.split(' ')[0] + ',';
    if (r.submitted_at) return showDone();
    const done = Object.keys(S.reviews).length;
    $('startBtn').textContent = done ? `Continue (${done} of ${S.rows.length} done)` : 'Start';
    show('screenWelcome');
  }

  // ---------- list ----------
  const state = id => S.drafts[id] || S.reviews[id] || { verdict: null, alt: null, feedback: '' };
  function rowClass(id) { const r = S.reviews[id], d = S.drafts[id]; return d ? 'draft' : r ? (r.verdict === 'agree' ? 'ok' : 'no') : ''; }
  function visible(row) {
    const st = S.reviews[row.id], f = S.filter;
    if (f === 'open' && st) return false;
    if ((f === 'L' || f === 'C') && row.d.zone !== f) return false;
    if (f === 'no' && !(st && st.verdict === 'not_agreed') && !(S.drafts[row.id] && S.drafts[row.id].verdict === 'not_agreed')) return false;
    if (S.q) { const hay = (row.id + ' ' + row.title + ' ' + row.d.includes + ' ' + row.d.why + ' ' + row.d.cross).toLowerCase(); if (!hay.includes(S.q)) return false; }
    return true;
  }
  function rowHtml(row) {
    const st = state(row.id), dis = S.locked ? 'disabled' : '', saved = S.reviews[row.id];
    const altPanel = st.verdict === 'not_agreed' ? `<div class="alt">
        <b>Where should it be?</b>
        <div class="opts">${Object.entries(ALT).filter(([k]) => !(k === 'local' && row.d.zone === 'L') && !(k === 'cloud' && row.d.zone === 'C')).map(([k, v]) => `<label><input type="radio" name="alt-${esc(row.id)}" value="${k}" ${st.alt === k ? 'checked' : ''} ${dis}> ${esc(v)}</label>`).join('')}</div>
        <label for="fb-${esc(row.id)}"><b>Why?</b></label>
        <textarea id="fb-${esc(row.id)}" data-fb="${esc(row.id)}" maxlength="4000" ${dis} placeholder="What worries you about the proposed location, or what would you keep separate?">${esc(st.feedback || '')}</textarea>
      </div>` : '';
    const status = S.locked ? (saved ? 'Saved' : '') : S.drafts[row.id] ? (st.verdict === 'not_agreed' && (!st.alt || !(st.feedback || '').trim()) ? 'Choose where it should be and say why, to save' : 'Not saved yet') : saved ? 'Saved ' + fmtTime(saved.at) : '';
    const scls = S.drafts[row.id] ? (status.startsWith('Choose') ? 'err' : 'wait') : 'ok';
    return `<article class="drow ${rowClass(row.id)}" id="row-${esc(row.id)}" data-id="${esc(row.id)}">
      <div class="rtop"><div class="rtitle"><span class="id">${esc(row.id)}</span>${esc(row.title)}</div><span class="zone ${row.d.zone}">Proposed: ${ZONE[row.d.zone]}</span></div>
      <p class="rdesc">${esc(row.d.includes)}</p>
      <div class="rmeta"><div><b>Why:</b> ${esc(row.d.why)}</div><div><b>What crosses between the two:</b> ${esc(row.d.cross)}</div></div>
      <div class="ract">
        <button class="ab yes ${st.verdict === 'agree' ? 'on' : ''}" data-v="agree" ${dis}>Agree</button>
        <button class="ab no ${st.verdict === 'not_agreed' ? 'on' : ''}" data-v="not_agreed" ${dis}>Not agree</button>
        <span class="rstatus ${scls}" id="st-${esc(row.id)}">${esc(status)}</span>
      </div>${altPanel}</article>`;
  }
  function render() {
    const groups = [];
    S.rows.forEach(r => { let g = groups[groups.length - 1]; if (!g || g.name !== r.section) groups.push(g = { name: r.section, rows: [] }); g.rows.push(r); });
    $('groups').innerHTML = groups.map(g => {
      const vis = g.rows.filter(visible); if (!vis.length) return '';
      const nl = g.rows.filter(r => r.d.zone === 'L').length, done = g.rows.filter(r => S.reviews[r.id]).length;
      const left = g.rows.filter(r => !S.reviews[r.id] && !S.drafts[r.id]).length;
      return `<section class="group"><div class="ghead"><h2>${esc(g.name)}</h2><div class="gmeta"><span>${g.rows.length} elements · <span class="zone L">${nl} local</span> <span class="zone C">${g.rows.length - nl} cloud</span> · ${done} answered</span>
        ${!S.locked && left ? `<button class="btn small bulk" data-bulk="${esc(g.name)}">Agree with the ${left} not yet answered</button>` : ''}</div></div>
        ${vis.map(rowHtml).join('')}</section>`;
    }).join('') || '<p class="muted">Nothing matches.</p>';
    progress();
  }
  function rerow(id) { const el = $('row-' + id); if (el) el.outerHTML = rowHtml(S.byId[id]); progress(); }
  function progress() {
    const n = S.rows.length, vals = Object.values(S.reviews);
    const a = vals.filter(v => v.verdict === 'agree').length, no = vals.length - a;
    $('progBar').innerHTML = `<i style="width:${a / n * 100}%;background:#2E7D4F"></i><i style="width:${no / n * 100}%;background:#B4412F"></i>`;
    $('progText').textContent = `${vals.length} of ${n} answered`;
    $('finishNote').textContent = vals.length < n ? `${n - vals.length} still to answer` : 'All answered';
    $('finishBtn').disabled = S.locked;
  }

  // ---------- saving ----------
  async function save(id) {
    clearTimeout(S.timers[id]);
    const d = S.drafts[id]; if (!d || S.locked) return true;
    const fb = (d.feedback || '').trim();
    if (d.verdict === 'not_agreed' && (!d.alt || !fb)) return false;
    const st = $('st-' + id); if (st) { st.textContent = 'Saving…'; st.className = 'rstatus wait'; }
    try {
      const res = await rpc('vista_data_save', { p_token: S.token, p_row: id, p_verdict: d.verdict, p_alt: d.verdict === 'agree' ? null : d.alt, p_feedback: fb });
      S.reviews[id] = { verdict: d.verdict, alt: d.verdict === 'agree' ? null : d.alt, feedback: fb, at: res.at };
      const now = S.drafts[id];
      if (now && now.verdict === d.verdict && now.alt === d.alt && (now.feedback || '').trim() === fb) delete S.drafts[id];
      saveDrafts();
      const ta = document.activeElement && document.activeElement.dataset && document.activeElement.dataset.fb === id;
      if (!ta) rerow(id); else { const s = $('st-' + id); if (s) { s.textContent = 'Saved ' + fmtTime(res.at); s.className = 'rstatus ok'; } const el = $('row-' + id); if (el) el.className = 'drow ' + rowClass(id); progress(); }
      return true;
    } catch (e) {
      if (/already submitted|closed/.test(e.message)) { S.locked = true; render(); }
      const s = $('st-' + id); if (s) { s.textContent = 'Not saved: ' + e.message; s.className = 'rstatus err'; }
      return false;
    }
  }
  $('groups').addEventListener('click', async e => {
    const b = e.target.closest('.ab'); if (b && !S.locked) {
      const id = b.closest('.drow').dataset.id, cur = state(id);
      S.drafts[id] = { verdict: b.dataset.v, alt: b.dataset.v === 'agree' ? null : cur.alt, feedback: b.dataset.v === 'agree' ? '' : cur.feedback || '' };
      saveDrafts(); rerow(id);
      if (b.dataset.v === 'agree') save(id);
      else { const ta = $('fb-' + id); if (ta && !cur.alt) { const r = document.querySelector(`#row-${CSS.escape(id)} input[type=radio]`); if (r) r.focus(); } else if (ta) ta.focus(); if (cur.alt && (cur.feedback || '').trim()) save(id); }
      return;
    }
    const bulk = e.target.closest('[data-bulk]'); if (bulk && !S.locked) {
      if (bulk.dataset.armed !== '1') { bulk.dataset.armed = '1'; bulk.textContent = 'Confirm: agree with all of them'; setTimeout(() => { if (bulk.isConnected) render(); }, 5000); return; }
      bulk.disabled = true; bulk.textContent = 'Saving…';
      const ids = S.rows.filter(r => r.section === bulk.dataset.bulk && !S.reviews[r.id] && !S.drafts[r.id]).map(r => r.id);
      for (const id of ids) { S.drafts[id] = { verdict: 'agree', alt: null, feedback: '' }; await save(id); }
      render();
    }
  });
  $('groups').addEventListener('change', e => {
    const r = e.target; if (r.type !== 'radio') return;
    const id = r.closest('.drow').dataset.id, cur = state(id);
    S.drafts[id] = { verdict: 'not_agreed', alt: r.value, feedback: cur.feedback || '' }; saveDrafts();
    const ta = $('fb-' + id);
    if ((cur.feedback || '').trim()) save(id); else if (ta) { ta.focus(); const s = $('st-' + id); if (s) { s.textContent = 'Say why, to save'; s.className = 'rstatus err'; } }
  });
  $('groups').addEventListener('input', e => {
    const ta = e.target; if (!ta.dataset || !ta.dataset.fb) return;
    const id = ta.dataset.fb, cur = state(id);
    S.drafts[id] = { verdict: 'not_agreed', alt: cur.alt, feedback: ta.value }; saveDrafts();
    const s = $('st-' + id);
    clearTimeout(S.timers[id]);
    if (!cur.alt) { if (s) { s.textContent = 'Choose where it should be, to save'; s.className = 'rstatus err'; } return; }
    if (s) { s.textContent = 'Typing…'; s.className = 'rstatus wait'; }
    S.timers[id] = setTimeout(() => save(id), 1500);
  });
  $('groups').addEventListener('focusout', e => { const ta = e.target; if (ta.dataset && ta.dataset.fb && S.drafts[ta.dataset.fb]) save(ta.dataset.fb); });

  $('filters').onclick = e => { const b = e.target.closest('button'); if (!b) return; S.filter = b.dataset.f; document.querySelectorAll('#filters button').forEach(x => x.classList.toggle('on', x === b)); render(); };
  let qt; $('search').oninput = e => { clearTimeout(qt); qt = setTimeout(() => { S.q = e.target.value.trim().toLowerCase(); render(); }, 200); };
  $('startBtn').onclick = () => openList();
  function openList() {
    show('screenList'); $('prog').classList.remove('hidden');
    $('lockedBanner').classList.toggle('hidden', !S.locked);
    if (S.locked) $('lockedBanner').textContent = S.data.reviewer.submitted_at ? `You submitted your review on ${fmtTime(S.data.reviewer.submitted_at)}. Answers are shown read-only.` : 'This review is closed. Answers are shown read-only.';
    render();
  }

  // ---------- finish ----------
  function tally() {
    const vals = Object.values(S.reviews), a = vals.filter(v => v.verdict === 'agree').length;
    return `<div style="--c:#2E7D4F"><b>${a}</b><span class="muted" style="font-size:13px">Agree</span></div><div style="--c:#B4412F"><b>${vals.length - a}</b><span class="muted" style="font-size:13px">Not agree</span></div><div style="--c:#B9B2A3"><b>${S.rows.length - vals.length}</b><span class="muted" style="font-size:13px">Not answered</span></div>`;
  }
  $('finishBtn').onclick = async () => {
    for (const id of Object.keys(S.drafts)) await save(id);
    $('finishTally').innerHTML = tally();
    const missing = S.rows.filter(r => !S.reviews[r.id]);
    $('finishMissing').innerHTML = missing.length ? `<div class="banner"><b>${missing.length} row${missing.length > 1 ? 's' : ''} still need${missing.length > 1 ? '' : 's'} an answer</b> before you can submit: ${missing.slice(0, 15).map(r => `<a href="#" data-goto="${esc(r.id)}">${esc(r.id)}</a>`).join(', ')}${missing.length > 15 ? '…' : ''}</div>` : '';
    const no = S.rows.filter(r => S.reviews[r.id] && S.reviews[r.id].verdict === 'not_agreed');
    $('finishFlagged').innerHTML = no.length ? `<p style="margin:14px 0 0"><b>Where you did not agree</b></p><ul class="list-plain">${no.map(r => `<li><a href="#" data-goto="${esc(r.id)}">${esc(r.id)} ${esc(r.title)}</a>: proposed ${ZONE[r.d.zone]}, you said <b>${esc(ALT[S.reviews[r.id].alt] || '')}</b></li>`).join('')}</ul>` : '';
    $('overallVerdicts').innerHTML = VERDICTS.map(v => `<button class="vbtn ${S.overall === v.id ? 'on' : ''}" data-v="${v.id}" style="--c:${v.color}">${esc(v.label)}</button>`).join('');
    $('submitBtn').disabled = missing.length > 0; $('submitBtn').textContent = 'Submit my review'; S.confirming = false; $('finishStatus').textContent = '';
    show('screenFinish');
  };
  $('overallVerdicts').onclick = e => { const b = e.target.closest('.vbtn'); if (!b) return; S.overall = b.dataset.v; document.querySelectorAll('#overallVerdicts .vbtn').forEach(x => x.classList.toggle('on', x === b)); };
  document.addEventListener('click', e => {
    const a = e.target.closest('[data-goto]'); if (!a) return; e.preventDefault();
    S.filter = 'all'; S.q = ''; $('search').value = ''; document.querySelectorAll('#filters button').forEach(x => x.classList.toggle('on', x.dataset.f === 'all'));
    openList(); const el = $('row-' + a.dataset.goto); if (el) el.scrollIntoView({ block: 'center' });
  });
  $('backBtn').onclick = () => openList();
  $('submitBtn').onclick = async () => {
    const st = $('finishStatus');
    if (!S.overall) { st.textContent = 'Choose your overall view.'; st.className = 'status err'; return; }
    const c = $('overallText').value.trim();
    if (S.overall !== 'agree' && !c) { st.textContent = 'Please add an overall comment for this view.'; st.className = 'status err'; $('overallText').focus(); return; }
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
    $('doneText').innerHTML = `Your review was submitted on ${esc(fmtTime(r.submitted_at))}${r.overall_verdict ? `, with the overall view <b>${esc(V[r.overall_verdict].label)}</b>` : ''}.`;
    $('doneTally').innerHTML = tally(); $('prog').classList.remove('hidden'); progress();
    show('screenDone');
  }
  $('browseBtn').onclick = () => openList();
  window.addEventListener('beforeunload', () => { for (const id of Object.keys(S.drafts)) save(id); });

  start();
})();
