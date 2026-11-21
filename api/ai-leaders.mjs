/* AI Leaders by DuaDesk: the roles radar, the public roles board, applications, AI matching and updates to Ashish.
   One endpoint, /api/ai-leaders
   - GET  ?action=roles                      public: open roles, company names masked
   - POST {action:'apply', ...}              public: apply to a role (or share a general profile), with a CV
   - POST {action:'match', id, t}            public, token-protected: matches one application (the page calls it right after applying)
   - POST {action:..., x-admin-key header}   private: the admin page (same password as the webinar admin)
   - GET  with "Authorization: Bearer CRON_SECRET" (Vercel Cron, daily): radar search, pending matches, pool matches, digest
   Uses the same Vercel settings as the webinar app: SUPABASE_URL, SUPABASE_SERVICE_KEY, RESEND_API_KEY,
   WEBINAR_ANTHROPIC_KEY (or ANTHROPIC_API_KEY), WEBINAR_AI_MODEL, WEBINAR_ADMIN_PASSWORD, CRON_SECRET, UNSUBSCRIBE_SECRET.
   AI prepares; people decide: the AI finds roles and scores fit, Ashish decides who goes forward. */
import crypto from 'node:crypto';
import zlib from 'node:zlib';

export const config = { maxDuration: 300 };

const ENV = () => ({
  SB_URL: (process.env.SUPABASE_URL || '').replace(/\/$/, ''),
  SB_KEY: process.env.SUPABASE_SERVICE_KEY || '',
  RESEND_KEY: process.env.RESEND_API_KEY || '',
  FROM: process.env.AIL_FROM || 'AI Leaders by DuaDesk <aileaders@ashishduacorporation.com>',
  REPLY_TO: process.env.AIL_REPLY_TO || 'ashish@ashishduacorporation.com',
  OWNER: process.env.AIL_OWNER_EMAIL || process.env.WEBINAR_OWNER_EMAIL || 'ashish@ashishduacorporation.com',
  SITE: (process.env.SITE_URL || 'https://duadesk.com').replace(/\/$/, ''),
  SECRET: process.env.UNSUBSCRIBE_SECRET || process.env.SUPABASE_SERVICE_KEY || 'change-me',
  ADMIN: process.env.AIL_ADMIN_PASSWORD || process.env.WEBINAR_ADMIN_PASSWORD || '',
  AI_KEY: process.env.WEBINAR_ANTHROPIC_KEY || process.env.ANTHROPIC_API_KEY || '',
  AI_MODEL: process.env.AIL_AI_MODEL || process.env.WEBINAR_AI_MODEL || 'claude-sonnet-5-5',
  CRON: process.env.CRON_SECRET || '',
});
const BUCKET = 'ail-cvs';
const MAX_CV = 3 * 1024 * 1024;
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const ROLE_DAYS = 45; // radar roles close after this many days unless Ashish keeps them open
const REGIONS = ['India', 'Germany, the Netherlands and wider Europe', 'the United Kingdom', 'the UAE and Saudi Arabia', 'Singapore, Japan and Asia-Pacific', 'the United States and Canada'];
const LEVELS = ['C-suite', 'Global or regional head', 'Capability centre leadership', 'Governance and risk', 'Board and advisory', 'Senior leadership'];
const APP_STATUS = ['new', 'shortlisted', 'contacted', 'interview', 'offer', 'placed', 'not_suitable', 'withdrawn'];

/* ---------- small utilities ---------- */
const E = (msg, status = 400) => Object.assign(new Error(msg), { status });
const clean = (s, n = 300) => String(s ?? '').replace(/[\u0000-\u0008\u000b-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const tok = (kind, id) => crypto.createHmac('sha256', ENV().SECRET).update(kind + ':' + id).digest('hex').slice(0, 32);
const safeEq = (a, b) => { const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || '')); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const normEmail = e => String(e || '').trim().toLowerCase();
const validEmail = e => /^[^\s@<>()[\],;:"]+@[^\s@<>()[\],;:"]+\.[a-z]{2,}$/i.test(e) && e.length <= 254;
const validUrl = u => { try { const x = new URL(u); return /^https?:$/.test(x.protocol); } catch { return false; } };
const enc = encodeURIComponent;
const list = (v, n, len) => (Array.isArray(v) ? v : []).map(x => clean(x, len)).filter(Boolean).slice(0, n);
const int = (v, lo, hi) => { const n = Math.round(+v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : null; };
const dateOnly = v => { const m = /^\d{4}-\d{2}-\d{2}/.exec(String(v || '')); return m && !isNaN(Date.parse(m[0])) ? m[0] : null; };

function send(res, code, obj, cache) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', cache || 'no-store');
  res.end(JSON.stringify(obj));
}
async function readBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return {}; } }
  const chunks = []; let size = 0;
  for await (const c of req) { size += c.length; if (size > 4.4e6) throw E('That upload is too large. Please keep the CV under 3 MB.', 413); chunks.push(c); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { return {}; }
}
function clientIp(req) { return String(req.headers['x-real-ip'] || String(req.headers['x-forwarded-for'] || '').split(',')[0] || '').trim() || 'unknown'; }

/* ---------- database and storage (Supabase) ---------- */
function sbHeaders(extra) {
  const { SB_KEY } = ENV();
  const h = { apikey: SB_KEY, ...extra };
  if (!SB_KEY.startsWith('sb_')) h.Authorization = 'Bearer ' + SB_KEY;
  return h;
}
async function sb(path, { method = 'GET', body, prefer } = {}) {
  const { SB_URL, SB_KEY } = ENV();
  if (!SB_URL || !SB_KEY) throw E('Database is not configured (SUPABASE_URL / SUPABASE_SERVICE_KEY).', 503);
  const headers = sbHeaders({ 'Content-Type': 'application/json' });
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let data = null; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const msg = (data && data.message) || `Database error ${res.status}`;
    if (/relation .*ail_|Could not find the table/i.test(msg)) throw E('The AI Leaders tables are not set up yet: run ai_leaders_setup.sql in Supabase.', 503);
    const e = E(msg, res.status >= 500 ? 502 : 400); e.code = data && data.code; throw e;
  }
  return data;
}
async function rateOk(req, bucket, windowSec, max, record = true) {
  const key = 'ail-' + bucket + '|' + sha((process.env.UNSUBSCRIBE_SECRET || '') + clientIp(req)).slice(0, 24);
  try { return await sb('rpc/rate_hit', { method: 'POST', body: { p_key: key, p_window_sec: windowSec, p_max: max, p_record: record } }); } catch { return true; }
}
const objPath = p => String(p).split('/').map(enc).join('/');
async function cvUpload(path, buf, type) {
  const { SB_URL } = ENV();
  const res = await fetch(`${SB_URL}/storage/v1/object/${BUCKET}/${objPath(path)}`, { method: 'POST', headers: sbHeaders({ 'Content-Type': type, 'x-upsert': 'true' }), body: buf });
  if (!res.ok) { const d = await res.json().catch(() => ({})); throw E('Could not save the CV: ' + (d.message || d.error || res.status), 502); }
}
async function cvDownload(path) {
  const { SB_URL } = ENV();
  const res = await fetch(`${SB_URL}/storage/v1/object/${BUCKET}/${objPath(path)}`, { headers: sbHeaders() });
  if (!res.ok) throw E('Could not read the CV file.', 502);
  return Buffer.from(await res.arrayBuffer());
}
async function cvLink(path, seconds = 7 * 86400) {
  const { SB_URL } = ENV();
  const res = await fetch(`${SB_URL}/storage/v1/object/sign/${BUCKET}/${objPath(path)}`, { method: 'POST', headers: sbHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ expiresIn: seconds }) });
  const d = await res.json().catch(() => ({}));
  const u = d.signedURL || d.signedUrl;
  if (!res.ok || !u) throw E('Could not make a link to the CV.', 502);
  return SB_URL + '/storage/v1' + (u.startsWith('/') ? u : '/' + u);
}
async function cvRemove(paths) {
  if (!paths.length) return;
  const { SB_URL } = ENV();
  await fetch(`${SB_URL}/storage/v1/object/${BUCKET}`, { method: 'DELETE', headers: sbHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ prefixes: paths }) }).catch(() => {});
}

