/* Generated file: DuaDesk webinars (webinar-admin). Edit src/ and rebuild. */
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

async function storage(path, body) {
  const { SB_URL, SB_KEY } = ENV();
  const headers = { apikey: SB_KEY, 'Content-Type': 'application/json' };
  if (!SB_KEY.startsWith('sb_')) headers.Authorization = 'Bearer ' + SB_KEY;
  const res = await fetch(`${SB_URL}/storage/v1/${path}`, { method: 'POST', headers, body: JSON.stringify(body || {}) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || data.error || `Storage error ${res.status}`);
  return data;
}
async function signedUpload(objectPath) {
  const d = await storage(`object/upload/sign/recordings/${objectPath}`, {});
  return ENV().SB_URL + '/storage/v1' + (d.url.startsWith('/') ? d.url : '/' + d.url);
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
<p style="margin:0 0 4px;font-size:14px;color:#5a6478">Related DuaDesk product: ${prodHtml(w)}</p>
${chips(p.id, w, settings)}
<p style="margin:18px 0 0">Warm regards,<br><b>CA Ashish Dua</b><br>Founder, DuaDesk</p>`, p.id);
  const text = `${p.name ? 'Dear ' + first(p.name) + ',' : 'Hello,'}\n\nYou are invited: ${w.title} - ${w.subtitle || ''}\n${whenIST(w.starts_at, w)}, on Microsoft Teams (45 minutes).\n\n${w.summary || ''}\n\nRegister with one click: ${actUrl(p.id, w.slug, 'register')}\nNot this one: ${actUrl(p.id, w.slug, 'not_this_one')}\nSuggest a topic: ${actUrl(p.id, w.slug, 'topic')}\nTalk to us about DuaDesk: ${actUrl(p.id, w.slug, 'talk')}\n\nCA Ashish Dua, DuaDesk\n\nChoose your invitations: ${actUrl(p.id, null, 'prefs')}\nUnsubscribe from all: ${unsubUrl(p.id)}`;
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
${chips(pid, w, settings)}
<p style="margin:18px 0 0">Warm regards,<br><b>CA Ashish Dua</b></p>`, pid, 'You received this because you registered for this session.');
  return { subject: `${rt ? 'Request received' : 'You’re registered'}: ${w.title}`, html, text: `You are registered for ${w.title}, ${whenIST(w.starts_at, w)}.${link ? '\nJoin: ' + w.teams_link : '\nThe joining link will follow.'}\n\nCA Ashish Dua` };
}

function reminderEmail(w, reg, pid) {
  const html = shell(`<p style="margin:0 0 14px">Dear ${esc(first(reg.name) || 'friend')},</p>
<p style="margin:0 0 14px">A reminder that our session starts soon:</p>
${h1(w.title)}<p style="margin:0 0 20px"><b>${esc(whenIST(w.starts_at, w))}</b> · 45 minutes</p>
<p style="margin:0 0 20px">${btn(w.teams_link, 'Join on Microsoft Teams')}</p>
<p style="margin:0 0 14px;font-size:13px;color:#5a6478">If the button does not work, copy this link: ${esc(w.teams_link)}</p>
<p style="margin:0 0 14px;font-size:13px;color:#5a6478">Please join with the same name you registered with (${esc(reg.name || '')}), so we can send your attendance certificate.</p>
<p style="margin:18px 0 0">See you there,<br><b>CA Ashish Dua</b></p>`, pid, 'You received this because you registered for this session.');
  return { subject: `Starting soon: ${w.title}`, html, text: `Starting soon: ${w.title}, ${whenIST(w.starts_at, w)}.\nJoin: ${w.teams_link}\nPlease join with the same name you registered with, so we can send your attendance certificate.\n\nCA Ashish Dua` };
}

