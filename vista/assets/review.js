// Reviewer page: one personal link per Vista leader (#k=token). Views are saved per slide as they go.
(function () {
  const { VERDICTS, V, rpc, loadSlides, mountSlide, esc, store, fmtTime } = window.VistaReview;
  const $ = id => document.getElementById(id);
  const screens = ['screenLoading', 'screenError', 'screenWelcome', 'screenReview', 'screenFinish', 'screenDone'];
  const show = id => { screens.forEach(s => $(s).classList.toggle('hidden', s !== id)); window.scrollTo(0, 0); };

  const S = { token: null, data: null, slides: [], content: {}, reviews: {}, drafts: {}, idx: 0, locked: false, saving: null, timer: null };

  // ---------- token ----------
  function readToken() {
    const h = new URLSearchParams(location.hash.slice(1));
    let t = h.get('k');
    if (t) { store.set('vista.k', t); history.replaceState(null, '', location.pathname); }
    else t = store.get('vista.k');
    return t && /^[0-9a-f]{32,128}$/i.test(t) ? t : null;
  }
  const draftKey = () => 'vista.drafts.' + S.token.slice(0, 12);
  const saveDrafts = () => store.set(draftKey(), JSON.stringify(S.drafts));

  // ---------- start ----------
  async function start() {
    S.token = readToken();
    if (!S.token) return show('screenError');
    try {
      S.data = await rpc('vista_open', { p_token: S.token });
    } catch (e) {
      if (e.code === '28000' || /invalid link/.test(e.message)) { store.del('vista.k'); $('errText').textContent = 'This link is no longer valid. It may have been replaced by a newer one.'; }
      else $('errText').textContent = e.message;
      return show('screenError');
    }
    try {
      const content = await loadSlides(S.data.deck.file, S.data.deck.key);
      content.forEach(c => { S.content[c.id] = c; });
    } catch (e) { $('errText').textContent = 'The slides could not be opened: ' + e.message; return show('screenError'); }
    S.slides = S.data.slides;
    S.reviews = S.data.reviews || {};
    try { S.drafts = JSON.parse(store.get(draftKey()) || '{}'); } catch { S.drafts = {}; }
    // drop drafts that match what is already saved
    for (const [id, d] of Object.entries(S.drafts)) { const r = S.reviews[id]; if (r && r.verdict === d.verdict && (r.feedback || '') === (d.feedback || '')) delete S.drafts[id]; }
    S.locked = !!S.data.reviewer.submitted_at || !S.data.deck.is_open;
    const r = S.data.reviewer;
    $('who').textContent = r.name + (r.designation ? ' · ' + r.designation : '');
    const last = store.get('vista.slide.' + S.token.slice(0, 12));
    const lastIdx = S.slides.findIndex(s => s.id === last);
    const firstOpen = S.slides.findIndex(s => !S.reviews[s.id]);
    S.idx = lastIdx >= 0 ? lastIdx : Math.max(0, firstOpen);
    buildSide(); buildVerdicts();
    if (r.submitted_at) return showDone();
    $('welcomeTitle').textContent = 'Dear ' + r.name.split(' ')[0] + ',';
    $('legend').innerHTML = VERDICTS.map(v => `<div style="--c:${v.color}"><b style="font-size:15px;font-family:inherit">${esc(v.label)}</b><span class="muted" style="font-size:12px">${v.id === 'agree' ? 'No comment needed' : 'Please say why'}</span></div>`).join('');
    const done = Object.keys(S.reviews).length;
    $('startBtn').textContent = done ? `Continue (${done} of ${S.slides.length} done)` : 'Start the review';
    show('screenWelcome');
  }

  // ---------- side list ----------
  function buildSide() {
    let html = '', sec = null;
    S.slides.forEach((s, i) => {
      if (s.section !== sec) { sec = s.section; html += `<h4>${esc(sec)}</h4>`; }
      html += `<button class="item" data-i="${i}"><span class="n">${s.n}</span><span class="dot" id="dot-${esc(s.id)}"></span><span>${esc(s.title)}</span></button>`;
    });
    $('side').innerHTML = html;
    $('side').addEventListener('click', e => { const b = e.target.closest('.item'); if (b) { go(+b.dataset.i); $('side').classList.remove('open'); } });
    refreshDots();
  }
  function refreshDots() {
    S.slides.forEach(s => {
      const d = $('dot-' + s.id); if (!d) return;
      const r = S.reviews[s.id], dr = S.drafts[s.id];
      d.style.background = r ? V[r.verdict].color : 'transparent';
      d.style.borderColor = r ? V[r.verdict].color : dr && dr.verdict ? V[dr.verdict].color : '#B9B2A3';
      d.style.borderStyle = !r && dr && dr.verdict ? 'dashed' : 'solid';
      d.title = r ? V[r.verdict].label : dr && dr.verdict ? 'Not saved yet: feedback needed' : 'Not reviewed yet';
    });
    document.querySelectorAll('#side .item').forEach((b, i) => b.classList.toggle('on', i === S.idx));
    const n = S.slides.length, counts = Object.fromEntries(VERDICTS.map(v => [v.id, 0]));
    Object.values(S.reviews).forEach(r => counts[r.verdict]++);
    const done = Object.keys(S.reviews).length;
    $('progBar').innerHTML = VERDICTS.map(v => `<i style="width:${counts[v.id] / n * 100}%;background:${v.color}"></i>`).join('');
    $('progText').textContent = `${done} of ${n} reviewed`;
  }

  // ---------- verdict buttons ----------
  function buildVerdicts() {
    $('verdicts').innerHTML = VERDICTS.map(v => `<button class="vbtn" role="radio" aria-checked="false" data-v="${v.id}" style="--c:${v.color}">${esc(v.label)}<small>${v.id === 'agree' ? 'Saved straight away' : 'Please add feedback'}</small><span class="k">Key ${v.key}</span></button>`).join('');
    $('verdicts').addEventListener('click', e => { const b = e.target.closest('.vbtn'); if (b && !S.locked) pick(b.dataset.v); });
    $('overallVerdicts').innerHTML = VERDICTS.map(v => `<button class="vbtn" role="radio" aria-checked="false" data-v="${v.id}" style="--c:${v.color}">${esc(v.label)}</button>`).join('');
    $('overallVerdicts').addEventListener('click', e => { const b = e.target.closest('.vbtn'); if (!b) return; S.overall = b.dataset.v; paintOverall(); });
  }
  const current = () => S.slides[S.idx];
  function state(id) { return S.drafts[id] || S.reviews[id] || { verdict: null, feedback: '' }; }

  function paint() {
    const s = current(), c = S.content[s.id] || {}, st = state(s.id);
    $('crumb').textContent = s.section;
    $('slideTitle').textContent = `${s.n}. ${s.title}`;
    mountSlide($('slideBox'), c.html || '<section style="padding:80px;font:32px sans-serif">Slide not found</section>');
    $('notes').textContent = c.notes || '';
    $('notesBox').classList.toggle('hidden', !c.notes);
    $('notesBox').open = false;
    $('count').textContent = `Slide ${s.n} of ${S.slides.length}`;
    $('prevBtn').disabled = S.idx === 0;
    $('nextBtn').disabled = S.idx === S.slides.length - 1;
    document.querySelectorAll('#verdicts .vbtn').forEach(b => { const on = b.dataset.v === st.verdict; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); b.disabled = S.locked; });
    $('fbText').value = st.feedback || '';
    $('fbText').disabled = S.locked;
    paintFb();
    const saved = S.reviews[s.id], draft = S.drafts[s.id];
    if (S.locked) setStatus(saved ? `Your view: ${V[saved.verdict].label}` : 'Not reviewed', 'wait');
    else if (draft && draft.verdict && !(draft.feedback || '').trim() && draft.verdict !== 'agree') setStatus('Add your feedback to save this view.', 'err');
    else if (draft) setStatus('Not saved yet.', 'wait');
    else if (saved) setStatus('Saved ' + fmtTime(saved.at), 'ok');
    else setStatus('', '');
    $('saveNextBtn').textContent = S.idx === S.slides.length - 1 ? 'Save and finish →' : 'Save and next →';
    $('saveNextBtn').disabled = S.locked; $('finishBtn').disabled = S.locked;
    $('lockedBanner').classList.toggle('hidden', !S.locked);
    if (S.locked) $('lockedBanner').textContent = S.data.reviewer.submitted_at ? `You submitted your review on ${fmtTime(S.data.reviewer.submitted_at)}. Answers are shown read-only.` : 'This review is closed. Answers are shown read-only.';
    store.set('vista.slide.' + S.token.slice(0, 12), s.id);
    refreshDots();
  }
  function paintFb() {
    const st = state(current().id), need = st.verdict && st.verdict !== 'agree';
    $('fbLabel').textContent = need ? 'Your feedback (needed for this view)' : 'Your feedback (optional when you completely agree)';
    $('fbCount').textContent = `${($('fbText').value || '').length} / 4000`;
    $('fbHint').textContent = need ? (st.verdict === 'discuss' ? 'What should be discussed, and with whom?' : st.verdict === 'not_agreed' ? 'What is wrong, and what would you want instead?' : 'What would you change or add?') : '';
  }
  function setStatus(t, cls) { const el = $('status'); el.textContent = t; el.className = 'status ' + (cls || ''); }

  function pick(v) {
    const id = current().id, st = state(id);
    S.drafts[id] = { verdict: v, feedback: $('fbText').value };
    saveDrafts(); paint();
    if (v === 'agree' || (st.feedback || $('fbText').value).trim()) save(id);
    else $('fbText').focus();
  }
  $('fbText').addEventListener('input', () => {
    const id = current().id, st = state(id);
    S.drafts[id] = { verdict: st.verdict, feedback: $('fbText').value };
    saveDrafts(); paintFb();
    clearTimeout(S.timer);
    if (st.verdict) { setStatus('Typing…', 'wait'); S.timer = setTimeout(() => save(id), 1500); }
    else setStatus('Choose one of the four views above to save.', 'wait');
  });

  async function save(id) {
    clearTimeout(S.timer);
    const d = S.drafts[id];
    if (!d || !d.verdict || S.locked) return !!S.reviews[id] && !d;
    const fb = (d.feedback || '').trim();
    if (d.verdict !== 'agree' && !fb) { if (id === current().id) setStatus('Add your feedback to save this view.', 'err'); return false; }
    if (id === current().id) setStatus('Saving…', 'wait');
    try {
      const res = await rpc('vista_save', { p_token: S.token, p_slide: id, p_verdict: d.verdict, p_feedback: fb });
      S.reviews[id] = { verdict: d.verdict, feedback: fb, at: res.at };
      const now = S.drafts[id];
      if (now && now.verdict === d.verdict && (now.feedback || '').trim() === fb) delete S.drafts[id];
      saveDrafts();
      if (id === current().id) setStatus('Saved ' + fmtTime(res.at), 'ok');
      refreshDots();
      return true;
    } catch (e) {
      if (/already submitted|closed/.test(e.message)) { S.locked = true; paint(); }
      if (id === current().id) setStatus('Not saved: ' + e.message, 'err');
      return false;
    }
  }

  async function go(i) {
    if (i < 0 || i >= S.slides.length) return;
    const id = current().id;
    if (S.drafts[id] && !S.locked) await save(id);
    S.idx = i; paint(); window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  $('prevBtn').onclick = () => go(S.idx - 1);
  $('nextBtn').onclick = () => go(S.idx + 1);
  $('saveNextBtn').onclick = async () => {
    const id = current().id, st = state(id);
    if (!st.verdict) { setStatus('Choose one of the four views first.', 'err'); return; }
    const ok = S.drafts[id] ? await save(id) : true;
    if (!ok) return;
    if (S.idx === S.slides.length - 1) openFinish(); else go(S.idx + 1);
  };
  $('finishBtn').onclick = async () => { const id = current().id; if (S.drafts[id]) await save(id); openFinish(); };
  $('startBtn').onclick = () => { show('screenReview'); $('prog').classList.remove('hidden'); $('menuBtn').classList.remove('hidden'); paint(); };
  $('menuBtn').onclick = () => $('side').classList.toggle('open');
  document.addEventListener('keydown', e => {
    if ($('screenReview').classList.contains('hidden') || e.target.matches('textarea,input') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'ArrowRight') go(S.idx + 1);
    else if (e.key === 'ArrowLeft') go(S.idx - 1);
    else { const v = VERDICTS.find(x => x.key === e.key); if (v && !S.locked) pick(v.id); }
  });
  window.addEventListener('beforeunload', e => { const id = S.slides[S.idx] && current().id; if (id && S.drafts[id] && !S.locked) { save(id); } });

  // ---------- finish ----------
  function tallyHtml() {
    const counts = Object.fromEntries(VERDICTS.map(v => [v.id, 0]));
    Object.values(S.reviews).forEach(r => counts[r.verdict]++);
    return VERDICTS.map(v => `<div style="--c:${v.color}"><b>${counts[v.id]}</b><span class="muted" style="font-size:13px">${esc(v.label)}</span></div>`).join('');
  }
  function openFinish() {
    $('finishTally').innerHTML = tallyHtml();
    const missing = S.slides.filter(s => !S.reviews[s.id]);
    $('finishMissing').innerHTML = missing.length
      ? `<div class="banner"><b>${missing.length} slide${missing.length > 1 ? 's' : ''} still need${missing.length > 1 ? '' : 's'} your view</b> before you can submit: ${missing.slice(0, 12).map(s => `<a href="#" data-goto="${esc(s.id)}">${s.n}</a>`).join(', ')}${missing.length > 12 ? '…' : ''}</div>`
      : '';
    const flagged = S.slides.filter(s => S.reviews[s.id] && ['discuss', 'not_agreed'].includes(S.reviews[s.id].verdict));
    $('finishFlagged').innerHTML = flagged.length ? `<p style="margin:14px 0 0"><b>Slides you want to discuss or did not agree with</b></p><ul class="list-plain">${flagged.map(s => `<li><span class="pill" style="--c:${V[S.reviews[s.id].verdict].color}">${esc(V[S.reviews[s.id].verdict].short)}</span> <a href="#" data-goto="${esc(s.id)}">${s.n}. ${esc(s.title)}</a></li>`).join('')}</ul>` : '';
    $('submitBtn').disabled = missing.length > 0;
    $('submitBtn').textContent = 'Submit my review';
    S.confirming = false;
    $('finishStatus').textContent = '';
    paintOverall();
    show('screenFinish');
  }
  function paintOverall() { document.querySelectorAll('#overallVerdicts .vbtn').forEach(b => b.classList.toggle('on', b.dataset.v === S.overall)); }
  document.addEventListener('click', e => {
    const a = e.target.closest('[data-goto]'); if (!a) return;
    e.preventDefault(); S.idx = S.slides.findIndex(s => s.id === a.dataset.goto);
    show('screenReview'); paint();
  });
  $('backBtn').onclick = () => { show('screenReview'); paint(); };
  $('submitBtn').onclick = async () => {
    const st = $('finishStatus');
    if (!S.overall) { st.textContent = 'Choose your overall view of the blueprint.'; st.className = 'status err'; return; }
    const c = $('overallText').value.trim();
    if (S.overall !== 'agree' && !c) { st.textContent = 'Please add an overall comment for this view.'; st.className = 'status err'; $('overallText').focus(); return; }
    if (!S.confirming) { S.confirming = true; $('submitBtn').textContent = 'Confirm: submit now'; st.textContent = 'After submitting, your answers are locked. Press again to confirm.'; st.className = 'status wait'; return; }
    $('submitBtn').disabled = true; st.textContent = 'Submitting…'; st.className = 'status wait';
    try {
      await rpc('vista_submit', { p_token: S.token, p_overall_verdict: S.overall, p_overall_comment: c });
      S.data.reviewer.submitted_at = new Date().toISOString(); S.data.reviewer.overall_verdict = S.overall; S.locked = true;
      store.del(draftKey()); S.drafts = {};
      showDone();
    } catch (e) { st.textContent = 'Not submitted: ' + e.message; st.className = 'status err'; $('submitBtn').disabled = false; }
  };
  function showDone() {
    const r = S.data.reviewer;
    $('doneText').innerHTML = `Your review was submitted on ${esc(fmtTime(r.submitted_at))}${r.overall_verdict ? `, with the overall view <b>${esc(V[r.overall_verdict].label)}</b>` : ''}.`;
    $('doneTally').innerHTML = tallyHtml();
    $('prog').classList.remove('hidden');
    show('screenDone');
  }
  $('browseBtn').onclick = () => { show('screenReview'); $('menuBtn').classList.remove('hidden'); paint(); };

  start();
})();
