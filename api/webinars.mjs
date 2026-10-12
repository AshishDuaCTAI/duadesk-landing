/* Generated file: DuaDesk webinars (webinars). Edit src/ and rebuild. */
/* ---- shared helpers (inlined into each function at build time) ---- */
import crypto from 'node:crypto';

const ENV = () => ({
  SB_URL: (process.env.SUPABASE_URL || '').replace(/\/$/, ''),
  SB_KEY: process.env.SUPABASE_SERVICE_KEY || '',
  RESEND_KEY: process.env.RESEND_API_KEY || '',
  FROM: process.env.WEBINAR_FROM || 'DuaDesk Webinars <webinar@ashishduacorporation.com>',
  REPLY_TO: process.env.WEBINAR_REPLY_TO || 'ashish@ashishduacorporation.com',
  OWNER: process.env.WEBINAR_OWNER_EMAIL || 'ashish@ashishduacorporation.com',
  SITE: (process.env.SITE_URL || 'https://duadesk.com').replace(/\/$/, ''),
  SECRET: process.env.UNSUBSCRIBE_SECRET || process.env.SUPABASE_SERVICE_KEY || 'change-me',
  ADMIN: process.env.WEBINAR_ADMIN_PASSWORD || '',
  AI_KEY: process.env.WEBINAR_ANTHROPIC_KEY || process.env.ANTHROPIC_API_KEY || '', // own key name, so the homepage concierge (api/ask.js) is not switched on by it
  AI_MODEL: process.env.WEBINAR_AI_MODEL || 'claude-sonnet-5-5',
});

async function sb(path, { method = 'GET', body, prefer, count } = {}) {
  const { SB_URL, SB_KEY } = ENV();
  if (!SB_URL || !SB_KEY) throw new Error('Database is not configured (SUPABASE_URL / SUPABASE_SERVICE_KEY).');
  const headers = { apikey: SB_KEY, 'Content-Type': 'application/json' };
  if (!SB_KEY.startsWith('sb_')) headers.Authorization = 'Bearer ' + SB_KEY; // legacy service_role JWT; new sb_secret_ keys go in apikey only
  const pf = [prefer, count ? 'count=exact' : null].filter(Boolean).join(',');
  if (pf) headers.Prefer = pf;
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let data = null; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) { const e = new Error((data && data.message) || `Database error ${res.status}`); e.status = res.status; e.code = data && data.code; throw e; }
  const cr = res.headers.get('content-range');
  return count ? { data, total: cr ? +cr.split('/')[1] : null } : data;
}

async function storage(path, body, method = 'POST') {
  const { SB_URL, SB_KEY } = ENV();
  const headers = { apikey: SB_KEY, 'Content-Type': 'application/json' };
  if (!SB_KEY.startsWith('sb_')) headers.Authorization = 'Bearer ' + SB_KEY;
  const res = await fetch(`${SB_URL}/storage/v1/${path}`, { method, headers, body: JSON.stringify(body || {}) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || data.error || `Storage error ${res.status}`);
  return data;
}
async function signedUpload(objectPath, bucket = 'recordings') {
  const d = await storage(`object/upload/sign/${bucket}/${objectPath}`, {});
  return ENV().SB_URL + '/storage/v1' + (d.url.startsWith('/') ? d.url : '/' + d.url);
}
async function storageRemove(bucket, paths) { if (paths.length) await storage(`object/${bucket}`, { prefixes: paths }, 'DELETE'); }

/* ---------- files for each webinar: the presentation and the poster (public bucket, unguessable paths) ---------- */
const FILES_BUCKET = 'webinar-files';
const encPath = p => String(p).split('/').map(encodeURIComponent).join('/');
const fileUrl = (f, download) => f && f.path ? `${ENV().SB_URL}/storage/v1/object/public/${FILES_BUCKET}/${encPath(f.path)}${download ? '?download=' + encodeURIComponent(f.name || '') : ''}` : null;
// a poster is current while everything printed on it is unchanged: date, title, subtitle, description, agenda, speakers, demo
const posterKey = w => `${w.starts_at ? new Date(w.starts_at).toISOString() : ''}|${w.title || ''}|` + crypto.createHash('sha1').update(JSON.stringify([w.subtitle || '', w.summary || '', (w.agenda || []).map(a => [a.min, a.item]), (w.products || []).map(p => p.name), w.cohost_confirmed ? w.cohost_name || '' : '', w.facilitator_confirmed ? w.facilitator_name || '' : '', w.format || '', +w.duration_min || 45])).digest('hex').slice(0, 12);
// what may be shown or sent: a poster only while it still matches the date and title; the slides only as the share setting allows
function webinarFiles(w, when) {
  const f = w.files || {}, cur = k => f[k] && f[k].path && f[k].for === posterKey(w);
  const share = w.deck_share || 'after';
  const deckOk = f.deck && f.deck.path && (share === 'before' || (share === 'after' && when === 'after'));
  return { poster_png: cur('poster_png') ? fileUrl(f.poster_png, true) : null, poster_pdf: cur('poster_pdf') ? fileUrl(f.poster_pdf, true) : null, deck: deckOk ? fileUrl(f.deck, true) : null, deck_name: deckOk ? f.deck.name : null };
}
async function signedRead(objectPath, seconds = 6 * 3600) {
  const d = await storage(`object/sign/recordings/${objectPath}`, { expiresIn: seconds });
  const u = d.signedURL || d.signedUrl;
  return ENV().SB_URL + '/storage/v1' + (u.startsWith('/') ? u : '/' + u);
}

async function resend(path, payload, idem) {
  const { RESEND_KEY } = ENV();
  if (!RESEND_KEY) throw new Error('Email is not configured (RESEND_API_KEY).');
  const headers = { Authorization: 'Bearer ' + RESEND_KEY, 'Content-Type': 'application/json' };
  if (idem) headers['Idempotency-Key'] = idem.slice(0, 256);
  const res = await fetch('https://api.resend.com' + path, { method: 'POST', headers, body: JSON.stringify(payload) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.message || `Email error ${res.status}`); e.status = res.status; throw e; }
  return data;
}

/* ---------- small utilities ---------- */
const normEmail = e => String(e || '').trim().toLowerCase();
const validEmail = e => /^[^\s@<>()[\],;:"]+@[^\s@<>()[\],;:"]+\.[a-z]{2,}$/i.test(e) && e.length <= 254;
function normPhone(p) {
  let d = String(p || '').replace(/[^\d+]/g, '');
  if (!d) return null;
  if (d.startsWith('+')) d = d.slice(1); else if (d.startsWith('00')) d = d.slice(2);
  else { d = d.replace(/^0+/, ''); if (d.length === 10) d = '91' + d; }
  return /^\d{10,15}$/.test(d) ? d : null;
}
const clean = (s, n = 300) => String(s ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const tok = (kind, id) => crypto.createHmac('sha256', ENV().SECRET).update(kind + ':' + id).digest('hex').slice(0, 32);
const safeEq = (a, b) => { const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || '')); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const checkTok = (kind, id, t) => !!id && safeEq(tok(kind, id), t);
const first = n => clean(n, 60).split(/\s+/)[0] || '';

async function getSettings() {
  try { const rows = await sb('settings?select=key,value'); return Object.fromEntries(rows.map(r => [r.key, r.value || ''])); } catch { return {}; }
}

/* ---------- people ---------- */
async function isSuppressed(email, phone) {
  const hs = [email && sha(normEmail(email)), phone && sha(phone)].filter(Boolean);
  if (!hs.length) return [];
  return sb(`suppression?select=hash,channel&hash=in.(${hs.join(',')})`);
}
async function suppress(email, phone, reason) {
  const rows = [];
  if (email) rows.push({ hash: sha(normEmail(email)), channel: 'email', reason });
  if (phone) rows.push({ hash: sha(phone), channel: 'whatsapp', reason });
  const now = new Date().toISOString(); rows.forEach(r => { r.created_at = now; }); // the latest opt-out date counts
  if (rows.length) await sb('suppression?on_conflict=hash', { method: 'POST', body: rows, prefer: 'resolution=merge-duplicates,return=minimal' });
}
// find by email, then phone; create if new; fill blanks; never re-subscribe someone who opted out
async function upsertPerson(p) {
  const email = p.email ? normEmail(p.email) : null, phone = p.phone ? normPhone(p.phone) : null;
  let row = null;
  if (email) [row] = await sb(`people?select=*&email=eq.${encodeURIComponent(email)}`);
  if (!row && phone) { const [byPhone] = await sb(`people?select=*&phone=eq.${phone}`); if (byPhone && (!email || !byPhone.email)) row = byPhone; }
  const fill = {};
  for (const k of ['name', 'company', 'role', 'city']) if (p[k] && (!row || !row[k])) fill[k] = clean(p[k], 160);
  if (row) {
    if (email && !row.email) fill.email = email;
    if (phone && !row.phone) { const [other] = await sb(`people?select=id&phone=eq.${phone}`); if (!other) fill.phone = phone; }
    if (p.tags && p.tags.length) fill.tags = [...new Set([...(row.tags || []), ...p.tags])];
    if (Object.keys(fill).length) { fill.updated_at = new Date().toISOString(); [row] = await sb(`people?id=eq.${row.id}`, { method: 'PATCH', body: fill, prefer: 'return=representation' }); }
    return row;
  }
  let ph = phone; if (ph) { const [taken] = await sb(`people?select=id&phone=eq.${ph}`); if (taken) ph = null; }
  const sup = await isSuppressed(email, ph);
  const body = { email, phone: ph, source: clean(p.source || 'website', 60), tags: p.tags || [], known_personally: !!p.known, ...fill };
  if (p.status) body.email_status = p.status; // e.g. 'no_invites' for people from public forms who did not ask for invitations
  if (sup.some(s => s.channel === 'email')) body.email_status = 'unsubscribed';
  if (sup.some(s => s.channel === 'whatsapp')) body.wa_stopped = true;
  try { [row] = await sb('people', { method: 'POST', body, prefer: 'return=representation' }); }
  catch (e) { if (e.code === '23505' && !p._retry) return upsertPerson({ ...p, _retry: true }); throw e; }
  return row;
}

// switch on invitations for someone who asked for them, but never for someone who opted out or bounced
async function optIn(person) {
  if (!person || !person.email || ['unsubscribed', 'bounced', 'complained'].includes(person.email_status)) return false;
  if ((await isSuppressed(person.email, null)).some(s => s.channel === 'email')) return false;
  if (person.email_status !== 'subscribed') await sb(`people?id=eq.${person.id}`, { method: 'PATCH', body: { email_status: 'subscribed', updated_at: new Date().toISOString() }, prefer: 'return=minimal' });
  return true;
}

/* ---------- links ---------- */
const site = () => ENV().SITE;
const webinarUrl = w => `${ENV().SITE}/webinars.html#${w.slug}`;
const actUrl = (pid, slug, a) => `${ENV().SITE}/webinar-respond.html?a=${a}&p=${pid}${slug ? '&w=' + encodeURIComponent(slug) : ''}&t=${tok('p', pid)}`;
const unsubUrl = pid => `${ENV().SITE}/api/webinars?action=unsubscribe&p=${pid}&t=${tok('p', pid)}`;
const watchUrl = (slug, pid) => `${ENV().SITE}/webinar-watch.html?w=${encodeURIComponent(slug)}${pid ? `&p=${pid}&t=${tok('p', pid)}` : ''}`;
const feedbackUrl = rid => `${ENV().SITE}/webinar-respond.html?a=feedback&r=${rid}&t=${tok('r', rid)}`;
const certUrl = rid => `${ENV().SITE}/webinar-certificate.html?r=${rid}&t=${tok('c', rid)}`;
const waLink = (num, text) => `https://wa.me/${String(num || '').replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;

function whenIST(iso, w) {
  if (!iso) return 'Date to be announced';
  const d = new Date(iso);
  const day = d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const t = d.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true }).toUpperCase();
  let s = `${day}, ${t} IST`;
  if (w && /uae/i.test(w.slug || '')) s += ` (${d.toLocaleTimeString('en-GB', { timeZone: 'Asia/Dubai', hour: 'numeric', minute: '2-digit', hour12: true }).toUpperCase()} UAE)`;
  return s;
}
function ics(w, withLink) {
  if (!w.starts_at) return null;
  const s = new Date(w.starts_at), e = new Date(s.getTime() + ((w.duration_min || 45) + 15) * 60000); // 45-minute session + 15 minutes for questions (e.g. 12:30–1:30)
  const f = d => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const fold = l => l.match(/.{1,70}/g).join('\r\n ');
  const txt = s => String(s).replace(/\\/g, '\\\\').replace(/[,;]/g, m => '\\' + m).replace(/\n/g, '\\n');
  const loc = withLink && w.teams_link ? w.teams_link : 'Microsoft Teams (link in your email)';
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//DuaDesk//Webinars//EN', 'METHOD:PUBLISH', 'BEGIN:VEVENT',
    `UID:${w.slug}@duadesk.com`, `SEQUENCE:${Math.max(0, Math.floor((Date.now() - Date.UTC(2026, 0, 1)) / 60000))}`, `DTSTAMP:${f(new Date())}`, `DTSTART:${f(s)}`, `DTEND:${f(e)}`,
    fold(`SUMMARY:${txt('DuaDesk Webinar: ' + w.title)}`), fold(`LOCATION:${txt(loc)}`),
    fold(`DESCRIPTION:${txt((w.subtitle || '') + '\n' + (withLink && w.teams_link ? 'Join: ' + w.teams_link : 'The joining link will be emailed to you.') + '\n' + webinarUrl(w))}`),
    'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
}

/* ---------- email building blocks ---------- */
function shell(inner, pid, why) {
  return `<!doctype html><html><body style="margin:0;background:#eef1f6;font-family:Arial,Helvetica,sans-serif;color:#1e2533">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f6;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden">
<tr><td style="background:#0b1424;padding:22px 28px"><span style="color:#d6ae55;font-weight:bold;letter-spacing:3px;font-size:12px">DUADESK WEBINARS</span></td></tr>
<tr><td style="padding:28px;font-size:15px;line-height:1.6">${inner}</td></tr>
<tr><td style="padding:18px 28px;background:#f6f7fa;font-size:12px;color:#5a6478;line-height:1.7">
CA Ashish Dua · DuaDesk · <a href="https://duadesk.com" style="color:#5a6478">duadesk.com</a> · +91 98995 73717 · <a href="${ENV().SITE}/webinar-privacy.html" style="color:#5a6478">Privacy</a><br>
Questions? Reply to this email or write to <a href="mailto:ashish@ashishduacorporation.com" style="color:#5a6478">ashish@ashishduacorporation.com</a>.<br>
${pid ? `${why || 'You received this because we have been in touch before.'}<br><b><a href="${actUrl(pid, null, 'prefs')}" style="color:#5a6478">Choose which invitations you get</a> · <a href="${unsubUrl(pid)}" style="color:#5a6478">Unsubscribe from all webinar emails</a></b>` : ''}
</td></tr></table></td></tr></table></body></html>`;
}
const btn = (href, label, alt) => `<a href="${esc(href)}" style="display:inline-block;background:${alt ? '#ffffff' : '#d6ae55'};color:#0b1424;text-decoration:none;font-weight:bold;padding:12px 20px;border-radius:8px;border:1px solid #d6ae55;margin:0 6px 8px 0">${esc(label)}</a>`;
const agendaHtml = w => (w.agenda || []).map(a => `<tr><td style="padding:4px 10px 4px 0;color:#b8892e;font-weight:bold;white-space:nowrap;vertical-align:top">${a.min} min</td><td style="padding:4px 0">${esc(a.item)}</td></tr>`).join('');
const prodNames = w => (w.products || []).map(p => p.name).join(', ');
const prodHtml = w => (w.products || []).map(p => `<a href="${esc(p.url)}" style="color:#2563c9">${esc(p.name)}</a>`).join(', ');
const h1 = t => `<h1 style="font-family:Georgia,serif;font-size:24px;line-height:1.25;margin:0 0 6px;color:#0b1424">${esc(t)}</h1>`;
// poster and slides links for the emails (nothing is shown when there is no current file)
const filesHtml = (w, when, posterLead) => {
  const f = webinarFiles(w, when), out = [];
  if (posterLead && (f.poster_png || f.poster_pdf)) out.push(`${esc(posterLead)} ${[f.poster_png && `<a href="${esc(f.poster_png)}" style="color:#2563c9;font-weight:bold">poster (image)</a>`, f.poster_pdf && `<a href="${esc(f.poster_pdf)}" style="color:#2563c9;font-weight:bold">poster (PDF)</a>`].filter(Boolean).join(' · ')}`);
  if (f.deck) out.push(`📑 <a href="${esc(f.deck)}" style="color:#2563c9;font-weight:bold">Download the slides</a>`);
  return out.length ? `<p style="margin:0 0 14px;font-size:14px;line-height:1.7">${out.join('<br>')}</p>` : '';
};
const filesText = (w, when, poster) => { const f = webinarFiles(w, when); return [poster && f.poster_png && 'Poster (image): ' + f.poster_png, poster && f.poster_pdf && 'Poster (PDF): ' + f.poster_pdf, f.deck && 'Slides: ' + f.deck].filter(Boolean).map(s => '\n' + s).join(''); };
const chips = (pid, w, settings) => {
  const items = [[actUrl(pid, w && w.slug, 'topic'), '💡 Suggest a webinar topic'], [actUrl(pid, w && w.slug, 'talk'), '🤝 Talk to us about using DuaDesk']];
  if (settings && settings.whatsapp_channel_url) items.push([settings.whatsapp_channel_url, '📢 Follow DuaDesk Webinars on WhatsApp']);
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 0">${items.map(([h, l]) => `<tr><td style="padding:3px 0"><a href="${esc(h)}" style="color:#2563c9;font-weight:bold;text-decoration:none">${esc(l)}</a></td></tr>`).join('')}</table>`;
};