function followupEmail(w, reg, pid, attended, settings) {
  const html = shell(`<p style="margin:0 0 14px">Dear ${esc(first(reg.name) || 'friend')},</p>
<p style="margin:0 0 14px">${attended ? 'Thank you for joining' : 'We missed you at'} <b>${esc(w.title)}</b>. ${attended ? 'Here is everything from the session:' : 'The good news: the full recording is ready for you.'}</p>
<p style="margin:0 0 8px">${btn(watchUrl(w.slug, pid), 'Watch the recording')}${attended ? btn(certUrl(reg.id), 'Your attendance certificate', true) : ''}</p>
${attended ? `<p style="margin:10px 0 14px">Two minutes of your feedback helps me plan the next sessions: <a href="${esc(feedbackUrl(reg.id))}" style="color:#2563c9;font-weight:bold">Give feedback</a></p>` : ''}
<p style="margin:14px 0 6px">If you would like to explore ${esc(prodNames(w) || 'DuaDesk')} for your organisation, I would be happy to talk.</p>
${chips(pid, w, settings)}
<p style="margin:18px 0 0">Warm regards,<br><b>CA Ashish Dua</b></p>`, pid, 'You received this because you registered for this session.');
  return { subject: attended ? `Thank you for joining: ${w.title}` : `Recording ready: ${w.title}`, html, text: `${attended ? 'Thank you for joining' : 'We missed you at'} ${w.title}.\nWatch the recording: ${watchUrl(w.slug, pid)}\n${attended ? 'Feedback: ' + feedbackUrl(reg.id) + '\nCertificate: ' + certUrl(reg.id) : ''}\n\nCA Ashish Dua` };
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

/* ---- version 3 admin actions: import & validation, insights, daily plan, outreach, RocketReach, push, exports ---- */
const SECRET_KEYS = ['rocketreach_api_key', 'vapid_private_jwk'];
const todayIST = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
async function settingsSafe() { const s = await getSettings(); for (const k of SECRET_KEYS) if (s[k]) s[k] = k === 'rocketreach_api_key' ? '••••' + s[k].slice(-4) : '(set)'; return s; }
async function setSetting(key, value) { await sb('settings?on_conflict=key', { method: 'POST', body: [{ key, value: String(value) }], prefer: 'resolution=merge-duplicates,return=minimal' }); }

function cleanRow(r) {
  const pre = precheckEmail(r.email);
  const phone = normPhone(r.phone);
  const row = { email: pre.email, phone, name: clean(r.name, 120) || null, company: clean(r.company, 160) || null, role: clean(r.role, 120) || null,
    city: clean(r.city, 80) || null, state: clean(r.state, 80) || null, industry: clean(r.industry, 200) || null, turnover: clean(r.turnover, 60) || null,
    details: clean(r.details, 400) || null, website: clean(r.website, 200) || null, linkedin_url: /linkedin\.com\//i.test(r.linkedin_url || '') ? clean(r.linkedin_url, 200) : null,
    tags: String(r.tags || '').split(/[;,|]/).map(t => clean(t, 30).toLowerCase()).filter(Boolean), known: /^(y|yes|true|1|warm)$/i.test(String(r.known || '')), email_check: pre.check };
  if (row.email && pre.check === 'invalid') row.email = null; // keep the person (e.g. mobile) but drop a broken email
  row.segments = segmentsFor({ ...row, email: row.email });
  return row;
}

async function verifyEmails(limit) {
  const people = await sb(`people?select=id,email&email=not.is.null&email_check=is.null&order=id.asc&limit=${Math.max(1, Math.min(limit || 400, 1000))}`);
  if (!people.length) return { checked: 0, done: true };
  const map = await mxStatus(people.map(p => p.email.split('@')[1]));
  const ok = [], bad = [];
  for (const p of people) { const d = p.email.split('@')[1]; if (!(d in map)) continue; (map[d] ? ok : bad).push(p.id); }
  const now = new Date().toISOString();
  for (let i = 0; i < ok.length; i += 300) await sb(`people?id=in.(${ok.slice(i, i + 300).join(',')})`, { method: 'PATCH', body: { email_check: 'valid', email_checked_at: now }, prefer: 'return=minimal' });
  for (let i = 0; i < bad.length; i += 300) await sb(`people?id=in.(${bad.slice(i, i + 300).join(',')})`, { method: 'PATCH', body: { email_check: 'no_mx', email_checked_at: now }, prefer: 'return=minimal' });
  return { checked: ok.length + bad.length, valid: ok.length, no_mx: bad.length, done: false };
}

function activeDrip(w, now = Date.now()) {
  if (w.status !== 'published' || !w.drip_on || !w.starts_at) return null;
  const start = new Date(w.starts_at).getTime(), from = start - w.drip_start_days * 864e5, to = start - w.drip_end_days * 864e5;
  if (now < from || now > to) return null;
  return { daysLeft: Math.max(1, Math.ceil((to - now) / 864e5)) };
}
async function planToday() {
  const [webinars, s] = await Promise.all([sb('webinars?select=*&status=eq.published&order=starts_at.asc'), getSettings()]);
  let warmCap = +s.daily_warm_cap || 150, coldCap = +s.daily_cold_cap || 25;
  const start = new Date(todayIST() + 'T00:00:00+05:30').toISOString();
  const sentWarm = (await sb(`email_log?select=id&kind=eq.invite&status=eq.sent&created_at=gte.${start}`, { method: 'HEAD', count: true })).total || 0;
  const coldToday = (await sb(`outreach_queue?select=id&planned_for=eq.${todayIST()}&status=neq.skipped`, { method: 'HEAD', count: true })).total || 0;
  warmCap = Math.max(0, warmCap - sentWarm);
  const plan = [];
  for (const w of webinars) {
    const d = activeDrip(w); if (!d) continue;
    const [warmLeft, coldLeft] = await Promise.all([sb('rpc/warm_remaining', { method: 'POST', body: { p_slug: w.slug } }), w.format === 'roundtable' || !(w.target_segments || []).length ? 0 : sb('rpc/cold_remaining', { method: 'POST', body: { p_slug: w.slug } })]);
    const doneToday = (await sb(`email_log?select=id&webinar_slug=eq.${encodeURIComponent(w.slug)}&kind=eq.invite&status=eq.sent&created_at=gte.${start}`, { method: 'HEAD', count: true })).total || 0;
    const warmToday = Math.max(0, Math.min(warmCap, Math.ceil((warmLeft + doneToday) / d.daysLeft) - doneToday)); warmCap -= warmToday;
    plan.push({ slug: w.slug, title: w.title, starts_at: w.starts_at, days_left: d.daysLeft, warm_left: warmLeft, warm_sent_today: doneToday, warm_today: warmToday, cold_left: coldLeft, cold_today: 0 });
  }
  let coldRoom = Math.max(0, coldCap - coldToday);
  for (const p of plan) { if (!coldRoom) break; const n = Math.min(coldRoom, Math.ceil(p.cold_left / p.days_left), Math.max(5, Math.ceil(coldCap / Math.max(1, plan.length)))); p.cold_today = n; coldRoom -= n; }
  return { date: todayIST(), sent_warm_today: sentWarm, cold_planned_today: coldToday, plan, warm_mode: s.warm_mode || 'auto', cold_mode: s.cold_mode || 'approve', warm_approved: s.warm_approved_date === todayIST(), smtp: !!smtpConfig() };
}
async function sendWarm(plan, budgetMs) {
  const t0 = Date.now(); const settings = await getSettings(); let sent = 0;
  for (const p of plan.plan) {
    let left = p.warm_today;
    const w = await getW(p.slug);
    while (left > 0 && Date.now() - t0 < budgetMs) {
      const people = await sb('rpc/warm_batch', { method: 'POST', body: { p_slug: p.slug, p_limit: Math.min(100, left) } });
      if (!people.length) break;
      const r = await batchSend(w.slug, people.map(x => ({ ...x, pid: x.id })), 'invite', x => inviteEmail(w, x, settings));
      sent += r.sent; left -= people.length; if (r.failed) return { sent, error: r.error };
    }
  }
  return { sent };
}
async function draftCold(plan) {
  const s = await getSettings(); const sig = s.outreach_signature || 'Ashish Dua'; let made = 0;
  for (const p of plan.plan) {
    if (!p.cold_today) continue;
    const already = (await sb(`outreach_queue?select=id&webinar_slug=eq.${encodeURIComponent(p.slug)}&planned_for=eq.${todayIST()}`, { method: 'HEAD', count: true })).total || 0;
    const need = p.cold_today - already; if (need <= 0) continue;
    const w = await getW(p.slug);
    const people = await sb('rpc/cold_batch', { method: 'POST', body: { p_slug: p.slug, p_limit: need } });
    for (let i = 0; i < people.length; i += 15) {
      const part = people.slice(i, i + 15);
      const drafts = await aiDrafts(w, part, sig, x => actUrl(x.id, w.slug, 'register'), x => unsubUrl(x.id));
      const rows = drafts.map(d => ({ person_id: d.id, webinar_slug: w.slug, email: part.find(x => x.id === d.id).email, subject: d.subject, body: d.body, status: s.cold_mode === 'auto' ? 'approved' : 'draft', planned_for: todayIST() }));
      await sb('outreach_queue?on_conflict=person_id,webinar_slug', { method: 'POST', body: rows, prefer: 'resolution=ignore-duplicates,return=minimal' });
      made += rows.length;
    }
  }
  return made;
}
async function sendColdFew(n) {
  const cfg = smtpConfig(); if (!cfg) return { sent: 0, reason: 'Outreach mailbox not configured' };
  const q = await sb(`outreach_queue?select=*&status=eq.approved&planned_for=lte.${todayIST()}&order=id.asc&limit=${Math.max(1, Math.min(n, 10))}`);
  let sent = 0, failed = 0;
  for (const m of q) {
    const [p] = await sb(`people?select=id,email_status,cold_touches,kind&id=eq.${m.person_id}`);
    if (!p || p.email_status !== 'subscribed') { await sb(`outreach_queue?id=eq.${m.id}`, { method: 'PATCH', body: { status: 'skipped', error: 'unsubscribed' }, prefer: 'return=minimal' }); continue; }
    try {
      await smtpSend(cfg, { to: m.email, subject: m.subject, text: m.body, replyTo: cfg.from, headers: { 'List-Unsubscribe': `<${unsubUrl(m.person_id)}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } });
      const now = new Date().toISOString();
      await sb(`outreach_queue?id=eq.${m.id}`, { method: 'PATCH', body: { status: 'sent', sent_at: now }, prefer: 'return=minimal' });
      await sb(`people?id=eq.${m.person_id}`, { method: 'PATCH', body: { cold_touches: (p.cold_touches || 0) + 1, cold_last_at: now }, prefer: 'return=minimal' });
      sent++;
    } catch (e) {
      failed++;
      await sb(`outreach_queue?id=eq.${m.id}`, { method: 'PATCH', body: { status: 'failed', error: String(e.message).slice(0, 400) }, prefer: 'return=minimal' });
      if (/auth|535|534|credentials/i.test(e.message)) break;
    }
  }
  return { sent, failed };
}
async function pushAll(message) {
  const keys = await vapidKeys();
  if (message) await setSetting('push_message', JSON.stringify({ ...message, at: new Date().toISOString() }));
  const subs = await sbAll('push_subs?select=endpoint&active=is.true&order=endpoint');
  let ok = 0, gone = 0, i = 0;
  const worker = async () => { while (i < subs.length) { const s = subs[i++]; try { const st = await pushOne(s.endpoint, keys); if (st >= 200 && st < 300) ok++; else if (st === 404 || st === 410) { gone++; await sb(`push_subs?endpoint=eq.${encodeURIComponent(s.endpoint)}`, { method: 'PATCH', body: { active: false }, prefer: 'return=minimal' }); } } catch { } } };
  await Promise.all(Array.from({ length: Math.min(20, subs.length) }, worker));
  return { delivered: ok, removed: gone, total: subs.length };
}

/* ---------- RocketReach prospecting: search is free, reveal costs 1 credit and only happens for a chosen person ---------- */
async function rrSettings() { const s = await getSettings(); if (!s.rocketreach_api_key) throw E('Add your RocketReach API key in Settings first.'); return s; }
const rrLimit = s => (s.rocketreach_daily_limit === '' || s.rocketreach_daily_limit == null) ? 20 : Math.max(0, +s.rocketreach_daily_limit || 0);
async function rrUsedToday() { return (await sb(`interactions?select=id&kind=eq.rr_lookup&created_at=gte.${new Date(todayIST() + 'T00:00:00+05:30').toISOString()}`, { method: 'HEAD', count: true })).total || 0; }
async function rrRoom(s) { const room = rrLimit(s) - await rrUsedToday(); if (room <= 0) throw E(`Today's RocketReach limit (${rrLimit(s)} reveals) is used up. Change it in Settings.`); return room; }
// same company? exact key, or one name extends the other (only when the shorter name has at least two words)
function sameCompany(rrCompany, key) {
  const k2 = companyKey(rrCompany); if (!k2 || !key) return false;
  if (k2 === key) return true;
  const [short, long] = k2.length < key.length ? [k2, key] : [key, k2];
  return short.split(' ').length >= 2 && long.startsWith(short + ' ');
}
async function saveProspects(list) {
  if (!list.length) return 0;
  const li = list.map(p => p.linkedin_url).filter(Boolean);
  const known = new Set();
  for (let i = 0; i < li.length; i += 50) (await sb(`people?select=linkedin_url&linkedin_url=in.(${li.slice(i, i + 50).map(u => '"' + u.replace(/"/g, '') + '"').join(',')})`)).forEach(r => known.add(r.linkedin_url));
  const rows = list.filter(p => !(p.linkedin_url && known.has(p.linkedin_url))).map(p => ({ rr_id: p.rr_id, name: clean(p.name, 120) || null, title: clean(p.title, 160) || null, company: clean(p.company, 160) || null,
    location: clean(p.location, 120) || null, linkedin_url: p.linkedin_url ? clean(p.linkedin_url, 200) : null, industry: p.industry || null, city: p.city || null,
    segments: [...new Set([...(p.segments || []).filter(x => !x.startsWith('role:')), ...segmentsFor({ role: p.title, company: p.company, city: p.city || p.location })])],
    webinar_slug: p.webinar_slug, found_by: p.found_by }));
  if (!rows.length) return 0;
  const ins = await sb('rr_prospects?on_conflict=rr_id', { method: 'POST', body: rows, prefer: 'resolution=ignore-duplicates,return=representation' });
  return ins.length;
}
async function rrSearchCompanies(w, s, n, budgetMs) {
  const key = s.rocketreach_api_key, plan = rrPlanFor(w), roles = plan.group.split('+'), t0 = Date.now();
  const cos = await sb('rpc/rr_company_candidates', { method: 'POST', body: { p_slug: w.slug, p_group: plan.group, p_roles: roles, p_limit: n } });
  let searched = 0, found = 0, saved = 0; const notes = [];
  for (const c of cos) {
    if (Date.now() - t0 > budgetMs) break;
    const name = searchName(c.company);
    let res = rrProfiles(await rrReq(key, 'search', { body: { query: { current_employer: ['"' + name + '"'], current_title: plan.titles }, order_by: 'popularity', page_size: 5, start: 1 } }));
    if (!res.length) res = rrProfiles(await rrReq(key, 'search', { body: { query: { current_employer: [name], current_title: plan.titles }, order_by: 'popularity', page_size: 10, start: 1 } }));
    const mine = res.map(rrPerson).filter(p => sameCompany(p.company, c.company_key)).slice(0, 2); // never trust a "similar" company
    saved += await saveProspects(mine.map(p => ({ ...p, industry: c.industry, city: c.city, segments: c.segments, webinar_slug: w.slug, found_by: 'my companies' })));
    await sb('rr_searched?on_conflict=key', { method: 'POST', body: [{ key: `co|${c.company_key}|${plan.group}`, found: mine.length, searched_at: new Date().toISOString() }], prefer: 'resolution=merge-duplicates,return=minimal' });
    searched++; found += mine.length;
  }
  if (searched < cos.length) notes.push('Stopped early to stay within the time limit; press Search again to continue.');
  return { mode: 'my companies', searched, found, new_prospects: saved, notes, credits_used: 0 };
}
async function rrSearchOpen(w, s, b) {
  const key = s.rocketreach_api_key, plan = rrPlanFor(w);
  const list = (v, d) => { const a = (Array.isArray(v) ? v : String(v || '').split(/[,;\n]/)).map(x => clean(x, 80)).filter(Boolean); return a.length ? a.slice(0, 15) : d; };
  const titles = list(b.titles, plan.titles), places = list(b.places, plan.places), industries = b.industries === undefined ? plan.industries : list(b.industries, []);
  const qkey = 'open|' + sha(JSON.stringify([titles, places, industries])).slice(0, 32);
  const [prev] = await sb(`rr_searched?select=*&key=eq.${qkey}`);
  let start = prev && prev.next_start ? prev.next_start : 1, notes = [];
  if (start > 10000) return { mode: 'open search', found: 0, new_prospects: 0, notes: ['All results for this search have been seen. Change the titles, places or industries.'], credits_used: 0 };
  const query = { current_title: titles, location: places }; if (industries.length) query.company_industry = industries;
  let data;
  try { data = await rrReq(key, 'search', { body: { query, order_by: 'popularity', page_size: 25, start } }); }
  catch (e) { if (e.rr === 400 && industries.length) { delete query.company_industry; notes.push('RocketReach did not accept the industry filter, so this search used titles and places only.'); data = await rrReq(key, 'search', { body: { query, order_by: 'popularity', page_size: 25, start } }); } else throw e; }
  const people = rrProfiles(data).map(rrPerson);
  const indSegs = query.company_industry ? plan.labels.filter(x => x.startsWith('ind:')) : [];
  const saved = await saveProspects(people.map(p => ({ ...p, segments: indSegs, webinar_slug: w.slug, found_by: 'open search' })));
  const pg = data.pagination || {}; const next = pg.next || start + 25;
  await sb('rr_searched?on_conflict=key', { method: 'POST', body: [{ key: qkey, found: ((prev && prev.found) || 0) + people.length, next_start: people.length ? next : 10001, searched_at: new Date().toISOString() }], prefer: 'resolution=merge-duplicates,return=minimal' });
  return { mode: 'open search', found: people.length, new_prospects: saved, total: pg.total ?? null, notes, credits_used: 0, query: { titles, places, industries: query.company_industry || [] } };
}
async function rrRevealProspects(ids, s, budgetMs) {
  const key = s.rocketreach_api_key; let room = await rrRoom(s); const t0 = Date.now();
  const rows = ids.length ? await sb(`rr_prospects?select=*&id=in.(${ids.join(',')})&status=eq.found&order=id.asc`) : [];
  const out = { revealed: 0, added: 0, no_email: 0, duplicate: 0, blocked: 0, left_for_later: 0, errors: [] };
  for (const p of rows) {
    if (room <= 0 || Date.now() - t0 > budgetMs) { out.left_for_later++; continue; }
    try {
      const r = await rrReveal(key, { id: p.rr_id }); room--; out.revealed++;
      await sb('interactions', { method: 'POST', body: { kind: 'rr_lookup', webinar_slug: p.webinar_slug, data: { prospect: p.id, status: r && r.status } }, prefer: 'return=minimal' });
      const best = rrBest(r, { personal: false }); const now = new Date().toISOString();
      if (!best.email) { out.no_email++; await sb(`rr_prospects?id=eq.${p.id}`, { method: 'PATCH', body: { status: 'no_email', revealed_at: now, error: 'no work email with grade A or A-' }, prefer: 'return=minimal' }); continue; }
      const [existing] = await sb(`people?select=id&email=eq.${encodeURIComponent(best.email)}`);
      if (existing) { out.duplicate++; await sb(`rr_prospects?id=eq.${p.id}`, { method: 'PATCH', body: { status: 'duplicate', person_id: existing.id, email: best.email, grade: best.grade, revealed_at: now }, prefer: 'return=minimal' }); continue; }
      const row = cleanRow({ email: best.email, phone: best.phone, name: p.name, company: p.company, role: best.title || p.title, city: p.city || (p.location || '').split(',')[0], industry: p.industry,
        linkedin_url: best.linkedin || p.linkedin_url, tags: ['rocketreach', p.webinar_slug].filter(Boolean).join(',') });
      row.segments = [...new Set([...row.segments, ...(p.segments || [])])]; row.email_check = 'valid';
      const res = await sb('rpc/import_people2', { method: 'POST', body: { p_rows: [row], p_source: 'RocketReach', p_tags: [], p_kind: 'cold' } });
      const [person] = await sb(`people?select=id,email_status&email=eq.${encodeURIComponent(best.email)}`);
      if (person) await sb(`people?id=eq.${person.id}`, { method: 'PATCH', body: { rr_enriched_at: now, email_checked_at: now }, prefer: 'return=minimal' });
      const blocked = res.blocked > 0 || (person && person.email_status !== 'subscribed');
      if (blocked) out.blocked++; else out.added++;
      await sb(`rr_prospects?id=eq.${p.id}`, { method: 'PATCH', body: { status: blocked ? 'skipped' : 'added', person_id: person ? person.id : null, email: best.email, grade: best.grade, revealed_at: now, error: blocked ? 'unsubscribed earlier: kept blocked' : null }, prefer: 'return=minimal' });
    } catch (e) { out.errors.push(e.message); if (e.status === 400 || e.status === 429) break; }
  }
  out.remaining_today = Math.max(0, room);
  return out;
}
// automatic mode (Settings): once a day, for webinars being invited now whose cold pool is running low
async function rrAuto(s) {
  const plan = await planToday(); let budget = Math.min(+s.rocketreach_auto_daily || 5, Math.max(0, rrLimit(s) - await rrUsedToday()));
  const out = []; const t0 = Date.now();
  for (const p of plan.plan) {
    if (budget <= 0 || Date.now() - t0 > 40000) break;
    const w = await getW(p.slug); if (w.format === 'roundtable' || !(w.target_segments || []).length) continue;
    if (p.cold_left >= Math.max(10, p.days_left * Math.max(1, p.cold_today))) continue; // enough people already
    let ready = await sb(`rr_prospects?select=id&webinar_slug=eq.${encodeURIComponent(w.slug)}&status=eq.found&order=id.asc&limit=${budget}`);
    let searched = null;
    if (ready.length < budget) { searched = await rrSearchCompanies(w, s, 6, 15000); ready = await sb(`rr_prospects?select=id&webinar_slug=eq.${encodeURIComponent(w.slug)}&status=eq.found&order=id.asc&limit=${budget}`); }
    const r = ready.length ? await rrRevealProspects(ready.map(x => x.id), s, 20000) : { revealed: 0, added: 0 };
    budget -= r.revealed; out.push({ slug: w.slug, searched: searched && searched.searched, revealed: r.revealed, added: r.added });
  }
  return out;
}

const actions3 = {
  async import_people(b) {
    const kind = b.kind === 'cold' ? 'cold' : 'warm';
    const src = clean(b.source || 'import', 60), tags = (b.tags || []).map(t => clean(t, 30).toLowerCase()).filter(Boolean);
    const seenE = new Set(), seenP = new Set(), rows = []; let invalid = 0, dup = 0, badEmail = 0;
    for (const raw of (b.rows || []).slice(0, 2000)) {
      const r = cleanRow({ ...raw, known: raw.known || (b.known ? 'yes' : '') });
      if (raw.email && !r.email) badEmail++;
      if (!r.email && !r.phone) { invalid++; continue; }
      if ((r.email && seenE.has(r.email)) || (!r.email && seenP.has(r.phone))) { dup++; continue; }
      if (r.email) seenE.add(r.email); if (r.phone) seenP.add(r.phone);
      rows.push(r);
    }
    const out = rows.length ? await sb('rpc/import_people2', { method: 'POST', body: { p_rows: rows, p_source: src, p_tags: tags, p_kind: kind } }) : { added: 0, merged: 0, blocked: 0 };
    return { received: (b.rows || []).length, invalid, invalid_emails_dropped: badEmail, duplicates_in_file: dup, ...out };
  },
  async verify_emails(b) { return verifyEmails(b.limit || 400); },
  async insights() {
    const [ins, webinars] = await Promise.all([sb('rpc/insights', { method: 'POST', body: {} }), sb('webinars?select=slug,title,starts_at,status,format,series,target_segments,drip_on,drip_start_days,drip_end_days&status=in.(published,later,draft)&order=starts_at.asc.nullslast')]);
    const aud = [];
    for (const w of webinars.filter(x => x.status === 'published')) {
      const [warm, cold, invited] = await Promise.all([sb('rpc/warm_remaining', { method: 'POST', body: { p_slug: w.slug } }), (w.target_segments || []).length && w.format !== 'roundtable' ? sb('rpc/cold_remaining', { method: 'POST', body: { p_slug: w.slug } }) : 0,
        sb(`email_log?select=id&webinar_slug=eq.${encodeURIComponent(w.slug)}&kind=eq.invite&status=eq.sent`, { method: 'HEAD', count: true })]);
      aud.push({ ...w, warm_left: warm, cold_left: cold, invited: invited.total || 0, drip: activeDrip(w) });
    }
    return { ...ins, webinars: aud };
  },
  async today() {
    const plan = await planToday();
    const q = await sb(`outreach_queue?select=id,webinar_slug,email,subject,body,status,error,planned_for,people(name,company,role,industry,city)&planned_for=eq.${todayIST()}&order=id.asc&limit=500`);
    return { ...plan, outreach: q };
  },
  async today_draft() { const plan = await planToday(); return { drafted: await draftCold(plan) }; },
  async today_send_warm() { const plan = await planToday(); const r = await sendWarm(plan, 45000); if (plan.warm_mode === 'approve') await setSetting('warm_approved_date', todayIST()); return r; },
  async outreach_update(b) {
    const f = b.fields || {}, patch = {};
    if (f.subject) patch.subject = clean(f.subject, 150); if (f.body) patch.body = String(f.body).slice(0, 6000);
    if (f.status && ['draft', 'approved', 'skipped'].includes(f.status)) patch.status = f.status;
    const ids = (b.ids || [b.id]).map(Number).filter(Boolean);
    await sb(`outreach_queue?id=in.(${ids.join(',')})&status=in.(draft,approved,skipped,failed)`, { method: 'PATCH', body: patch, prefer: 'return=minimal' });
    return { ok: true };
  },
  async outreach_send_now(b) { return sendColdFew(b.n || 3); },
  async outreach_history(b) { return { rows: await sb(`outreach_queue?select=id,webinar_slug,email,subject,status,sent_at,error,planned_for,people(name,company)&order=id.desc&limit=${Math.min(+b.limit || 300, 2000)}`) }; },

  async rocketreach_test() {
    const s = await rrSettings();
    const a = await rrReq(s.rocketreach_api_key, 'account');
    const used = await rrUsedToday();
    return { ok: true, account: { name: a.first_name ? a.first_name + ' ' + (a.last_name || '') : a.email || 'connected', lookups: a.lookup_credit_balance ?? a.lookups_remaining ?? a.credits_remaining ?? null }, used_today: used, limit: rrLimit(s) };
  },
  // fill a missing or bad email for people already in your data: search (free) -> confident match -> reveal (1 credit)
  async rocketreach_enrich(b) {
    const s = await rrSettings(); const key = s.rocketreach_api_key;
    let room = await rrRoom(s);
    const ids = (b.ids || []).map(Number).filter(Boolean).slice(0, 10);
    const people = ids.length ? await sb(`people?select=*&id=in.(${ids.join(',')})`) : [];
    const results = [];
    for (const p of people) {
      if (room <= 0) { results.push({ id: p.id, status: `today's RocketReach limit is used up` }); continue; }
      try {
        let r;
        if (p.linkedin_url) r = await rrReveal(key, { linkedin_url: p.linkedin_url });
        else if (p.name && p.company) {
          const nm = String(p.name).replace(/^(mr|mrs|ms|dr|shri|smt|sh|ca|er)\.?\s+/i, '').trim();
          const found = rrProfiles(await rrReq(key, 'search', { body: { query: { name: ['"' + nm + '"'], current_employer: [searchName(p.company)] }, order_by: 'popularity', page_size: 5, start: 1 } })).map(rrPerson);
          const m = found.find(x => sameCompany(x.company, p.company_key || companyKey(p.company)));
          if (!m) { results.push({ id: p.id, status: 'no confident match in RocketReach (no credit used)' }); continue; }
          r = await rrReveal(key, { id: m.rr_id });
        } else { results.push({ id: p.id, status: 'needs name + company, or a LinkedIn link' }); continue; }
        room--;
        await sb('interactions', { method: 'POST', body: { person_id: p.id, kind: 'rr_lookup', data: { status: r && r.status, for: 'enrich' } }, prefer: 'return=minimal' });
        const best = rrBest(r || {}); const patch = { rr_enriched_at: new Date().toISOString() };
        if (best.email && (!p.email || ['no_mx', 'invalid'].includes(p.email_check))) {
          const [taken] = await sb(`people?select=id&email=eq.${encodeURIComponent(best.email)}`);
          if (!taken) { patch.email = best.email; patch.email_check = 'valid'; patch.email_checked_at = new Date().toISOString(); }
        }
        if (best.phone && !p.phone) { const ph = normPhone(best.phone); if (ph) { const [t2] = await sb(`people?select=id&phone=eq.${ph}`); if (!t2) patch.phone = ph; } }
        if (best.title && best.title !== p.role) patch.role = clean(best.title, 120); // RocketReach has the current title
        if (best.linkedin && !p.linkedin_url) patch.linkedin_url = best.linkedin;
        if (patch.role) patch.segments = [...new Set([...(p.segments || []).filter(x => !x.startsWith('role:')), ...segmentsFor({ ...p, role: patch.role })])];
        await sb(`people?id=eq.${p.id}`, { method: 'PATCH', body: patch, prefer: 'return=minimal' });
        results.push({ id: p.id, status: best.email ? `found ${best.email} (grade ${best.grade})` : 'no reliable email found (grade below A-)' });
      } catch (e) { results.push({ id: p.id, status: e.message }); if (e.status === 400 || e.status === 429) break; }
    }
    return { results, remaining_today: Math.max(0, room) };
  },

  /* ---- prospecting: find NEW people for a webinar ---- */
  async rr_prospect_plan(b) {
    const s = await getSettings(); const w = await getW(b.slug); const plan = rrPlanFor(w);
    const [cos, waiting, added, used] = await Promise.all([
      sb('rpc/rr_company_candidates', { method: 'POST', body: { p_slug: w.slug, p_group: plan.group, p_roles: plan.group.split('+'), p_limit: 200 } }),
      sb(`rr_prospects?select=id&webinar_slug=eq.${encodeURIComponent(w.slug)}&status=eq.found`, { method: 'HEAD', count: true }),
      sb(`rr_prospects?select=id&webinar_slug=eq.${encodeURIComponent(w.slug)}&status=eq.added`, { method: 'HEAD', count: true }),
      rrUsedToday()]);
    return { webinar: { slug: w.slug, title: w.title, starts_at: w.starts_at, target_segments: w.target_segments || [] }, plan, companies_waiting: cos.length, companies_sample: cos.slice(0, 8).map(c => c.company),
      found_waiting: waiting.total || 0, added: added.total || 0, connected: !!s.rocketreach_api_key, used_today: used, limit: rrLimit(s), mode: s.rocketreach_mode || 'approve' };
  },
  async rr_search(b) {
    const s = await rrSettings(); const w = await getW(b.slug);
    return b.mode === 'open' ? rrSearchOpen(w, s, b) : rrSearchCompanies(w, s, Math.max(1, Math.min(+b.n || 10, 25)), 45000);
  },
  async rr_prospects(b) {
    const st = ['found', 'added', 'no_email', 'duplicate', 'skipped'].includes(b.status) ? b.status : 'found';
    return { rows: await sb(`rr_prospects?select=id,name,title,company,location,city,linkedin_url,found_by,status,email,grade,error,person_id,created_at&webinar_slug=eq.${encodeURIComponent(b.slug || '')}&status=eq.${st}&order=id.asc&limit=500`) };
  },
  async rr_reveal(b) { const s = await rrSettings(); return rrRevealProspects((b.ids || []).map(Number).filter(Boolean), s, 50000); },
  async rr_prospect_skip(b) {
    const ids = (b.ids || []).map(Number).filter(Boolean); if (!ids.length) return { ok: true };
    await sb(`rr_prospects?id=in.(${ids.join(',')})&status=eq.found`, { method: 'PATCH', body: { status: 'skipped' }, prefer: 'return=minimal' }); return { ok: true };
  },
  async linkedin_companies(b) {
    const w = await getW(b.slug);
    const rows = await sb('rpc/linkedin_companies', { method: 'POST', body: { p_slug: w.slug } });
    return { companies: rows.map(r => { const dom = r.email && r.email.split('@')[1]; const site = (r.website || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      return { companyname: r.company, companywebsite: site || (dom && !isFreeDomain(dom) ? dom : ''), companyemaildomain: dom && !isFreeDomain(dom) ? dom : '', city: r.city || '', state: r.state || '', companycountry: 'IN' }; }) };
  },
  async push_send(b) {
    const w = b.slug ? await getW(b.slug) : null;
    const msg = w ? { title: 'Free webinar: ' + w.title, body: whenIST(w.starts_at, w) + (w.subtitle ? ' · ' + w.subtitle : ''), url: '/webinars.html#' + w.slug } : { title: clean(b.title, 80), body: clean(b.body, 180), url: clean(b.url || '/webinars.html', 200) };
    if (!msg.title) throw E('Nothing to send');
    return pushAll(msg);
  },
  async push_stats() { return { subscribers: (await sb('push_subs?select=endpoint&active=is.true', { method: 'HEAD', count: true })).total || 0 }; },
};

/* ---------- the scheduled job (called by Supabase pg_cron every 10 minutes, 9:30 AM–2:30 PM IST) ---------- */
async function cronRun() {
  const s = await getSettings(); const out = { date: todayIST() };
  const first = s.last_plan_date !== todayIST();
  if (first) {
    await setSetting('last_plan_date', todayIST());
    const plan = await planToday();
    out.drafted = await draftCold(plan);
    if (plan.warm_mode === 'auto') out.warm = await sendWarm(plan, 35000);
    // day-of browser reminder
    const today = (await sb('webinars?select=slug,title,subtitle,starts_at&status=eq.published')).filter(w => w.starts_at && new Date(w.starts_at).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) === todayIST());
    if (today[0]) out.push = await pushAll({ title: 'Today: ' + today[0].title, body: whenIST(today[0].starts_at, today[0]), url: '/webinars.html#' + today[0].slug });
  } else if (s.warm_mode === 'auto' || s.warm_approved_date === todayIST()) {
    const plan = await planToday(); if (plan.plan.some(p => p.warm_today > 0)) out.warm = await sendWarm(plan, 35000);
  }
  if (!first && !out.warm && s.rocketreach_mode === 'auto' && s.rocketreach_api_key && s.rr_auto_date !== todayIST()) { // a later run, so it never competes with the morning work
    await setSetting('rr_auto_date', todayIST());
    try { out.rocketreach = await rrAuto(s); } catch (e) { out.rocketreach = { error: e.message }; }
  }
  out.cold = await sendColdFew(3);
  try { const t = await teamsAutoAttendance(); if (t && t.length) out.teams = t; } catch (e) { out.teams = { error: e.message }; }
  out.verify = await verifyEmails(300);
  return out;
}

/* ---- version 3.2 admin: Microsoft Teams link-up (Microsoft Graph) and the dashboard ---- */

/* ---------- Microsoft Graph (app-only sign-in with a client secret) ---------- */
const MS = () => ({ tenant: process.env.MS_TENANT_ID || '', client: process.env.MS_CLIENT_ID || '', secret: process.env.MS_CLIENT_SECRET || '', organizer: process.env.MS_ORGANIZER_ID || '',
  login: process.env.MS_LOGIN_BASE || 'https://login.microsoftonline.com', graph: process.env.MS_GRAPH_BASE || 'https://graph.microsoft.com/v1.0' });
const teamsReady = () => { const m = MS(); return !!(m.tenant && m.client && m.secret && m.organizer); };
let msToken = { value: '', exp: 0 };
async function graphToken() {
  const m = MS(); if (!teamsReady()) throw E('Microsoft Teams is not connected yet (MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, MS_ORGANIZER_ID in Vercel).', 503);
  if (msToken.value && Date.now() < msToken.exp - 60000) return msToken.value;
  const res = await fetch(`${m.login}/${encodeURIComponent(m.tenant)}/oauth2/v2.0/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: m.client, client_secret: m.secret, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' }).toString(), signal: AbortSignal.timeout(15000) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) throw E('Microsoft sign-in failed: ' + (j.error_description || j.error || res.status).toString().split('\r\n')[0].slice(0, 200) + ' Check MS_TENANT_ID, MS_CLIENT_ID and MS_CLIENT_SECRET (secrets expire; create a new one if needed).', 502);
  msToken = { value: j.access_token, exp: Date.now() + (+j.expires_in || 3600) * 1000 };
  return msToken.value;
}
async function graph(path, { method = 'GET', body, accept, raw } = {}) {
  const m = MS(); const url = path.startsWith('https://') ? path : m.graph + path;
  const res = await fetch(url, { method, headers: { Authorization: 'Bearer ' + await graphToken(), ...(body ? { 'content-type': 'application/json' } : {}), ...(accept ? { Accept: accept } : {}) },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(25000) });
  if (raw && res.ok) return res.text();
  const j = res.status === 204 ? {} : await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (j.error && j.error.message) || res.status;
    let hint = '';
    if (/application access policy/i.test(msg)) hint = ' Run the two Teams PowerShell commands from the setup guide (Step 9), then wait 30 minutes.';
    else if (res.status === 403) hint = ' Check that the app has the Microsoft Graph permissions from the setup guide and that an admin granted consent.';
    else if (/transcript/i.test(msg) && /disabled|not allowed/i.test(msg)) hint = ' Turn on Microsoft Graph access to transcripts in the Teams admin centre, or upload the transcript file instead.';
    throw Object.assign(new Error('Microsoft Teams: ' + String(msg).slice(0, 300) + hint), { status: res.status === 404 ? 404 : 502, graph: res.status });
  }
  return j;
}
const utc = d => new Date(d).toISOString().slice(0, 19);
// the co-host and facilitator get the Outlook/Teams invitation directly from your calendar
const speakers = w => [[w.cohost_email, w.cohost_name], [w.facilitator_email, w.facilitator_name]].filter(([e]) => e).map(([e, n]) => ({ emailAddress: { address: e, name: n || e }, type: 'required' }));
async function meetingIdFor(w) {
  if (w.teams_meeting_id) return w.teams_meeting_id;
  if (!w.teams_link) throw E('This webinar has no Teams link yet.');
  const m = MS();
  const r = await graph(`/users/${encodeURIComponent(m.organizer)}/onlineMeetings?$filter=${encodeURIComponent(`JoinWebUrl eq '${w.teams_link}'`)}`);
  const id = r.value && r.value[0] && r.value[0].id;
  if (!id) throw E('Could not find this Teams meeting in your account. It must be organised by the Teams account in MS_ORGANIZER_ID.', 404);
  await sb(`webinars?slug=eq.${encodeURIComponent(w.slug)}`, { method: 'PATCH', body: { teams_meeting_id: id }, prefer: 'return=minimal' });
  return id;
}
async function teamsCreate(w) {
  const m = MS(); if (!w.starts_at) throw E('Set the date and time first.');
  if (w.teams_link) throw E('This webinar already has a Teams link. Clear it first if you want a new meeting.');
  const end = new Date(new Date(w.starts_at).getTime() + (+w.duration_min || 45) * 60000 + 15 * 60000); // 15 minutes spare for questions
  const ev = await graph(`/users/${encodeURIComponent(m.organizer)}/events`, { method: 'POST', body: {
    subject: 'DuaDesk webinar: ' + w.title, body: { contentType: 'HTML', content: `<p>${esc(w.subtitle || '')}</p><p>${esc(w.summary || '')}</p><p>Registrations are managed on duadesk.com.</p>` },
    start: { dateTime: utc(w.starts_at), timeZone: 'UTC' }, end: { dateTime: utc(end), timeZone: 'UTC' },
    attendees: speakers(w), isOnlineMeeting: true, onlineMeetingProvider: 'teamsForBusiness', allowNewTimeProposals: false, isReminderOn: true, reminderMinutesBeforeStart: 30, showAs: 'busy' } });
  const join = ev.onlineMeeting && ev.onlineMeeting.joinUrl;
  if (!join) throw E('Teams did not return a joining link. Check that Teams meetings are enabled for your account.', 502);
  const patch = { teams_link: join, teams_event_id: ev.id };
  const notes = [];
  try {
    const mid = (await graph(`/users/${encodeURIComponent(m.organizer)}/onlineMeetings?$filter=${encodeURIComponent(`JoinWebUrl eq '${join}'`)}`)).value[0].id;
    patch.teams_meeting_id = mid;
    // webinar-style options: guests skip the lobby, only you present, attendees join muted with camera off, recording and transcript start automatically
    await graph(`/users/${encodeURIComponent(m.organizer)}/onlineMeetings/${encodeURIComponent(mid)}`, { method: 'PATCH', body: {
      lobbyBypassSettings: { scope: 'everyone', isDialInBypassEnabled: true }, allowedPresenters: 'organizer', allowAttendeeToEnableMic: false, allowAttendeeToEnableCamera: false,
      allowMeetingChat: 'enabled', isEntryExitAnnounced: false, recordAutomatically: true, allowTranscription: true } });
  } catch (e) { notes.push('Meeting created, but its options could not be set automatically (' + e.message.replace(/^Microsoft Teams: /, '') + '). Set them in Teams → Meeting options if needed.'); }
  await sb(`webinars?slug=eq.${encodeURIComponent(w.slug)}`, { method: 'PATCH', body: patch, prefer: 'return=minimal' });
  return { teams_link: join, notes };
}
// keep the calendar event in step when the date, time or title changes
async function teamsSync(before, after) {
  if (!teamsReady() || !before.teams_event_id) return null;
  const timeChanged = before.starts_at !== after.starts_at || before.title !== after.title || before.duration_min !== after.duration_min;
  const peopleChanged = JSON.stringify(speakers(before)) !== JSON.stringify(speakers(after));
  if (!timeChanged && !peopleChanged) return null;
  try {
    const m = MS(); const end = new Date(new Date(after.starts_at).getTime() + (+after.duration_min || 45) * 60000 + 15 * 60000);
    const body = timeChanged ? { subject: 'DuaDesk webinar: ' + after.title, start: { dateTime: utc(after.starts_at), timeZone: 'UTC' }, end: { dateTime: utc(end), timeZone: 'UTC' } } : {};
    if (peopleChanged) body.attendees = speakers(after);
    await graph(`/users/${encodeURIComponent(m.organizer)}/events/${encodeURIComponent(before.teams_event_id)}`, { method: 'PATCH', body });
    return [timeChanged && 'Teams meeting moved to the new time. The joining link stays the same.', peopleChanged && 'Co-host and facilitator invitations updated in Teams.'].filter(Boolean).join(' ');
  } catch (e) { return 'Could not update the Teams meeting: ' + e.message; }
}
async function teamsAttendanceRows(w) {
  const m = MS(); const mid = await meetingIdFor(w);
  const base = `/users/${encodeURIComponent(m.organizer)}/onlineMeetings/${encodeURIComponent(mid)}/attendanceReports`;
  const reports = (await graph(base)).value || [];
  const by = new Map();
  for (const rp of reports) {
    let page = await graph(`${base}/${encodeURIComponent(rp.id)}?$expand=attendanceRecords`);
    let recs = page.attendanceRecords || [], next = page['attendanceRecords@odata.nextLink'];
    for (let k = 0; next && k < 20; k++) { const more = await graph(next); recs = recs.concat(more.value || []); next = more['@odata.nextLink']; }
    for (const r of recs) {
      if (String(r.role || '').toLowerCase() === 'organizer') continue;
      const name = String((r.identity && r.identity.displayName) || '').trim(), email = normEmail(r.emailAddress || '');
      const key = email || 'n:' + name.toLowerCase(); if (!email && !name) continue;
      const cur = by.get(key) || { name, email, minutes: 0 };
      cur.minutes += Math.round((+r.totalAttendanceInSeconds || 0) / 60); if (!cur.name && name) cur.name = name;
      by.set(key, cur);
    }
  }
  return { reports: reports.length, rows: [...by.values()] };
}

/* ---------- attendance: match by email, then by name; keep the rest for you to match ---------- */
const nameKey = n => String(n || '').toLowerCase().replace(/\((guest|external|unverified)\)/g, ' ').replace(/\b(mr|mrs|ms|dr|ca|cs|cma|shri|smt|sh|er|adv)\b\.?/g, ' ').replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
function sameName(a, b) {
  const x = nameKey(a), y = nameKey(b); if (!x || !y) return false;
  if (x === y) return true;
  const xs = x.split(' '), ys = y.split(' ');
  if (xs.length < 2 || ys.length < 2) return false; // a first name alone is not enough
  return xs.length === ys.length ? [...xs].sort().join(' ') === [...ys].sort().join(' ') : (xs[0] === ys[0] && xs[xs.length - 1] === ys[ys.length - 1]);
}
async function applyAttendance(w, rows, how) {
  const { OWNER } = ENV(); const ownerDom = String(OWNER || '').split('@')[1] || 'ashishduacorporation.com';
  const regs = await sbAll(`registrations?select=id,name,email,attended,attended_minutes,teams_name,matched_by&webinar_slug=eq.${encodeURIComponent(w.slug)}&order=id.asc`, 50000);
  const byEmail = new Map(regs.map(r => [r.email, r]));
  let matched = 0, byName = 0, walkins = 0; const unmatched = [];
  for (const a of rows.slice(0, 5000)) {
    const email = normEmail(a.email || ''); const minutes = Math.max(0, Math.round(+a.minutes || 0)); const name = clean(a.name, 120);
    if (email && email.endsWith('@' + ownerDom)) continue;
    let reg = email && validEmail(email) ? byEmail.get(email) : null, via = 'email';
    if (!reg && name) { const seen = regs.find(r => r.teams_name && r.teams_name === name); if (seen) { reg = seen; via = seen.matched_by || 'name'; } } // matched before (also by hand)
    if (!reg && name) { const c = regs.filter(r => !r.attended && sameName(r.name, name)); if (c.length === 1) { reg = c[0]; via = 'name'; } }
    if (reg) {
      await sb(`registrations?id=eq.${reg.id}`, { method: 'PATCH', body: { attended: true, attended_minutes: Math.max(minutes, reg.attended_minutes || 0), teams_name: name || null, matched_by: via }, prefer: 'return=minimal' });
      reg.attended = true; reg.teams_name = name || null; if (via === 'email') matched++; else byName++; continue;
    }
    if (email && validEmail(email)) {
      const person = await upsertPerson({ email, name, source: 'teams attendance' });
      await sb('registrations', { method: 'POST', body: { webinar_slug: w.slug, person_id: person.id, kind: 'walk_in', name: name || email, email, source: 'teams', attended: true, attended_minutes: minutes, teams_name: name || null, matched_by: 'email' }, prefer: 'return=minimal' }).catch(() => {});
      walkins++; continue;
    }
    if (name) unmatched.push({ webinar_slug: w.slug, name, email: null, minutes, status: 'open' });
  }
  if (unmatched.length) await sb('attendance_unmatched?on_conflict=webinar_slug,name', { method: 'POST', body: unmatched, prefer: 'resolution=ignore-duplicates,return=minimal' });
  if (how === 'teams') await sb(`webinars?slug=eq.${encodeURIComponent(w.slug)}`, { method: 'PATCH', body: { teams_attendance_at: new Date().toISOString() }, prefer: 'return=minimal' });
  return { matched, matched_by_name: byName, walkins, unmatched: unmatched.length };
}

/* ---------- dashboard lists ---------- */
const LISTS = {
  noshow: 'Registered but did not attend', followup: 'Attended, has not asked to talk yet', hot: 'Very interested: rated 4–5, asked a question or stayed 30+ minutes',
  leads_due: 'Leads to act on', customers: 'Customers', unmatched: 'Teams names to match' };
async function dashList(slug, list) {
  const w = slug ? `&webinar_slug=eq.${encodeURIComponent(slug)}` : '';
  const past = (await sb('webinars?select=slug,title,starts_at&starts_at=lt.' + new Date().toISOString())).map(x => x.slug);
  const pastF = slug ? '' : `&webinar_slug=in.(${past.map(s => '"' + s + '"').join(',') || '""'})`;
  const regSel = 'id,webinar_slug,name,email,phone,role,company,source,ref,contact_ok,challenge,attended,attended_minutes,feedback_rating,feedback_text,teams_name,matched_by,person_id,created_at';
  if (list === 'noshow') return sbAll(`registrations?select=${regSel}&attended=is.false&kind=neq.walk_in${w}${pastF}&order=created_at.desc,id.desc`, 50000);
  if (list === 'followup' || list === 'hot') {
    let rows = await sbAll(`registrations?select=${regSel}&attended=is.true${w}&order=attended_minutes.desc.nullslast,id.asc`, 50000);
    const emails = [...new Set(rows.map(r => r.email))]; const withLead = new Set();
    for (let i = 0; i < emails.length; i += 150) (await sb(`leads?select=email&email=in.(${emails.slice(i, i + 150).map(e => '"' + e + '"').join(',')})`)).forEach(l => withLead.add(l.email));
    rows = rows.filter(r => !withLead.has(r.email));
    if (list === 'hot') rows = rows.filter(r => (r.feedback_rating || 0) >= 4 || clean(r.challenge, 5) || (r.attended_minutes || 0) >= 30);
    return rows;
  }
  if (list === 'leads_due') {
    const today = todayIST();
    const rows = await sbAll(`leads?select=*&status=not.in.(won,not_now)${slug ? `&from_webinar=eq.${encodeURIComponent(slug)}` : ''}&order=created_at.asc,id.asc`, 20000);
    return rows.filter(l => l.status === 'new' || (l.next_action_at && l.next_action_at <= today));
  }
  if (list === 'customers') return sbAll(`leads?select=*&status=eq.won${slug ? `&from_webinar=eq.${encodeURIComponent(slug)}` : ''}&order=won_at.desc.nullslast,id.desc`, 20000);
  if (list === 'unmatched') return sbAll(`attendance_unmatched?select=*&status=eq.open${w}&order=minutes.desc,id.asc`, 20000);
  throw E('Unknown list');
}

const actions4 = {
  async dashboard(b) {
    const d = await sb('rpc/dashboard', { method: 'POST', body: {} });
    return { ...d, teams: teamsReady(), lists: LISTS };
  },
  async dashboard_list(b) { return { rows: await dashList(b.slug || '', b.list) }; },
  // add people from a list to Leads (no emails are sent; you follow up yourself)
  async dashboard_make_leads(b) {
    const ids = (b.ids || []).map(Number).filter(Boolean).slice(0, 500); if (!ids.length) throw E('Tick people first.');
    const regs = await sb(`registrations?select=id,webinar_slug,name,email,phone,company,person_id,challenge,contact_ok&id=in.(${ids.join(',')})`);
    let made = 0;
    for (const r of regs) {
      const [ex] = await sb(`leads?select=id&email=eq.${encodeURIComponent(r.email)}&status=not.in.(won,not_now)`); if (ex) continue;
      const [w] = await sb(`webinars?select=products&slug=eq.${encodeURIComponent(r.webinar_slug)}`);
      await sb('leads', { method: 'POST', body: { person_id: r.person_id, name: r.name, email: r.email, phone: r.phone, company: r.company, how: r.contact_ok === 'call' ? 'call' : 'email',
        interest: ((w && w.products) || []).map(p => p.name).join(', ') || null, from_webinar: r.webinar_slug, note: r.challenge || null, admin_notes: 'Added from the dashboard' }, prefer: 'return=minimal' });
      made++;
    }
    return { made };
  },
  async attendance_match(b) {
    const [u] = await sb(`attendance_unmatched?select=*&id=eq.${+b.id}`); if (!u) throw E('Not found', 404);
    if (b.ignore) { await sb(`attendance_unmatched?id=eq.${u.id}`, { method: 'PATCH', body: { status: 'ignored' }, prefer: 'return=minimal' }); return { ok: true }; }
    const [r] = await sb(`registrations?select=id,attended_minutes&id=eq.${+b.registration_id}&webinar_slug=eq.${encodeURIComponent(u.webinar_slug)}`); if (!r) throw E('Choose who this was.');
    await sb(`registrations?id=eq.${r.id}`, { method: 'PATCH', body: { attended: true, attended_minutes: Math.max(u.minutes, r.attended_minutes || 0), teams_name: u.name, matched_by: 'manual' }, prefer: 'return=minimal' });
    await sb(`attendance_unmatched?id=eq.${u.id}`, { method: 'PATCH', body: { status: 'matched', registration_id: r.id }, prefer: 'return=minimal' });
    return { ok: true };
  },
  async attendance_candidates(b) { return { rows: await sbAll(`registrations?select=id,name,email,company&webinar_slug=eq.${encodeURIComponent(b.slug)}&attended=is.false&kind=neq.walk_in&order=name.asc,id.asc`, 20000) }; },

  async teams_status() {
    if (!teamsReady()) return { connected: false };
    const m = MS();
    const out = { connected: true, calendar: false, meetings: null };
    try { await graphToken(); out.signin = true; } catch (e) { return { connected: true, signin: false, error: e.message }; }
    try { await graph(`/users/${encodeURIComponent(m.organizer)}/events?$top=1&$select=subject`); out.calendar = true; } catch (e) { out.calendar_error = e.message; }
    const [w] = await sb('webinars?select=slug,teams_link,teams_meeting_id&teams_link=not.is.null&order=starts_at.asc&limit=1');
    if (w) { try { await meetingIdFor(w); out.meetings = true; } catch (e) { out.meetings = false; out.meetings_error = e.message; } }
    return out;
  },
  async teams_create(b) { return teamsCreate(await getW(b.slug)); },
  async teams_attendance(b) {
    const w = await getW(b.slug);
    const { reports, rows } = await teamsAttendanceRows(w);
    if (!reports) return { reports: 0, message: 'Teams has no attendance report for this meeting yet. Reports appear a few minutes after the meeting ends.' };
    return { reports, people: rows.length, ...(await applyAttendance(w, rows, 'teams')) };
  },
  async teams_transcript(b) {
    const w = await getW(b.slug); const m = MS(); const mid = await meetingIdFor(w);
    const base = `/users/${encodeURIComponent(m.organizer)}/onlineMeetings/${encodeURIComponent(mid)}/transcripts`;
    const list = (await graph(base)).value || [];
    if (!list.length) throw E('No transcript found. Transcription must be on during the meeting (it is on by default for meetings the app creates).', 404);
    const t = list.sort((a, b) => String(b.createdDateTime).localeCompare(String(a.createdDateTime)))[0];
    let text;
    try { text = await graph(`${base}/${encodeURIComponent(t.id)}/content?$format=text/vtt`, { raw: true, accept: 'text/vtt' }); }
    catch (e) { if (/speaker/i.test(e.message)) text = await graph(`${base}/${encodeURIComponent(t.id)}/content`, { raw: true, accept: 'application/vnd.microsoft.graph.transcript+text' }); else throw e; }
    return { transcript: text, created: t.createdDateTime };
  },
  /* ---------- planning: weekly schedule, move earlier/later, delete, tell registrants about a new date ---------- */
  async schedule_apply(b) {
    const items = (b.items || []).slice(0, 200);
    if (!items.length) throw E('Choose at least one webinar.');
    const out = { updated: 0, unchanged: 0, affected: [], teams_notes: [] };
    for (let k = 0; k < items.length; k++) {
      const it = items[k]; const when = new Date(it.starts_at);
      if (isNaN(when)) throw E('A date is missing or not valid for ' + clean(it.slug, 80));
      const before = await getW(it.slug);
      const patch = { n: k + 1 };
      const moved = !before.starts_at || new Date(before.starts_at).getTime() !== when.getTime();
      if (moved) { patch.starts_at = when.toISOString(); if (before.starts_at) patch.rescheduled_at = new Date().toISOString(); }
      const [after] = await sb(`webinars?slug=eq.${encodeURIComponent(before.slug)}`, { method: 'PATCH', body: { ...patch, updated_at: new Date().toISOString() }, prefer: 'return=representation' });
      if (!moved) { out.unchanged++; continue; }
      out.updated++;
      const note = await teamsSync(before, after); if (note) out.teams_notes.push(before.title + ': ' + note);
      const regs = await registeredCount(before.slug); if (regs && before.starts_at) out.affected.push({ slug: before.slug, title: before.title, registered: regs, starts_at: after.starts_at });
    }
    return out;
  },
  async swap_dates(b) {
    const [a, c] = [await getW(b.a), await getW(b.b)];
    if (!a.starts_at || !c.starts_at) throw E('Both webinars need a date.');
    const now = new Date().toISOString();
    const [a2] = await sb(`webinars?slug=eq.${encodeURIComponent(a.slug)}`, { method: 'PATCH', body: { starts_at: c.starts_at, n: c.n, rescheduled_at: now, updated_at: now }, prefer: 'return=representation' });
    const [c2] = await sb(`webinars?slug=eq.${encodeURIComponent(c.slug)}`, { method: 'PATCH', body: { starts_at: a.starts_at, n: a.n, rescheduled_at: now, updated_at: now }, prefer: 'return=representation' });
    const notes = [await teamsSync(a, a2), await teamsSync(c, c2)].filter(Boolean);
    const affected = [];
    for (const w of [a2, c2]) { const n = await registeredCount(w.slug); if (n) affected.push({ slug: w.slug, title: w.title, registered: n, starts_at: w.starts_at }); }
    return { ok: true, affected, teams_notes: notes };
  },
  async delete_webinar(b) {
    const w = await getW(b.slug);
    const regs = (await sb(`registrations?select=id&webinar_slug=eq.${encodeURIComponent(w.slug)}`, { method: 'HEAD', count: true })).total || 0;
    if (regs) throw E(`${regs} ${regs === 1 ? 'person has' : 'people have'} registered for this webinar, so it can’t be deleted. Set its status to “cancelled” instead: it disappears from the website and their records stay.`, 409);
    let note = null;
    if (w.teams_event_id && teamsReady()) {
      try { await graph(`/users/${encodeURIComponent(MS().organizer)}/events/${encodeURIComponent(w.teams_event_id)}`, { method: 'DELETE' }); note = 'The Teams meeting was removed from your calendar.'; }
      catch (e) { note = 'Remove the Teams meeting from your calendar yourself (' + e.message + ').'; }
    }
    await sb(`webinars?slug=eq.${encodeURIComponent(w.slug)}`, { method: 'DELETE', prefer: 'return=minimal' });
    return { ok: true, note };
  },
  async notify_reschedule(b) {
    const w = await getW(b.slug); if (!w.starts_at) throw E('This webinar has no date.');
    const since = w.rescheduled_at || w.updated_at;
    const settings = await getSettings();
    const regs = await sbAll(`registrations?select=id,name,email,person_id,created_at,kind&webinar_slug=eq.${encodeURIComponent(w.slug)}&kind=neq.walk_in&order=id.asc`, 20000);
    const done = new Set((await sbAll(`email_log?select=email&webinar_slug=eq.${encodeURIComponent(w.slug)}&kind=eq.reschedule&status=eq.sent&created_at=gte.${encodeURIComponent(since)}`, 20000)).map(r => r.email));
    const todo = regs.filter(r => !done.has(r.email));
    // never to someone who unsubscribed after registering, or whose address bounced or complained
    const blocked = new Set();
    for (let i = 0; i < todo.length; i += 100) {
      const part = todo.slice(i, i + 100);
      const sup = await sb(`suppression?select=hash,created_at&channel=eq.email&hash=in.(${part.map(r => sha(normEmail(r.email))).join(',')})`);
      const bySup = Object.fromEntries(sup.map(x => [x.hash, x.created_at]));
      part.forEach(r => { const t = bySup[sha(normEmail(r.email))]; if (t && t > r.created_at) blocked.add(r.email); });
      (await sb(`people?select=email&email_status=in.(bounced,complained)&email=in.(${part.map(r => '"' + r.email + '"').join(',')})`)).forEach(p => blocked.add(p.email));
    }
    const cal = ics(w, true); let sent = 0, failed = 0; const t0 = Date.now();
    const list = todo.filter(r => !blocked.has(r.email));
    for (const r of list) {
      if (Date.now() - t0 > 45000) break;
      const okSent = await sendOne(r.email, rescheduleEmail(w, r, r.person_id, settings), r.person_id, { kind: 'reschedule', slug: w.slug, idem: `resched-${w.slug}-${w.starts_at}-${r.email}` },
        cal ? { attachments: [{ filename: 'invite.ics', content: Buffer.from(cal).toString('base64') }] } : {});
      okSent ? sent++ : failed++;
    }
    return { sent, failed, skipped: blocked.size, more: sent + failed < list.length };
  },
};
async function registeredCount(slug) { return (await sb(`registrations?select=id&webinar_slug=eq.${encodeURIComponent(slug)}&kind=neq.walk_in`, { method: 'HEAD', count: true })).total || 0; }

// called by the daily schedule: fetch attendance from Teams after each webinar (tries for 3 days)
async function teamsAutoAttendance() {
  if (!teamsReady()) return null;
  const from = new Date(Date.now() - 3 * 864e5).toISOString(), to = new Date(Date.now() - 2 * 3600e3).toISOString();
  const ws = await sb(`webinars?select=*&teams_link=not.is.null&teams_attendance_at=is.null&starts_at=gte.${from}&starts_at=lte.${to}`);
  const out = [];
  for (const w of ws) {
    try { const { reports, rows } = await teamsAttendanceRows(w); if (reports) out.push({ slug: w.slug, ...(await applyAttendance(w, rows, 'teams')) }); else out.push({ slug: w.slug, waiting: true }); }
    catch (e) { out.push({ slug: w.slug, error: e.message }); }
  }
  return out;
}

/* DuaDesk Webinars: admin endpoint  →  /api/webinar-admin   (POST only, header x-admin-key) */
export const config = { maxDuration: 60 };

const EDITABLE = ['n', 'series', 'format', 'status', 'title', 'subtitle', 'starts_at', 'duration_min', 'products', 'audience', 'summary', 'agenda', 'speaker',
  'cohost_needed', 'cohost_name', 'cohost_confirmed', 'cohost_note', 'facilitator_name', 'facilitator_confirmed', 'facilitator_note', 'teams_link', 'note', 'registration_open',
  'recording_kind', 'recording_ref', 'recording_summary', 'recording_takeaways', 'recording_chapters', 'slides_url', 'recording_published', 'target_segments', 'drip_on', 'drip_start_days', 'drip_end_days', 'cohost_email', 'cohost_phone', 'facilitator_email', 'facilitator_phone'];
const E = (msg, status = 400) => Object.assign(new Error(msg), { status });

function pick(o) {
  const out = {};
  for (const k of EDITABLE) if (k in o) out[k] = o[k] === '' ? null : o[k];
  if (out.teams_link && !/^https:\/\/([a-z0-9-]+\.)*(teams\.microsoft\.com|teams\.live\.com)\//i.test(out.teams_link)) throw E('The Teams link should start with https://teams.microsoft.com/ or https://teams.live.com/');
  for (const k of ['cohost_email', 'facilitator_email']) if (out[k]) { out[k] = normEmail(out[k]); if (!validEmail(out[k])) throw E('Please check the ' + k.replace('_', ' ') + '.'); }
  for (const k of ['cohost_phone', 'facilitator_phone']) if (out[k]) out[k] = clean(out[k], 30);
  if ('status' in out && !['draft', 'published', 'later', 'done', 'cancelled'].includes(out.status)) throw E('Unknown status');
  if (out.recording_kind && !['storage', 'youtube', 'link'].includes(out.recording_kind)) throw E('Unknown recording type');
  return out;
}
async function getW(slug) { const [w] = await sb(`webinars?select=*&slug=eq.${encodeURIComponent(slug || '')}`); if (!w) throw E('Webinar not found', 404); return w; }
async function sentToday() {
  const start = new Date(); start.setUTCHours(0, 0, 0, 0);
  const r = await sb(`email_log?select=id&status=eq.sent&kind=in.(invite,reminder,followup,noshow,scheduled,test)&created_at=gte.${start.toISOString()}`, { method: 'HEAD', count: true });
  return r.total || 0;
}
async function logMany(rows) {
  if (!rows.length) return;
  try { await sb('email_log', { method: 'POST', body: rows, prefer: 'return=minimal' }); }
  catch { for (const r of rows) await sb('email_log', { method: 'POST', body: r, prefer: 'return=minimal' }).catch(() => {}); }
}
// people: [{id(person or registration), email, name, pid}]
async function batchSend(slug, people, kind, build) {
  const payload = people.map(p => envelope(p.email, build(p), p.pid));
  const rows = [];
  try {
    const r = await resend('/emails/batch', payload, `${kind}-${slug}-${people[0].email}-${people.length}-${Date.now() >> 16}`);
    const ids = (r && r.data) || [];
    people.forEach((p, i) => rows.push({ webinar_slug: slug, person_id: p.pid || null, email: p.email, kind, status: 'sent', resend_id: ids[i] && ids[i].id }));
    await logMany(rows); return { sent: people.length, failed: 0 };
  } catch (e) {
    people.forEach(p => rows.push({ webinar_slug: slug, person_id: p.pid || null, email: p.email, kind, status: 'failed', error: String(e.message).slice(0, 500) }));
    await logMany(rows); return { sent: 0, failed: people.length, error: e.message };
  }
}
async function pidsFor(emails) {
  if (!emails.length) return {};
  const rows = await sb(`people?select=id,email&email=in.(${emails.map(e => '"' + e.replace(/"/g, '') + '"').join(',')})`);
  return Object.fromEntries(rows.map(r => [r.email, r.id]));
}

/* ---------- AI summary of a Teams transcript ---------- */
function compactTranscript(raw) {
  const lines = String(raw).replace(/\r/g, '').split('\n'); const out = []; let ts = null;
  for (const l of lines) {
    const m = l.match(/^(\d{1,2}):(\d{2}):(\d{2})(?:[.,]\d+)?\s*-->/);
    if (m) { const h = +m[1], mm = +m[2], ss = m[3]; ts = h ? `${h}:${String(mm).padStart(2, '0')}:${ss}` : `${mm}:${ss}`; continue; }
    if (!l.trim() || /^WEBVTT|^NOTE|^\d+$|^[0-9a-f-]{20,}(\/\d+-\d+)?$/i.test(l.trim())) continue;
    const text = l.replace(/<v ([^>]+)>/g, '$1: ').replace(/<[^>]+>/g, '').trim();
    if (text) out.push(ts ? `[${ts}] ${text}` : text), ts = null;
  }
  return (out.length ? out.join('\n') : String(raw)).slice(0, 150000);
}
async function aiSummary(w, transcript) {
  const { AI_KEY, AI_MODEL } = ENV();
  if (!AI_KEY) throw E('AI is not set up (add WEBINAR_ANTHROPIC_KEY in Vercel). You can type the summary yourself.', 503);
  const prompt = `You are preparing the public recording page for a DuaDesk webinar titled "${w.title}" (${w.subtitle || ''}), presented by ${w.speaker}.
From the transcript below, return ONLY a JSON object with:
- "summary": 3-4 sentences in plain English describing what the session covered and who it helps. No hype.
- "takeaways": 4-6 short, specific takeaways a viewer can act on.
- "chapters": 5-9 chapters as {"t": "mm:ss" or "h:mm:ss" start time taken from the transcript timestamps, "title": a short title}. First chapter starts at "0:00".
Use only what is in the transcript. Do not invent numbers, names or claims. Do not include attendees' names or personal details.

TRANSCRIPT:
${compactTranscript(transcript)}`;
  const res = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': AI_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: AI_MODEL, max_tokens: 2000, messages: [{ role: 'user', content: prompt }] }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw E('AI error: ' + ((data.error && data.error.message) || res.status), 502);
  const text = (data.content || []).map(c => c.text || '').join('');
  const m = text.match(/\{[\s\S]*\}/); if (!m) throw E('AI returned an unexpected answer. Please try again.', 502);
  const j = JSON.parse(m[0]);
  return { summary: String(j.summary || ''), takeaways: (j.takeaways || []).map(String).slice(0, 8), chapters: (j.chapters || []).map(c => ({ t: String(c.t || ''), title: String(c.title || '') })).slice(0, 12) };
}

const actions = {
  async login() { return { ok: true }; },

  async list() {
    const [webinars, stats, settings] = await Promise.all([sb('webinars?select=*&order=starts_at.asc.nullslast,n.asc'), sb('rpc/webinar_stats', { method: 'POST', body: {} }), settingsSafe()]);
    const by = Object.fromEntries(stats.map(s => [s.slug, s]));
    return { webinars: webinars.map(w => ({ ...w, stats: by[w.slug] || {} })), settings, sent_today: await sentToday() };
  },
  async save(b) {
    const patch = { ...pick(b.webinar || {}), updated_at: new Date().toISOString() };
    const [before] = await sb(`webinars?select=*&slug=eq.${encodeURIComponent(b.slug || '')}`);
    if (!before) throw E('Webinar not found', 404);
    if ('teams_link' in patch && patch.teams_link !== before.teams_link) { patch.teams_meeting_id = null; patch.teams_event_id = null; patch.teams_attendance_at = null; } // a different meeting
    const moved = 'starts_at' in patch && before.starts_at && patch.starts_at && new Date(patch.starts_at).getTime() !== new Date(before.starts_at).getTime();
    if (moved) patch.rescheduled_at = new Date().toISOString();
    const rows = await sb(`webinars?slug=eq.${encodeURIComponent(b.slug || '')}`, { method: 'PATCH', body: patch, prefer: 'return=representation' });
    const teams_note = 'teams_link' in patch && patch.teams_link !== before.teams_link ? null : await teamsSync(before, rows[0]);
    const registered = moved ? await registeredCount(before.slug) : 0;
    return { webinar: rows[0], teams_note, moved: !!moved, registered };
  },
  async create(b) {
    const w = pick(b.webinar || {});
    const slug = clean((b.webinar && b.webinar.slug) || w.title, 120).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (!slug || !w.title) throw E('Title required');
    const rows = await sb('webinars', { method: 'POST', body: { slug, status: 'draft', ...w }, prefer: 'return=representation' });
    return { webinar: rows[0] };
  },
  async settings_save(b) {
    const allowed = ['bookings_url', 'whatsapp_number', 'whatsapp_channel_url', 'invites_per_person_per_30_days', 'warm_mode', 'cold_mode', 'daily_warm_cap', 'daily_cold_cap', 'warm_include_unlabelled', 'rocketreach_daily_limit', 'outreach_signature', 'rocketreach_api_key', 'rocketreach_mode', 'rocketreach_auto_daily', 'slot_weekday', 'slot_time', 'slot_weeks'];
    if (b.settings && b.settings.rocketreach_api_key && /^••••/.test(b.settings.rocketreach_api_key)) delete b.settings.rocketreach_api_key;
    const rows = Object.entries(b.settings || {}).filter(([k]) => allowed.includes(k)).map(([key, value]) => ({ key, value: key === 'outreach_signature' ? String(value).slice(0, 500) : clean(value, 500) }));
    for (const r of rows) if (/_url$/.test(r.key) && r.value && !/^https:\/\//.test(r.value)) throw E(`${r.key} should start with https://`);
    if (rows.length) await sb('settings?on_conflict=key', { method: 'POST', body: rows, prefer: 'resolution=merge-duplicates,return=minimal' });
    return { settings: await settingsSafe() };
  },

  async registrations(b) {
    const q = b.slug ? `&webinar_slug=eq.${encodeURIComponent(b.slug)}` : '';
    const [regs, sources] = await Promise.all([sbAll(`registrations?select=*,people(kind,company,role,industry,turnover,segments,city)${q}&order=created_at.desc,id.desc`, 50000), b.slug ? sb('rpc/source_stats', { method: 'POST', body: { p_slug: b.slug } }) : []]);
    return { registrations: regs, sources };
  },
  async add_registration(b) { // e.g. someone who registered by WhatsApp chat
    const w = await getW(b.slug); const d = b.data || {};
    const email = normEmail(d.email); if (!validEmail(email) || !clean(d.name)) throw E('Name and a valid email are needed.');
    const person = await upsertPerson({ email, phone: d.phone, name: d.name, company: d.company, source: 'whatsapp' });
    const reg = { webinar_slug: w.slug, person_id: person.id, kind: w.format === 'roundtable' ? 'invite_request' : 'register', name: clean(d.name, 120), email, phone: normPhone(d.phone), company: clean(d.company, 160) || null, source: clean(d.source || 'whatsapp', 30), wa_optin: !!d.wa_optin && !!normPhone(d.phone) };
    try { await sb('registrations', { method: 'POST', body: reg, prefer: 'return=minimal' }); } catch (e) { if (e.code === '23505') throw E('Already registered.'); throw e; }
    if (reg.wa_optin) await sb(`people?id=eq.${person.id}`, { method: 'PATCH', body: { wa_optin: true, wa_optin_at: new Date().toISOString(), wa_optin_source: 'whatsapp chat' }, prefer: 'return=minimal' });
    const settings = await getSettings(); const cal = ics(w, true);
    await sendOne(email, confirmEmail(w, reg, person.id, settings), person.id, { kind: 'confirmation', slug: w.slug }, cal ? { attachments: [{ filename: 'invite.ics', content: Buffer.from(cal).toString('base64') }] } : {});
    return { ok: true };
  },

  /* ---------- people ---------- */
  async people_stats() {
    const c = async q => (await sb(`people?select=id${q}`, { method: 'HEAD', count: true })).total || 0;
    const [total, withEmail, subscribed, unsub, withPhone, waOpt, waStop, known] = await Promise.all([c(''), c('&email=not.is.null'), c('&email=not.is.null&email_status=eq.subscribed'), c('&email_status=in.(unsubscribed,bounced,complained)'), c('&phone=not.is.null'), c('&wa_optin=is.true&wa_stopped=is.false'), c('&wa_stopped=is.true'), c('&known_personally=is.true&phone=not.is.null')]);
    return { total, withEmail, subscribed, unsub, withPhone, waOpt, waStop, known };
  },
  async import_people(b) {
    const src = clean(b.source || 'import', 60), tags = (b.tags || []).map(t => clean(t, 30).toLowerCase()).filter(Boolean);
    const rows = [], seenE = new Set(), seenP = new Set(); let invalid = 0, dup = 0;
    for (const r of (b.rows || []).slice(0, 2000)) {
      const email = validEmail(normEmail(r.email)) ? normEmail(r.email) : null, phone = normPhone(r.phone);
      if (!email && !phone) { invalid++; continue; }
      if ((email && seenE.has(email)) || (!email && phone && seenP.has(phone))) { dup++; continue; }
      if (email) seenE.add(email); if (phone) seenP.add(phone);
      rows.push({ email, phone, name: clean(r.name, 120) || null, company: clean(r.company, 160) || null,
        role: clean(r.role, 120) || null, city: clean(r.city, 80) || null, tags: String(r.tags || '').split(/[;,|]/).map(t => clean(t, 30).toLowerCase()).filter(Boolean),
        known: /^(y|yes|true|1)$/i.test(String(r.known || '')) });
    }
    const out = rows.length ? await sb('rpc/import_people', { method: 'POST', body: { p_rows: rows, p_source: src, p_tags: tags, p_known: !!b.known } }) : { added: 0, merged: 0, blocked: 0 };
    return { received: (b.rows || []).length, invalid, duplicates_in_file: dup, ...out };
  },
  async people_search(b) {
    const q = clean(b.q, 80); if (!q) return { people: [] };
    const d = q.replace(/\D/g, '');
    const f = d.length >= 6 ? `phone=like.*${d}*` : `or=(email.ilike.*${encodeURIComponent(q)}*,name.ilike.*${encodeURIComponent(q)}*,company.ilike.*${encodeURIComponent(q)}*)`;
    return { people: await sb(`people?select=*&${f}&limit=50`) };
  },
  async people_update(b) {
    const [p] = await sb(`people?select=*&id=eq.${+b.id}`); if (!p) throw E('Person not found', 404);
    const f = b.fields || {}, patch = { updated_at: new Date().toISOString() };
    if ('known_personally' in f) patch.known_personally = !!f.known_personally;
    if (f.kind === 'warm' || f.kind === 'cold') patch.kind = f.kind;
    if (f.replied === true) { patch.kind = 'warm'; if (p.kind === 'cold') patch.warm_at = new Date().toISOString(); await sb('interactions', { method: 'POST', body: { person_id: p.id, kind: 'replied' }, prefer: 'return=minimal' }); }
    if ('tags' in f) patch.tags = (f.tags || []).map(t => clean(t, 30).toLowerCase()).filter(Boolean);
    if (f.wa_stopped === true) { patch.wa_stopped = true; patch.wa_optin = false; if (p.phone) await suppress(null, p.phone, 'STOP on WhatsApp'); }
    if (f.wa_optin === true && !p.wa_stopped) Object.assign(patch, { wa_optin: true, wa_optin_at: new Date().toISOString(), wa_optin_source: clean(f.wa_source || 'messaged us on WhatsApp', 60) });
    if (f.email_status && ['unsubscribed'].includes(f.email_status)) { patch.email_status = 'unsubscribed'; if (p.email) await suppress(p.email, null, 'admin'); }
    const [row] = await sb(`people?id=eq.${p.id}`, { method: 'PATCH', body: patch, prefer: 'return=representation' });
    return { person: row };
  },
  async people_delete(b) { // right to erasure: keep only do-not-contact fingerprints
    const [p] = await sb(`people?select=*&id=eq.${+b.id}`); if (!p) throw E('Person not found', 404);
    await suppress(p.email, p.phone, 'erasure request');
    await sb(`people?id=eq.${p.id}`, { method: 'DELETE', prefer: 'return=minimal' });
    if (p.email) await sb(`registrations?email=eq.${encodeURIComponent(p.email)}`, { method: 'DELETE', prefer: 'return=minimal' });
    return { ok: true };
  },
  async wa_optins() { return { people: await sbAll('people?select=name,phone,wa_optin_at,wa_optin_source&wa_optin=is.true&wa_stopped=is.false&phone=not.is.null&order=wa_optin_at.desc,id.desc') }; },
  async personal_queue(b) {
    const w = await getW(b.slug); const n = Math.max(1, Math.min(+b.n || 25, 100));
    const cutoff = new Date(Date.now() - 30 * 864e5).toISOString();
    const rows = await sb(`people?select=id,name,phone,company&known_personally=is.true&wa_stopped=is.false&phone=not.is.null&or=(personal_invite_at.is.null,personal_invite_at.lt.${cutoff})&order=id.asc&limit=${n * 3}`);
    const regs = await sb(`registrations?select=person_id&webinar_slug=eq.${encodeURIComponent(w.slug)}`);
    const reg = new Set(regs.map(r => r.person_id));
    return { people: rows.filter(r => !reg.has(r.id)).slice(0, n) };
  },
  async personal_mark(b) { await sb(`people?id=eq.${+b.id}`, { method: 'PATCH', body: { personal_invite_at: new Date().toISOString() }, prefer: 'return=minimal' }); return { ok: true }; },

  /* ---------- sending ---------- */
  async send_invites(b) {
    const w = await getW(b.slug); const settings = await getSettings();
    if (b.test_email) {
      const email = normEmail(b.test_email); if (!validEmail(email)) throw E('Test email not valid');
      const p = await upsertPerson({ email, name: 'Ashish Dua', source: 'admin test' });
      const msg = inviteEmail(w, p, settings);
      await sendOne(email, { ...msg, subject: '[TEST] ' + msg.subject }, p.id, { kind: 'test', slug: w.slug });
      return { sent: 1, test: true };
    }
    if (w.status !== 'published') throw E('Publish the webinar before sending invitations.');
    if (w.starts_at && new Date(w.starts_at) < new Date()) throw E('This webinar date has passed.');
    const cap = Math.max(1, Math.min(+b.daily_cap || 100, 50000));
    const room = cap - await sentToday();
    if (room <= 0) return { sent: 0, remaining_today: 0, done_for_today: true };
    const tags = (b.tags || []).map(t => clean(t, 30).toLowerCase()).filter(Boolean);
    const people = await sb('rpc/next_invite_batch', { method: 'POST', body: { p_slug: w.slug, p_limit: Math.min(100, room), p_tags: tags.length ? tags : null } });
    if (!people.length) return { sent: 0, finished: true };
    const r = await batchSend(w.slug, people.map(p => ({ ...p, pid: p.id })), 'invite', p => inviteEmail(w, p, settings));
    return { ...r, remaining_today: room - r.sent };
  },
  async send_reminders(b) {
    const w = await getW(b.slug);
    if (!w.teams_link) throw E('Add the Microsoft Teams link first.');
    const regs = await sb('rpc/next_reminder_batch', { method: 'POST', body: { p_slug: w.slug, p_limit: 100 } });
    if (!regs.length) return { sent: 0, finished: true };
    const pids = await pidsFor(regs.map(r => r.email));
    return batchSend(w.slug, regs.map(r => ({ ...r, pid: pids[r.email] })), 'reminder', r => reminderEmail(w, r, r.pid));
  },
  async import_attendance(b) { return applyAttendance(await getW(b.slug), b.rows || [], 'csv'); },
  async send_followups(b) {
    const w = await getW(b.slug); const settings = await getSettings();
    if (!w.recording_published) throw E('Publish the recording first, so the emails can link to it.');
    let sent = 0, failed = 0;
    for (const kind of ['followup', 'noshow']) {
      const regs = await sb('rpc/next_followup_batch', { method: 'POST', body: { p_slug: w.slug, p_kind: kind, p_limit: 100 } });
      if (!regs.length) continue;
      const pids = await pidsFor(regs.map(r => r.email));
      const r = await batchSend(w.slug, regs.map(x => ({ ...x, pid: pids[x.email] })), kind, x => followupEmail(w, x, x.pid, kind === 'followup', settings));
      sent += r.sent; failed += r.failed;
      if (r.failed) return { sent, failed, error: r.error };
      return { sent, failed, more: true };
    }
    return { sent, failed, finished: true };
  },

  /* ---------- recordings ---------- */
  async recording_upload_url(b) {
    const w = await getW(b.slug);
    const ext = (String(b.filename || '').match(/\.(mp4|m4v|mov|webm)$/i) || [, 'mp4'])[1].toLowerCase();
    const path = `${w.slug}/${Date.now()}.${ext}`;
    return { upload_url: await signedUpload(path), path };
  },
  async ai_summary(b) { const w = await getW(b.slug); if (!clean(b.transcript, 50)) throw E('Paste or upload the transcript first.'); return await aiSummary(w, b.transcript); },

  /* ---------- topics ---------- */
  async topics() {
    const rows = await sbAll('topic_suggestions?select=*,people(name,email)&order=created_at.desc,id.desc', 20000);
    return { topics: rows };
  },
  async topic_update(b) {
    const ids = (b.ids || [b.id]).map(Number).filter(Boolean); if (!ids.length) throw E('No topic selected');
    const patch = {}; if (b.status) patch.status = b.status; if ('planned_slug' in b) patch.planned_slug = b.planned_slug || null;
    await sb(`topic_suggestions?id=in.(${ids.join(',')})`, { method: 'PATCH', body: patch, prefer: 'return=minimal' });
    return { ok: true };
  },
  async topic_notify(b) {
    const w = await getW(b.slug); const settings = await getSettings();
    if (w.status !== 'published') throw E('Publish the webinar first.');
    const rows = await sb(`topic_suggestions?select=id,text,person_id,people(id,name,email,email_status)&planned_slug=eq.${encodeURIComponent(w.slug)}&notified_at=is.null&limit=200`);
    let sent = 0; const seen = new Set();
    for (const t of rows) {
      const p = t.people;
      if (p && p.email && p.email_status === 'subscribed' && !seen.has(p.id)) { seen.add(p.id); if (await sendOne(p.email, scheduledEmail(w, p, t.text, settings), p.id, { kind: 'scheduled', slug: w.slug })) sent++; }
      await sb(`topic_suggestions?id=eq.${t.id}`, { method: 'PATCH', body: { notified_at: new Date().toISOString(), status: 'planned' }, prefer: 'return=minimal' });
    }
    return { sent };
  },

  /* ---------- leads ---------- */
  async leads() { return { leads: await sbAll('leads?select=*,people(kind,role,industry,turnover,segments,city)&order=created_at.desc,id.desc', 20000) }; },
  async lead_update(b) {
    const f = b.fields || {}, patch = { updated_at: new Date().toISOString() };
    if (f.status && ['new', 'contacted', 'demo', 'pilot', 'won', 'not_now'].includes(f.status)) { patch.status = f.status; patch.won_at = f.status === 'won' ? new Date().toISOString() : null; }
    if ('next_action_at' in f) patch.next_action_at = f.next_action_at || null;
    if ('admin_notes' in f) patch.admin_notes = clean(f.admin_notes, 3000);
    const [row] = await sb(`leads?id=eq.${+b.id}`, { method: 'PATCH', body: patch, prefer: 'return=representation' });
    return { lead: row };
  },
};

Object.assign(actions, actions3, actions4);

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
  const cronKey = process.env.CRON_SECRET || '';
  if (cronKey && req.headers['x-cron-key'] && safeEq(req.headers['x-cron-key'], cronKey)) {
    try { return send(res, 200, await cronRun()); } catch (e) { console.error('cron', e); return send(res, 500, { error: e.message }); }
  }
  const { ADMIN } = ENV();
  if (!ADMIN) return send(res, 503, { error: 'Admin password is not configured (WEBINAR_ADMIN_PASSWORD).' });
  if (!(await rateOk(req, 'admin-fail', 900, 10, false))) return send(res, 429, { error: 'Too many wrong passwords from this connection. Try again in 15 minutes.' });
  if (!safeEq(req.headers['x-admin-key'] || '', ADMIN)) { await rateOk(req, 'admin-fail', 900, 10, true); await new Promise(r => setTimeout(r, 600)); return send(res, 401, { error: 'Wrong password' }); }
  try {
    const b = await readBody(req);
    const fn = actions[b.action];
    if (!fn) return send(res, 400, { error: 'Unknown action' });
    return send(res, 200, await fn(b));
  } catch (e) {
    console.error('webinar-admin', e);
    return send(res, e.status && e.status < 600 ? e.status : 500, { error: e.message || 'Server error' });
  }
}
