/**
 * Weekly New England source discovery — NOT a whole-internet crawl.
 *
 * 1) Fetch a curated seed list of public NE rec / university pages
 * 2) Extract candidate .ics / Google Calendar iCal links
 * 3) Optionally run Google Programmable Search (if CSE keys set) for "volleyball
 *    drop-in" + state + "ical" / "calendar"
 * 4) Write pending rows to ingestCandidates for super-admin approve/reject
 *
 * Explicitly skipped: Facebook, Meetup, Instagram, Active.com event HTML.
 *
 * Auth: Authorization Bearer ${CRON_SECRET}
 *    or Firebase ID token whose email is in SUPER_ADMIN_EMAILS
 */

const crypto = require('crypto');
const seeds = require('./ne-discovery-seeds');

const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'volleyball-score-tracker';
const CRON_SECRET = process.env.CRON_SECRET || '';
// Mirror firestore.rules superAdmins() as a last-resort fallback so local/prod
 // discover still works if SUPER_ADMIN_EMAILS was forgotten in the function env.
const SUPER_ADMIN_EMAILS = String(
  process.env.SUPER_ADMIN_EMAILS || process.env.REACT_APP_SUPER_ADMIN_EMAILS || ''
)
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);
const EFFECTIVE_SUPERS =
  SUPER_ADMIN_EMAILS.length > 0 ? SUPER_ADMIN_EMAILS : ['logontokartik@gmail.com'];

const BLOCKED_HOSTS = [
  'facebook.com',
  'fb.com',
  'meetup.com',
  'instagram.com',
  'active.com',
  'activenetwork.com',
];

function unauthorized(res, msg = 'Unauthorized') {
  res.status(401).json({ error: msg });
}

function authorizedCron(req) {
  if (!CRON_SECRET) return false;
  const header = req.headers.authorization || '';
  if (header === `Bearer ${CRON_SECRET}`) return true;
  if (req.query?.secret === CRON_SECRET) return true;
  return false;
}

function loadServiceAccount() {
  const fs = require('fs');
  const path = require('path');
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (raw && raw.trim() && raw.trim() !== '{' && raw.trim().startsWith('{')) {
    return JSON.parse(raw);
  }
  // Local/dev fallback: Vercel/dotenv often drop multi-KB JSON env values.
  const rel =
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH || './service-account.local.json';
  const abs = path.isAbsolute(rel) ? rel : path.join(process.cwd(), rel);
  if (!fs.existsSync(abs)) {
    throw new Error(
      'FIREBASE_SERVICE_ACCOUNT_JSON is not set (and no service-account.local.json). ' +
        'For local: put the key file at service-account.local.json or set FIREBASE_SERVICE_ACCOUNT_PATH.'
    );
  }
  return JSON.parse(fs.readFileSync(abs, 'utf8'));
}

async function getAdmin() {
  const admin = require('firebase-admin');
  if (!admin.apps.length) {
    const cred = loadServiceAccount();
    admin.initializeApp({
      credential: admin.credential.cert(cred),
      projectId: FIREBASE_PROJECT_ID || cred.project_id,
    });
  }
  return admin;
}

async function getAdminDb() {
  const admin = await getAdmin();
  return admin.firestore();
}