function inviteEmail(w, p, settings) {
  const rt = w.format === 'roundtable';
  const host = w.cohost_confirmed && w.cohost_name ? `<br>In association with <b>${esc(w.cohost_name)}</b>` : '';
  const html = shell(`<p style="margin:0 0 14px">${p.name ? 'Dear ' + esc(first(p.name)) + ',' : 'Hello,'}</p>
<p style="margin:0 0 14px">I would be glad to have you join my ${rt ? 'private roundtable' : 'free 45-minute webinar'}:</p>
${h1(w.title)}<p style="margin:0 0 16px;color:#5a6478;font-style:italic">${esc(w.subtitle || '')}</p>
<p style="margin:0 0 16px"><b>${esc(whenIST(w.starts_at, w))}</b><br>Online on Microsoft Teams · 45 minutes${host}</p>
<p style="margin:0 0 16px">${esc(w.summary || '')}</p>
<p style="margin:0 0 6px;font-weight:bold">Agenda</p><table role="presentation" cellpadding="0" cellspacing="0" style="font-size:14px;line-height:1.5;margin:0 0 18px">${agendaHtml(w)}</table>
<p style="margin:0 0 4px">${btn(actUrl(p.id, w.slug, 'register'), rt ? 'Request a seat (one click)' : 'Register me (one click)')}${btn(actUrl(p.id, w.slug, 'wa'), 'Remind me on WhatsApp', true)}</p>
<p style="margin:0 0 18px;font-size:13px"><a href="${esc(actUrl(p.id, w.slug, 'not_this_one'))}" style="color:#5a6478">Not this one, but keep me posted about others</a></p>
${filesHtml(w, 'before', '📣 To share with colleagues:')}<p style="margin:0 0 4px;font-size:14px;color:#5a6478">Related DuaDesk product: ${prodHtml(w)}</p>
${chips(p.id, w, settings)}
<p style="margin:18px 0 0">Warm regards,<br><b>CA Ashish Dua</b><br>Founder, DuaDesk</p>`, p.id);
  const text = `${p.name ? 'Dear ' + first(p.name) + ',' : 'Hello,'}\n\nYou are invited: ${w.title} - ${w.subtitle || ''}\n${whenIST(w.starts_at, w)}, on Microsoft Teams (45 minutes).\n\n${w.summary || ''}\n\nRegister with one click: ${actUrl(p.id, w.slug, 'register')}\nNot this one: ${actUrl(p.id, w.slug, 'not_this_one')}${filesText(w, 'before', true)}\nSuggest a topic: ${actUrl(p.id, w.slug, 'topic')}\nTalk to us about DuaDesk: ${actUrl(p.id, w.slug, 'talk')}\n\nCA Ashish Dua, DuaDesk\n\nChoose your invitations: ${actUrl(p.id, null, 'prefs')}\nUnsubscribe from all: ${unsubUrl(p.id)}`;
  return { subject: `${rt ? 'Invitation' : 'Free webinar'}: ${w.title} (${w.starts_at ? new Date(w.starts_at).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' }) : 'date TBA'})`, html, text };
}

