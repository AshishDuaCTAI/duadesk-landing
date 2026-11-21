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
async function mail({ to, subject, html, idem, replyTo }) {
  const { RESEND_KEY, FROM, REPLY_TO } = ENV();
  if (!RESEND_KEY) { console.warn('ail: RESEND_API_KEY missing, email skipped:', subject); return null; }
  const headers = { Authorization: 'Bearer ' + RESEND_KEY, 'Content-Type': 'application/json' };
  if (idem) headers['Idempotency-Key'] = String(idem).slice(0, 256);
  const res = await fetch('https://api.resend.com/emails', { method: 'POST', headers, body: JSON.stringify({ from: FROM, to: [to], subject, html, reply_to: replyTo || REPLY_TO }) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) { console.error('ail mail', res.status, d); return null; }
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
    subject: role ? `We have your application: ${role.title} (${role.ref})` : 'We have your profile',
    html: shell(role ? 'Thank you for applying' : 'Thank you for sharing your profile', `<p>Dear ${esc(c.name.split(' ')[0])},</p>
<p>${role ? `We have received your application for <b>${esc(role.title)}</b> with ${esc(role.company_masked || 'a confidential company')} (reference ${esc(role.ref)}).` : 'We have received your profile.'}</p>
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

/* ---------- the daily job ---------- */
async function cronRun() {
  const t0 = Date.now(), left = () => 270000 - (Date.now() - t0);
  const out = { matched: 0, radar: null, pool: [], closed: 0, errors: [] };
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
  // 5. one short digest for Ashish, only when something happened
  if (out.radar && out.radar.added || out.pool.length || out.errors.length) await digest(out);
  return { ok: true, matched: out.matched, closed: out.closed, radar: out.radar, pool: out.pool.length, errors: out.errors };
}
async function digest(out) {
  const { OWNER, SITE } = ENV();
  const newRoles = out.radar && out.radar.ids && out.radar.ids.length ? await sb(`ail_roles?select=ref,title,company,company_masked,location,source_url&id=in.(${out.radar.ids.join(',')})`) : [];
  const html = shell('Today on the AI Leaders desk', `
${newRoles.length ? `<b>${newRoles.length} new role${newRoles.length > 1 ? 's' : ''} found (${esc(out.radar.region)}) and now live, company masked</b>
<ul style="margin:6px 0 14px;padding-left:20px">${newRoles.map(r => `<li>${esc(r.ref)} <b>${esc(r.title)}</b> · ${esc(r.company)} <span style="color:#7a7394">(shown as “${esc(r.company_masked)}”)</span> · ${esc(r.location || '')}${r.source_url ? ` · <a href="${esc(r.source_url)}" style="color:#6b4fe0">source</a>` : ''}</li>`).join('')}</ul>
<p style="font-size:13px;color:#7a7394;margin:-6px 0 14px">If any should not be shown, hide it on the desk.</p>` : (out.radar ? `<p>No new roles found in ${esc(out.radar.region)} today.</p>` : '')}
${out.pool.length ? `<b>People already in your pool who fit new roles</b><ul style="margin:6px 0 14px;padding-left:20px">${out.pool.map(x => `<li>${esc(x.person.name)} → ${esc(x.role.ref)} ${esc(x.role.title)} ${scoreChip(x.score)} ${esc(x.why)}</li>`).join('')}</ul>` : ''}
${out.errors.length ? `<b>Needs a look</b>${ul(out.errors)}` : ''}
<p style="margin:16px 0 0"><a href="${esc(SITE)}/ai-leaders/admin/" style="display:inline-block;background:#8b6cff;color:#fff;text-decoration:none;border-radius:999px;padding:10px 18px;font-weight:700">Open the AI Leaders desk</a></p>`);
  await mail({ to: OWNER, subject: `AI Leaders: ${newRoles.length} new role${newRoles.length === 1 ? '' : 's'}, ${out.pool.length} pool match${out.pool.length === 1 ? '' : 'es'}`, html, idem: 'ail-digest-' + new Date().toISOString().slice(0, 10) });
}

/* ---------- the admin desk ---------- */
const admin = {
  async desk() {
    const [roles, apps, runs, pool] = await Promise.all([
      sb('ail_roles?select=*&order=found_at.desc&limit=300'),
      sb('ail_applications?select=id,role_id,candidate_id,note,status,match_state,match_error,score,match,matched_at,admin_note,created_at,updated_at,ail_candidates(id,name,email,phone,linkedin,current_title,current_company,years,location,cv_path,open_to_other)&order=created_at.desc&limit=500'),
      sb('ail_runs?select=*&order=started_at.desc&limit=12'),
      sb('ail_matches?select=role_id,candidate_id,source,score,match,created_at,ail_candidates(name,current_title,current_company,email)&source=eq.pool&order=created_at.desc&limit=300'),
    ]);
    return { roles, apps, runs, pool, regions: REGIONS, levels: LEVELS, statuses: APP_STATUS, ai: !!ENV().AI_KEY, email: !!ENV().RESEND_KEY };
  },
  async role_save(b) {
    const id = +b.id || null;
    const r = roleInput(b, !!id);
    if (b.status && ['open', 'hidden', 'closed'].includes(b.status)) r.status = b.status;
    maskOut(r);
    r.updated_at = new Date().toISOString();
    if (id) { const [row] = await sb(`ail_roles?id=eq.${id}`, { method: 'PATCH', body: r, prefer: 'return=representation' }); if (!row) throw E('Role not found', 404); return { role: row }; }
    r.source = 'manual'; r.fingerprint = fingerprint(r);
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
      return send(res, 200, { roles: rows.map(publicRole), updated: new Date().toISOString() }, 'public, s-maxage=300, stale-while-revalidate=600');
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