async function authorizedSuperAdmin(req) {
  const header = req.headers.authorization || '';
  const m = header.match(/^Bearer\s+(\S+)/i);
  if (!m) return { ok: false, reason: 'missing_bearer' };
  try {
    const admin = await getAdmin();
    const decoded = await admin.auth().verifyIdToken(m[1]);
    const email = String(decoded.email || '').toLowerCase();
    if (!email) return { ok: false, reason: 'token_missing_email' };
    if (!decoded.email_verified) return { ok: false, reason: 'email_unverified', email };
    if (!EFFECTIVE_SUPERS.includes(email)) {
      return {
        ok: false,
        reason: 'email_not_super_admin',
        email,
        hint: 'Add this address to SUPER_ADMIN_EMAILS (and REACT_APP_SUPER_ADMIN_EMAILS).',
      };
    }
    return { ok: true, email };
  } catch (err) {
    const msg = String(err?.message || err);
    if (/FIREBASE_SERVICE_ACCOUNT/i.test(msg) || /service-account\.local\.json/i.test(msg)) {
      return {
        ok: false,
        reason: 'missing_service_account',
        hint:
          'Add service-account.local.json in the project root (gitignored) or set FIREBASE_SERVICE_ACCOUNT_PATH, then restart vercel dev.',
      };
    }
    return { ok: false, reason: 'verifyIdToken_failed', detail: msg.slice(0, 180) };
  }
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

function isBlockedHost(url) {
  const host = hostOf(url);
  return BLOCKED_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

function looksLikeIcalUrl(url) {
  try {
    const u = new URL(url);
    const path = u.pathname.toLowerCase();
    return (
      path.endsWith('.ics') ||
      path.includes('/ical/') ||
      path.includes('/calendar/ical/') ||
      u.searchParams.has('ical') ||
      (u.hostname.includes('calendar.google.com') && path.includes('/ical/'))
    );
  } catch {
    return false;
  }
}

function normalizeIcalUrl(href, base) {
  try {
    const abs = new URL(href, base).toString();
    const u = new URL(abs);
    // Google embed → public ical
    if (u.hostname.includes('calendar.google.com') && u.searchParams.get('src') && !u.pathname.includes('/ical/')) {
      const src = u.searchParams.get('src');
      return `https://calendar.google.com/calendar/ical/${encodeURIComponent(src)}/public/basic.ics`;
    }
    return abs.split('#')[0];
  } catch {
    return null;
  }
}

function extractLinks(html, baseUrl) {
  const found = new Set();
  const re = /href\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html))) {
    const raw = m[1];
    if (!raw || raw.startsWith('javascript:') || raw.startsWith('mailto:')) continue;
    const abs = normalizeIcalUrl(raw, baseUrl);
    if (!abs || isBlockedHost(abs)) continue;
    if (looksLikeIcalUrl(abs) || /\.ics(\?|$)/i.test(abs)) found.add(abs);
  }
  // Also catch bare calendar.google.com/calendar/ical/... in page text/scripts
  const icalRe = /https?:\/\/calendar\.google\.com\/calendar\/ical\/[^"'\\\s<>]+/gi;
  let g;
  while ((g = icalRe.exec(html))) {
    const abs = g[0].replace(/[.,;)]+$/, '');
    if (!isBlockedHost(abs)) found.add(abs);
  }
  return [...found];
}

function pageMentionsVolleyball(html) {
  return /volley/i.test(html);
}

function candidateId(url) {
  return crypto.createHash('sha256').update(url).digest('hex').slice(0, 32);
}