/* ---------- email (Resend) ---------- */
async function mail({ to, subject, html, idem, replyTo, attachments }) {
  const { RESEND_KEY, FROM, REPLY_TO } = ENV();
  if (!RESEND_KEY) { console.warn('ail: RESEND_API_KEY missing, email skipped:', subject); return null; }
  const headers = { Authorization: 'Bearer ' + RESEND_KEY, 'Content-Type': 'application/json' };
  if (idem) headers['Idempotency-Key'] = String(idem).slice(0, 256);
  const res = await fetch('https://api.resend.com/emails', { method: 'POST', headers, body: JSON.stringify({ from: FROM, to: [to], subject, html, reply_to: replyTo || REPLY_TO, ...(attachments && attachments.length ? { attachments } : {}) }) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) { console.error('ail mail', res.status, d); const e = E('Email was not sent: ' + (d.message || res.status), 502); if (to === ENV().OWNER) throw e; return null; }
  return d;
}
const shell = (title, body) => `<!doctype html><html><body style="margin:0;background:#f4f2fb;font:15px/1.55 Arial,Helvetica,sans-serif;color:#1b1535">
<div style="max-width:640px;margin:0 auto;padding:24px 16px"><div style="background:#fff;border-radius:14px;border-top:5px solid #8b6cff;padding:26px 26px 22px">
<div style="font:700 12px Arial;letter-spacing:2px;text-transform:uppercase;color:#6b4fe0;margin-bottom:8px">AI Leaders by DuaDesk</div>
<h1 style="font:700 22px Georgia,serif;margin:0 0 14px">${esc(title)}</h1>${body}</div>
<p style="font-size:12px;color:#7a7394;text-align:center;margin:14px 0 0">AI prepares; people decide. · <a href="${esc(ENV().SITE)}/ai-leaders/" style="color:#6b4fe0">duadesk.com/ai-leaders</a></p></div></body></html>`;
const ul = a => a && a.length ? `<ul style="margin:6px 0 12px;padding-left:20px">${a.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '<p style="margin:4px 0 12px;color:#7a7394">None noted.</p>';
const scoreChip = s => `<span style="display:inline-block;border-radius:999px;padding:3px 10px;font-weight:700;color:#fff;background:${s >= 75 ? '#2b9348' : s >= 55 ? '#e09f00' : '#c0392b'}">${s == null ? '–' : s + '/100'}</span>`;

/* ---------- AI (Claude), with web search for the radar ---------- */
async function ai({ system, content, maxTokens = 4000, search = 0 }) {
  const { AI_KEY, AI_MODEL } = ENV();
  if (!AI_KEY) throw E('AI is not set up: add WEBINAR_ANTHROPIC_KEY in Vercel.', 503);
  const messages = [{ role: 'user', content }];
  const tools = search ? [{ type: 'web_search_20250305', name: 'web_search', max_uses: search }] : undefined;
  let text = '';
  for (let turn = 0; turn < 4; turn++) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', headers: { 'x-api-key': AI_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: AI_MODEL, max_tokens: maxTokens, system, messages, ...(tools ? { tools } : {}) }), signal: AbortSignal.timeout(240000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw E('AI error: ' + ((data.error && data.error.message) || res.status), 502);
    text += (data.content || []).filter(c => c.type === 'text').map(c => c.text || '').join('');
    if (data.stop_reason === 'pause_turn') { messages.push({ role: 'assistant', content: data.content }); continue; } // a long web search: let it continue
    if (data.stop_reason === 'max_tokens') throw E('The AI answer was cut off.', 502);
    break;
  }
  const a = text.indexOf('{'), z = text.lastIndexOf('}');
  if (a < 0 || z < a) throw E('The AI returned an unexpected answer.', 502);
  try { return JSON.parse(text.slice(a, z + 1)); } catch { throw E('The AI returned an unexpected answer.', 502); }
}

/* ---------- reading a Word CV without extra packages ---------- */
function docxText(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 70000); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw E('That Word file could not be read.');
  const n = buf.readUInt16LE(eocd + 10); let p = buf.readUInt32LE(eocd + 16);
  for (let k = 0; k < n && p + 46 <= buf.length; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), nl = buf.readUInt16LE(p + 28), xl = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), lho = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nl);
    if (name === 'word/document.xml') {
      const start = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
      const raw = buf.subarray(start, start + csize);
      const xml = (method === 8 ? zlib.inflateRawSync(raw) : raw).toString('utf8');
      return xml.replace(/<w:tab\/>/g, ' ').replace(/<\/w:p>/g, '\n').replace(/<[^>]+>/g, '')
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
        .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim().slice(0, 60000);
    }
    p += 46 + nl + xl + cl;
  }
  throw E('That Word file could not be read.');
}

/* ---------- roles ---------- */
const publicRole = r => ({
  ref: r.ref, title: r.title, level: r.level, industry: r.industry, region: r.region, location: r.location, work_mode: r.work_mode,
  summary: r.summary, must_haves: r.must_haves || [], company: r.company_masked || 'Confidential company',
  kind: r.source === 'manual' ? 'client' : 'market', posted_on: r.posted_on, found_at: r.found_at,
});
// keep the company's name out of everything the public sees
function maskOut(r) {
  const LEGAL = /\b(ag|se|gmbh|kgaa|co|corp|corporation|inc|ltd|limited|llc|llp|plc|pvt|private|public|group|holdings?|company|nv|bv|sa|spa|ab|as|oy|kk|& co)\b\.?/gi;
  const full = clean(r.company, 120), core = full.replace(LEGAL, ' ').replace(/[&,.]+/g, ' ').replace(/\s+/g, ' ').trim();
  const firstWord = (core.split(' ')[0] || '');
  const names = [full, core, ...full.split(/\s+(?:&|and)\s+|,\s*/), firstWord.length >= 4 ? firstWord : ''].map(x => clean(x, 120)).filter(x => x && x.length >= 3)
    .sort((x, y) => y.length - x.length);
  const scrub = s => {
    let t = String(s || '').replace(/https?:\/\/\S+/g, '').replace(/\bwww\.\S+/g, '');
    for (const nm of names) t = t.replace(new RegExp('\\b' + nm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:-\\w+)?', 'gi'), 'the company');
    return clean(t.replace(/\b(see|visit|apply at)\s+(for more|\.)/gi, '').replace(/\s+([.,;])/g, '$1').replace(/\.{2,}/g, '.'), 2000);
  };
  r.title = scrub(r.title).slice(0, 160); r.summary = scrub(r.summary).slice(0, 700);
  r.must_haves = (r.must_haves || []).map(scrub).filter(Boolean).slice(0, 6);
  const generic = `A confidential ${r.industry ? clean(r.industry, 60).toLowerCase() + ' ' : ''}company`;
  r.company_masked = scrub(r.company_masked).slice(0, 120);
  if (!r.company_masked || /the company/i.test(r.company_masked)) r.company_masked = generic;
  return r;
}
const fingerprint = r => sha([r.company, r.title, r.location].map(x => clean(x, 200).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()).join('|')).slice(0, 40);
async function setRef(row) {
  if (row.ref) return row;
  const ref = 'AIL-' + String(row.id).padStart(4, '0');
  const [r] = await sb(`ail_roles?id=eq.${row.id}`, { method: 'PATCH', body: { ref }, prefer: 'return=representation' });
  return r || { ...row, ref };
}
function roleInput(b, existing) {
  const r = {
    title: clean(b.title, 160), level: LEVELS.includes(b.level) ? b.level : clean(b.level, 60) || null,
    industry: clean(b.industry, 80) || null, region: clean(b.region, 80) || null, location: clean(b.location, 120) || null,
    work_mode: clean(b.work_mode, 40) || null, summary: clean(b.summary, 700) || null, must_haves: list(b.must_haves, 6, 200),
    company: clean(b.company, 120) || null, company_masked: clean(b.company_masked, 120) || null,
    source_url: validUrl(b.source_url) ? clean(b.source_url, 600) : null, source_title: clean(b.source_title, 200) || null,
    posted_on: dateOnly(b.posted_on), notes: clean(b.notes, 1000) || null,
  };
  if (!existing && !r.title) throw E('A role needs a title.');
  return r;
}

/* the radar: one region per run, roles posted recently, no repeats */
async function radar(region, opts = {}) {
  const run = await startRun('radar', { region });
  try {
    const known = await sb(`ail_roles?select=company,title&order=found_at.desc&limit=150`);
    const system = `You are the research desk of "AI Leaders by DuaDesk", an executive search practice that places senior AI leaders.
Use web search to find CURRENTLY OPEN senior AI leadership roles in ${region}, advertised in the last 30 days.
Roles that count: Chief AI Officer, Chief Data & AI Officer, Chief Technology Officer with an AI mandate, Global/Regional Head of AI, Head of Generative AI, Head of AI Platforms, VP or Director of AI/ML leading a function, Head of AI at a global capability centre, Head of Responsible AI / AI Governance / AI Risk, AI board or advisory roles.
Do not include individual-contributor engineering roles, internships, or roles below head-of-function level.
Rules:
- Only include a role if a real job posting or a credible announcement of the open position supports it, and give that page's URL. Never invent a role, a company, a date or a detail. If unsure, leave it out.
- "company_masked" describes the employer without naming it or giving it away (no brand, product or parent names): sector, scale and footprint, e.g. "A global consumer goods group headquartered in Europe".
- "summary" and "must_haves" are public: never name the company, its brands, products, parent or people.
- Skip roles already in this list (company | title): ${known.slice(0, 120).map(k => `${clean(k.company, 60)} | ${clean(k.title, 80)}`).join('; ') || 'none'}
Answer with ONE JSON object and nothing else:
{"roles":[{"title":"","level":"one of: ${LEVELS.join(' / ')}","company":"real employer name","company_masked":"","industry":"","location":"city, country","region":"${clean(region, 60)}","work_mode":"On-site / Hybrid / Remote / Not stated","summary":"2–3 sentences: the mandate and what success looks like (≤ 450 characters)","must_haves":["≤ 5 short requirements"],"posted_on":"YYYY-MM-DD or empty","source_url":"","source_title":""}]}
Find up to ${opts.max || 8} roles. Use an empty list when nothing qualifies.`;
    const j = await ai({ system, content: `Find open senior AI leadership roles in ${region}. Today is ${new Date().toISOString().slice(0, 10)}.`, maxTokens: 8000, search: opts.searches || 6 });
    let added = 0, skipped = 0; const ids = [];
    for (const x of (Array.isArray(j.roles) ? j.roles : []).slice(0, 12)) {
      let r = null; try { r = roleInput(x || {}); } catch { r = null; }
      if (!r || !r.company || !r.source_url) { skipped++; continue; }
      r.region = r.region || clean(region, 80);
      maskOut(r);
      r.fingerprint = fingerprint(r); r.source = 'radar'; r.status = 'open';
      const rows = await sb('ail_roles?on_conflict=fingerprint', { method: 'POST', body: r, prefer: 'resolution=ignore-duplicates,return=representation' });
      if (rows && rows[0]) { await setRef(rows[0]); added++; ids.push(rows[0].id); } else skipped++;
    }
    await endRun(run, { region, added, skipped });
    return { region, added, skipped, ids };
  } catch (e) { await endRun(run, { region, error: e.message }); throw e; }
}
async function startRun(kind, result) { try { const [r] = await sb('ail_runs', { method: 'POST', body: { kind, result }, prefer: 'return=representation' }); return r && r.id; } catch { return null; } }
async function endRun(id, result) { if (id) await sb(`ail_runs?id=eq.${id}`, { method: 'PATCH', body: { finished_at: new Date().toISOString(), result } }).catch(() => {}); }

/* ---------- applications ---------- */
async function apply(req, b) {
  if (b.website) return { ok: true, id: 0 }; // honeypot: bots fill hidden fields
  if (!(await rateOk(req, 'apply', 3600, 12))) throw E('Too many applications from this connection. Please try again in an hour.', 429);
  const email = normEmail(b.email);
  const c = {
    name: clean(b.name, 120), email, phone: clean(b.phone, 40) || null, linkedin: validUrl(b.linkedin) ? clean(b.linkedin, 300) : null,
    current_title: clean(b.current_title, 160) || null, current_company: clean(b.current_company, 160) || null,
    years: int(b.years, 0, 60), location: clean(b.location, 120) || null, open_to_other: b.open_to_other !== false,
  };
  if (!c.name) throw E('Please enter your name.');
  if (!validEmail(email)) throw E('Please enter a valid email address.');
  if (!b.consent) throw E('Please agree to how we use your details.');
  if (b.linkedin && !c.linkedin) throw E('Please enter your LinkedIn link in full, starting with https://');
  let role = null;
  if (b.role && b.role !== 'general') {
    [role] = await sb(`ail_roles?select=id,ref,title,status,company_masked&ref=eq.${enc(clean(b.role, 20))}`);
    if (!role || role.status !== 'open') throw E('That role is no longer open. You can still share your profile for other roles.', 410);
  }
  // the CV: a PDF or Word file, up to 3 MB
  let cv = null;
  if (b.cv && b.cv.data) {
    const buf = Buffer.from(String(b.cv.data).replace(/^data:[^,]*,/, ''), 'base64');
    if (!buf.length || buf.length > MAX_CV) throw E('Please attach a CV under 3 MB.');
    const isPdf = buf.subarray(0, 5).toString() === '%PDF-', isZip = buf.readUInt32LE(0) === 0x04034b50;
    if (!isPdf && !isZip) throw E('Please attach your CV as a PDF or Word (.docx) file.');
    if (isZip) docxText(buf); // throws if it is not a readable Word file
    cv = { buf, type: isPdf ? 'application/pdf' : DOCX, name: clean(b.cv.name, 120).replace(/[^\w.\- ]+/g, '_') || (isPdf ? 'cv.pdf' : 'cv.docx') };
  }
  const now = new Date().toISOString();
  const [existing] = await sb(`ail_candidates?select=id,cv_path&email=eq.${enc(email)}`);
  if (!cv && !(existing && existing.cv_path)) throw E('Please attach your CV (PDF or Word).');
  let cand;
  if (existing) [cand] = await sb(`ail_candidates?id=eq.${existing.id}`, { method: 'PATCH', body: { ...c, consent_at: now, updated_at: now }, prefer: 'return=representation' });
  else [cand] = await sb('ail_candidates', { method: 'POST', body: { ...c, consent_at: now }, prefer: 'return=representation' });
  if (cv) {
    const path = `${cand.id}/${Date.now()}-${cv.name}`;
    await cvUpload(path, cv.buf, cv.type);
    if (existing && existing.cv_path && existing.cv_path !== path) await cvRemove([existing.cv_path]);
    await sb(`ail_candidates?id=eq.${cand.id}`, { method: 'PATCH', body: { cv_path: path, cv_name: cv.name, cv_type: cv.type, profile: null } });
  }
  const note = clean(b.note, 1500) || null;
  const roleQ = role ? `role_id=eq.${role.id}` : 'role_id=is.null';
  let [app] = await sb(`ail_applications?select=id&candidate_id=eq.${cand.id}&${roleQ}`);
  let again = false;
  if (app) { again = true; await sb(`ail_applications?id=eq.${app.id}`, { method: 'PATCH', body: { note, match_state: 'pending', match_tries: 0, match_error: null, updated_at: now } }); }
  else [app] = await sb('ail_applications', { method: 'POST', body: { role_id: role ? role.id : null, candidate_id: cand.id, note }, prefer: 'return=representation' });
  await mail({
    to: email, idem: `ail-ack-${app.id}-${again ? Date.now() : 0}`,
    subject: role ? `We have your application: ${role.title} (${role.ref})` : 'We have your profile', // candidates see the role, never the employer
    html: shell(role ? 'Thank you for applying' : 'Thank you for sharing your profile', `<p>Dear ${esc(c.name.split(' ')[0])},</p>
<p>${role ? `We have received your application for the <b>${esc(role.title)}</b> role (reference ${esc(role.ref)}).` : 'We have received your profile.'}</p>
<p>A person reads every application. If there is a good fit, we will contact you to talk it through before anything is shared with an employer. We never share your profile without your agreement.</p>
${c.open_to_other ? '<p>You asked us to consider you for other suitable roles too, so we will keep your profile in mind as new roles open.</p>' : ''}
<p>With best wishes,<br>Ashish Dua<br>AI Leaders by DuaDesk</p>`),
  });
  return { ok: true, id: app.id, t: tok('ail-match', app.id), again };
}

/* one application: profile the CV once, score the fit, look across other open roles, tell Ashish */
async function matchApplication(id) {
  const [claim] = await sb(`ail_applications?id=eq.${+id}&match_state=in.(pending,failed)&match_tries=lt.3`, { method: 'PATCH', body: { match_state: 'running', updated_at: new Date().toISOString() }, prefer: 'return=representation' });
  if (!claim) return { skipped: true };
  try {
    const [cand] = await sb(`ail_candidates?id=eq.${claim.candidate_id}`);
    const role = claim.role_id ? (await sb(`ail_roles?id=eq.${claim.role_id}`))[0] : null;
    const open = await sb(`ail_roles?select=id,ref,title,level,industry,region,location,summary,must_haves,company_masked&status=eq.open&order=found_at.desc&limit=40`);
    const others = open.filter(r => !role || r.id !== role.id).slice(0, 25);
    const content = [];
    if (cand.cv_path) {
      const buf = await cvDownload(cand.cv_path);
      if (cand.cv_type === 'application/pdf') content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buf.toString('base64') } });
      else content.push({ type: 'text', text: 'CV (text from the Word file):\n' + docxText(buf) });
    }
    content.push({ type: 'text', text: `CANDIDATE (from the form)
Name: ${cand.name} · Current: ${cand.current_title || '-'} at ${cand.current_company || '-'} · Years: ${cand.years ?? '-'} · Location: ${cand.location || '-'}
Note from the candidate: ${claim.note || '-'}

${role ? `THE ROLE APPLIED FOR (${role.ref})
Title: ${role.title} · Level: ${role.level || '-'} · Employer: ${role.company_masked || '-'} (${role.industry || '-'}) · Location: ${role.location || '-'} · ${role.work_mode || ''}
Summary: ${role.summary || '-'}
Must-haves: ${(role.must_haves || []).join('; ') || '-'}` : 'No specific role: this is a general profile.'}

OTHER OPEN ROLES
${others.map(r => `${r.ref}: ${r.title} · ${r.level || ''} · ${r.company_masked || ''} · ${r.location || ''} · needs: ${(r.must_haves || []).join('; ')}`).join('\n') || 'none'}` });
    const system = `You are the assessment desk of "AI Leaders by DuaDesk", an executive search practice for senior AI leaders. You prepare; a person decides.
Read the CV and assess the candidate on evidence: AI systems in production, measurable business value, size of teams led, governance and risk, scope (local vs global), seniority.
Be fair and specific. Do not guess facts the CV does not support; say what is unclear. Ignore age, gender, religion, nationality, marital status, photos and any other protected characteristic.
Answer with ONE JSON object and nothing else:
{"profile":{"headline":"one line (≤ 140 chars)","seniority":"","years":0,"ai_evidence":["≤ 5 concrete achievements"],"sectors":[""],"regions":[""],"skills":["≤ 8"]},
 "match":${role ? '{"score":0-100,"verdict":"strong | possible | weak","summary":"2–3 sentences","strengths":["≤ 4"],"gaps":["≤ 4"],"questions":["≤ 3 questions to ask in the first call"]}' : 'null'},
 "other_roles":[{"ref":"AIL-…","score":0-100,"why":"one sentence"}]}
In other_roles list at most 3 roles from OTHER OPEN ROLES that score 60 or more; use an empty list if none.`;
    const j = await ai({ system, content, maxTokens: 3500 });
    const p = j.profile || {};
    const profile = { headline: clean(p.headline, 160), seniority: clean(p.seniority, 60), years: int(p.years, 0, 60), ai_evidence: list(p.ai_evidence, 5, 300), sectors: list(p.sectors, 6, 60), regions: list(p.regions, 6, 60), skills: list(p.skills, 8, 60) };
    const m = j.match && role ? { score: int(j.match.score, 0, 100), verdict: clean(j.match.verdict, 20), summary: clean(j.match.summary, 700), strengths: list(j.match.strengths, 4, 250), gaps: list(j.match.gaps, 4, 250), questions: list(j.match.questions, 3, 250) } : null;
    const now = new Date().toISOString();
    await sb(`ail_candidates?id=eq.${cand.id}`, { method: 'PATCH', body: { profile } });
    if (role && m) await sb('ail_matches?on_conflict=role_id,candidate_id', { method: 'POST', body: { role_id: role.id, candidate_id: cand.id, source: 'application', score: m.score, match: m }, prefer: 'resolution=merge-duplicates,return=minimal' });
    const extra = [];
    if (cand.open_to_other) for (const o of (Array.isArray(j.other_roles) ? j.other_roles : []).slice(0, 3)) {
      const r = others.find(x => x.ref === clean(o && o.ref, 20)); const s = int(o && o.score, 0, 100);
      if (!r || s == null || s < 60) continue;
      extra.push({ ...r, score: s, why: clean(o.why, 300) });
      await sb('ail_matches?on_conflict=role_id,candidate_id', { method: 'POST', body: { role_id: r.id, candidate_id: cand.id, source: 'pool', score: s, match: { summary: clean(o.why, 300) } }, prefer: 'resolution=ignore-duplicates,return=minimal' });
    }
    await sb(`ail_applications?id=eq.${claim.id}`, { method: 'PATCH', body: { match_state: 'done', match_error: null, score: m ? m.score : null, match: { ...(m || {}), profile, other_roles: extra.map(x => ({ ref: x.ref, title: x.title, score: x.score, why: x.why })) }, matched_at: now, updated_at: now } });
    await notifyApplication(claim, cand, role, m, profile, extra);
    return { done: true, score: m ? m.score : null };
  } catch (e) {
    await sb(`ail_applications?id=eq.${claim.id}`, { method: 'PATCH', body: { match_state: 'failed', match_tries: (claim.match_tries || 0) + 1, match_error: clean(e.message, 300) } }).catch(() => {});
    throw e;
  }
}
async function notifyApplication(app, cand, role, m, profile, extra) {
  const { OWNER, SITE } = ENV();
  let link = ''; try { if (cand.cv_path) link = await cvLink(cand.cv_path); } catch { }
  const html = shell(role ? `New application: ${role.title}` : 'New general profile', `
<p style="margin:0 0 6px"><b>${esc(cand.name)}</b> · ${esc(cand.current_title || '')}${cand.current_company ? ' at ' + esc(cand.current_company) : ''}${cand.years != null ? ' · ' + cand.years + ' yrs' : ''}${cand.location ? ' · ' + esc(cand.location) : ''}</p>
<p style="margin:0 0 14px;font-size:14px"><a href="mailto:${esc(cand.email)}" style="color:#6b4fe0">${esc(cand.email)}</a>${cand.phone ? ' · ' + esc(cand.phone) : ''}${cand.linkedin ? ` · <a href="${esc(cand.linkedin)}" style="color:#6b4fe0">LinkedIn</a>` : ''}${link ? ` · <a href="${esc(link)}" style="color:#6b4fe0">CV (link valid 7 days)</a>` : ''}</p>
${profile && profile.headline ? `<p style="margin:0 0 14px;padding:10px 12px;background:#f4f2fb;border-radius:8px">${esc(profile.headline)}</p>` : ''}
${role ? `<p style="margin:0 0 4px;font-size:13px;color:#7a7394">ROLE ${esc(role.ref)}</p>
<p style="margin:0 0 12px"><b>${esc(role.title)}</b> · ${esc(role.company || role.company_masked || '')}${role.location ? ' · ' + esc(role.location) : ''}${role.source_url ? ` · <a href="${esc(role.source_url)}" style="color:#6b4fe0">source</a>` : ''}</p>` : ''}
${m ? `<p style="margin:0 0 8px">Fit ${scoreChip(m.score)} <b style="text-transform:capitalize">${esc(m.verdict || '')}</b></p><p style="margin:0 0 10px">${esc(m.summary)}</p>
<b>Strengths</b>${ul(m.strengths)}<b>Gaps</b>${ul(m.gaps)}<b>Ask in the first call</b>${ul(m.questions)}` : ''}
${profile && profile.ai_evidence && profile.ai_evidence.length ? `<b>AI evidence in the CV</b>${ul(profile.ai_evidence)}` : ''}
${extra.length ? `<b>Also a fit for</b><ul style="margin:6px 0 12px;padding-left:20px">${extra.map(x => `<li>${esc(x.ref)} ${esc(x.title)} ${scoreChip(x.score)} ${esc(x.why)}</li>`).join('')}</ul>` : ''}
${app.note ? `<b>Note from the candidate</b><p style="margin:4px 0 12px">${esc(app.note)}</p>` : ''}
<p style="margin:18px 0 0"><a href="${esc(SITE)}/ai-leaders/admin/" style="display:inline-block;background:#8b6cff;color:#fff;text-decoration:none;border-radius:999px;padding:10px 18px;font-weight:700">Open the AI Leaders desk</a></p>
<p style="font-size:12px;color:#7a7394;margin:14px 0 0">The score is the AI's preparation, not a decision. Nothing has been sent to any employer.</p>`);
  await mail({ to: OWNER, subject: `${m ? `[${m.score}/100] ` : ''}${cand.name} → ${role ? role.title + ' (' + role.ref + ')' : 'general profile'}`, html, idem: `ail-own-${app.id}-${Date.now() >> 16}`, replyTo: cand.email });
  await sb(`ail_applications?id=eq.${app.id}`, { method: 'PATCH', body: { notified_at: new Date().toISOString() } }).catch(() => {});
}

