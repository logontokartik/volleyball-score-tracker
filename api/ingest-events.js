/**
 * Vercel Cron / manual: pull enabled ingestSources and upsert events.
 *
 * Auth: Authorization: Bearer ${CRON_SECRET}  (or ?secret= for Vercel cron query).
 * Writes: Firebase Admin via FIREBASE_SERVICE_ACCOUNT_JSON (service account JSON string).
 *
 * Only public feeds listed in ingestSources — not Facebook/Meetup scraping.
 */

const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'volleyball-score-tracker';
const CRON_SECRET = process.env.CRON_SECRET || '';
const NE = new Set(['CT', 'MA', 'ME', 'NH', 'RI', 'VT']);

function unauthorized(res) {
  res.status(401).json({ error: 'Unauthorized' });
}

function authorized(req) {
  if (!CRON_SECRET) return false;
  const header = req.headers.authorization || '';
  if (header === `Bearer ${CRON_SECRET}`) return true;
  if (req.query?.secret === CRON_SECRET) return true;
  return false;
}

function parseIcal(text) {
  const events = [];
  const blocks = text.split(/BEGIN:VEVENT/i).slice(1);
  for (const block of blocks) {
    const body = block.split(/END:VEVENT/i)[0] || '';
    const unfold = body.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '');
    const get = (key) => {
      const re = new RegExp(`^${key}[^:]*:(.+)$`, 'im');
      const m = unfold.match(re);
      return m ? m[1].trim() : '';
    };
    const summary = get('SUMMARY');
    const location = get('LOCATION');
    const description = get('DESCRIPTION').replace(/\\n/g, '\n').replace(/\\,/g, ',');
    const uid = get('UID') || `${summary}-${get('DTSTART')}`;
    const dtStart = parseIcalDate(get('DTSTART'));
    const dtEnd = parseIcalDate(get('DTEND'));
    if (!summary || !dtStart) continue;
    events.push({
      uid,
      summary,
      location,
      description,
      startsAt: dtStart,
      endsAt: dtEnd,
    });
  }
  return events;
}

function parseIcalDate(raw) {
  if (!raw) return null;
  // VALUE=DATE:20260315 or 20260315T190000Z / 20260315T190000
  const cleaned = raw.replace(/^.*:/, '').trim();
  if (/^\d{8}$/.test(cleaned)) {
    const y = cleaned.slice(0, 4);
    const m = cleaned.slice(4, 6);
    const d = cleaned.slice(6, 8);
    return new Date(`${y}-${m}-${d}T12:00:00`);
  }
  const m = cleaned.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/);
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${m[7] || ''}`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function guessFormat(text) {
  const t = (text || '').toLowerCase();
  if (t.includes('beach')) return 'beach';
  if (t.includes('grass')) return 'grass';
  if (t.includes('outdoor')) return 'outdoor';
  return 'indoor';
}

function loadServiceAccount() {
  const fs = require('fs');
  const path = require('path');
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (raw && raw.trim() && raw.trim() !== '{' && raw.trim().startsWith('{')) {
    return JSON.parse(raw);
  }
  const rel =
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH || './service-account.local.json';
  const abs = path.isAbsolute(rel) ? rel : path.join(process.cwd(), rel);
  if (!fs.existsSync(abs)) {
    throw new Error(
      'FIREBASE_SERVICE_ACCOUNT_JSON is not set (and no service-account.local.json)'
    );
  }
  return JSON.parse(fs.readFileSync(abs, 'utf8'));
}

async function getAdminDb() {
  const admin = require('firebase-admin');
  if (!admin.apps.length) {
    const cred = loadServiceAccount();
    admin.initializeApp({
      credential: admin.credential.cert(cred),
      projectId: FIREBASE_PROJECT_ID || cred.project_id,
    });
  }
  return admin.firestore();
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!authorized(req)) return unauthorized(res);

  let db;
  try {
    db = await getAdminDb();
  } catch (err) {
    return res.status(503).json({
      error: err.message,
      hint: 'Set FIREBASE_SERVICE_ACCOUNT_JSON and CRON_SECRET in Vercel env.',
    });
  }

  const sourcesSnap = await db.collection('ingestSources').where('enabled', '==', true).get();
  const results = [];

  for (const sourceDoc of sourcesSnap.docs) {
    const source = { id: sourceDoc.id, ...sourceDoc.data() };
    const state = NE.has(source.state) ? source.state : 'MA';
    let status = 'ok';
    let upserted = 0;

    try {
      if (source.type !== 'ical') {
        status = `skipped type=${source.type}`;
      } else {
        const resp = await fetch(source.url, {
          headers: { 'User-Agent': 'VolleyScoresIngest/1.0' },
          signal: AbortSignal.timeout(25000),
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const text = await resp.text();
        const parsed = parseIcal(text);
        const now = Date.now();

        for (const ev of parsed) {
          if (ev.startsAt.getTime() < now - 6 * 60 * 60 * 1000) continue;
          // Lightweight keyword filter — sources may be general rec calendars.
          const blob = `${ev.summary} ${ev.description} ${ev.location}`.toLowerCase();
          if (!blob.includes('volley')) continue;

          const sourceKey = `${source.id}:${ev.uid}`;
          const existing = await db
            .collection('events')
            .where('sourceKey', '==', sourceKey)
            .limit(1)
            .get();

          const payload = {
            title: ev.summary.slice(0, 120),
            description: (ev.description || '').slice(0, 2000),
            venueName: (ev.location || source.name || 'Venue').slice(0, 120),
            address: '',
            city: '',
            state,
            format: guessFormat(blob),
            skillLevel: 'open',
            cost: '',
            capacity: null,
            source: 'ingest',
            sourceUrl: source.url,
            sourceKey,
            hostUid: 'ingest',
            hostName: source.name || 'Public calendar',
            status: 'scheduled',
            timezone: 'America/New_York',
            startsAt: ev.startsAt,
            endsAt: ev.endsAt || null,
            updatedAt: new Date(),
          };

          if (existing.empty) {
            await db.collection('events').add({ ...payload, createdAt: new Date() });
          } else {
            await existing.docs[0].ref.set(payload, { merge: true });
          }
          upserted += 1;
        }
      }
    } catch (err) {
      status = `error: ${err.message || err}`;
    }

    await sourceDoc.ref.set(
      { lastFetchedAt: new Date(), lastStatus: `${status}; upserted=${upserted}` },
      { merge: true }
    );
    results.push({ id: source.id, name: source.name, status, upserted });
  }

  return res.status(200).json({ ok: true, sources: results.length, results });
};