// sent when you move a webinar that people have already registered for
function rescheduleEmail(w, reg, pid, settings) {
  const rt = w.format === 'roundtable', link = !rt && w.teams_link;
  const html = shell(`<p style="margin:0 0 14px">Dear ${esc(first(reg.name))},</p>
<p style="margin:0 0 14px"><b>The date has changed</b> for the session you registered for:</p>
${h1(w.title)}<p style="margin:0 0 16px">New date and time: <b>${esc(whenIST(w.starts_at, w))}</b> · Microsoft Teams · 45 minutes, with time for questions</p>
<p style="margin:0 0 16px">You are still registered; there is nothing you need to do. The attached calendar invite replaces the earlier one.</p>
${link ? `<p style="margin:0 0 16px">${btn(w.teams_link, 'Join on Microsoft Teams')}</p>` : ''}
<p style="margin:0 0 14px">If the new time doesn't suit you, just reply to this email.</p>
<p style="margin:18px 0 0">Warm regards,<br><b>CA Ashish Dua</b></p>`, pid, 'You received this because you registered for this session.');
  return { subject: `New date: ${w.title}`, html, text: `The date has changed for ${w.title}. New date: ${whenIST(w.starts_at, w)}. You are still registered.${link ? '\nJoin: ' + w.teams_link : ''}\n\nCA Ashish Dua` };
}
function confirmEmail(w, reg, pid, settings) {
  const rt = w.format === 'roundtable', link = !rt && w.teams_link;
  const share = waLink('', `I’ve registered for “${w.title}” (${whenIST(w.starts_at, w)}), a free 45-minute DuaDesk webinar. Join me: ${webinarUrl(w)}`).replace('https://wa.me/?', 'https://wa.me/?');
  const waBlock = reg.wa_optin && settings && settings.whatsapp_number ? `<p style="margin:0 0 14px;font-size:14px;background:#f2f8f3;border-radius:8px;padding:10px 12px">📱 <b>WhatsApp reminders:</b> please save <b>+${esc(String(settings.whatsapp_number).replace(/\D/g, ''))}</b> as “DuaDesk Webinars” in your phone, so our reminders reach you. Reply STOP at any time to stop them.</p>` : '';
  const html = shell(`<p style="margin:0 0 14px">Dear ${esc(first(reg.name))},</p>
<p style="margin:0 0 14px">${rt ? 'Thank you for requesting a seat at' : 'You are registered for'}:</p>
${h1(w.title)}<p style="margin:0 0 16px"><b>${esc(whenIST(w.starts_at, w))}</b> · Microsoft Teams · 45 minutes</p>
${link ? `<p style="margin:0 0 8px">${btn(w.teams_link, 'Join on Microsoft Teams')}</p><p style="margin:0 0 16px;font-size:13px;color:#5a6478">Keep this email. The same link works on the day. A calendar invite is attached.</p>`
    : `<p style="margin:0 0 16px">${rt ? 'Seats are limited. I will personally confirm your place and send the joining details.' : 'Your Microsoft Teams link will be emailed to you before the session. A calendar invite is attached so you can block the time.'}</p>`}
${waBlock}
<p style="margin:0 0 6px;font-weight:bold">Agenda</p><table role="presentation" cellpadding="0" cellspacing="0" style="font-size:14px;line-height:1.5;margin:0 0 18px">${agendaHtml(w)}</table>
<p style="margin:0 0 8px">Know someone who should attend? ${btn(share, 'Share on WhatsApp', true)}</p>
${filesHtml(w, 'before', '📣 Or forward the')}${chips(pid, w, settings)}
<p style="margin:18px 0 0">Warm regards,<br><b>CA Ashish Dua</b></p>`, pid, 'You received this because you registered for this session.');
  return { subject: `${rt ? 'Request received' : 'You’re registered'}: ${w.title}`, html, text: `You are registered for ${w.title}, ${whenIST(w.starts_at, w)}.${link ? '\nJoin: ' + w.teams_link : '\nThe joining link will follow.'}${filesText(w, 'before', true)}\n\nCA Ashish Dua` };
}

function reminderEmail(w, reg, pid) {
  const html = shell(`<p style="margin:0 0 14px">Dear ${esc(first(reg.name) || 'friend')},</p>
<p style="margin:0 0 14px">A reminder that our session starts soon:</p>
${h1(w.title)}<p style="margin:0 0 20px"><b>${esc(whenIST(w.starts_at, w))}</b> · 45 minutes</p>
<p style="margin:0 0 20px">${btn(w.teams_link, 'Join on Microsoft Teams')}</p>
<p style="margin:0 0 14px;font-size:13px;color:#5a6478">If the button does not work, copy this link: ${esc(w.teams_link)}</p>
<p style="margin:0 0 14px;font-size:13px;color:#5a6478">Please join with the same name you registered with (${esc(reg.name || '')}), so we can send your attendance certificate.</p>
${filesHtml(w, 'before', null)}<p style="margin:18px 0 0">See you there,<br><b>CA Ashish Dua</b></p>`, pid, 'You received this because you registered for this session.');
  return { subject: `Starting soon: ${w.title}`, html, text: `Starting soon: ${w.title}, ${whenIST(w.starts_at, w)}.\nJoin: ${w.teams_link}\nPlease join with the same name you registered with, so we can send your attendance certificate.${filesText(w, 'before', false)}\n\nCA Ashish Dua` };
}

function followupEmail(w, reg, pid, attended, settings) {
  const html = shell(`<p style="margin:0 0 14px">Dear ${esc(first(reg.name) || 'friend')},</p>
<p style="margin:0 0 14px">${attended ? 'Thank you for joining' : 'We missed you at'} <b>${esc(w.title)}</b>. ${attended ? 'Here is everything from the session:' : 'The good news: the full recording is ready for you.'}</p>
<p style="margin:0 0 8px">${btn(watchUrl(w.slug, pid), 'Watch the recording')}${attended ? btn(certUrl(reg.id), 'Your attendance certificate', true) : ''}</p>
${attended ? `<p style="margin:10px 0 14px">Two minutes of your feedback helps me plan the next sessions: <a href="${esc(feedbackUrl(reg.id))}" style="color:#2563c9;font-weight:bold">Give feedback</a></p>` : ''}
${filesHtml(w, 'after', null)}${(w.faq || []).length ? `<p style="margin:14px 0 6px;font-weight:bold">Questions from the session</p>${w.faq.map(f => `<p style="margin:0 0 10px;font-size:14px"><b>${esc(f.q)}</b><br>${esc(f.a || '')}</p>`).join('')}` : ''}<p style="margin:14px 0 6px">If you would like to explore ${esc(prodNames(w) || 'DuaDesk')} for your organisation, I would be happy to talk.</p>
${chips(pid, w, settings)}
<p style="margin:18px 0 0">Warm regards,<br><b>CA Ashish Dua</b></p>`, pid, 'You received this because you registered for this session.');
  return { subject: attended ? `Thank you for joining: ${w.title}` : `Recording ready: ${w.title}`, html, text: `${attended ? 'Thank you for joining' : 'We missed you at'} ${w.title}.\nWatch the recording: ${watchUrl(w.slug, pid)}\n${attended ? 'Feedback: ' + feedbackUrl(reg.id) + '\nCertificate: ' + certUrl(reg.id) : ''}${filesText(w, 'after', false)}\n\nCA Ashish Dua` };
}

function scheduledEmail(w, p, topicText, settings) {
  const html = shell(`<p style="margin:0 0 14px">Dear ${esc(first(p.name) || 'friend')},</p>
<p style="margin:0 0 14px">You suggested a webinar on <i>“${esc(topicText)}”</i>. <b>You asked, and we scheduled it:</b></p>
${h1(w.title)}<p style="margin:0 0 16px"><b>${esc(whenIST(w.starts_at, w))}</b> · Microsoft Teams · 45 minutes</p>
<p style="margin:0 0 16px">${esc(w.summary || '')}</p>
<p style="margin:0 0 8px">${btn(actUrl(p.id, w.slug, 'register'), 'Register me (one click)')}</p>
<p style="margin:18px 0 0">Thank you for the idea,<br><b>CA Ashish Dua</b></p>`, p.id, 'You received this because you suggested this topic.');
  return { subject: `You asked, we scheduled it: ${w.title}`, html, text: `You suggested "${topicText}". We scheduled: ${w.title}, ${whenIST(w.starts_at, w)}.\nRegister: ${actUrl(p.id, w.slug, 'register')}` };
}

function leadAckEmail(lead, settings) {
  const b = settings && settings.bookings_url;
  const html = shell(`<p style="margin:0 0 14px">Dear ${esc(first(lead.name) || 'friend')},</p>
<p style="margin:0 0 14px">Thank you for your interest in ${esc(lead.interest || 'DuaDesk')}. I’d be glad to understand what you are looking for and show you how it could work for you.</p>
${b ? `<p style="margin:0 0 14px">Please pick a time that suits you:</p><p style="margin:0 0 14px">${btn(b, 'Choose a time for a 30-minute call')}</p>` : `<p style="margin:0 0 14px">I will get in touch ${lead.how === 'call' ? 'by phone' : 'by email'} within two working days.</p>`}
<p style="margin:18px 0 0">Warm regards,<br><b>CA Ashish Dua</b><br>Founder, DuaDesk · +91 98995 73717</p>`, lead.person_id, 'You received this because you asked us to contact you.');
  return { subject: 'Thank you, let’s find a time to talk', html, text: `Thank you for your interest in ${lead.interest || 'DuaDesk'}.${b ? ' Pick a time: ' + b : ' I will be in touch within two working days.'}\n\nCA Ashish Dua` };
}
function leadAlertEmail(lead) {
  const rows = [['Name', lead.name], ['Email', lead.email], ['Mobile', lead.phone], ['Company', lead.company], ['Prefers', lead.how], ['Interest', lead.interest], ['From webinar', lead.from_webinar], ['Note', lead.note]];
  return { subject: `New DuaDesk lead: ${lead.name || lead.email}${lead.company ? ' (' + lead.company + ')' : ''}`,
    html: `<div style="font-family:Arial,sans-serif;font-size:14px"><p><b>New “talk to us” request</b></p><table cellpadding="6" style="border-collapse:collapse">${rows.filter(r => r[1]).map(([k, v]) => `<tr><td style="color:#5a6478">${k}</td><td><b>${esc(v)}</b></td></tr>`).join('')}</table><p><a href="${ENV().SITE}/webinar-admin.html">Open the Leads tab</a></p></div>`,
    text: rows.filter(r => r[1]).map(r => r.join(': ')).join('\n') };
}