async function fetchText(url) {
  const resp = await fetch(url, {
    headers: {
      'User-Agent': 'VolleyScoresDiscovery/1.0 (+https://volleyscores.app; weekly public calendar discovery)',
      Accept: 'text/html,application/xhtml+xml,text/calendar,*/*',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(20000),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const text = await resp.text();
  return { text, finalUrl: resp.url || url, contentType: resp.headers.get('content-type') || '' };
}

async function verifyIcal(url) {
  try {
    const { text, contentType } = await fetchText(url);
    const ok =
      /BEGIN:VCALENDAR/i.test(text) ||
      /BEGIN:VEVENT/i.test(text) ||
      /text\/calendar/i.test(contentType);
    const volleyHits = (text.match(/volley/gi) || []).length;
    return { ok, volleyHits, bytes: text.length };
  } catch (err) {
    return { ok: false, error: err.message, volleyHits: 0 };
  }
}

async function googleCseSearch() {
  const key = process.env.GOOGLE_CSE_API_KEY;
  const cx = process.env.GOOGLE_CSE_ID;
  if (!key || !cx) return [];

  const queries = [
    'volleyball drop-in OR "open gym" OR "open play" New England OR Massachusetts calendar ical',
    'volleyball "open gym" (Connecticut OR "Rhode Island" OR Vermont OR Maine OR "New Hampshire") ics OR ical',
    'site:calendar.google.com volleyball (Boston OR Cambridge OR Providence OR Hartford)',
  ];

  const urls = new Set();
  for (const q of queries) {
    const endpoint = new URL('https://www.googleapis.com/customsearch/v1');
    endpoint.searchParams.set('key', key);
    endpoint.searchParams.set('cx', cx);
    endpoint.searchParams.set('q', q);
    endpoint.searchParams.set('num', '8');
    const resp = await fetch(endpoint).catch(() => null);
    if (!resp || !resp.ok) continue;
    const data = await resp.json();
    for (const item of data.items || []) {
      const link = item.link;
      if (!link || isBlockedHost(link)) continue;
      if (looksLikeIcalUrl(link)) {
        urls.add(normalizeIcalUrl(link, link));
      } else {
        // Follow search hit pages for ics links (one hop).
        try {
          const page = await fetchText(link);
          if (!pageMentionsVolleyball(page.text) && !/calendar/i.test(page.text)) continue;
          for (const ics of extractLinks(page.text, page.finalUrl)) urls.add(ics);
        } catch {
          /* ignore */
        }
      }
    }
  }
  return [...urls].filter(Boolean);
}

async function discoverFromSeeds() {
  const candidates = [];
  for (const seed of seeds) {
    if (isBlockedHost(seed.url)) continue;
    try {
      const page = await fetchText(seed.url);
      const links = extractLinks(page.text, page.finalUrl);
      const volleyPage = pageMentionsVolleyball(page.text);
      for (const ics of links) {
        candidates.push({
          url: ics,
          state: seed.state,
          name: seed.name,
          foundOn: seed.url,
          reason: volleyPage ? 'ics_on_volley_seed' : 'ics_on_seed',
        });
      }
      // If the seed URL itself is already an ics (unlikely but fine)
      if (looksLikeIcalUrl(seed.url)) {
        candidates.push({
          url: normalizeIcalUrl(seed.url, seed.url),
          state: seed.state,
          name: seed.name,
          foundOn: seed.url,
          reason: 'seed_is_ics',
        });
      }
    } catch (err) {
      candidates.push({
        error: true,
        seed: seed.url,
        message: err.message,
      });
    }
  }
  return candidates;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const cronOk = authorizedCron(req);
  const adminAuth = cronOk ? { ok: true } : await authorizedSuperAdmin(req);
  if (!cronOk && !adminAuth.ok) {
    return res.status(401).json({
      error: 'Unauthorized',
      reason: adminAuth.reason || 'forbidden',
      hint: adminAuth.hint || undefined,
      detail: adminAuth.detail || undefined,
      email: adminAuth.email || undefined,
    });
  }

  let db;
  try {
    db = await getAdminDb();
  } catch (err) {
    return res.status(503).json({ error: err.message });
  }

  const seedHits = await discoverFromSeeds();
  const cseHits = await googleCseSearch();

  const existingSources = new Set();
  const srcSnap = await db.collection('ingestSources').get();
  srcSnap.forEach((d) => {
    if (d.data().url) existingSources.add(d.data().url);
  });

  const byUrl = new Map();
  for (const hit of seedHits) {
    if (hit.error || !hit.url) continue;
    if (!byUrl.has(hit.url)) byUrl.set(hit.url, hit);
  }
  for (const url of cseHits) {
    if (!byUrl.has(url)) {
      byUrl.set(url, {
        url,
        state: 'MA',
        name: 'Search discovery',
        foundOn: 'google_cse',
        reason: 'cse',
      });
    }
  }

  const results = [];
  let created = 0;
  let skipped = 0;

  for (const [url, meta] of byUrl) {
    if (existingSources.has(url)) {
      skipped += 1;
      results.push({ url, status: 'already_source' });
      continue;
    }
    const verify = await verifyIcal(url);
    if (!verify.ok) {
      results.push({ url, status: 'not_ical', error: verify.error });
      continue;
    }

    const id = candidateId(url);
    const ref = db.collection('ingestCandidates').doc(id);
    const prev = await ref.get();
    if (prev.exists && prev.data().status === 'rejected') {
      skipped += 1;
      results.push({ url, status: 'previously_rejected' });
      continue;
    }
    if (prev.exists && prev.data().status === 'approved') {
      skipped += 1;
      results.push({ url, status: 'already_approved' });
      continue;
    }

    const payload = {
      url,
      type: 'ical',
      state: meta.state || 'MA',
      suggestedName: meta.name || 'Discovered calendar',
      foundOn: meta.foundOn || null,
      reason: meta.reason || 'discover',
      volleyHits: verify.volleyHits || 0,
      status: 'pending',
      updatedAt: new Date(),
    };
    if (!prev.exists) payload.createdAt = new Date();
    await ref.set(payload, { merge: true });
    created += 1;
    results.push({ url, status: 'queued', id, volleyHits: verify.volleyHits });
  }

  const seedErrors = seedHits.filter((h) => h.error).length;

  return res.status(200).json({
    ok: true,
    seeds: seeds.length,
    seedErrors,
    cseEnabled: Boolean(process.env.GOOGLE_CSE_API_KEY && process.env.GOOGLE_CSE_ID),
    queued: created,
    skipped,
    results: results.slice(0, 50),
  });
};
