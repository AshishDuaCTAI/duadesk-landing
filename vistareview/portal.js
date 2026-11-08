// Review portal: log in with email + PIN, then see and open every review assigned to you.
(function () {
  const { rpc, esc, store, fmtTime } = window.VistaReview;
  const $ = id => document.getElementById(id);
  const SK = 'vistareview.s';
  const KIND = {
    'vista-blueprint': { path: '/vista/', key: 'vista.k', label: 'Blueprint', color: '#13233A', what: '60 slides of the platform blueprint. A view and feedback on each slide.', mins: 45 },
    'vista-data': { path: '/vistadata/', key: 'vistadata.k', label: 'Data location', color: '#C98A1E', what: 'Every data element and whether it stays on Vista’s server or the cloud. Agree or not agree on each.', mins: 30 },
    'vista-proc-d': { path: '/vistabidding/', key: 'vistabidding.k', label: 'Process · D', color: '#1F5F99', what: 'Sales and bidding: steps, reports, mobile screens, AI autonomy and formats.', mins: 40 },
    'vista-proc-a': { path: '/vistaprojects/', key: 'vistaprojects.k', label: 'Process · A', color: '#1F5F99', what: 'Projects: everything after the win, to warranty and close-out.', mins: 60 },
    'vista-proc-b': { path: '/vistaprocurement/', key: 'vistaprocurement.k', label: 'Process · B', color: '#1F5F99', what: 'Procurement: items, RFQs, POs, delivery, invoices, stores.', mins: 40 },
    'vista-proc-c': { path: '/vistahr/', key: 'vistahr.k', label: 'Process · C', color: '#1F5F99', what: 'HR: people processes, attendance, timesheets, KRAs, compliance.', mins: 40 },
    'vista-proc-e': { path: '/vistafinance/', key: 'vistafinance.k', label: 'Process · E', color: '#1F5F99', what: 'Finance and accounts: GST, TDS, project control, direct costing, billing, payments, treasury, close, MIS and audit.', mins: 60 },
    'vista-aisod': { path: '/vistaai/', key: 'vistaai.k', label: 'Data, assistant, duties', color: '#9B2C2C', what: 'Outside data the platform reads, the Vista assistant, the AI agents, and segregation of duties. Answer for your own area.', mins: 25 },
    'vista-pillars': { path: '/vistapillars/', key: 'vistapillars.k', label: 'Four pillars', color: '#6B2FA3', what: 'What drives each process: cost, profitability, controls, delivery quality.', mins: 20 },
    'vista-video': { path: '/vistavideo/', key: 'vistavideo.k', label: 'Film', color: '#2E7D4F', what: 'The 13-minute Board film of the platform.', mins: 13 },
  };
  const ORDER = ['vista-video', 'vista-blueprint', 'vista-data', 'vista-pillars', 'vista-proc-d', 'vista-proc-a', 'vista-proc-b', 'vista-proc-c', 'vista-proc-e', 'vista-aisod'];
  const show = id => ['loading', 'login', 'portal'].forEach(x => $(x).classList.toggle('hidden', x !== id));

  async function load() {
    const s = store.get(SK);
    if (!s) { show('login'); $('email').focus(); return; }
    let d;
    try { d = await rpc('vista_portal', { p_session: s }); }
    catch (e) {
      if (e.code === '28000' || /signed out/.test(e.message)) { store.del(SK); show('login'); return; }
      $('cards').innerHTML = `<div class="banner">${esc(e.message)}</div>`; show('portal'); return;
    }
    $('who').textContent = d.person.name + (d.person.designation ? ' · ' + d.person.designation : '');
    $('outBtn').classList.remove('hidden');
    $('hello').textContent = 'Namaste, ' + d.person.name.split(' ')[0];
    const reviews = d.reviews.slice().sort((a, b) => ORDER.indexOf(a.deck) - ORDER.indexOf(b.deck));
    const open = reviews.filter(r => !r.submitted_at && r.deck !== 'vista-video').length;
    $('sub').textContent = reviews.length ? `${reviews.length} item${reviews.length > 1 ? 's' : ''} for you${open ? ` · ${open} still to complete` : ' · all submitted, thank you'}.` : 'Nothing is assigned to you yet.';
    $('cards').innerHTML = reviews.map(r => {
      const k = KIND[r.deck] || { path: '/', label: 'Review', color: '#13233A', what: '' };
      const pct = r.total ? Math.round(r.done / r.total * 100) : 0, video = r.deck === 'vista-video';
      // hand the page its own access key; it is valid only while this login is
      store.set(k.key, r.token);
      const VC = { agree: '#2E7D4F', agree_feedback: '#1F5F99', discuss: '#D69A2D', not_agreed: '#A3342A' }, VN = { agree: 'Agree', agree_feedback: 'Agree with changes', discuss: 'Need to discuss', not_agreed: 'Not agreed' };
      const team = (r.team || []), mix = r.mix || {}, mixTot = Object.values(mix).reduce((a, b) => a + b, 0), exp = r.total * Math.max(team.length, 1);
      const teamHtml = video || !team.length ? '' : `<details class="team"><summary>Team progress · ${team.filter(t => t.submitted).length} of ${team.length} submitted</summary>
        <div class="tbar">${Object.keys(VC).filter(k => mix[k]).map(k => `<i style="flex:${mix[k]};background:${VC[k]}" title="${VN[k]}: ${mix[k]}"></i>`).join('')}${exp - mixTot > 0 ? `<i style="flex:${exp - mixTot};background:#E2DDD1" title="Not answered yet: ${exp - mixTot}"></i>` : ''}</div>
        <div class="tleg">${Object.keys(VC).map(k => `<span><i style="background:${VC[k]}"></i>${VN[k]} ${mix[k] || 0}</span>`).join('')}</div>
        ${team.map(t => `<div class="trow${t.me ? ' me' : ''}"><span>${esc(t.name)}${t.me ? ' (you)' : ''}</span><span class="tb"><i style="width:${r.total ? Math.round(t.done / r.total * 100) : 0}%"></i></span><span>${t.submitted ? '✓ Submitted' : Math.round(t.done / (r.total || 1) * 100) + '%'}</span></div>`).join('')}</details>`;
      const pend = (r.pending || []), pendHtml = video || r.submitted_at ? '' : pend.length ? `<details class="team"><summary>Your pending: ${pend.length} item${pend.length > 1 ? 's' : ''}</summary><ul class="plist">${pend.slice(0, 12).map(x => `<li><b>${esc(x.id)}</b> ${esc(x.title)}</li>`).join('')}${pend.length > 12 ? `<li class="muted">and ${pend.length - 12} more</li>` : ''}</ul></details>` : '<p class="ok">All answered. Open it and press <b>Finish and submit</b>.</p>';
      return `<div class="rc" style="--c:${k.color}">
        <span class="k">${esc(k.label)}</span><h3>${esc(r.title)}</h3><p>${esc(k.what)}</p>
        ${video ? '' : `<div class="bar2"><i style="width:${pct}%"></i></div>`}
        <div class="foot"><span>${video ? `About ${k.mins} minutes` : r.submitted_at ? `<span class="done">Submitted ${esc(fmtTime(r.submitted_at))}</span>` : `${r.done} of ${r.total} answered · about ${k.mins} min`}</span><a class="go" href="${k.path}">${video ? 'Watch →' : r.submitted_at ? 'View →' : r.done ? 'Continue →' : 'Start →'}</a></div>
        ${pendHtml}${teamHtml}</div>`;
    }).join('');
    show('portal');
  }

  $('login').onsubmit = async e => {
    e.preventDefault();
    const st = $('loginStatus'), pin = $('pin').value.trim();
    if (!/^\d{6}$/.test(pin)) { st.textContent = 'The PIN has 6 digits.'; st.className = 'status err'; $('pin').focus(); return; }
    st.textContent = 'Checking…'; st.className = 'status wait'; $('loginBtn').disabled = true;
    try {
      const r = await rpc('vista_login', { p_email: $('email').value.trim(), p_pin: pin });
      if (!r || r.ok === false) throw new Error((r && r.error) || 'Email or PIN is not right.');
      store.set(SK, r.session); $('pin').value = ''; st.textContent = '';
      show('loading'); await load();
    } catch (err) { st.textContent = err.message; st.className = 'status err'; $('pin').select(); }
    $('loginBtn').disabled = false;
  };
  $('pin').addEventListener('input', e => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6); if (e.target.value.length === 6 && $('email').value.includes('@')) $('login').requestSubmit(); });
  $('outBtn').onclick = async () => {
    const s = store.get(SK);
    try { if (s) await rpc('vista_logout', { p_session: s }); } catch { }
    Object.values(KIND).forEach(k => store.del(k.key)); store.del(SK);
    location.reload();
  };
  load();
})();