function mailHeaders(pid) {
  return pid ? { 'List-Unsubscribe': `<${unsubUrl(pid)}>, <mailto:ashish@ashishduacorporation.com?subject=unsubscribe>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } : {};
}
function envelope(to, msg, pid, extra = {}) {
  const { FROM, REPLY_TO } = ENV();
  return { from: FROM, to: [to], reply_to: REPLY_TO, subject: msg.subject, html: msg.html, text: msg.text, headers: mailHeaders(pid), ...extra };
}
async function sendOne(to, msg, pid, meta, extra) {
  try {
    const r = await resend('/emails', envelope(to, msg, pid, extra), meta.idem);
    await sb('email_log', { method: 'POST', body: { webinar_slug: meta.slug || null, person_id: pid || null, email: to, kind: meta.kind, status: 'sent', resend_id: r.id }, prefer: 'return=minimal' }).catch(() => {});
    return true;
  } catch (e) {
    await sb('email_log', { method: 'POST', body: { webinar_slug: meta.slug || null, person_id: pid || null, email: to, kind: meta.kind, status: 'failed', error: String(e.message).slice(0, 500) }, prefer: 'return=minimal' }).catch(() => {});
    return false;
  }
}

/* ---------- leads ---------- */
async function createLead(person, d, settings) {
  const lead = { person_id: person.id, name: person.name || d.name || null, email: person.email || null, phone: d.phone ? normPhone(d.phone) : person.phone || null,
    company: person.company || d.company || null, how: d.how === 'call' ? 'call' : 'email', interest: clean(d.interest || '', 200) || null,
    from_webinar: d.slug || null, note: clean(d.note || '', 1000) || null };
  const recent = await sb(`leads?select=id&person_id=eq.${person.id}&created_at=gte.${new Date(Date.now() - 7 * 864e5).toISOString()}`);
  if (recent.length) return { duplicate: true };
  const [row] = await sb('leads', { method: 'POST', body: lead, prefer: 'return=representation' });
  const { OWNER } = ENV();
  await sendOne(OWNER, leadAlertEmail(lead), null, { kind: 'lead_alert' });
  if (lead.email) await sendOne(lead.email, leadAckEmail(row, settings), person.id, { kind: 'lead_ack' });
  return { lead: row };
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return Object.fromEntries(new URLSearchParams(req.body)); } }
  const chunks = []; for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  try { return JSON.parse(raw || '{}'); } catch { return Object.fromEntries(new URLSearchParams(raw)); }
}
function clientIp(req) { return String(req.headers['x-real-ip'] || String(req.headers['x-forwarded-for'] || '').split(',')[0] || '').trim() || 'unknown'; }
// simple abuse protection: at most `max` actions per IP per window (the IP is stored only as a keyed hash)
async function rateOk(req, bucket, windowSec, max, record = true) {
  const scale = Math.max(1, +(process.env.RATE_LIMIT_SCALE || 1));
  const key = bucket + '|' + sha((process.env.UNSUBSCRIBE_SECRET || '') + clientIp(req)).slice(0, 24);
  try { return await sb('rpc/rate_hit', { method: 'POST', body: { p_key: key, p_window_sec: windowSec, p_max: max * scale, p_record: record } }); } catch { return true; } // never block people because of a database hiccup
}
// fetch every row (Supabase returns at most 1,000 rows per request)
async function sbAll(path, max = 200000) {
  const out = [];
  for (let off = 0; off < max; off += 1000) {
    const rows = await sb(`${path}${path.includes('?') ? '&' : '?'}limit=1000&offset=${off}`);
    out.push(...rows); if (rows.length < 1000) break;
  }
  return out;
}
function send(res, code, obj) { res.statusCode = code; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(obj)); }

/* ---- version 3 helpers: labelling, email validation, SMTP, web push, RocketReach, outreach drafting ---- */
import dns from 'node:dns/promises';
import tls from 'node:tls';
import net from 'node:net';

/* ---------- labelling (segments) ---------- */
const ROLE_RULES = [
  ['role:finance', /\b(cfo|finance|financial|accounts?|accountant|controller|treasur|chartered accountant|\bca\b|fp&a|cost accountant)/i],
  ['role:ceo-owner', /\b(ceo|c\.e\.o|md|m\.d|managing director|director|founder|co-founder|owner|proprietor|partner|chairman|chairperson|president|cmd|promoter|whole ?time director|principal)\b/i],
  ['role:procurement', /\b(purchase|purchasing|procure|sourcing|supply chain|buyer|vendor development|materials?)\b/i],
  ['role:hr', /\b(hr|human resources?|people|talent|recruit)/i],
  ['role:it', /\b(it|cio|cto|ciso|technology|systems|erp|digital|information)\b/i],
  ['role:tax', /\b(tax|taxation|gst|indirect|direct tax)\b/i],
  ['role:audit', /\b(audit|auditor|internal audit|risk|compliance)\b/i],
];
const IND_RULES = [
  ['ind:pharma', /pharma|drug|medic|healthcare|hospital|life ?science|diagnostic|ayurved|nutraceutical|surgical/i],
  ['ind:auto', /\bauto|automobile|automotive|vehicle|tyre|tire|spare part|two wheeler|tractor/i],
  ['ind:manufacturing', /manufactur|industr|engineering|machin|steel|metal|rubber|plastic|moulding|molding|fabricat|casting|forging|chemical|textile|garment|apparel|packag|electrical|electronic|cable|pump|valve|fastener|printing|paper|furniture|glass|ceramic|polymer|tool/i],
  ['ind:trading', /trader|trading|wholesale|distribut|dealer|stockist|supplier|retail|shop|store|kirana|mart|merchant|agency|agencies/i],
  ['ind:food', /food|spice|flavou?r|bakery|dairy|\brice\b|snack|beverage|sweets|confection|edible oil|agro/i],
  ['ind:it-services', /software|it services|it solution|web design|digital marketing|saas|technolog/i],
  ['ind:finance-services', /\bbank|nbfc|insurance|investment|capital|\bca firm|chartered accountant|audit firm|financial services|broking|wealth|venture/i],
  ['ind:real-estate', /real estate|builder|construction|infra|cement|realty|developer|architect|interior/i],
  ['ind:education', /school|college|education|institute|academy|university|coaching|training/i],
  ['ind:hospitality', /hotel|restaurant|travel|tour|resort|catering|banquet/i],
  ['ind:logistics', /logistic|transport|courier|shipping|freight|cargo|warehous/i],
  ['ind:trade-customs', /export|import|customs|overseas|international trade|clearing|forwarding/i],
];
const NCR = /delhi|gurgaon|gurugram|noida|faridabad|ghaziabad|greater noida|manesar|sonipat|bahadurgarh/i;
const UAE = /dubai|\buae\b|abu dhabi|sharjah|ajman|united arab emirates/i;
function segmentsFor(r) {
  const seg = new Set();
  const role = `${r.role || ''}`;
  for (const [s, re] of ROLE_RULES) if (re.test(role)) seg.add(s);
  const ind = `${r.industry || ''} ${r.details || ''} ${r.company || ''}`;
  for (const [s, re] of IND_RULES) if (re.test(ind)) seg.add(s);
  const geo = `${r.city || ''} ${r.state || ''}`;
  if (NCR.test(geo)) seg.add('geo:ncr');
  if (UAE.test(geo + ' ' + (r.company || ''))) seg.add('geo:uae');
  if (/\.ae$/i.test(r.email || '')) seg.add('geo:uae');
  const t = `${r.turnover || ''}`.toLowerCase();
  if (/(\d{3,}|1000|500|250)\s*-?\s*.*cr|above|>|bn|billion/.test(t) && !/^0|below|less/.test(t)) seg.add('size:large');
  else if (/cr/.test(t)) seg.add('size:mid');
  return [...seg];
}

/* ---------- email validation ---------- */
const TYPO = { 'gmial.com': 'gmail.com', 'gamil.com': 'gmail.com', 'gmai.com': 'gmail.com', 'gmail.co': 'gmail.com', 'gmail.con': 'gmail.com', 'gmail.cm': 'gmail.com', 'gmaill.com': 'gmail.com', 'gmail.om': 'gmail.com', 'gnail.com': 'gmail.com',
  'yaho.com': 'yahoo.com', 'yahoo.co': 'yahoo.com', 'yahoo.con': 'yahoo.com', 'yahooo.com': 'yahoo.com', 'yhoo.com': 'yahoo.com', 'yahoo.co.inn': 'yahoo.co.in', 'yahoo.in': 'yahoo.in',
  'hotmal.com': 'hotmail.com', 'hotmail.co': 'hotmail.com', 'hotmail.con': 'hotmail.com', 'hotmai.com': 'hotmail.com', 'outlok.com': 'outlook.com', 'outlook.co': 'outlook.com', 'rediffmail.co': 'rediffmail.com', 'redifmail.com': 'rediffmail.com' };
const FREE = new Set(['gmail.com', 'yahoo.com', 'yahoo.co.in', 'yahoo.in', 'hotmail.com', 'outlook.com', 'live.com', 'rediffmail.com', 'icloud.com', 'aol.com', 'msn.com', 'ymail.com', 'protonmail.com', 'zoho.com', 'zohomail.in']);
const DISPOSABLE = /(mailinator|tempmail|10minutemail|guerrillamail|yopmail|trashmail|sharklasers|getnada|dispostable|temp-mail|fakeinbox)\./i;
const ROLE_LOCAL = /^(info|sales|admin|contact|support|accounts?|hr|office|enquiry|enquiries|inquiry|mail|marketing|help|service|services|care|customercare|noreply|no-reply|webmaster|billing|purchase|export|exports|import)([.\-_\d]*)$/i;
const isFreeDomain = d => FREE.has(String(d || '').toLowerCase());
// returns {email, check} where check is null (needs MX check), 'invalid', 'disposable' or 'role'
function precheckEmail(raw) {
  let e = String(raw || '').trim().toLowerCase().replace(/^mailto:/, '').replace(/[\s,;:'"<>()\[\]]+$/g, '').replace(/^[\s,;:'"<>()\[\]]+/g, '');
  if (!e) return { email: null, check: null };
  e = e.replace(/\.+$/, '').replace(/\.co\.inn$/, '.co.in').replace(/\.comm$/, '.com').replace(/\.con$/, '.com').replace(/@\./, '@');
  const at = e.lastIndexOf('@'); if (at < 1) return { email: e, check: 'invalid' };
  let local = e.slice(0, at), dom = e.slice(at + 1);
  if (TYPO[dom]) dom = TYPO[dom];
  e = local + '@' + dom;
  if (!/^[a-z0-9!#$%&'*+/=?^_`{|}~.-]{1,64}@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(e) || /\.\./.test(e) || local.startsWith('.') || local.endsWith('.')) return { email: e, check: 'invalid' };
  if (DISPOSABLE.test(dom)) return { email: e, check: 'disposable' };
  if (ROLE_LOCAL.test(local)) return { email: e, check: 'role' };
  return { email: e, check: null };
}
// MX lookups with a shared cache table; returns map domain -> true/false
async function mxStatus(domains) {
  const uniq = [...new Set(domains.filter(Boolean))];
  const out = {};
  for (const d of uniq) if (FREE.has(d)) out[d] = true;
  const rest = uniq.filter(d => !(d in out));
  if (rest.length) {
    for (let i = 0; i < rest.length; i += 150) {
      const part = rest.slice(i, i + 150);
      const rows = await sb(`email_domains?select=domain,has_mx&domain=in.(${part.map(d => '"' + d + '"').join(',')})`);
      rows.forEach(r => { out[r.domain] = r.has_mx; });
    }
  }
  const todo = rest.filter(d => !(d in out));
  const fresh = [];
  let idx = 0;
  const worker = async () => {
    while (idx < todo.length) {
      const d = todo[idx++];
      let ok = false;
      try { const mx = await Promise.race([dns.resolveMx(d), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 4000))]); ok = Array.isArray(mx) && mx.length > 0; }
      catch (e) {
        if (e.message === 'timeout') continue; // undecided: try again next time
        try { const a = await Promise.race([dns.resolve4(d), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 3000))]); ok = a.length > 0; } catch { ok = false; }
      }
      out[d] = ok; fresh.push({ domain: d, has_mx: ok });
    }
  };
  await Promise.all(Array.from({ length: Math.min(25, todo.length) }, worker));
  if (fresh.length) await sb('email_domains?on_conflict=domain', { method: 'POST', body: fresh, prefer: 'resolution=merge-duplicates,return=minimal' }).catch(() => {});
  return out;
}