/* new roles × the candidate pool (people who said "consider me for other roles") */
async function poolMatch(role) {
  const pool = await sb(`ail_candidates?select=id,name,current_title,current_company,years,location,profile&open_to_other=eq.true&profile=not.is.null&order=updated_at.desc&limit=60`);
  const already = new Set((await sb(`ail_matches?select=candidate_id&role_id=eq.${role.id}`)).map(x => x.candidate_id));
  const people = pool.filter(p => !already.has(p.id));
  await sb(`ail_roles?id=eq.${role.id}`, { method: 'PATCH', body: { pool_matched_at: new Date().toISOString() } });
  if (!people.length) return [];
  const system = `You are the assessment desk of "AI Leaders by DuaDesk". You prepare; a person decides. Score how well each candidate's profile fits the role, on evidence only. Ignore protected characteristics.
Answer with ONE JSON object and nothing else: {"matches":[{"id":0,"score":0-100,"why":"one sentence"}]} listing only candidates scoring 60 or more (at most 5).`;
  const content = `ROLE ${role.ref}: ${role.title} · ${role.level || ''} · ${role.company_masked || ''} · ${role.industry || ''} · ${role.location || ''}
Summary: ${role.summary || ''}
Must-haves: ${(role.must_haves || []).join('; ')}

CANDIDATES
${people.map(p => `#${p.id}: ${p.current_title || ''} at ${p.current_company || ''}, ${p.years ?? '?'} yrs, ${p.location || ''}. ${p.profile.headline || ''}. Evidence: ${(p.profile.ai_evidence || []).join('; ')}. Sectors: ${(p.profile.sectors || []).join(', ')}. Regions: ${(p.profile.regions || []).join(', ')}`).join('\n')}`;
  const j = await ai({ system, content, maxTokens: 1500 });
  const out = [];
  for (const x of (Array.isArray(j.matches) ? j.matches : []).slice(0, 5)) {
    const p = people.find(q => q.id === +x.id); const s = int(x.score, 0, 100);
    if (!p || s == null || s < 60) continue;
    await sb('ail_matches?on_conflict=role_id,candidate_id', { method: 'POST', body: { role_id: role.id, candidate_id: p.id, source: 'pool', score: s, match: { summary: clean(x.why, 300) } }, prefer: 'resolution=ignore-duplicates,return=minimal' });
    out.push({ role, person: p, score: s, why: clean(x.why, 300) });
  }
  return out;
}

/* ---------- RocketReach: hiring contacts for each role, and AI leaders to source ----------
   Uses the key and daily reveal limit saved in the webinar app's Settings (table "settings").
   Searching is free; revealing an email costs 1 credit and only happens when Ashish clicks Reveal.
   Reveals are logged as interactions kind 'rr_lookup', so they share the webinar app's daily limit. */
const RR = 'https://api.rocketreach.co';
const RR_PATHS = {
  search: ['/v2/api/search', '/api/v2/person/search'],
  reveal: ['/api/v2/person/lookup', '/v2/api/lookupProfile'],
  status: ['/api/v2/person/checkStatus', '/v2/api/checkStatus'],
  account: ['/api/v2/account/', '/v2/api/account'] };
const HIRING_TITLES = ['Chief Human Resources Officer', 'CHRO', 'Chief People Officer', 'Global Head of Talent Acquisition', 'Head of Talent Acquisition', 'Head of Executive Search', 'Chief Technology Officer', 'Chief Information Officer', 'Chief Digital Officer', 'Chief Data Officer'];
const LEADER_TITLES = ['Chief AI Officer', 'Chief Artificial Intelligence Officer', 'Chief Data and AI Officer', 'Head of AI', 'Head of Artificial Intelligence', 'Head of Generative AI', 'Head of AI Platform', 'Head of Machine Learning', 'Head of Data Science',
  'VP Artificial Intelligence', 'VP AI', 'Vice President AI', 'VP Machine Learning', 'VP Data Science', 'AVP Artificial Intelligence', 'AVP AI', 'Assistant Vice President AI', 'AVP Data Science',
  'Director of AI', 'Director Artificial Intelligence', 'Director Machine Learning', 'Director Data Science', 'Director Generative AI', 'Senior Director AI',
  'Senior Manager AI', 'Senior Manager Artificial Intelligence', 'Senior Manager Machine Learning', 'Senior Manager Data Science', 'AI Manager', 'Manager Artificial Intelligence', 'Machine Learning Manager',
  'AI Lead', 'Generative AI Lead', 'Lead AI', 'Principal AI', 'AI Practice Lead']; // leadership pipeline: heads, VPs, AVPs, directors, senior managers, managers and leads