/* ---------- minimal SMTP client (TLS on 465, or STARTTLS on 587) ---------- */
function smtpConfig() {
  const host = process.env.OUTREACH_SMTP_HOST || '', user = process.env.OUTREACH_SMTP_USER || '', pass = process.env.OUTREACH_SMTP_PASS || '';
  const port = +(process.env.OUTREACH_SMTP_PORT || 465);
  const from = process.env.OUTREACH_FROM || user;
  const secure = process.env.OUTREACH_SMTP_SECURE ? process.env.OUTREACH_SMTP_SECURE === 'yes' : port === 465;
  return host && user && pass ? { host, port, user, pass, from, secure, insecure: process.env.OUTREACH_SMTP_INSECURE === 'yes' } : null;
}
async function smtpSend(cfg, msg) {
  const domain = (cfg.from.match(/@([^>\s]+)/) || [, 'localhost'])[1];
  let sock = cfg.secure ? tls.connect({ host: cfg.host, port: cfg.port, servername: cfg.host, rejectUnauthorized: !cfg.insecure }) : net.connect({ host: cfg.host, port: cfg.port });
  let buf = '', waiters = [];
  const onData = d => { buf += d.toString('utf8'); pump(); };
  function pump() {
    while (waiters.length) {
      const m = buf.match(/(^|\r\n)(\d{3}) [^\r\n]*\r\n/);
      if (!m) return;
      const end = m.index + m[0].length; const chunk = buf.slice(0, end); buf = buf.slice(end);
      waiters.shift()({ code: +m[2], text: chunk.trim() });
    }
  }
  const read = () => new Promise((res, rej) => { waiters.push(res); setTimeout(() => rej(new Error('SMTP timeout')), 20000); pump(); });
  const cmd = async (line, expect) => { sock.write(line + '\r\n'); const r = await read(); if (expect && !expect.includes(r.code)) throw new Error(`SMTP ${r.code}: ${r.text.slice(0, 200)}`); return r; };
  sock.on('data', onData);
  await new Promise((res, rej) => { sock.once(cfg.secure ? 'secureConnect' : 'connect', res); sock.once('error', rej); });
  try {
    let r = await read(); if (r.code !== 220) throw new Error('SMTP greeting ' + r.text);
    r = await cmd('EHLO ' + domain, [250]);
    if (!cfg.secure) {
      await cmd('STARTTLS', [220]);
      sock.removeListener('data', onData);
      sock = tls.connect({ socket: sock, servername: cfg.host, rejectUnauthorized: !cfg.insecure });
      await new Promise((res, rej) => { sock.once('secureConnect', res); sock.once('error', rej); });
      sock.on('data', onData);
      await cmd('EHLO ' + domain, [250]);
    }
    await cmd('AUTH LOGIN', [334]);
    await cmd(Buffer.from(cfg.user).toString('base64'), [334]);
    await cmd(Buffer.from(cfg.pass).toString('base64'), [235]);
    const fromAddr = (cfg.from.match(/<([^>]+)>/) || [, cfg.from])[1];
    await cmd(`MAIL FROM:<${fromAddr}>`, [250]);
    if (!/^[^\s<>@]+@[^\s<>@]+$/.test(msg.to)) throw new Error('Invalid recipient');
    await cmd(`RCPT TO:<${msg.to}>`, [250, 251]);
    await cmd('DATA', [354]);
    const one = s => String(s == null ? '' : s).replace(/[\r\n]+/g, ' ').trim(); // no header injection
    const enc = s => { s = one(s); return /[^\x20-\x7e]/.test(s) ? '=?UTF-8?B?' + Buffer.from(s).toString('base64') + '?=' : s; };
    const mid = `<${Date.now().toString(36)}.${Math.random().toString(36).slice(2)}@${domain}>`;
    const headers = [`From: ${cfg.from}`, `To: <${msg.to}>`, `Subject: ${enc(msg.subject)}`, `Date: ${new Date().toUTCString()}`, `Message-ID: ${mid}`, 'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', ...(msg.replyTo ? [`Reply-To: ${msg.replyTo}`] : []), ...Object.entries(msg.headers || {}).map(([k, v]) => `${one(k)}: ${one(v)}`)];
    const body = Buffer.from(msg.text.replace(/\r?\n/g, '\r\n')).toString('base64').replace(/.{76}/g, '$&\r\n');
    sock.write(headers.join('\r\n') + '\r\n\r\n' + body + '\r\n.\r\n');
    const r2 = await read(); if (r2.code !== 250) throw new Error('SMTP rejected: ' + r2.text.slice(0, 200));
    sock.write('QUIT\r\n');
    return { id: mid };
  } finally { setTimeout(() => sock.destroy(), 200); }
}

/* ---------- web push (no payload; the service worker fetches the message) ---------- */
const b64u = b => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
async function vapidKeys() {
  const s = await getSettings();
  if (s.vapid_public && s.vapid_private_jwk) return { pub: s.vapid_public, jwk: JSON.parse(s.vapid_private_jwk) };
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = privateKey.export({ format: 'jwk' });
  const raw = publicKey.export({ format: 'der', type: 'spki' }).slice(-65);
  const pub = b64u(raw);
  await sb('settings?on_conflict=key', { method: 'POST', body: [{ key: 'vapid_public', value: pub }, { key: 'vapid_private_jwk', value: JSON.stringify(jwk) }], prefer: 'resolution=ignore-duplicates,return=minimal' });
  const again = await getSettings();
  return { pub: again.vapid_public, jwk: JSON.parse(again.vapid_private_jwk) };
}
// only real browser push services (never let a subscription make the server call an arbitrary address)
function pushHostOk(endpoint) {
  let u; try { u = new URL(String(endpoint || '')); } catch { return false; }
  if (u.protocol !== 'https:' || String(endpoint).length > 800) return false;
  const extra = String(process.env.PUSH_EXTRA_HOSTS || '').split(',').filter(Boolean);
  return /^(fcm\.googleapis\.com|android\.googleapis\.com|updates\.push\.services\.mozilla\.com|push\.services\.mozilla\.com|[a-z0-9-]+\.notify\.windows\.com|web\.push\.apple\.com|[a-z0-9.-]+\.push\.apple\.com)$/i.test(u.hostname) && !u.port || extra.includes(u.host);
}
async function pushOne(endpoint, keys) {
  if (!pushHostOk(endpoint)) return 410;
  const aud = new URL(endpoint).origin;
  const head = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64u(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: 'mailto:ashish@ashishduacorporation.com' }));
  const key = crypto.createPrivateKey({ key: keys.jwk, format: 'jwk' });
  const sig = crypto.sign('sha256', Buffer.from(head + '.' + claims), { key, dsaEncoding: 'ieee-p1363' });
  const jwt = head + '.' + claims + '.' + b64u(sig);
  const res = await fetch(endpoint, { method: 'POST', headers: { Authorization: `vapid t=${jwt}, k=${keys.pub}`, TTL: '86400', Urgency: 'normal', 'Content-Length': '0' } });
  return res.status;
}

/* ---------- RocketReach ----------
   Two-step flow proven in DuaDesk AI CPO: Search (free) -> pick the right person -> Reveal (1 credit).
   Never reveal from a company/title guess; only from a chosen search result, a LinkedIn URL, or an exact name + employer match. */
const RR = 'https://api.rocketreach.co';
const RR_PATHS = { // the paths live in AI CPO first, then RocketReach's newer documented paths
  account: ['/v2/api/account', '/api/v2/account/'],
  search: ['/v2/api/search', '/api/v2/person/search'],
  reveal: ['/v2/api/lookupProfile', '/api/v2/person/lookup'],
  status: ['/v2/api/checkStatus', '/api/v2/person/checkStatus'] };
async function rrReq(key, kind, { query = '', body } = {}) {
  let last = '';
  for (const p of RR_PATHS[kind]) {
    let res;
    try {
      res = await fetch(RR + p + query, { method: body ? 'POST' : 'GET', cache: 'no-store', signal: AbortSignal.timeout(20000),
        headers: { 'Api-Key': key, Accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    } catch (e) { throw Object.assign(new Error('RocketReach did not answer in time. Try again.'), { status: 504 }); }
    if (res.status === 404 || res.status === 405) { last = res.status; continue; } // try the other path
    const data = await res.json().catch(() => ({}));
    if (res.status === 429) throw Object.assign(new Error('RocketReach is busy (too many requests). Try again in a minute.'), { status: 429 });
    if (!res.ok) {
      const m = data.detail || data.message || data.error || (typeof data === 'object' ? JSON.stringify(data).slice(0, 200) : res.status);
      throw Object.assign(new Error('RocketReach: ' + m), { status: res.status === 401 || res.status === 403 ? 400 : res.status === 400 ? 422 : 502, rr: res.status });
    }
    return data;
  }
  if (kind === 'reveal' && last === 404) return { status: 'failed', emails: [] }; // person not found on either path
  throw Object.assign(new Error('RocketReach endpoint not found (' + last + ')'), { status: 502 });
}
const rrProfiles = d => (Array.isArray(d) ? d : d.profiles || d.data || d.results || []).filter(x => x && x.id);
function rrPerson(x) {
  const loc = x.location || [x.city, x.region, x.country_code || x.country].filter(Boolean).join(', ');
  return { rr_id: Number(x.id), name: x.name || [x.first_name, x.last_name].filter(Boolean).join(' ') || null, title: x.current_title || null,
    company: x.current_employer || null, location: loc || null, linkedin_url: x.linkedin_url || null };
}
const PENDING = ['searching', 'progress', 'waiting', 'pending'];
// reveal one person (1 credit); by id, or by linkedin_url
async function rrReveal(key, by) {
  const q = by.id ? 'id=' + encodeURIComponent(by.id) : 'linkedin_url=' + encodeURIComponent(by.linkedin_url);
  let r = await rrReq(key, 'reveal', { query: '?' + q });
  for (let k = 0; k < 4 && r && PENDING.includes(String(r.status)); k++) {
    await new Promise(x => setTimeout(x, +(process.env.RR_POLL_MS || 3000)));
    const st = await rrReq(key, 'status', { query: '?ids=' + encodeURIComponent(r.id || r.profile_id || by.id) });
    r = Array.isArray(st) ? st[0] : (st.profiles ? st.profiles[0] : st);
  }
  return r || {};
}
// keep only good emails: grade A or A- (or RocketReach's "valid"); professional first; personal only when allowed
function rrBest(p, { personal = true } = {}) {
  const emails = (p.emails || []).filter(e => e && e.email);
  const score = e => { const g = String(e.grade || '').toUpperCase(); return g === 'A' ? 3 : g === 'A-' ? 2 : String(e.smtp_valid || '').toLowerCase() === 'valid' ? 1 : 0; };
  const ok = emails.filter(e => score(e) > 0 && (personal || e.type !== 'personal')).sort((a, b) => (b.type === 'professional') - (a.type === 'professional') || score(b) - score(a));
  const best = ok[0];
  const phone = (p.phones || []).map(x => x.number).find(Boolean);
  return { email: best ? String(best.email).toLowerCase() : null, grade: best ? (best.grade || 'valid') : null, phone: phone || null, title: p.current_title || null, linkedin: p.linkedin_url || null, status: p.status || null };
}
// company names as people write them vs as RocketReach stores them
const companyKey = c => String(c || '').toLowerCase().replace(/\(p\)|\(i\)/g, ' ').replace(/&/g, ' and ').replace(/\b(pvt|private|ltd|limited|llp|inc|co|company|corp|corporation|india|the|m\/s)\b\.?/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
const searchName = c => String(c || '').replace(/^m\/s\.?\s*/i, '').replace(/\(p\)|\(i\)/gi, '').replace(/\b(pvt|private)\.?\s*(ltd|limited)\.?|\b(ltd|limited|llp|inc)\b\.?/gi, '').replace(/[.,\s]+$/, '').replace(/\s+/g, ' ').trim();
const RR_TITLES = {
  'role:finance': ['CFO', 'Chief Financial Officer', 'Finance Director', 'Director Finance', 'Head of Finance', 'VP Finance', 'Financial Controller', 'General Manager Finance', 'Finance Manager'],
  'role:ceo-owner': ['CEO', 'Managing Director', 'Founder', 'Owner', 'Proprietor', 'Director', 'Chairman'],
  'role:procurement': ['Chief Procurement Officer', 'Head of Procurement', 'Purchase Head', 'Head Purchase', 'Procurement Manager', 'Purchase Manager', 'Supply Chain Head'],
  'role:tax': ['Head of Taxation', 'Tax Head', 'Tax Manager', 'Indirect Tax Manager', 'GST Manager'],
  'role:audit': ['Chief Audit Executive', 'Head of Internal Audit', 'Internal Audit Head', 'Head of Risk'],
  'role:it': ['CIO', 'CTO', 'Head of IT', 'IT Head', 'IT Director'],
  'role:hr': ['CHRO', 'Head of HR', 'HR Head'] };
const RR_PLACES = { 'geo:ncr': ['Delhi, India', 'Gurgaon, India', 'Noida, India', 'Faridabad, India'], 'geo:uae': ['United Arab Emirates'] };
const RR_INDUSTRY = { 'ind:pharma': ['Pharmaceuticals', 'Pharmaceutical Manufacturing'], 'ind:auto': ['Automotive', 'Motor Vehicle Manufacturing'], 'ind:manufacturing': ['Manufacturing', 'Industrial Machinery Manufacturing', 'Machinery'],
  'ind:trading': ['Wholesale', 'Retail'], 'ind:food': ['Food and Beverage Manufacturing', 'Food & Beverages'], 'ind:it-services': ['IT Services and IT Consulting', 'Information Technology and Services'],
  'ind:finance-services': ['Financial Services', 'Accounting'], 'ind:real-estate': ['Real Estate', 'Construction'], 'ind:logistics': ['Transportation, Logistics, Supply Chain and Storage', 'Logistics and Supply Chain'],
  'ind:trade-customs': ['International Trade and Development', 'Import and Export'], 'ind:education': ['Education'], 'ind:hospitality': ['Hospitality'] };
function rrPlanFor(w) {
  const t = w.target_segments || [];
  const roles = t.filter(x => x.startsWith('role:'));
  const titles = [...new Set((roles.length ? roles : ['role:finance', 'role:ceo-owner']).flatMap(r => RR_TITLES[r] || []))];
  const places = [...new Set(t.flatMap(x => RR_PLACES[x] || []))];
  const industries = [...new Set(t.flatMap(x => RR_INDUSTRY[x] || []))];
  return { titles, places: places.length ? places : ['India'], industries, group: (roles.length ? roles : ['role:finance', 'role:ceo-owner']).join('+'), labels: t.filter(x => !x.startsWith('role:')) };
}

/* ---------- outreach drafting ---------- */
const SEG_WORDS = { 'role:finance': 'finance', 'role:ceo-owner': 'leadership', 'role:procurement': 'procurement', 'role:tax': 'tax', 'role:audit': 'audit', 'role:it': 'technology',
  'ind:pharma': 'pharma', 'ind:auto': 'auto-component', 'ind:manufacturing': 'manufacturing', 'ind:trading': 'trading', 'ind:food': 'food', 'ind:finance-services': 'financial services', 'ind:trade-customs': 'import–export' };
function templateDraft(w, p, signature, link, unsub) {
  const firstName = (String(p.name || '').replace(/^(mr|mrs|ms|dr|shri|smt|sh|ca)\.?\s+/i, '').split(/\s+/)[0] || '').replace(/[^A-Za-z'-]/g, '');
  const topic = (p.segments || []).map(s => SEG_WORDS[s]).filter(Boolean)[0];
  const when = whenIST(w.starts_at, w).replace(/, \d{4}/, '');
  const subject = `${w.title}: free 45-min session, ${new Date(w.starts_at).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' })}`;
  const body = `${firstName ? 'Dear ' + firstName + ',' : 'Hello,'}

I'm Ashish Dua, a chartered accountant who has spent 30 years implementing ERP and finance systems for large companies. I'm hosting a free 45-minute online session${topic ? ` that I think will be useful for ${topic} leaders${p.company ? ' like you at ' + p.company : ''}` : ''}:

${w.title}: ${w.subtitle || ''}
${when} · Microsoft Teams

${w.summary || ''}

If it's of interest, you can register with one click here:
${link}

Warm regards,
${signature}

If you'd rather not hear from me again, just reply "STOP" or use this link: ${unsub}
How I found your details and how I use them: ${ENV().SITE}/webinar-privacy.html`;
  return { subject, body };
}
async function aiDrafts(w, people, signature, linkFor, unsubFor) {
  const { AI_KEY, AI_MODEL } = ENV();
  const fallback = () => people.map(p => ({ id: p.id, ...templateDraft(w, p, signature, linkFor(p), unsubFor(p)) }));
  if (!AI_KEY) return fallback();
  const list = people.map(p => ({ id: p.id, name: p.name, role: p.role, company: p.company, industry: p.industry, city: p.city, groups: p.segments }));
  const prompt = `Write short, personal, plain-text cold invitation emails from CA Ashish Dua (a chartered accountant with 30+ years implementing ERP, BI and EPM systems for large companies, founder of DuaDesk) inviting each person below to a free 45-minute online webinar.
Webinar: "${w.title}" (${w.subtitle || ''}), ${whenIST(w.starts_at, w)}, on Microsoft Teams. About: ${w.summary || ''}
Rules: 70–110 words for the body. Warm, respectful Indian business English, no hype, no exclamation marks, no emojis. One sentence connecting the session to the person's role or industry, using only the facts given (do not invent anything about them or their company). Address by first name if a name is given (drop Mr/Mrs/Sh/Dr), else "Hello,". Do not include a sign-off, link or unsubscribe line; those are added automatically. Subject: under 70 characters, specific, no clickbait.
Return ONLY a JSON array of {"id": number, "subject": string, "body": string}.
People: ${JSON.stringify(list)}`;
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': AI_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: AI_MODEL, max_tokens: 6000, messages: [{ role: 'user', content: prompt }] }) });
    const data = await res.json();
    const text = (data.content || []).map(c => c.text || '').join('');
    const arr = JSON.parse((text.match(/\[[\s\S]*\]/) || ['[]'])[0]);
    const by = Object.fromEntries(arr.map(x => [x.id, x]));
    return people.map(p => {
      const x = by[p.id];
      if (!x || !x.body) return { id: p.id, ...templateDraft(w, p, signature, linkFor(p), unsubFor(p)) };
      return { id: p.id, subject: String(x.subject).slice(0, 120), body: `${String(x.body).trim()}\n\nRegister with one click:\n${linkFor(p)}\n\nWarm regards,\n${signature}\n\nIf you'd rather not hear from me again, just reply "STOP" or use this link: ${unsubFor(p)}\nHow I found your details and how I use them: ${ENV().SITE}/webinar-privacy.html` };
    });
  } catch { return fallback(); }
}

/* DuaDesk Webinars: public endpoint  →  /api/webinars
   GET  ?action=list | ics&slug= | cert&r=&t=
   POST ?action=register | act | watch
   GET/POST ?action=unsubscribe&p=&t=                                                                   */

const PUBLIC_FIELDS = 'slug,n,series,format,status,title,subtitle,starts_at,duration_min,products,audience,summary,agenda,speaker,cohost_name,cohost_confirmed,facilitator_name,facilitator_confirmed,note,registration_open,recording_published,recording_summary,files,deck_share,topic_key';
const ok = (res, o) => send(res, 200, { ok: true, ...o });
const bad = (res, msg, code = 400) => send(res, code, { error: msg });

function toPublic(w) {
  const { cohost_name, cohost_confirmed, facilitator_name, facilitator_confirmed, recording_published, recording_summary, files, deck_share, topic_key, faq, ...rest } = w;
  const f = webinarFiles(w, 'before'); // posters only while they match the date and title; slides only if shared before the session
  return { ...rest, faq: faq || [], poster_png: f.poster_png, poster_pdf: f.poster_pdf, slides: f.deck, cohost: cohost_confirmed && cohost_name ? cohost_name : null, facilitator: facilitator_confirmed && facilitator_name ? facilitator_name : null,
    has_recording: !!recording_published, recording_teaser: recording_published ? (recording_summary || '').slice(0, 260) : null };
}
// questions from past sessions that you approved for the website, by topic
async function publicFaq() { const rows = await sb('webinar_knowledge?select=topic_key,question,answer&kind=eq.qa&status=eq.approved&public=eq.true&order=created_at.asc&limit=1000').catch(() => []); const by = {}; for (const r of rows) (by[r.topic_key] = by[r.topic_key] || []).push({ q: r.question, a: r.answer }); return by; }
async function publicSettings() { const s = await getSettings(); return { whatsapp_number: s.whatsapp_number || '', whatsapp_channel_url: s.whatsapp_channel_url || '' }; }
async function getW(slug) { const [w] = await sb(`webinars?select=*&slug=eq.${encodeURIComponent(slug)}`); return w; }

async function list(res) {
  const [rows, settings] = await Promise.all([sb(`webinars?select=${PUBLIC_FIELDS}&status=in.(published,later,done)&order=starts_at.asc.nullslast,n.asc`), publicSettings()]);
  res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
  res.statusCode = 200; res.setHeader('Content-Type', 'application/json; charset=utf-8');
  const faq = await publicFaq(); rows.forEach(w => { w.faq = (faq[w.topic_key || w.slug] || []).slice(0, 8); });
  res.end(JSON.stringify({ webinars: rows.map(toPublic), settings }));
}

async function icsFile(res, slug) {
  const w = await getW(slug);
  const body = w && ['published', 'done'].includes(w.status) && ics(w, false);
  if (!body) return bad(res, 'Not found', 404);
  res.statusCode = 200; res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${w.slug}.ics"`); res.end(body);
}

/* ---------- registration (website form, one-click from email, WhatsApp-assisted by admin) ---------- */
async function doRegister(w, person, d, source, verified = false) {
  const email = person.email;
  if (!email) throw Object.assign(new Error('An email address is needed to register.'), { status: 400 });
  if (w.status !== 'published' || !w.registration_open) throw Object.assign(new Error('This webinar is not open for registration.'), { status: 409 });
  if (w.starts_at && new Date(w.starts_at).getTime() + 30 * 60000 < Date.now()) throw Object.assign(new Error('This session has already taken place.'), { status: 409 });
  const settings = await getSettings();
  const phone = d.phone ? normPhone(d.phone) : person.phone;
  const waOpt = !!d.wa_optin && !!phone && !person.wa_stopped;
  const contact = ['call', 'email', 'no'].includes(d.contact_ok) ? d.contact_ok : null;
  const reg = { webinar_slug: w.slug, person_id: person.id, kind: w.format === 'roundtable' ? 'invite_request' : 'register', name: clean(d.name || person.name, 120) || email,
    email, phone: phone || null, role: clean(d.role, 120) || person.role || null, company: clean(d.company, 160) || person.company || null, company_size: clean(d.company_size, 40) || null,
    challenge: clean(d.challenge, 1000) || null, source, ref: clean(d.ref, 60) || null, wa_optin: waOpt, contact_ok: contact };
  let already = false, row = null;
  try { [row] = await sb('registrations', { method: 'POST', body: reg, prefer: 'return=representation' }); }
  catch (e) { if (e.code === '23505') already = true; else throw e; }
  // consents and preferences
  const patch = {};
  // only a signed link from our own email may undo an unsubscribe; a public form can only switch invitations on for someone who never opted out
  if (d.consent && verified) { patch.email_status = 'subscribed'; await sb(`suppression?hash=eq.${sha(email)}`, { method: 'DELETE', prefer: 'return=minimal' }).catch(() => {}); }
  else if (d.consent) await optIn(person);
  if (waOpt) Object.assign(patch, { wa_optin: true, wa_optin_at: new Date().toISOString(), wa_optin_source: 'registration' });
  if (phone && !person.phone) patch.phone = phone;
  if (Object.keys(patch).length) await sb(`people?id=eq.${person.id}`, { method: 'PATCH', body: { ...patch, updated_at: new Date().toISOString() }, prefer: 'return=minimal' }).catch(() => {});
  await makeWarm(person.id);
  if (d.topic && clean(d.topic, 300)) await sb('topic_suggestions', { method: 'POST', body: { person_id: person.id, text: clean(d.topic, 300), from_webinar: w.slug }, prefer: 'return=minimal' });
  if (contact === 'call' || contact === 'email') await createLead({ ...person, name: reg.name, company: reg.company }, { how: contact, phone, interest: (w.products || []).map(p => p.name).join(', '), slug: w.slug, note: reg.challenge }, settings).catch(() => {});
  if (!already) {
    const cal = ics(w, true);
    await sendOne(email, confirmEmail(w, { ...reg, id: row && row.id }, person.id, settings), person.id, { kind: 'confirmation', slug: w.slug, idem: `confirm-${w.slug}-${email}` },
      cal ? { attachments: [{ filename: 'invite.ics', content: Buffer.from(cal).toString('base64') }] } : {});
  }
  return { already, kind: reg.kind };
}

async function register(req, res) {
  const b = await readBody(req);
  if (b.website) return ok(res, {}); // bot honeypot
  const email = normEmail(b.email), name = clean(b.name, 120);
  if (!b.slug || !name || !validEmail(email)) return bad(res, 'Please enter your name and a valid email address.');
  if (b.phone && !normPhone(b.phone)) return bad(res, 'Please check the mobile number (with country code if outside India).');
  const w = await getW(clean(b.slug, 120)); if (!w) return bad(res, 'Webinar not found', 404);
  const person = await upsertPerson({ email, phone: b.phone, name, company: b.company, role: b.role, source: b.ref ? 'partner:' + clean(b.ref, 40) : 'website', status: 'no_invites' });
  return ok(res, await doRegister(w, person, { ...b, name }, b.src === 'whatsapp' ? 'whatsapp' : 'website'));
}

/* ---------- one-click actions from emails ---------- */
async function act(req, res) {
  const b = await readBody(req);
  const pid = +b.p;
  if (b.a === 'feedback') return feedback(res, b);
  const full = checkTok('p', pid, b.t), lite = !full && checkTok('w', pid, b.t); // 'w' = typed an email to watch a recording: may only talk to us or suggest a topic
  if (!full && !lite) return bad(res, 'This link is not valid or has expired.', 403);
  if (lite && !['peek', 'talk', 'topic'].includes(b.a)) return bad(res, 'Please use the link in one of our emails for this.', 403);
  const [person] = await sb(`people?select=*&id=eq.${pid}`);
  if (!person) return bad(res, 'We could not find your details.', 404);
  const w = b.w ? await getW(clean(b.w, 120)) : null;
  const settings = await getSettings();
  const pub = lite ? { name: person.name } : { name: person.name, email: person.email, phone: person.phone, pref_series: person.pref_series, paused_until: person.paused_until, email_status: person.email_status, wa_optin: person.wa_optin, wa_stopped: person.wa_stopped };
  const wpub = w ? { slug: w.slug, title: w.title, subtitle: w.subtitle, starts_at: w.starts_at, format: w.format, products: w.products } : null;
  const log = (kind, data) => sb('interactions', { method: 'POST', body: { person_id: pid, webinar_slug: w ? w.slug : null, kind, data: data || null }, prefer: 'return=minimal' }).catch(() => {});
  switch (b.a) {
    case 'peek': return ok(res, { person: pub, webinar: wpub, settings: { whatsapp_channel_url: settings.whatsapp_channel_url || '', whatsapp_number: settings.whatsapp_number || '', bookings_url: settings.bookings_url || '' } });
    case 'register': {
      if (!w) return bad(res, 'Webinar not found', 404);
      if (!person.name && !b.name) return bad(res, 'Please tell us your name.');
      await log('register_click');
      return ok(res, await doRegister(w, person, { name: b.name || person.name, phone: b.phone, wa_optin: b.wa_optin, contact_ok: b.contact_ok, company: b.company, role: b.role, challenge: b.challenge, consent: true }, 'email', true));
    }
    case 'not_this_one': await log('not_this_one'); return ok(res, {});
    case 'topic': {
      const t = clean(b.text, 300); if (!t) return bad(res, 'Please write a topic.');
      await makeWarm(pid);
      await sb('topic_suggestions', { method: 'POST', body: { person_id: pid, text: t, from_webinar: w ? w.slug : null }, prefer: 'return=minimal' });
      return ok(res, {});
    }
    case 'talk': {
      if (b.phone && !normPhone(b.phone)) return bad(res, 'Please check the mobile number.');
      await makeWarm(pid);
      const r = await createLead({ ...person, name: b.name || person.name, company: b.company || person.company }, { how: b.how, phone: b.phone, interest: b.interest, note: b.note, slug: w ? w.slug : null }, settings);
      return ok(res, { duplicate: !!r.duplicate, bookings_url: settings.bookings_url || '' });
    }
    case 'wa': {
      const phone = normPhone(b.phone || person.phone);
      if (!phone) return bad(res, 'Please enter your WhatsApp number.');
      if (person.wa_stopped) return bad(res, 'You previously asked us to stop WhatsApp messages. Reply START to us on WhatsApp if you want them again.');
      const patch = { wa_optin: true, wa_optin_at: new Date().toISOString(), wa_optin_source: 'email', updated_at: new Date().toISOString() };
      if (!person.phone) { const [other] = await sb(`people?select=id&phone=eq.${phone}`); if (!other) patch.phone = phone; }
      await sb(`people?id=eq.${pid}`, { method: 'PATCH', body: patch, prefer: 'return=minimal' });
      if (w) await sb(`registrations?webinar_slug=eq.${encodeURIComponent(w.slug)}&person_id=eq.${pid}`, { method: 'PATCH', body: { wa_optin: true, phone }, prefer: 'return=minimal' }).catch(() => {});
      await log('wa_optin', { phone });
      await makeWarm(pid);
      return ok(res, { whatsapp_number: settings.whatsapp_number || '' });
    }
    case 'prefs': {
      const patch = { updated_at: new Date().toISOString() };
      if (['all', 'business', 'family'].includes(b.series)) patch.pref_series = b.series;
      if (b.pause_months !== undefined) { const m = Math.max(0, Math.min(+b.pause_months || 0, 12)); patch.paused_until = m ? new Date(Date.now() + m * 30 * 864e5).toISOString().slice(0, 10) : null; }
      if (b.email_off === true && person.email) { patch.email_status = 'unsubscribed'; await suppress(person.email, null, 'preference centre'); }
      if (b.email_off === false && ['unsubscribed', 'no_invites'].includes(person.email_status)) { patch.email_status = 'subscribed'; await sb(`suppression?hash=eq.${sha(person.email)}`, { method: 'DELETE', prefer: 'return=minimal' }).catch(() => {}); }
      if (b.wa_stop === true) { patch.wa_stopped = true; patch.wa_optin = false; if (person.phone) await suppress(null, person.phone, 'preference centre'); }
      await sb(`people?id=eq.${pid}`, { method: 'PATCH', body: patch, prefer: 'return=minimal' });
      await log('prefs', patch);
      return ok(res, {});
    }
    default: return bad(res, 'Unknown action');
  }
}

async function feedback(res, b) {
  const rid = +b.r;
  if (!checkTok('r', rid, b.t)) return bad(res, 'This link is not valid.', 403);
  const [reg] = await sb(`registrations?select=*&id=eq.${rid}`);
  if (!reg) return bad(res, 'Registration not found', 404);
  const [w] = await sb(`webinars?select=slug,title,products&slug=eq.${encodeURIComponent(reg.webinar_slug)}`);
  if (b.peek) return ok(res, { name: reg.name, title: w && w.title, done: !!reg.feedback_at });
  const rating = Math.max(1, Math.min(5, +b.rating || 0));
  if (!+b.rating) return bad(res, 'Please choose a rating.');
  await sb(`registrations?id=eq.${rid}`, { method: 'PATCH', body: { feedback_rating: rating, feedback_text: clean(b.text, 2000) || null, feedback_at: new Date().toISOString() }, prefer: 'return=minimal' });
  if (clean(b.topic, 300)) await sb('topic_suggestions', { method: 'POST', body: { person_id: reg.person_id, text: clean(b.topic, 300), from_webinar: reg.webinar_slug }, prefer: 'return=minimal' });
  let bookings = '';
  if ((b.how === 'call' || b.how === 'email') && reg.person_id) {
    const [person] = await sb(`people?select=*&id=eq.${reg.person_id}`);
    const settings = await getSettings(); bookings = settings.bookings_url || '';
    if (person) await createLead(person, { how: b.how, phone: b.phone, interest: (w && (w.products || []).map(p => p.name).join(', ')) || '', slug: reg.webinar_slug, note: clean(b.text, 500) }, settings).catch(() => {});
  }
  return ok(res, { bookings_url: bookings });
}


/* ---------- public topic suggestion (no email link needed) ---------- */
async function suggest(req, res) {
  const b = await readBody(req);
  if (b.website) return ok(res, {});
  const email = normEmail(b.email), name = clean(b.name, 120), text = clean(b.text, 300);
  if (!name || !validEmail(email) || !text) return bad(res, 'Please enter your name, email and a topic.');
  const person = await upsertPerson({ email, name, source: 'topic suggestion', status: 'no_invites' });
  if (b.consent && await optIn(person)) await makeWarm(person.id);
  await sb('topic_suggestions', { method: 'POST', body: { person_id: person.id, text }, prefer: 'return=minimal' });
  return ok(res, {});
}

/* ---------- recordings behind an email gate ---------- */
function youtubeId(u) { const m = String(u || '').match(/(?:youtu\.be\/|v=|embed\/|shorts\/|live\/)([\w-]{11})/); return m ? m[1] : null; }
async function watch(req, res) {
  const b = await readBody(req);
  const w = await getW(clean(b.slug, 120));
  if (!w || !w.recording_published || !w.recording_ref) return bad(res, 'This recording is not available yet.', 404);
  let person = null;
  let full = false;
  if (b.p && checkTok('p', +b.p, b.t)) { [person] = await sb(`people?select=*&id=eq.${+b.p}`); full = !!person; }
  else if (b.p && checkTok('w', +b.p, b.t)) [person] = await sb(`people?select=*&id=eq.${+b.p}`);
  if (!person) {
    const email = normEmail(b.email), name = clean(b.name, 120);
    if (!name || !validEmail(email)) return bad(res, 'Please enter your name and email to watch.');
    person = await upsertPerson({ email, name, company: b.company, source: 'recording', status: 'no_invites' });
    if (b.consent && await optIn(person)) await makeWarm(person.id);
  }
  await sb('interactions', { method: 'POST', body: { person_id: person.id, webinar_slug: w.slug, kind: 'watch' }, prefer: 'return=minimal' }).catch(() => {});
  let video = null;
  if (w.recording_kind === 'youtube') { const id = youtubeId(w.recording_ref); video = id ? { type: 'embed', url: `https://www.youtube-nocookie.com/embed/${id}?rel=0&modestbranding=1` } : { type: 'link', url: w.recording_ref }; }
  else if (w.recording_kind === 'storage') video = { type: 'file', url: await signedRead(w.recording_ref) };
  else video = { type: 'link', url: w.recording_ref };
  return ok(res, { title: w.title, subtitle: w.subtitle, starts_at: w.starts_at, products: w.products, summary: w.recording_summary, takeaways: w.recording_takeaways, chapters: w.recording_chapters,
    slides_url: w.slides_url || webinarFiles(w, 'after').deck, faq: ((await publicFaq())[w.topic_key || w.slug] || []).slice(0, 10), video, p: person.id, t: full ? tok('p', person.id) : tok('w', person.id), name: person.name }); // a typed email never gets a full personal token
}

async function cert(res, q) {
  const rid = +q.get('r');
  if (!checkTok('c', rid, q.get('t'))) return bad(res, 'This certificate link is not valid.', 403);
  const [reg] = await sb(`registrations?select=name,webinar_slug,attended,attended_minutes&id=eq.${rid}`);
  if (!reg || !reg.attended) return bad(res, 'No attendance found for this registration.', 404);
  const [w] = await sb(`webinars?select=title,subtitle,starts_at,speaker,cohost_name,cohost_confirmed&slug=eq.${encodeURIComponent(reg.webinar_slug)}`);
  if (!w) return bad(res, 'This webinar no longer exists.', 404);
  return ok(res, { name: reg.name, minutes: reg.attended_minutes, title: w.title, subtitle: w.subtitle, starts_at: w.starts_at, speaker: w.speaker, cohost: w.cohost_confirmed ? w.cohost_name : null, id: 'DD-' + reg.webinar_slug.slice(0, 6).toUpperCase() + '-' + rid });
}


/* ---------- v3: make warm, calendar feed, browser notifications ---------- */
async function makeWarm(pid) { if (pid) await sb(`people?id=eq.${pid}&kind=eq.cold`, { method: 'PATCH', body: { kind: 'warm', warm_at: new Date().toISOString(), updated_at: new Date().toISOString() }, prefer: 'return=minimal' }).catch(() => {}); }
function cors(res) { res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type'); }
async function feed(res) {
  const rows = await sb('webinars?select=slug,title,subtitle,starts_at,duration_min,status&status=eq.published&order=starts_at.asc');
  const ev = rows.map(w => ics(w, false)).filter(Boolean).map(x => x.split('\r\n').slice(4, -1).join('\r\n'));
  const body = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//DuaDesk//Webinars//EN', 'X-WR-CALNAME:DuaDesk Webinars', 'X-WR-TIMEZONE:Asia/Kolkata', 'REFRESH-INTERVAL;VALUE=DURATION:PT12H', 'X-PUBLISHED-TTL:PT12H', ...ev, 'END:VCALENDAR'].join('\r\n');
  res.statusCode = 200; res.setHeader('Content-Type', 'text/calendar; charset=utf-8'); res.setHeader('Cache-Control', 'public, s-maxage=600'); res.end(body);
}
async function pushKey(res) { const k = await vapidKeys(); return ok(res, { key: k.pub }); }
/* ---------- leads from the rest of duadesk.com (homepage demo form and Value Lab), so every enquiry is in one place ---------- */
function productName(p) {
  p = clean(p, 120); if (!p || /not sure/i.test(p)) return null;
  if (/saudi|zatca/i.test(p)) return 'AI CFO Saudi edition';
  if (/^AI CPO/i.test(p)) return 'AI CPO';
  return p.replace(/\s*\(.*\)\s*$/, '').replace(/\s+—.*$/, '').trim();
}
async function siteLead(req, res) {
  const b = await readBody(req);
  if (b.website) return ok(res, {}); // bots fill hidden fields
  const email = normEmail(b.email); if (!validEmail(email)) return bad(res, 'A valid email is needed.');
  const person = await upsertPerson({ email, name: b.name, phone: b.phone, company: /^not (applicable|provided)$/i.test(b.company || '') ? null : b.company, source: b.kind === 'value_lab' ? 'value lab' : 'demo request', status: 'no_invites' });
  await makeWarm(person.id);
  const interest = b.kind === 'value_lab' ? 'Value Lab (pricing)' : productName(b.product);
  const recent = await sb(`leads?select=id&email=eq.${encodeURIComponent(email)}&created_at=gte.${new Date(Date.now() - 7 * 864e5).toISOString()}`);
  if (recent.length) return ok(res, { duplicate: true });
  const note = [b.need && clean(b.need, 800), b.country && 'Country: ' + clean(b.country, 60), b.erp && !/not applicable/i.test(b.erp) && 'ERP: ' + clean(b.erp, 60),
    b.kind === 'value_lab' && [b.industry && 'Industry: ' + clean(b.industry, 60), b.turnover_cr && 'Turnover: ₹' + clean(b.turnover_cr, 20) + ' cr', b.erp && 'ERP: ' + clean(b.erp, 40)].filter(Boolean).join(' · ')].filter(Boolean).join('\n');
  await sb('leads', { method: 'POST', body: { person_id: person.id, name: clean(b.name, 120) || person.name || null, email, phone: b.phone ? normPhone(b.phone) : null, company: person.company || null, how: b.phone ? 'call' : 'email',
    interest, note: note || null, admin_notes: b.kind === 'value_lab' ? 'From the homepage Value Lab' : 'Homepage demo request' }, prefer: 'return=minimal' });
  return ok(res, {}); // no emails here: the homepage already notifies Ashish through Web3Forms
}
async function pushSubscribe(req, res) {
  const b = await readBody(req); const s = b.subscription || {};
  if (!pushHostOk(s.endpoint) || !s.keys || !/^[\w-]{20,200}$/.test(s.keys.p256dh || '') || !/^[\w-]{8,100}$/.test(s.keys.auth || '')) return bad(res, 'Invalid subscription');
  await sb('push_subs?on_conflict=endpoint', { method: 'POST', body: { endpoint: s.endpoint, p256dh: s.keys && s.keys.p256dh, auth: s.keys && s.keys.auth, active: true }, prefer: 'resolution=merge-duplicates,return=minimal' });
  return ok(res, {});
}
async function pushUnsubscribe(req, res) { const b = await readBody(req); if (b.endpoint) await sb(`push_subs?endpoint=eq.${encodeURIComponent(b.endpoint)}`, { method: 'PATCH', body: { active: false }, prefer: 'return=minimal' }); return ok(res, {}); }
async function pushLatest(res) {
  const s = await getSettings(); let m = null; try { m = JSON.parse(s.push_message || 'null'); } catch { }
  if (!m) { const [w] = await sb('webinars?select=slug,title,subtitle,starts_at&status=eq.published&starts_at=gte.' + new Date().toISOString() + '&order=starts_at.asc&limit=1'); if (w) m = { title: 'Free webinar: ' + w.title, body: whenIST(w.starts_at, w), url: '/webinars.html#' + w.slug }; }
  res.setHeader('Cache-Control', 'no-store'); return ok(res, { message: m });
}

function page(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title>
<style>body{margin:0;background:#06101c;color:#e8ecf3;font:16px/1.6 Inter,Arial,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:16px}main{max-width:520px;background:#0f1a2e;border:1px solid #23314d;border-radius:16px;padding:32px}h1{font-family:Georgia,serif;color:#f0d18a;margin:0 0 12px;font-size:26px}a{color:#f0d18a}</style></head><body><main>${body}</main></body></html>`;
}
async function unsubscribe(req, res, q) {
  let pid = +q.get('p'), t = q.get('t');
  if (req.method === 'POST' && (!pid || !t)) { const b = await readBody(req); pid = +b.p; t = b.t; }
  res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.setHeader('Cache-Control', 'no-store');
  if (!checkTok('p', pid, t)) { res.statusCode = 400; return res.end(page('Link not valid', '<h1>This link is not valid</h1><p>Please reply to any of our emails with “unsubscribe” and we will remove you.</p>')); }
  if (req.method !== 'POST') { // email security scanners open links in advance; a button makes sure a person decided
    res.statusCode = 200;
    return res.end(page('Unsubscribe', `<h1>Unsubscribe from DuaDesk webinar emails?</h1><form method="post" action="/api/webinars?action=unsubscribe&amp;p=${pid}&amp;t=${esc(t)}"><button type="submit" style="background:#d6ae55;color:#0b1424;border:0;border-radius:8px;padding:12px 20px;font-weight:bold;font-size:16px;cursor:pointer">Yes, unsubscribe me</button></form><p style="margin-top:18px">Prefer fewer emails instead? <a href="/webinar-respond.html?a=prefs&p=${pid}&t=${esc(t)}">Choose which invitations you get</a>.</p>`));
  }
  const [person] = await sb(`people?select=id,email&id=eq.${pid}`);
  if (person) {
    await sb(`people?id=eq.${pid}`, { method: 'PATCH', body: { email_status: 'unsubscribed', updated_at: new Date().toISOString() }, prefer: 'return=minimal' });
    if (person.email) await suppress(person.email, null, 'unsubscribe link');
    await sb('interactions', { method: 'POST', body: { person_id: pid, kind: 'unsubscribe' }, prefer: 'return=minimal' }).catch(() => {});
  }
  res.statusCode = 200;
  res.end(page('Unsubscribed', `<h1>You’re unsubscribed</h1><p>${esc(person && person.email || 'You')} will not receive DuaDesk webinar invitations again.</p><p>Prefer fewer emails instead? <a href="/webinar-respond.html?a=prefs&p=${pid}&t=${t}">Choose which invitations you get</a>.</p>`));
}

export default async function handler(req, res) {
  const q = new URL(req.url, 'http://x').searchParams;
  const action = q.get('action') || 'list';
  cors(res);
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  try {
    const LIMITS = { register: [600, 10], act: [600, 30], watch: [600, 10], suggest: [600, 5], push_subscribe: [600, 10], site_lead: [600, 5] };
    if (req.method === 'POST' && LIMITS[action] && !(await rateOk(req, 'pub-' + action, LIMITS[action][0], LIMITS[action][1])))
      return bad(res, 'Too many requests from your connection. Please try again in a few minutes.', 429);
    if (req.method === 'GET' && action === 'list') return await list(res);
    if (req.method === 'GET' && action === 'feed') return await feed(res);
    if (req.method === 'GET' && action === 'push_key') return await pushKey(res);
    if (req.method === 'GET' && action === 'push_latest') return await pushLatest(res);
    if (req.method === 'POST' && action === 'push_subscribe') return await pushSubscribe(req, res);
    if (req.method === 'POST' && action === 'push_unsubscribe') return await pushUnsubscribe(req, res);
    if (req.method === 'GET' && action === 'ics') return await icsFile(res, q.get('slug') || '');
    if (req.method === 'GET' && action === 'cert') return await cert(res, q);
    if (req.method === 'POST' && action === 'register') return await register(req, res);
    if (req.method === 'POST' && action === 'act') return await act(req, res);
    if (req.method === 'POST' && action === 'watch') return await watch(req, res);
    if (req.method === 'POST' && action === 'suggest') return await suggest(req, res);
    if (req.method === 'POST' && action === 'site_lead') return await siteLead(req, res);
    if (action === 'unsubscribe') return await unsubscribe(req, res, q);
    return bad(res, 'Unknown action', 404);
  } catch (e) {
    console.error('webinars', action, e);
    return send(res, e.status && e.status < 500 ? e.status : 500, { error: e.status && e.status < 500 ? e.message : 'Something went wrong. Please try again, or email ashish@ashishduacorporation.com.' });
  }
}