const RR_PLACES = {
  'India': ['India'], 'Germany, the Netherlands and wider Europe': ['Germany', 'Netherlands', 'Switzerland', 'France'], 'the United Kingdom': ['United Kingdom'],
  'the UAE and Saudi Arabia': ['United Arab Emirates', 'Saudi Arabia'], 'Singapore, Japan and Asia-Pacific': ['Singapore', 'Japan', 'Australia'], 'the United States and Canada': ['United States', 'Canada'] };
async function rrSettings() {
  const rows = await sb(`settings?select=key,value&key=in.(rocketreach_api_key,rocketreach_daily_limit)`).catch(() => []);
  const s = Object.fromEntries(rows.map(r => [r.key, r.value || '']));
  return { key: s.rocketreach_api_key || '', limit: s.rocketreach_daily_limit === '' || s.rocketreach_daily_limit == null ? 20 : Math.max(0, +s.rocketreach_daily_limit || 0) };
}
const istMidnight = () => { const d = new Date(Date.now() + 5.5 * 3600000); return new Date(d.toISOString().slice(0, 10) + 'T00:00:00+05:30').toISOString(); };
async function rrUsedToday() { return (await sb(`interactions?select=id&kind=eq.rr_lookup&created_at=gte.${istMidnight()}&limit=1000`)).length; }
async function rrReq(key, kind, { query = '', body } = {}) {
  let last = '';
  for (const p of RR_PATHS[kind]) {
    let res;
    try {
      res = await fetch(RR + p + query, { method: body ? 'POST' : 'GET', signal: AbortSignal.timeout(20000),
        headers: { 'Api-Key': key, Accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    } catch { throw E('RocketReach did not answer in time. Try again.', 504); }
    if (res.status === 404 || res.status === 405) { last = res.status; continue; }
    const data = await res.json().catch(() => ({}));
    if (res.status === 429) throw E('RocketReach is busy. Try again in a minute.', 429);
    if (!res.ok) throw E('RocketReach: ' + (data.detail || data.message || data.error || res.status), res.status === 401 || res.status === 403 ? 400 : 502);
    return data;
  }
  if (kind === 'reveal') return { status: 'failed', emails: [] };
  throw E('RocketReach endpoint not found (' + last + ')', 502);
}
const rrProfiles = d => (Array.isArray(d) ? d : d.profiles || d.data || d.results || []).filter(x => x && x.id);
const rrPerson = x => ({ rr_id: Number(x.id), name: clean(x.name || [x.first_name, x.last_name].filter(Boolean).join(' '), 120) || null, title: clean(x.current_title, 160) || null,
  company: clean(x.current_employer, 160) || null, location: clean(x.location || [x.city, x.region, x.country_code || x.country].filter(Boolean).join(', '), 120) || null, linkedin_url: validUrl(x.linkedin_url) ? clean(x.linkedin_url, 300) : null });
async function rrReveal(key, rrId) {
  let r = await rrReq(key, 'reveal', { query: '?id=' + enc(rrId) + '&lookup_type=' + enc(process.env.RR_LOOKUP_TYPE || 'premium') });
  for (let k = 0; k < 8 && r && ['searching', 'progress', 'waiting', 'pending', 'queued', 'not queued'].includes(String(r.status).toLowerCase()); k++) {
    await new Promise(x => setTimeout(x, +(process.env.RR_POLL_MS || 3000)));
    const st = await rrReq(key, 'status', { query: '?ids=' + enc(r.id || rrId) });
    r = Array.isArray(st) ? st[0] : (st.profiles ? st.profiles[0] : st);
  }
  return r || {};
}
function rrBest(p, mode) { // mode: 'work' for hiring contacts, 'personal' for candidates (never contact a candidate at their employer)
  const score = e => { const g = String(e.grade || '').toUpperCase(); return g === 'A' ? 3 : g === 'A-' ? 2 : String(e.smtp_valid || '').toLowerCase() === 'valid' ? 1 : 0; };
  const ok = (p.emails || []).filter(e => e && e.email && score(e) > 0 && (mode === 'personal' ? e.type === 'personal' : e.type !== 'personal')).sort((a, b) => (b.type === 'professional') - (a.type === 'professional') || score(b) - score(a));
  const ph = rrPhone(p, mode);
  return { email: ok[0] ? String(ok[0].email).toLowerCase() : null, grade: ok[0] ? (ok[0].grade || 'valid') : null, phone: ph.phone, phone_type: ph.type };
}
// the best phone: a mobile first; for candidates never an office or company line
function rrPhone(p, mode) {
  const kind = x => { const t = String(x.type || x.phone_type || '').toLowerCase(); return /mobile|cell/.test(t) ? 'mobile' : /personal|home/.test(t) ? 'personal' : /work|professional|office|hq|company|direct|business|landline/.test(t) ? 'work' : 'other'; };
  const rank = { mobile: 0, personal: 1, other: 2, work: 3 };
  const list = (p.phones || []).filter(x => x && x.number && !(x.validity && /invalid/i.test(String(x.validity))))
    .map(x => ({ number: clean(String(x.number), 40), k: kind(x), rec: !!x.recommended }))
    .filter(x => mode !== 'personal' || x.k !== 'work')
    .sort((a, b) => rank[a.k] - rank[b.k] || b.rec - a.rec);
  return list[0] ? { phone: list[0].number, type: list[0].k } : { phone: null, type: null };
}
const digits = n => String(n || '').replace(/[^\d]/g, '');
const telLink = n => 'tel:+' + digits(n);
const waLink = n => 'https://wa.me/' + digits(n);
const companyKey = c => String(c || '').toLowerCase().replace(/&/g, ' and ').replace(/\b(pvt|private|ltd|limited|llp|inc|co|kg|ag|se|gmbh|plc|company|corp|corporation|group|the)\b\.?/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
function sameCompany(a, b) {
  const x = companyKey(a), y = companyKey(b); if (!x || !y) return false;
  if (x === y) return true;
  const [s, l] = x.length < y.length ? [x, y] : [y, x];
  return (l.startsWith(s + ' ') && s.length >= 4);
}
const undisclosed = c => !c || /^(undisclosed|confidential)\b/i.test(c);

// hiring contacts at a role's company (free search): the role's own country first, then anywhere; exact name first, then a looser one
const HIRING_MORE = ['Head of Human Resources', 'Head of HR', 'HR Director', 'Director Human Resources', 'Head of People', 'Head of Recruiting', 'Talent Acquisition Director', 'Director Talent Acquisition', 'Head of IT', 'Personalleiter', 'Leiter Personal', 'Leiterin Personal', 'Head of Talent'];
const COUNTRY_FIX = { usa: 'United States', us: 'United States', 'u.s.': 'United States', uk: 'United Kingdom', uae: 'United Arab Emirates', ksa: 'Saudi Arabia' };
const roleCountry = r => { const p = String(r.location || '').split(',').map(x => x.trim()).filter(Boolean); const c = p[p.length - 1] || ''; return COUNTRY_FIX[c.toLowerCase()] || c; };
async function findContacts(role, key) {
  await sb(`ail_roles?id=eq.${role.id}`, { method: 'PATCH', body: { contacts_searched_at: new Date().toISOString() } });
  if (undisclosed(role.company)) return 0;
  const name = role.company.replace(/\b(GmbH\s*&\s*Co\.?\s*KG|GmbH|AG|SE|KGaA|Inc\.?|Ltd\.?|plc|LLC)\b\.?/gi, '').replace(/\s+/g, ' ').trim();
  const country = roleCountry(role);
  const titles = [...HIRING_TITLES, ...HIRING_MORE];
  const tries = [
    { current_employer: ['"' + name + '"'], current_title: titles, ...(country ? { location: [country] } : {}) },
    { current_employer: ['"' + name + '"'], current_title: titles },
    { current_employer: [name], current_title: titles, ...(country ? { location: [country] } : {}) },
    { current_employer: [name], current_title: titles },
  ];
  const iso = { india: ', in', germany: ', de', 'united kingdom': ', gb', 'united states': ', us', 'saudi arabia': ', sa', 'united arab emirates': ', ae', singapore: ', sg', netherlands: ', nl', japan: ', jp' }[country.toLowerCase()];
  const inCountry = p => { const l = (p.location || '').toLowerCase(); return !!country && (l.includes(country.toLowerCase()) || (!!iso && l.endsWith(iso))); };
  const seen = new Map();
  for (const q of tries) {
    let res = [];
    try { res = rrProfiles(await rrReq(key, 'search', { body: { query: q, order_by: 'popularity', page_size: 15, start: 1 } })); }
    catch (e) { if (e.status === 400 || e.status === 429) throw e; continue; }
    for (const p of res.map(rrPerson)) if (p.rr_id && sameCompany(p.company, role.company) && !seen.has(p.rr_id)) seen.set(p.rr_id, p);
    if ([...seen.values()].filter(inCountry).length >= 3) break;
  }
  const people = [...seen.values()].sort((x, y) => (inCountry(y) - inCountry(x)) || (HIRE_RANK(x.title) - HIRE_RANK(y.title))).slice(0, 4);
  if (!people.length) return 0;
  const rows = await sb('ail_contacts?on_conflict=role_id,rr_id', { method: 'POST', body: people.map(p => ({ ...p, role_id: role.id })), prefer: 'resolution=ignore-duplicates,return=representation' });
  return rows.length;
}
// AI leaders in a region (free search, a page at a time)
async function sourceLeaders(region, key, pages = 2) {
  const places = RR_PLACES[region] || ['India'];
  const qkey = 'ail|src2|' + sha(region).slice(0, 16); // src2: the wider title list starts from page 1
  let found = 0, added = 0;
  for (let n = 0; n < pages; n++) {
    const [prev] = await sb(`rr_searched?select=*&key=eq.${qkey}`);
    const start = prev && prev.next_start ? prev.next_start : 1;
    if (start > 2000) return { region, found, added, note: 'All results for this region have been seen.' };
    const data = await rrReq(key, 'search', { body: { query: { current_title: LEADER_TITLES, location: places }, order_by: 'popularity', page_size: 25, start } });
    const people = rrProfiles(data).map(rrPerson).filter(p => p.name);
    const rows = people.length ? await sb('ail_sourced?on_conflict=rr_id', { method: 'POST', body: people.map(p => ({ ...p, region })), prefer: 'resolution=ignore-duplicates,return=representation' }) : [];
    const pg = data.pagination || {};
    await sb('rr_searched?on_conflict=key', { method: 'POST', body: [{ key: qkey, found: ((prev && prev.found) || 0) + people.length, next_start: people.length ? (pg.next || start + 25) : 2001, searched_at: new Date().toISOString() }], prefer: 'resolution=merge-duplicates,return=minimal' });
    found += people.length; added += rows.length;
    if (!people.length) break;
  }
  return { region, found, added };
}
// which open roles each newly sourced leader may fit (AI, from title, employer and location only)
async function fitSourced(limit = 40) {
  const people = await sb(`ail_sourced?select=id,name,title,company,location&fits=is.null&status=neq.dismissed&order=created_at.desc&limit=${limit}`);
  if (!people.length) return 0;
  const roles = await sb('ail_roles?select=ref,title,level,industry,location,must_haves&status=eq.open&order=found_at.desc&limit=40');
  if (!roles.length) return 0;
  const system = `You are the research desk of "AI Leaders by DuaDesk". You prepare; a person decides. From each person's current title, employer and location only, suggest which open roles they could plausibly be approached for. The pool includes Heads, VPs, AVPs, Directors, Senior Managers, Managers and Leads in AI, ML, generative AI and data science: someone one level below the role can fit when scope and domain match (e.g. an AVP or Senior Manager of AI stepping up to Head or VP); two or more levels below usually does not. Heads of AI and Chief AI Officers at startups and scale-ups are a strong source: building AI products end to end from zero is real evidence, so do not mark them down for company size; weigh it against roles that need large-enterprise or regulated-industry scale. Global mobility is part of the practice: a person in another country can fit any role, including relocation (e.g. India to Germany, Singapore, the Gulf, the UK or North America); note "relocation" in the why, and only lower the score where the role states a hard local requirement such as fluent German or local citizenship. Be honest rather than generous. Ignore protected characteristics.
Answer with ONE JSON object and nothing else: {"fits":[{"id":0,"roles":[{"ref":"AIL-…","score":0-100,"why":"one short sentence"}]}]} with at most 2 roles per person, only scores of 60 or more; give an empty roles list when nothing fits.`;
  const content = `OPEN ROLES\n${roles.map(r => `${r.ref}: ${r.title} · ${r.level || ''} · ${r.industry || ''} · ${r.location || ''} · needs: ${(r.must_haves || []).join('; ')}`).join('\n')}\n\nPEOPLE\n${people.map(p => `#${p.id}: ${p.title || ''} at ${p.company || ''}, ${p.location || ''}`).join('\n')}`;
  const j = await ai({ system, content, maxTokens: 3000 });
  const refs = new Set(roles.map(r => r.ref)); let n = 0;
  const byId = new Map((Array.isArray(j.fits) ? j.fits : []).map(f => [+f.id, f]));
  for (const p of people) {
    const f = byId.get(p.id);
    const fits = (f && Array.isArray(f.roles) ? f.roles : []).filter(x => refs.has(clean(x.ref, 20)) && int(x.score, 0, 100) >= 60).slice(0, 2).map(x => ({ ref: clean(x.ref, 20), score: int(x.score, 0, 100), why: clean(x.why, 200) }));
    await sb(`ail_sourced?id=eq.${p.id}`, { method: 'PATCH', body: { fits } });
    if (fits.length) n++;
  }
  return n;
}
async function rrRevealRow(table, id) {
  if (!['ail_contacts', 'ail_sourced'].includes(table)) throw E('Unknown list');
  const s = await rrSettings(); if (!s.key) throw E('Add your RocketReach API key in the webinar admin Settings first.');
  const [row] = await sb(`${table}?select=*&id=eq.${+id}`); if (!row) throw E('Not found', 404);
  const used = await rrUsedToday();
  if (row.revealed_at) return { row, left: Math.max(0, s.limit - used) };
  if (used >= s.limit) throw E(`Today's RocketReach limit (${s.limit} reveals) is used up. Change it in the webinar admin Settings.`, 429);
  const r = await rrReveal(s.key, row.rr_id);
  await sb('interactions', { method: 'POST', body: { kind: 'rr_lookup', data: { ail: table, id: row.id, status: r && r.status, emails: (r && r.emails || []).length, grades: (r && r.emails || []).map(e => `${e.type || ''}:${e.grade || e.smtp_valid || ''}`).slice(0, 6), phones: (r && r.phones || []).length, phone_types: (r && r.phones || []).map(x => String(x.type || '') + (x.recommended ? '*' : '')).slice(0, 10), keys: Object.keys(r || {}).slice(0, 30) } }, prefer: 'return=minimal' });
  const st = String(r && r.status || '').toLowerCase();
  if (['searching', 'progress', 'waiting', 'pending', 'queued', 'not queued'].includes(st)) throw E('RocketReach is still looking this person up. Try Reveal again in a minute.', 202);
  const best = rrBest(r, table === 'ail_sourced' ? 'personal' : 'work'); // candidates: personal email only; hiring contacts: work email only
  const [upd] = await sb(`${table}?id=eq.${row.id}`, { method: 'PATCH', body: { email: best.email, phone: best.phone, phone_type: best.phone_type, grade: best.grade, status: best.email || best.phone ? 'revealed' : 'no_email', revealed_at: new Date().toISOString(), linkedin_url: row.linkedin_url || (validUrl(r.linkedin_url) ? r.linkedin_url : null) }, prefer: 'return=representation' });
  return { row: upd, left: s.limit - used - 1 };
}
async function rrPhonesRefresh(table, limit = 25) {
  const s = await rrSettings(); if (!s.key) throw E('Add your RocketReach API key in the webinar admin Settings first.');
  const rows = await sb(`${table}?select=id,rr_id,phone,phone_type&revealed_at=not.is.null&phone_type=is.null&rr_id=not.is.null&order=revealed_at.desc&limit=${limit}`);
  let updated = 0, mobiles = 0;
  for (const row of rows) {
    const r = await rrReveal(s.key, row.rr_id);
    await sb('interactions', { method: 'POST', body: { kind: 'rr_relookup', data: { ail: table, id: row.id, status: r && r.status, phones: (r && r.phones || []).length, phone_types: (r && r.phones || []).map(x => String(x.type || '') + (x.recommended ? '*' : '')).slice(0, 10) } }, prefer: 'return=minimal' });
    if (!r || !Array.isArray(r.phones)) continue;
    const ph = rrPhone(r, table === 'ail_sourced' ? 'personal' : 'work');
    await sb(`${table}?id=eq.${row.id}`, { method: 'PATCH', body: { phone: ph.phone, phone_type: ph.type || 'none' }, prefer: 'return=minimal' });
    updated++; if (ph.type === 'mobile') mobiles++;
  }
  return { checked: rows.length, updated, mobiles };
}
async function rrDaily(out, left) {
  const s = await rrSettings(); if (!s.key) return;
  const roles = await sb('ail_roles?select=id,ref,company,location&status=eq.open&contacts_searched_at=is.null&order=found_at.desc&limit=6');
  let contacts = 0;
  for (const r of roles) { if (left() < 60000) break; try { contacts += await findContacts(r, s.key); } catch (e) { out.errors.push('contacts ' + r.ref + ': ' + e.message); if (e.status === 400 || e.status === 429) return; } }
  out.contacts = contacts;
  if (left() > 50000) { const region = REGIONS[Math.floor(Date.now() / 86400000) % REGIONS.length]; try { out.sourced = await sourceLeaders(region, s.key); } catch (e) { out.errors.push('sourcing: ' + e.message); } }
  if (left() > 40000 && ENV().AI_KEY) { try { out.sourced_fits = await fitSourced(); } catch (e) { out.errors.push('sourcing fits: ' + e.message); } }
}

/* ---------- the daily job ---------- */
async function cronRun() {
  const t0 = Date.now(), left = () => 270000 - (Date.now() - t0);
  const out = { matched: 0, radar: null, pool: [], closed: 0, contacts: 0, sourced: null, sourced_fits: 0, errors: [] };
  // 1. applications whose matching did not finish
  const stale = new Date(Date.now() - 15 * 60000).toISOString(), wait = new Date(Date.now() - 3 * 60000).toISOString();
  await sb(`ail_applications?match_state=eq.running&updated_at=lt.${stale}`, { method: 'PATCH', body: { match_state: 'failed' } }).catch(() => {});
  const pending = await sb(`ail_applications?select=id&match_state=in.(pending,failed)&match_tries=lt.3&created_at=lt.${wait}&order=created_at.asc&limit=4`);
  for (const a of pending) { if (left() < 200000) break; try { await matchApplication(a.id); out.matched++; } catch (e) { out.errors.push('match ' + a.id + ': ' + e.message); } }
  // 2. close market roles that have been open too long
  const old = new Date(Date.now() - ROLE_DAYS * 86400000).toISOString();
  const closed = await sb(`ail_roles?source=eq.radar&status=eq.open&found_at=lt.${old}`, { method: 'PATCH', body: { status: 'closed', updated_at: new Date().toISOString() }, prefer: 'return=representation' }).catch(() => []);
  out.closed = closed.length;
  // 3. the radar: one region a day, in turn
  if (left() > 150000) {
    const region = REGIONS[Math.floor(Date.now() / 86400000) % REGIONS.length];
    try { out.radar = await radar(region); } catch (e) { out.errors.push('radar: ' + e.message); }
  }
  // 4. new roles × the candidate pool
  const fresh = await sb(`ail_roles?select=*&status=eq.open&pool_matched_at=is.null&order=found_at.desc&limit=4`);
  for (const r of fresh) { if (left() < 40000) break; try { out.pool.push(...await poolMatch(r)); } catch (e) { out.errors.push('pool ' + r.ref + ': ' + e.message); } }
  // 5. RocketReach (free searches): hiring contacts for open roles, and AI leaders in today's region
  try { await rrDaily(out, left); } catch (e) { out.errors.push('rocketreach: ' + e.message); }
  // 6. reveal emails for the best people (a small daily budget of RocketReach credits), then write the drafts
  try { out.revealed = await autoReveal(out, left); } catch (e) { out.errors.push('reveals: ' + e.message); }
  let drafts = [];
  try { drafts = await buildDrafts(); } catch (e) { out.errors.push('drafts: ' + e.message); }
  let lis = [];
  try { lis = await buildLinkedIn(drafts); } catch (e) { out.errors.push('linkedin: ' + e.message); }
  // 7. the morning brief to Ashish, every day
  try { await digest(out, drafts, lis); } catch (e) { out.errors.push('brief: ' + e.message); }
  return { ok: true, matched: out.matched, closed: out.closed, radar: out.radar, pool: out.pool.length, contacts: out.contacts, sourced: out.sourced, sourced_fits: out.sourced_fits, revealed: out.revealed || 0, drafts: drafts.length, linkedin: lis.length, errors: out.errors };
}

/* ---------- the morning drafts: one email per person, for Ashish to open and send from his own mailbox ---------- */
const SIGN = `Warm regards,

**Ashish Dua**
Founder, DuaDesk · AI Leaders by DuaDesk
Ashish Dua Consulting Corporation (Canada)
ashish@ashishduacorporation.com · +91 98995 73717
duadesk.com/ai-leaders`;
/* drafts are written once with light markup ("## Heading", "**bold**", "• bullet") and come out as a formatted Outlook email plus a plain-text copy */
const mdText = s => s.replace(/^## (.+)$/gm, (_, h) => h.toUpperCase()).replace(/\*\*(.+?)\*\*/g, '$1');
const mdInline = t => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
  .replace(/ashish@ashishduacorporation\.com/g, '<a href="mailto:ashish@ashishduacorporation.com" style="color:#5b3fd0">ashish@ashishduacorporation.com</a>')
  .replace(/duadesk\.com\/ai-leaders/g, '<a href="https://duadesk.com/ai-leaders" style="color:#5b3fd0">duadesk.com/ai-leaders</a>');
function mdHtml(src) {
  const out = []; let para = [], list = [];
  const flush = () => {
    if (para.length) { out.push(`<p style="margin:0 0 12px">${para.map(mdInline).join('<br>')}</p>`); para = []; }
    if (list.length) { out.push(`<ul style="margin:0 0 12px;padding-left:22px">${list.map(x => `<li style="margin:0 0 6px">${mdInline(x)}</li>`).join('')}</ul>`); list = []; }
  };
  for (const line of src.split('\n')) {
    if (!line.trim()) { flush(); continue; }
    if (line.startsWith('## ')) { flush(); out.push(`<p style="margin:18px 0 6px;padding-bottom:3px;border-bottom:1px solid #e3ddf7;color:#4b2fb5;font-weight:bold;font-size:12pt">${esc(line.slice(3))}</p>`); continue; }
    if (line.startsWith('• ')) { if (para.length) { const p = para; para = []; out.push(`<p style="margin:0 0 6px">${p.map(mdInline).join('<br>')}</p>`); } list.push(line.slice(2)); continue; }
    if (list.length) flush();
    para.push(line);
  }
  flush();
  return `<div style="font-family:Calibri,'Segoe UI',Arial,sans-serif;font-size:11pt;line-height:1.45;color:#1f1d2b">${out.join('')}</div>`;
}
const fmt = src => ({ body: mdText(src), html: mdHtml(src) });
const aOr = t => /^[aeiou]/i.test(String(t || '').trim()) ? 'an' : 'a';
const firstName = n => (clean(n, 120).split(' ')[0] || '').replace(/[^\p{L}\-']/gu, '') || 'there';
const HIRE_RANK = t => /talent|recruit|executive search/i.test(t || '') ? 0 : /chro|human|people|\bhr\b|personal/i.test(t || '') ? 1 : /technology|cto|information|cio|digital|data/i.test(t || '') ? 2 : 3;
async function autoSettings() {
  const rows = await sb(`settings?select=key,value&key=eq.ail_auto_reveals`).catch(() => []);
  const v = rows[0] ? rows[0].value : '10';
  return Math.max(0, Math.min(20, v === '' || v == null ? 10 : +v || 0));
}
// reveal: first the best hiring contact for each open role, then the strongest sourced candidates
async function autoReveal(out, left) {
  const want = await autoSettings(); if (!want) return 0;
  const s = await rrSettings(); if (!s.key) return 0;
  let room = Math.min(want, s.limit - await rrUsedToday()); if (room <= 0) return 0;
  const queue = [];
  const contacts = await sb('ail_contacts?select=id,role_id,title,status,revealed_at,ail_roles!inner(status,found_at)&status=eq.found&revealed_at=is.null&ail_roles.status=eq.open&order=created_at.desc&limit=200');
  const best = new Map();
  for (const c of contacts) { const cur = best.get(c.role_id); if (!cur || HIRE_RANK(c.title) < HIRE_RANK(cur.title)) best.set(c.role_id, c); }
  const revealedRoles = new Set((await sb('ail_contacts?select=role_id&revealed_at=not.is.null&limit=1000')).map(x => x.role_id));
  for (const c of best.values()) if (!revealedRoles.has(c.role_id)) queue.push(['ail_contacts', c.id]);
  const sourced = await sb('ail_sourced?select=id,fits&status=eq.found&revealed_at=is.null&fits=not.is.null&limit=300');
  sourced.map(p => [p, Math.max(0, ...(p.fits || []).map(f => f.score || 0))]).filter(([, sc]) => sc >= 70).sort((x, y) => y[1] - x[1]).forEach(([p]) => queue.push(['ail_sourced', p.id]));
  let n = 0;
  for (const [t, id] of queue) {
    if (room <= 0 || left() < 30000) break;
    try { await rrRevealRow(t, id); n++; room--; } catch (e) { out.errors.push('reveal: ' + e.message); if (e.status === 429 || e.status === 400) break; }
  }
  return n;
}
/* LinkedIn: no API for personal or Premium accounts, so the brief gives Ashish ready searches, profile links and short notes to paste */
const LI_KW = '"Chief AI Officer" OR "Head of AI" OR "Head of Artificial Intelligence" OR "Head of Generative AI" OR "VP AI" OR "Director of AI"';
const liJobs = place => `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(LI_KW)}&location=${encodeURIComponent(place)}&f_TPR=r86400&f_E=5%2C6`;
const liPeople = q => `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(q)}`;
const liClip = (t, n = 300) => t.length <= n ? t : t.slice(0, n - 1).replace(/[\s,.;:]+\S*$/, '') + '…';
const short = s => String(s || '').replace(/^A /, 'a ').replace(/\s*\(.*?\)\s*/g, ' ').trim();
const contactNote = (c, r) => {
  const head = `Hi ${firstName(c.name)}, I saw ${coName(r) || 'your team'} is hiring ${aOr(r.title)} ${r.title}. I run AI Leaders by DuaDesk, a search practice only for senior AI leadership roles.`;
  const full = `${head} Having built AI products myself (ex-Head of IT, Microsoft India), I assess candidates on what they have delivered. Happy to share a confidential slate.`;
  return full.length <= 300 ? full : liClip(`${head} Happy to share a confidential slate of proven candidates.`);
};
const candidateNote = (p, r) => { // the role only, never the employer
  const base = `Hi ${firstName(p.name)}, I'm running a confidential search for ${aOr(r.title)} ${r.title}${r.location ? ' in ' + r.location.split(',')[0] : ''} and your background stood out.`;
  const full = `${base} I build AI products myself (ex-Head of IT, Microsoft India), so I understand the work. Open to a short call? Ashish Dua, AI Leaders by DuaDesk`;
  return full.length <= 300 ? full : liClip(`${base} Open to a short call? Ashish Dua, AI Leaders by DuaDesk`);
};
const applicantNote = (c, r) => liClip(`Hi ${firstName(c.name)}, thank you for applying for the ${r.title} role (${r.ref}). I'd like to talk it through with you; could we find 30 minutes this week? Ashish Dua, AI Leaders by DuaDesk`);
const coName = r => String(r.company || '').replace(/\s*\|.*$/, '').replace(/\s+(GmbH\s*&\s*Co\.?\s*KG|GmbH|AG|SE|KGaA|Inc\.?|Ltd\.?|plc|LLC)\b\.?/gi, '').trim();
function contactDraft(c, r) {
  const where = r.location ? ` in ${r.location.split(',')[0]}` : '';
  const co = coName(r) || 'your company';
  return { kind: 'Hiring contact', table: 'ail_contacts', id: c.id, to: c.email, phone: c.phone, phone_type: c.phone_type, li: c.linkedin_url, note: contactNote(c, r), name: c.name, who: `${c.title || ''} · ${c.company || r.company || ''}`, about: `${r.ref} ${r.title}`,
    subject: `${r.title}: a shortlist of proven AI leaders`,
    ...fmt(`Dear ${firstName(c.name)},

I saw that **${co} is hiring ${aOr(r.title)} ${r.title}**${where}. I run **AI Leaders by DuaDesk**, a search practice that focuses only on senior AI leadership roles, and I would like to help you fill it.

## About the role
Roles like this are hard to hire for. Many candidates have AI on their CV; far fewer have **taken AI into production, shown measurable value, built a team and kept it well governed**. That is what we look for.

## How we work
• **Role first:** we start by agreeing what the ${r.title} must achieve in the first 12 to 24 months.
• **Evidence, not titles:** every candidate is assessed on systems delivered, value created, teams built and risk managed.
• **A short, confidential slate**, with a written view of each candidate's strengths and risks.
• **Global reach:** India, Europe, the Middle East and North America, including strong people who are not actively looking and leaders open to relocation.

## About AI Leaders by DuaDesk
What makes our assessment different is that **I build AI myself**. Over the last three years I have designed and shipped **13 live AI products at DuaDesk**, across finance, procurement, audit and banking. Before that I led enterprise technology as **Head of IT at Microsoft India** and **Technical Director at KPMG India**, and I hold an **Executive PG Certification in Generative AI and Machine Learning from IIT Roorkee**. So when a candidate describes their work, I can tell real delivery from slideware. I am a Canadian citizen, and we work through my firm, **Ashish Dua Consulting Corporation, registered in Canada**.

## Next step
Would a **20-minute call next week** be useful to talk through the role? There is no commitment in that first conversation.

${SIGN}

P.S. If this is not relevant, just let me know and I will not follow up.`) };
}
function candidateDraft(p, r, fit) { // the role only, never the employer's name
  const at = [p.title, p.company].filter(Boolean).join(' at ');
  return { kind: 'Possible candidate', table: 'ail_sourced', id: p.id, to: p.email, phone: p.phone, phone_type: p.phone_type, li: p.linkedin_url, note: candidateNote(p, r), name: p.name, who: `${p.title || ''} · ${p.company || ''}`, about: `${r.ref} ${r.title} (fit ${fit.score}/100)`,
    subject: `A confidential ${r.title} role`,
    ...fmt(`Dear ${firstName(p.name)},

I run **AI Leaders by DuaDesk**, a search practice that focuses only on senior AI leadership roles. ${at ? `Your work as ${at} stood out to me, and ` : ''}I am working on a confidential search that I think could be a strong fit for your background.

## About the role
**${r.title}**${r.location ? `, based in **${r.location}**` : ''} (reference ${r.ref})${r.summary ? `
${r.summary}` : ''}

## About me and AI Leaders by DuaDesk
**I build AI myself.** Over the last three years I have designed and shipped **13 live AI products at DuaDesk**, across finance, procurement, audit and banking. Before that I led enterprise technology as **Head of IT at Microsoft India** and **Technical Director at KPMG India**, and I hold an **Executive PG Certification in Generative AI and Machine Learning from IIT Roorkee**. So I understand the work you have done, and I can present it to employers for what it is: real delivery, not just a title. I am a Canadian citizen, and we work through my firm, **Ashish Dua Consulting Corporation, registered in Canada**.

## Next step
If you are open to a conversation, I would be glad to share more **in confidence**. Would you have **20 minutes for a call** this week or next? You can also see the role (reference ${r.ref}) at duadesk.com/ai-leaders.

${SIGN}

P.S. If you would rather not hear from me about roles, just say so and I will not write again.`) };
}
function applicantDraft(a, c, r) {
  return { kind: 'Applicant (strong match)', table: 'ail_applications', id: a.id, to: c.email, phone: c.phone, li: c.linkedin, note: applicantNote(c, r), name: c.name, who: `${c.current_title || ''} · ${c.current_company || ''}`, about: `${r.ref} ${r.title} (fit ${a.score}/100)`,
    subject: `Your application: ${r.title} (${r.ref})`,
    ...fmt(`Dear ${firstName(c.name)},

Thank you for applying through **AI Leaders by DuaDesk**. I have read your profile and would like to talk it through with you before anything goes further.

## About the role
**${r.title}** (reference ${r.ref})

## Next step
Could we have a **30-minute call this week**? Please send me two or three times that suit you.

${SIGN}`) };
}
async function buildDrafts() {
  const roles = new Map((await sb('ail_roles?select=id,ref,title,company,company_masked,location,summary,status&limit=1000')).map(r => [r.id, r]));
  const byRef = new Map([...roles.values()].map(r => [r.ref, r]));
  const out = [];
  for (const c of await sb('ail_contacts?select=*&revealed_at=not.is.null&drafted_at=is.null&email=not.is.null&status=eq.revealed&limit=20')) {
    const r = roles.get(c.role_id); if (r && r.status === 'open') out.push(Object.assign(contactDraft(c, r), { role_id: c.role_id }));
  }
  for (const p of await sb('ail_sourced?select=*&revealed_at=not.is.null&drafted_at=is.null&email=not.is.null&status=eq.revealed&limit=20')) {
    const fit = (p.fits || []).filter(f => byRef.has(f.ref) && byRef.get(f.ref).status === 'open').sort((x, y) => y.score - x.score)[0];
    if (fit) out.push(candidateDraft(p, byRef.get(fit.ref), fit));
  }
  for (const a of await sb('ail_applications?select=id,score,role_id,status,ail_candidates(name,email,phone,linkedin,current_title,current_company)&match_state=eq.done&drafted_at=is.null&status=eq.new&score=gte.70&limit=20')) {
    const r = roles.get(a.role_id); if (r && a.ail_candidates && a.ail_candidates.email) out.push(applicantDraft(a, a.ail_candidates, r));
  }
  return out.slice(0, 25);
}
// people we can reach on LinkedIn without spending a RocketReach credit
async function buildLinkedIn(emailDrafts) {
  const roles = new Map((await sb('ail_roles?select=id,ref,title,company,company_masked,location,status&status=eq.open&limit=1000')).map(r => [r.id, r]));
  const byRef = new Map([...roles.values()].map(r => [r.ref, r]));
  const covered = new Set([...(await sb('ail_contacts?select=role_id&or=(drafted_at.not.is.null,li_drafted_at.not.is.null)&limit=1000')).map(x => x.role_id),
    ...emailDrafts.filter(d => d.table === 'ail_contacts').map(d => d.role_id)]);
  const best = new Map();
  for (const c of await sb('ail_contacts?select=*&linkedin_url=not.is.null&revealed_at=is.null&li_drafted_at=is.null&status=eq.found&limit=300')) {
    if (!roles.has(c.role_id) || covered.has(c.role_id)) continue;
    const cur = best.get(c.role_id); if (!cur || HIRE_RANK(c.title) < HIRE_RANK(cur.title)) best.set(c.role_id, c);
  }
  const out = [...best.values()].slice(0, 10).map(c => { const r = roles.get(c.role_id); return { kind: 'Hiring contact', table: 'ail_contacts', id: c.id, li: c.linkedin_url, phone: c.phone, phone_type: c.phone_type, name: c.name, who: `${c.title || ''} · ${c.company || ''}`, about: `${r.ref} ${r.title}`, note: contactNote(c, r) }; });
  const emailed = new Set(emailDrafts.filter(d => d.table === 'ail_sourced').map(d => d.id));
  const people = (await sb('ail_sourced?select=*&linkedin_url=not.is.null&email=is.null&li_drafted_at=is.null&status=in.(found,no_email)&fits=not.is.null&limit=300'))
    .filter(p => !emailed.has(p.id)).map(p => [p, (p.fits || []).filter(f => byRef.has(f.ref)).sort((x, y) => y.score - x.score)[0]]).filter(([, f]) => f && f.score >= 60).sort((x, y) => y[1].score - x[1].score).slice(0, 10);
  for (const [p, f] of people) { const r = byRef.get(f.ref); out.push({ kind: 'Possible candidate', table: 'ail_sourced', id: p.id, li: p.linkedin_url, phone: p.phone, phone_type: p.phone_type, name: p.name, who: `${p.title || ''} · ${p.company || ''}`, about: `${r.ref} ${r.title} (fit ${f.score}/100)`, note: candidateNote(p, r) }); }
  return out;
}
/* Outlook: put each draft straight into Ashish's Drafts folder (Microsoft Graph, the "DuaDesk Webinars" app; needs the Mail.ReadWrite application permission) */
const MS = () => ({ tenant: process.env.MS_TENANT_ID || '', client: process.env.MS_CLIENT_ID || '', secret: process.env.MS_CLIENT_SECRET || '',
  login: process.env.MS_LOGIN_BASE || 'https://login.microsoftonline.com', graph: process.env.MS_GRAPH_BASE || 'https://graph.microsoft.com/v1.0',
  mailbox: process.env.AIL_DRAFTS_MAILBOX || process.env.AIL_OWNER_EMAIL || process.env.WEBINAR_OWNER_EMAIL || 'ashish@ashishduacorporation.com' });
let msTok = { v: '', exp: 0 };
async function msGraph(path, opts = {}) {
  try { return await msGraph1(path, opts); } catch (e) { if (e.status !== 403) throw e; msTok = { v: '', exp: 0 }; return msGraph1(path, opts); } // a new permission needs a fresh token
}
async function msGraph1(path, { method = 'GET', body } = {}) {
  const m = MS(); if (!m.tenant || !m.client || !m.secret) throw E('Microsoft 365 is not connected (MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET).', 503);
  if (!msTok.v || Date.now() > msTok.exp - 60000) {
    const r = await fetch(`${m.login}/${encodeURIComponent(m.tenant)}/oauth2/v2.0/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: m.client, client_secret: m.secret, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' }).toString(), signal: AbortSignal.timeout(15000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.access_token) throw E('Microsoft sign-in failed: ' + String(j.error_description || j.error || r.status).split('\r\n')[0].slice(0, 160), 502);
    msTok = { v: j.access_token, exp: Date.now() + (+j.expires_in || 3600) * 1000 };
  }
  const res = await fetch(m.graph + path, { method, headers: { Authorization: 'Bearer ' + msTok.v, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) });
  const j = res.status === 204 ? {} : await res.json().catch(() => ({}));
  if (!res.ok) { const msg = (j.error && j.error.message) || res.status; throw E(res.status === 403 || /access is denied|insufficient privileges|authorization/i.test(String(msg)) ? 'Outlook drafts need the Mail.ReadWrite permission on the DuaDesk Webinars app (with admin consent).' : 'Outlook: ' + String(msg).slice(0, 200), res.status === 403 ? 403 : 502); }
  return j;
}
async function outlookDrafts(drafts) {
  const out = { created: 0, error: null };
  if (!drafts.length) return out;
  const box = encodeURIComponent(MS().mailbox);
  for (const d of drafts) {
    try {
      await msGraph(`/users/${box}/messages`, { method: 'POST', body: { subject: d.subject, body: d.html ? { contentType: 'HTML', content: d.html } : { contentType: 'Text', content: d.body }, toRecipients: [{ emailAddress: { address: d.to, ...(d.name ? { name: d.name } : {}) } }], categories: ['AI Leaders'] } });
      out.created++;
    } catch (e) { out.error = e.message; if (e.status === 403 || e.status === 503) break; }
  }
  return out;
}
// Outlook on the web: opens a new message in the signed-in Microsoft 365 mailbox, filled in and ready to send
const owaLink = d => `https://outlook.office.com/mail/deeplink/compose?to=${encodeURIComponent(d.to)}&subject=${encodeURIComponent(d.subject)}&body=${encodeURIComponent(d.body)}`;
const mailtoLink = d => `mailto:${encodeURIComponent(d.to)}?subject=${encodeURIComponent(d.subject)}&body=${encodeURIComponent(d.body.replace(/\n/g, '\r\n'))}`;
// an Outlook-ready draft file: X-Unsent makes Outlook open it as a new message ready to send
const emlFile = d => Buffer.from(`To: ${d.name ? `"${String(d.name).replace(/"/g, '')}" ` : ''}<${d.to}>\r\nSubject: =?UTF-8?B?${Buffer.from(d.subject).toString('base64')}?=\r\nX-Unsent: 1\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${Buffer.from(d.body.replace(/\n/g, '\r\n')).toString('base64').replace(/.{76}/g, '$&\r\n')}\r\n`).toString('base64');
const phoneLine = d => d.phone ? `<div style="font-size:13px;margin:2px 0 4px">📞 <a href="${esc(telLink(d.phone))}" style="color:#1f1d2b;text-decoration:none"><b>${esc(d.phone)}</b></a>${d.phone_type && d.phone_type !== 'other' ? ` <span style="color:#7a7394">(${esc(d.phone_type)})</span>` : ''}${d.phone_type !== 'work' ? ` · <a href="${esc(waLink(d.phone))}" style="color:#1a8f4c;font-weight:700">WhatsApp</a>` : ''}</div>` : '';
async function digest(out, drafts = [], lis = []) {
  const { OWNER, SITE } = ENV();
  const newRoles = await sb(`ail_roles?select=ref,title,company,company_masked,location,source_url,source&status=eq.open&found_at=gte.${new Date(Date.now() - 26 * 3600000).toISOString()}&order=found_at.desc&limit=50`); // every role added since yesterday's brief: by the radar, by Claude's morning research or by hand
  const openRoles = (await sb('ail_roles?select=id&status=eq.open&limit=1000')).length;
  const newApps = (await sb(`ail_applications?select=id&created_at=gte.${new Date(Date.now() - 86400000).toISOString()}&limit=1000`)).length;
  const ol = await outlookDrafts(drafts).catch(e => ({ created: 0, error: e.message }));
  const inOutlook = drafts.length && ol.created === drafts.length;
  const draftHtml = drafts.length ? `<h2 style="font:700 18px Georgia,serif;margin:18px 0 6px">${drafts.length} draft email${drafts.length === 1 ? '' : 's'} ready</h2>
${inOutlook ? `<p style="margin:0 0 10px;padding:10px 12px;background:#e8f5ec;border-radius:8px;color:#1e5b33"><b>All ${drafts.length} are already in your Outlook Drafts folder</b> (category <b>AI Leaders</b>). In Outlook, open <b>Drafts</b>, click a draft, check it and click <b>Send</b>.</p>` : (ol.error ? `<p style="margin:0 0 10px;padding:10px 12px;background:#fff4e0;border-radius:8px;color:#7a4a00">${ol.created ? `${ol.created} of ${drafts.length} drafts were put in your Outlook Drafts folder. ` : ''}Could not put ${ol.created ? 'the rest' : 'them'} in Outlook: ${esc(ol.error)} Use the buttons or attached files below for now.</p>` : '')}
<p style="font-size:13px;color:#7a7394;margin:0 0 10px">Click <b>Open in Outlook</b>: a new message opens in Outlook on the web (signed in as ashish@ashishduacorporation.com), already addressed and written. Check it and click <b>Send</b>. <b>Open in mail app</b> does the same in your computer's email app, if one is set up. Each draft is also attached as a file. Nothing has been sent.</p>
${drafts.map((d, i) => `<div style="border:1px solid #e4def7;border-radius:10px;padding:12px 14px;margin:0 0 10px">
<div style="font-size:12px;color:#6b4fe0;font-weight:700;text-transform:uppercase;letter-spacing:1px">${i + 1}. ${esc(d.kind)} · ${esc(d.about)}</div>
<div style="margin:4px 0"><b>${esc(d.name || '')}</b> <span style="color:#7a7394">${esc(d.who)}</span> · ${esc(d.to)}</div>${phoneLine(d)}
<div style="font-size:14px;margin:0 0 6px"><b>Subject:</b> ${esc(d.subject)}</div>
<details><summary style="cursor:pointer;color:#6b4fe0;font-size:13px">Read the draft</summary><pre style="white-space:pre-wrap;font:13px/1.5 Arial,sans-serif;background:#f7f5fd;border-radius:8px;padding:10px;margin:6px 0 0">${esc(d.body)}</pre></details>
<a href="${esc(owaLink(d))}" style="display:inline-block;margin-top:8px;background:#0f6cbd;color:#fff;text-decoration:none;border-radius:999px;padding:7px 14px;font-weight:700;font-size:13px">Open in Outlook</a> <a href="${esc(mailtoLink(d))}" style="display:inline-block;margin-top:8px;border:1px solid #8b6cff;color:#6b4fe0;text-decoration:none;border-radius:999px;padding:6px 13px;font-weight:700;font-size:13px">Open in mail app</a>${d.li ? ` <a href="${esc(d.li)}" style="display:inline-block;margin-top:8px;border:1px solid #0a66c2;color:#0a66c2;text-decoration:none;border-radius:999px;padding:6px 13px;font-weight:700;font-size:13px">LinkedIn profile</a>
<div style="font-size:12px;color:#7a7394;margin:8px 0 2px">LinkedIn note (copy into a connection request or InMail):</div><div style="font-size:13px;background:#eef4fb;border-radius:8px;padding:8px 10px">${esc(d.note)}</div>` : ''}</div>`).join('')}` : '<p style="color:#7a7394">No new email drafts today.</p>';
  const region = REGIONS[Math.floor(Date.now() / 86400000) % REGIONS.length];
  const liHtml = `<h2 style="font:700 18px Georgia,serif;margin:20px 0 6px">On LinkedIn today</h2>
<p style="font-size:13px;color:#7a7394;margin:0 0 8px">Open these while signed in to your Premium account.</p>
<ul style="margin:0 0 12px;padding-left:20px">${(RR_PLACES[region] || []).map(p => `<li><a href="${esc(liJobs(p))}" style="color:#0a66c2">AI leadership jobs posted in the last 24 hours: ${esc(p)}</a></li>`).join('')}
<li><a href="${esc(liJobs('Worldwide'))}" style="color:#0a66c2">AI leadership jobs posted in the last 24 hours: worldwide</a></li>
${(RR_PLACES[region] || []).slice(0, 2).map(p => `<li><a href="${esc(liPeople(`"Chief AI Officer" OR "Head of AI" ${p}`))}" style="color:#0a66c2">AI leaders in ${esc(p)}</a></li>`).join('')}</ul>
<p style="font-size:13px;color:#7a7394;margin:0 0 12px">Found a good role there? Add it on the desk under Roles → Add a role, as a Market opportunity.</p>
${lis.length ? `<b>${lis.length} ${lis.length === 1 ? 'person' : 'people'} to reach on LinkedIn (no RocketReach credit used)</b>
${lis.map((d, i) => `<div style="border:1px solid #d6e4f5;border-radius:10px;padding:10px 14px;margin:8px 0">
<div style="font-size:12px;color:#0a66c2;font-weight:700;text-transform:uppercase;letter-spacing:1px">${i + 1}. ${esc(d.kind)} · ${esc(d.about)}</div>
<div style="margin:4px 0"><b>${esc(d.name || '')}</b> <span style="color:#7a7394">${esc(d.who)}</span></div>${phoneLine(d)}
<div style="font-size:13px;background:#eef4fb;border-radius:8px;padding:8px 10px;margin:4px 0">${esc(d.note)}</div>
<a href="${esc(d.li)}" style="display:inline-block;margin-top:4px;background:#0a66c2;color:#fff;text-decoration:none;border-radius:999px;padding:6px 13px;font-weight:700;font-size:13px">Open LinkedIn profile</a></div>`).join('')}` : ''}
${newRoles.filter(r => r.company && !/^(undisclosed|confidential)/i.test(r.company)).length ? `<b>Hiring teams for today's new roles</b><ul style="margin:6px 0 12px;padding-left:20px">${newRoles.filter(r => r.company && !/^(undisclosed|confidential)/i.test(r.company)).map(r => `<li><a href="${esc(liPeople(r.company.replace(/\s+(GmbH|AG|SE|Inc\.?|Ltd\.?|plc)\b.*$/i, '') + ' talent acquisition'))}" style="color:#0a66c2">${esc(r.ref)} ${esc(r.company)}: talent and HR people</a></li>`).join('')}</ul>` : ''}`;
  const html = shell('Your AI Leaders morning brief', `
<p style="margin:0 0 12px">${openRoles} open role${openRoles === 1 ? '' : 's'} on the board · ${newApps} new application${newApps === 1 ? '' : 's'} in the last day${out.revealed ? ` · ${out.revealed} email${out.revealed === 1 ? '' : 's'} revealed on RocketReach today` : ''}.</p>
${newRoles.length ? `<b>${newRoles.length} new role${newRoles.length > 1 ? 's' : ''} added since yesterday and now live, company masked</b>
<ul style="margin:6px 0 14px;padding-left:20px">${newRoles.map(r => `<li>${esc(r.ref)} <b>${esc(r.title)}</b> · ${esc(r.company)} <span style="color:#7a7394">(shown as “${esc(r.company_masked)}”)</span> · ${esc(r.location || '')}${r.source_url ? ` · <a href="${esc(r.source_url)}" style="color:#6b4fe0">source</a>` : ''}</li>`).join('')}</ul>
<p style="font-size:13px;color:#7a7394;margin:-6px 0 14px">If any should not be shown, hide it on the desk.</p>` : (out.radar ? `<p>No new roles found in ${esc(out.radar.region)} today.</p>` : '')}
${out.pool.length ? `<b>People already in your pool who fit new roles</b><ul style="margin:6px 0 14px;padding-left:20px">${out.pool.map(x => `<li>${esc(x.person.name)} → ${esc(x.role.ref)} ${esc(x.role.title)} ${scoreChip(x.score)} ${esc(x.why)}</li>`).join('')}</ul>` : ''}
${out.contacts || (out.sourced && out.sourced.added) ? `<b>From RocketReach</b><ul style="margin:6px 0 14px;padding-left:20px">${out.contacts ? `<li>${out.contacts} hiring contact${out.contacts === 1 ? '' : 's'} found at companies with open roles</li>` : ''}${out.sourced && out.sourced.added ? `<li>${out.sourced.added} new AI leader${out.sourced.added === 1 ? '' : 's'} sourced in ${esc(out.sourced.region)}${out.sourced_fits ? `, ${out.sourced_fits} suggested for open roles` : ''}</li>` : ''}</ul>` : ''}
${draftHtml}
${liHtml}
${out.errors.length ? `<b>Needs a look</b>${ul(out.errors)}` : ''}
<p style="margin:16px 0 0"><a href="${esc(SITE)}/ai-leaders/admin/" style="display:inline-block;background:#8b6cff;color:#fff;text-decoration:none;border-radius:999px;padding:10px 18px;font-weight:700">Open the AI Leaders desk</a></p>`);
  const attachments = inOutlook ? [] : drafts.map((d, i) => ({ filename: `${String(i + 1).padStart(2, '0')} ${String(d.name || 'draft').replace(/[^\w\- ]+/g, '').slice(0, 40)}.eml`, content: emlFile(d) }));
  const sent = await mail({ to: OWNER, subject: `AI Leaders morning brief: ${drafts.length} email draft${drafts.length === 1 ? '' : 's'}${inOutlook ? ' in your Outlook Drafts' : ''}, ${lis.length} LinkedIn, ${newRoles.length} new role${newRoles.length === 1 ? '' : 's'}`, html, attachments, idem: 'ail-brief-' + new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10) + '-' + sha(html).slice(0, 16) }); // same content is never sent twice; changed content always goes out
  if (sent) {
    const now = new Date().toISOString();
    for (const d of drafts) await sb(`${d.table}?id=eq.${d.id}`, { method: 'PATCH', body: d.table === 'ail_applications' ? { drafted_at: now } : { drafted_at: now, li_drafted_at: now } }).catch(() => {});
    for (const d of lis) await sb(`${d.table}?id=eq.${d.id}`, { method: 'PATCH', body: { li_drafted_at: now } }).catch(() => {});
  }
  return sent;
}

/* ---------- the admin desk ---------- */
const admin = {
  async desk() {
    const [roles, apps, runs, pool, contacts, sourced, rr, used] = await Promise.all([
      sb('ail_roles?select=*&order=found_at.desc&limit=300'),
      sb('ail_applications?select=id,role_id,candidate_id,note,status,match_state,match_error,score,match,matched_at,admin_note,created_at,updated_at,ail_candidates(id,name,email,phone,linkedin,current_title,current_company,years,location,cv_path,open_to_other)&order=created_at.desc&limit=500'),
      sb('ail_runs?select=*&order=started_at.desc&limit=12'),
      sb('ail_matches?select=role_id,candidate_id,source,score,match,created_at,ail_candidates(name,current_title,current_company,email)&source=eq.pool&order=created_at.desc&limit=300'),
      sb('ail_contacts?select=*&order=created_at.desc&limit=600'),
      sb('ail_sourced?select=*&order=created_at.desc&limit=600'),
      rrSettings(), rrUsedToday().catch(() => 0),
    ]);
    return { roles, apps, runs, pool, contacts, sourced, rocketreach: { connected: !!rr.key, limit: rr.limit, used_today: used, auto_reveals: await autoSettings() }, regions: REGIONS, levels: LEVELS, statuses: APP_STATUS, ai: !!ENV().AI_KEY, email: !!ENV().RESEND_KEY };
  },
  async role_save(b) {
    const id = +b.id || null;
    const r = roleInput(b, !!id);
    if (b.status && ['open', 'hidden', 'closed'].includes(b.status)) r.status = b.status;
    maskOut(r);
    r.updated_at = new Date().toISOString();
    if (id) { const [row] = await sb(`ail_roles?id=eq.${id}`, { method: 'PATCH', body: r, prefer: 'return=representation' }); if (!row) throw E('Role not found', 404); return { role: row }; }
    r.source = b.source === 'radar' ? 'radar' : 'manual'; r.fingerprint = fingerprint(r);
    const [row] = await sb('ail_roles', { method: 'POST', body: r, prefer: 'return=representation' });
    return { role: await setRef(row) };
  },
  async role_status(b) {
    if (!['open', 'hidden', 'closed'].includes(b.status)) throw E('Unknown status');
    const [row] = await sb(`ail_roles?id=eq.${+b.id}`, { method: 'PATCH', body: { status: b.status, updated_at: new Date().toISOString(), ...(b.status === 'open' ? { found_at: new Date().toISOString() } : {}) }, prefer: 'return=representation' });
    return { role: row };
  },
  async role_delete(b) { await sb(`ail_roles?id=eq.${+b.id}`, { method: 'DELETE' }); return { ok: true }; },
  async radar_run(b) { const region = REGIONS.includes(b.region) ? b.region : REGIONS[0]; const r = await radar(region); const fresh = r.ids.length ? await sb(`ail_roles?select=*&id=in.(${r.ids.join(',')})`) : []; let pool = 0; for (const x of fresh) { try { pool += (await poolMatch(x)).length; } catch { } } return { ...r, pool }; },
  async app_update(b) {
    const patch = { updated_at: new Date().toISOString() };
    if (b.status) { if (!APP_STATUS.includes(b.status)) throw E('Unknown status'); patch.status = b.status; }
    if ('admin_note' in b) patch.admin_note = clean(b.admin_note, 2000) || null;
    const [row] = await sb(`ail_applications?id=eq.${+b.id}`, { method: 'PATCH', body: patch, prefer: 'return=representation' });
    return { app: row };
  },
  async rematch(b) { await sb(`ail_applications?id=eq.${+b.id}`, { method: 'PATCH', body: { match_state: 'pending', match_tries: 0 } }); return matchApplication(+b.id); },
  async cv_link(b) { const [c] = await sb(`ail_candidates?select=cv_path&id=eq.${+b.candidate_id}`); if (!c || !c.cv_path) throw E('No CV on file', 404); return { url: await cvLink(c.cv_path, 3600) }; },
  async candidate_delete(b) { // a person asked to be forgotten
    const [c] = await sb(`ail_candidates?select=id,cv_path&id=eq.${+b.candidate_id}`);
    if (!c) throw E('Not found', 404);
    if (c.cv_path) await cvRemove([c.cv_path]);
    await sb(`ail_candidates?id=eq.${c.id}`, { method: 'DELETE' });
    return { ok: true };
  },
  async cron_now() { return cronRun(); },
  async auto_reveals(b) { const n = Math.max(0, Math.min(20, Math.round(+b.value) || 0)); await sb('settings?on_conflict=key', { method: 'POST', body: [{ key: 'ail_auto_reveals', value: String(n) }], prefer: 'resolution=merge-duplicates,return=minimal' }); return { value: n }; },
  async brief_now() { const d = await buildDrafts(); const l = await buildLinkedIn(d); const sent = await digest({ matched: 0, radar: null, pool: [], closed: 0, contacts: 0, sourced: null, sourced_fits: 0, errors: [] }, d, l); return { sent: !!sent, id: sent && sent.id, drafts: d.length, linkedin: l.length }; },
  async outlook_remove(b) {
    const to = new Set((Array.isArray(b.to) ? b.to : []).map(normEmail).filter(Boolean)); if (!to.size) throw E('Say which addresses.');
    const box = encodeURIComponent(MS().mailbox);
    const list = await msGraph(`/users/${box}/mailFolders/drafts/messages?$select=id,subject,toRecipients,categories&$top=100`);
    let removed = 0;
    for (const m of list.value || []) if ((m.categories || []).includes('AI Leaders') && (m.toRecipients || []).some(r => to.has(normEmail(r.emailAddress && r.emailAddress.address)))) { await msGraph(`/users/${box}/messages/${encodeURIComponent(m.id)}`, { method: 'DELETE' }); removed++; }
    return { removed };
  },
  async outlook_test() { const f = await msGraph(`/users/${encodeURIComponent(MS().mailbox)}/mailFolders/drafts?$select=displayName,totalItemCount`); return { ok: true, mailbox: MS().mailbox, folder: f.displayName, items: f.totalItemCount }; },
  async drafts_preview() { const d = await buildDrafts(); return { drafts: d.map(x => ({ ...x, mailto: mailtoLink(x), owa: owaLink(x) })), linkedin: await buildLinkedIn(d) }; },
  async rr_contacts(b) { if (b.refresh) await sb(`ail_contacts?role_id=eq.${+b.role_id}&revealed_at=is.null&status=eq.found`, { method: 'DELETE' }); const s = await rrSettings(); if (!s.key) throw E('Add your RocketReach API key in the webinar admin Settings first.'); const [r] = await sb(`ail_roles?select=id,ref,company,location&id=eq.${+b.role_id}`); if (!r) throw E('Role not found', 404); if (undisclosed(r.company)) throw E('The company is not named for this role, so there is no one to search for.'); return { found: await findContacts(r, s.key) }; },
  async rr_source(b) { const s = await rrSettings(); if (!s.key) throw E('Add your RocketReach API key in the webinar admin Settings first.'); const region = REGIONS.includes(b.region) ? b.region : REGIONS[0]; const r = await sourceLeaders(region, s.key); let fits = 0; if (ENV().AI_KEY) { try { fits = await fitSourced(); } catch (e) { r.note = 'Role suggestions need the AI: ' + e.message; } } return { ...r, fits }; },
  async rr_account() { const s = await rrSettings(); if (!s.key) throw E('Not connected'); const a = await rrReq(s.key, 'account'); const pick = {}; for (const k of Object.keys(a || {})) if (/credit|lookup|plan|state|status|limit|remaining|balance/i.test(k)) pick[k] = a[k]; return { account: pick }; },
  async rr_fits() { return { suggested: await fitSourced() }; },
  async rr_phones(b) { return rrPhonesRefresh(b.list === 'contacts' ? 'ail_contacts' : 'ail_sourced', Math.min(25, +b.limit || 1)); },
  async rr_reveal(b) { return rrRevealRow(b.list === 'sourced' ? 'ail_sourced' : 'ail_contacts', b.id); },
  async rr_status(b) { const t = b.list === 'sourced' ? 'ail_sourced' : 'ail_contacts'; if (!['found', 'revealed', 'no_email', 'contacted', 'dismissed'].includes(b.status)) throw E('Unknown status'); const [row] = await sb(`${t}?id=eq.${+b.id}`, { method: 'PATCH', body: { status: b.status }, prefer: 'return=representation' }); return { row }; },
};

/* ---------- the handler ---------- */
export default async function handler(req, res) {
  const { CRON, ADMIN } = ENV();
  try {
    // Vercel Cron (GET with the cron secret) or a scheduler posting x-cron-key
    const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (CRON && (safeEq(bearer, CRON) || safeEq(req.headers['x-cron-key'] || '', CRON))) return send(res, 200, await cronRun());
    if (req.method === 'GET') {
      const q = new URL(req.url, 'http://x').searchParams;
      if ((q.get('action') || 'roles') !== 'roles') return send(res, 400, { error: 'Unknown action' });
      const rows = await sb('ail_roles?select=ref,title,level,industry,region,location,work_mode,summary,must_haves,company_masked,source,posted_on,found_at&status=eq.open&order=found_at.desc&limit=200');
      return send(res, 200, { roles: rows.map(publicRole), updated: new Date().toISOString() }, 'public, max-age=0, s-maxage=60, stale-while-revalidate=30');
    }
    if (req.method !== 'POST') return send(res, 405, { error: 'GET or POST only' });
    const b = await readBody(req);
    if (b.action === 'apply') return send(res, 200, await apply(req, b));
    if (b.action === 'match') {
      if (!checkMatchTok(b.id, b.t)) return send(res, 403, { error: 'Not allowed' });
      try { const r = await matchApplication(+b.id); return send(res, 200, { ok: true, done: !!r.done }); } catch (e) { console.error('ail match', e); return send(res, 200, { ok: true, done: false }); } // the daily job retries
    }
    // the admin desk
    if (!ADMIN) return send(res, 503, { error: 'Admin password is not configured (WEBINAR_ADMIN_PASSWORD).' });
    if (!(await rateOk(req, 'admin-fail', 900, 10, false))) return send(res, 429, { error: 'Too many wrong passwords. Try again in 15 minutes.' });
    if (!safeEq(req.headers['x-admin-key'] || '', ADMIN)) { await rateOk(req, 'admin-fail', 900, 10, true); await new Promise(r => setTimeout(r, 600)); return send(res, 401, { error: 'Wrong password' }); }
    const fn = admin[b.action];
    if (!fn) return send(res, 400, { error: 'Unknown action' });
    return send(res, 200, await fn(b));
  } catch (e) {
    if (!e.status || e.status >= 500) console.error('ai-leaders', e);
    return send(res, e.status && e.status < 600 ? e.status : 500, { error: e.message || 'Server error' });
  }
}
const checkMatchTok = (id, t) => !!+id && safeEq(tok('ail-match', +id), t);
