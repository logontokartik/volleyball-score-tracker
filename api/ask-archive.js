/**
 * Vercel Function: answer free-form questions about a club's archive using Claude.
 *
 * The Anthropic API key is read from the ANTHROPIC_API_KEY environment variable and
 * never leaves the server — the browser only ever posts a question and a club id.
 *
 * The client posts a *club id*, never a spreadsheet id: the sheet is resolved from
 * `clubs/{clubId}.archiveSheetId` here. Accepting a sheet id would make this an open
 * fetch proxy and let anyone spend the project's Anthropic credits summarising an
 * arbitrary spreadsheet.
 *
 * That only holds because `archiveSheetId` is **super-admin-only** in `firestore.rules`
 * — a club admin may update every other field on the club document but not that one.
 * Anyone with a Google account can create a club and become its admin, so a
 * club-admin-writable `archiveSheetId` would leave this endpoint just as open: create a
 * club, point it at any sheet, ask. Attaching a spreadsheet is an operator action, and
 * these two halves have to stay together.
 *
 * The club document is world-readable, so the lookup goes through the Firestore REST
 * API and needs no service-account credentials.
 *
 * The archive itself is likewise fetched here rather than accepted from the client, so
 * the prompt prefix stays byte-stable (prompt caching) and the endpoint can't be used
 * to push arbitrary context through the key.
 */

const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'volleyball-score-tracker';

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-5';
const EFFORT = process.env.ANTHROPIC_EFFORT || 'medium';

const ARCHIVE_TTL_MS = 10 * 60 * 1000; // re-pull the sheet at most every 10 minutes
const CLUB_TTL_MS = 5 * 60 * 1000; // a club's archiveSheetId changes about never
const MAX_QUESTION_CHARS = 500;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 10; // per IP per window

// Firestore auto-ids are 20 chars, but ids can be chosen; this is deliberately narrow so
// nothing that could traverse or escape the REST path ever reaches the URL.
const CLUB_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

/* ------------------------------------------------------------------ */
/* Google Sheets → archive shape                                       */
/* ------------------------------------------------------------------ */

function csvUrl(sheetId, sheetName) {
  return `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`;
}

/** Minimal but correct RFC-4180 CSV parser. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuote = false;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];
    if (inQuote) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuote = false;
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuote = true;
      } else if (ch === ',') {
        row.push(field); field = '';
      } else if (ch === '\r' && text[i + 1] === '\n') {
        row.push(field); field = ''; rows.push(row); row = []; i += 2; continue;
      } else if (ch === '\n' || ch === '\r') {
        row.push(field); field = ''; rows.push(row); row = [];
      } else {
        field += ch;
      }
    }
    i++;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

async function fetchSheet(sheetId, sheetName) {
  const res = await fetch(csvUrl(sheetId, sheetName));
  if (!res.ok) {
    throw new Error(`Could not fetch sheet "${sheetName}" (${res.status}). Make sure the spreadsheet is shared as "Anyone with the link can view".`);
  }
  return parseCsv(await res.text());
}

const trim = (s) => String(s ?? '').trim();

function cleanName(s) {
  const t = trim(s);
  if (!t || t === '#N/A' || t === '#REF!' || t === '#VALUE!') return '';
  return t;
}

/**
 * Mirrors src/archiveRefreshUtils.js, with one deliberate omission: the per-player
 * `appearances` map is NOT built here. In the client parser those columns overlap the
 * WINNERS/RUNNERS block, so the values are other players' names — feeding that to a
 * model produces confidently wrong answers.
 */
async function fetchArchiveFromSheets(sheetId) {
  const [masterRows, allT, vl, mr] = await Promise.all([
    fetchSheet(sheetId, 'Master List'),
    fetchSheet(sheetId, 'All Tournaments'),
    fetchSheet(sheetId, 'VLookups'),
    fetchSheet(sheetId, 'Master Rules').catch(() => []),
  ]);

  /* ---------- Master List ---------- */
  const masterList = [];
  for (let i = 1; i < masterRows.length; i++) {
    const row = masterRows[i];
    const name = trim(row[0]);
    if (!name) break;
    masterList.push({
      name,
      tournamentsPlayed: Number(row[1]) || 0,
      tournamentsWon: Number(row[2]) || 0,
      runnersUp: Number(row[3]) || 0,
      speciality: trim(row[6]),
      position: trim(row[7]),
      height: trim(row[11]),
    });
  }

  /* ---------- All Tournaments ---------- */
  const tournamentNamesFromAllT = (allT[0] || []).map(trim).filter(Boolean);
  const tournamentSignups = tournamentNamesFromAllT.map((name, colIdx) => {
    const signups = [];
    for (let r = 1; r < allT.length; r++) {
      const cell = cleanName(allT[r]?.[colIdx]);
      if (cell) signups.push(cell);
    }
    return { name, signups };
  });

  /* ---------- VLookups ---------- */
  const vlHeader = vl[0] || [];
  const tStart = 3;
  const vlTournamentNames = vlHeader.slice(tStart).map(trim).filter(Boolean);

  const winIdx = vl.findIndex((row) => trim(row?.[0]) === 'WINNERS');
  const runIdx = vl.findIndex((row) => trim(row?.[0]) === 'RUNNERS');
  const directoryEnd = winIdx >= 0 ? winIdx : vl.length;

  const directory = [];
  for (let i = 1; i < directoryEnd; i++) {
    const row = vl[i];
    if (!row) continue;
    const raw = trim(row[0]);
    const canonical = trim(row[1]) || raw;
    if (!canonical && !raw) continue;
    directory.push({
      rawName: raw || canonical,
      canonicalName: canonical,
      tournamentsPlayed: Number(row[2]) || 0,
    });
  }

  function collectChampions(startRow, endRow) {
    const byTournament = {};
    vlTournamentNames.forEach((tn) => { byTournament[tn] = []; });
    for (let i = startRow; i < endRow; i++) {
      const row = vl[i];
      if (!row) continue;
      vlTournamentNames.forEach((tn, j) => {
        const v = cleanName(row[tStart + j]);
        if (v) byTournament[tn].push(v);
      });
    }
    return byTournament;
  }

  const champions = {
    winners: winIdx >= 0 && runIdx > winIdx ? collectChampions(winIdx + 1, runIdx) : {},
    runnersUp: runIdx >= 0 ? collectChampions(runIdx + 1, Math.min(runIdx + 15, vl.length)) : {},
  };

  const rules = mr
    .filter((row) => trim(row[1]) || trim(row[0]))
    .map((row) => ({ ref: trim(row[0]), text: trim(row[1]) }));

  return {
    generatedAt: new Date().toISOString(),
    masterList,
    tournamentSignups,
    directory,
    tournamentNames: vlTournamentNames,
    champions,
    rules,
  };
}

/* ------------------------------------------------------------------ */
/* Derived stats — precomputed so the model never has to count         */
/* ------------------------------------------------------------------ */

const normName = (s) => String(s || '').trim().replace(/\s+/g, ' ');

function pairWinningRosterCooccurrence(champions, tournamentNames) {
  const counts = new Map();
  const winnersByTournament = champions?.winners || {};
  for (const tn of tournamentNames || []) {
    const names = [...new Set((winnersByTournament[tn] || []).map(normName).filter(Boolean))].sort(
      (a, b) => a.localeCompare(b)
    );
    if (names.length < 2) continue;
    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        const key = `${names[i]}|||${names[j]}`;
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    }
  }
  return [...counts.entries()]
    .map(([key, count]) => {
      const [a, b] = key.split('|||');
      return { a, b, titlesTogether: count };
    })
    .sort((x, y) => y.titlesTogether - x.titlesTogether);
}

function computeStats(data) {
  const { masterList = [], tournamentSignups = [], directory = [], champions, tournamentNames = [] } = data;

  const byWon = [...masterList].sort((a, b) => b.tournamentsWon - a.tournamentsWon);
  const byPlayed = [...masterList].sort((a, b) => b.tournamentsPlayed - a.tournamentsPlayed);
  const byRunner = [...masterList].sort((a, b) => b.runnersUp - a.runnersUp);

  return {
    uniqueCanonicalPlayers: new Set(directory.map((d) => normName(d.canonicalName)).filter(Boolean)).size,
    masterListCount: masterList.length,
    totalTournaments: tournamentSignups.length,
    totalSignupSlots: tournamentSignups.reduce((s, t) => s + (t.signups?.length || 0), 0),
    totalWins: masterList.reduce((s, p) => s + (p.tournamentsWon || 0), 0),
    totalRunnerUps: masterList.reduce((s, p) => s + (p.runnersUp || 0), 0),
    topWon: byWon.slice(0, 15),
    topPlayed: byPlayed.slice(0, 15),
    topRunner: byRunner.slice(0, 10),
    topPairs: pairWinningRosterCooccurrence(champions, tournamentNames).slice(0, 20),
  };
}

/* ------------------------------------------------------------------ */
/* Caches                                                              */
/* ------------------------------------------------------------------ */

/** Errors whose message is safe to hand back to the caller verbatim. */
class ClubLookupError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

// Both caches are keyed — one process serves every club, so a single-slot cache would
// hand club B the sheet or the archive belonging to club A.
const clubCache = new Map(); // clubId -> { at, sheetId, name }
const archiveCache = new Map(); // sheetId -> { at, payload }

/**
 * Read `archiveSheetId` off the club document via the Firestore REST API. `clubs/{id}`
 * is publicly readable, so this needs no credentials and no firebase-admin dependency.
 */
async function getClub(clubId) {
  const cached = clubCache.get(clubId);
  if (cached && Date.now() - cached.at < CLUB_TTL_MS) return cached;

  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/clubs/${encodeURIComponent(
    clubId
  )}`;

  let res;
  try {
    res = await fetch(url);
  } catch (err) {
    console.error('[ask-archive] club lookup network error:', err);
    throw new ClubLookupError('Could not look up this club right now.', 502);
  }

  if (res.status === 404) throw new ClubLookupError('That club does not exist.', 404);
  if (!res.ok) {
    console.error('[ask-archive] club lookup failed', res.status, await res.text());
    throw new ClubLookupError('Could not look up this club right now.', 502);
  }

  const body = await res.json();
  const sheetId = body.fields?.archiveSheetId?.stringValue || '';
  const name = body.fields?.name?.stringValue || 'the club';
  if (!sheetId) {
    throw new ClubLookupError('This club has no archive spreadsheet configured.', 404);
  }

  const entry = { at: Date.now(), sheetId, name };
  clubCache.set(clubId, entry);
  return entry;
}

async function getArchive(sheetId) {
  const cached = archiveCache.get(sheetId);
  if (cached && Date.now() - cached.at < ARCHIVE_TTL_MS) return cached.payload;

  const archive = await fetchArchiveFromSheets(sheetId);
  const payload = { archive, stats: computeStats(archive) };
  archiveCache.set(sheetId, { at: Date.now(), payload });
  return payload;
}

const rateLimiter = new Map();

function rateLimited(ip) {
  const now = Date.now();
  const hits = (rateLimiter.get(ip) || []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (hits.length >= RATE_LIMIT_MAX) return true;
  hits.push(now);
  rateLimiter.set(ip, hits);
  if (rateLimiter.size > 500) {
    for (const [key, times] of rateLimiter) {
      if (!times.some((t) => now - t < RATE_LIMIT_WINDOW_MS)) rateLimiter.delete(key);
    }
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Prompt                                                              */
/* ------------------------------------------------------------------ */

const instructions = (clubName) => `You answer questions about the ${clubName} (volleyball club) tournament archive using only the data below.

## The data

- \`masterList\` — one row per player with career totals: tournamentsPlayed, tournamentsWon, runnersUp, speciality (playing position), height. This is the authoritative source for career stats.
- \`tournamentSignups\` — the roster that signed up for each tournament season, in chronological order.
- \`champions.winners\` / \`champions.runnersUp\` — the winning and runner-up rosters per season. A season's winners list is one championship team.
- \`directory\` — maps the informal names used on signup sheets to canonical player names.
- \`rules\` — the club's match rules and scoring format.
- \`stats\` — figures already computed exactly from the above.

## How to answer

Use the numbers in \`stats\` for anything it already covers (most wins, most played, most runner-ups, totals, pairs who won together) rather than recounting them yourself. Count from the raw lists only for things \`stats\` does not cover.

Signup sheets use informal names: the same person appears as "Kartik", "Abhi", "Amar J", or "Adi Akare". Resolve these against \`directory\` and \`masterList\` before counting, and say which name you matched when it is not obvious. If a name is genuinely ambiguous between two players, say so rather than guessing.

Answer only from this data. If the archive does not contain the answer, say so plainly and mention what related information it does have — never estimate or invent a number, a player, or a season. Note that per-player, per-season appearance history is not available, so questions needing exactly which seasons a specific player signed up for can only be answered from the signup rosters themselves.

Lead with the answer. Keep it to a few sentences or a short list; this renders in a small panel. Use \`**bold**\` for player names and figures. Plain text only — no headers, tables, or markdown links.`;

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    title: {
      type: 'string',
      description: 'A short headline for the answer, at most 8 words. No trailing punctuation.',
    },
    body: {
      type: 'string',
      description:
        'The answer. Plain text with \\n line breaks and **bold** for names and figures. Use "• " to start list items.',
    },
  },
  required: ['title', 'body'],
  additionalProperties: false,
};

/* ------------------------------------------------------------------ */
/* Handler                                                             */
/* ------------------------------------------------------------------ */

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });

export default {
  async fetch(request) {
    if (request.method !== 'POST') {
      return json({ error: 'Use POST.' }, 405);
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return json({ error: 'The archive assistant is not configured on this deployment.' }, 503);
    }

    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
      request.headers.get('x-real-ip') ||
      'unknown';
    if (rateLimited(ip)) {
      return json({ error: 'Too many questions in a row — give it a minute.' }, 429);
    }

    let question;
    let clubId;
    try {
      ({ question, clubId } = await request.json());
    } catch {
      return json({ error: 'Malformed request body.' }, 400);
    }

    clubId = String(clubId ?? '').trim();
    if (!CLUB_ID_RE.test(clubId)) {
      return json({ error: 'Missing or malformed club id.' }, 400);
    }

    question = String(question ?? '').trim();
    if (!question) {
      return json({ error: 'Ask a question first.' }, 400);
    }
    if (question.length > MAX_QUESTION_CHARS) {
      return json({ error: `Keep questions under ${MAX_QUESTION_CHARS} characters.` }, 400);
    }

    let club;
    try {
      club = await getClub(clubId);
    } catch (err) {
      if (err instanceof ClubLookupError) return json({ error: err.message }, err.status);
      console.error('[ask-archive] club lookup failed:', err);
      return json({ error: 'Could not look up this club right now.' }, 502);
    }

    let payload;
    try {
      payload = await getArchive(club.sheetId);
    } catch (err) {
      console.error('[ask-archive] sheet fetch failed:', err);
      return json({ error: 'Could not read the archive spreadsheet right now.' }, 502);
    }

    const context = `${instructions(club.name)}\n\n## Archive data\n\n<archive>\n${JSON.stringify(
      payload.archive
    )}\n</archive>\n\n<stats>\n${JSON.stringify(payload.stats)}\n</stats>`;

    let res;
    try {
      res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 4000,
          // The archive is byte-stable between refreshes, so this prefix caches and
          // repeat questions bill the context at ~10% of list price.
          system: [{ type: 'text', text: context, cache_control: { type: 'ephemeral' } }],
          output_config: {
            effort: EFFORT,
            format: { type: 'json_schema', schema: RESPONSE_SCHEMA },
          },
          messages: [{ role: 'user', content: question }],
        }),
      });
    } catch (err) {
      console.error('[ask-archive] network error:', err);
      return json({ error: 'Could not reach the archive assistant.' }, 502);
    }

    if (!res.ok) {
      const detail = await res.text();
      console.error('[ask-archive] anthropic error', res.status, detail);
      const message =
        res.status === 429
          ? 'The archive assistant is rate limited right now — try again shortly.'
          : 'The archive assistant could not answer that.';
      return json({ error: message }, 502);
    }

    const message = await res.json();

    if (message.stop_reason === 'refusal') {
      return json({ error: 'That question could not be answered.' }, 422);
    }

    const text = (message.content || [])
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('');

    let answer;
    try {
      answer = JSON.parse(text);
    } catch {
      console.error('[ask-archive] unparseable model output:', text.slice(0, 500));
      return json({ error: 'The archive assistant returned an unreadable answer.' }, 502);
    }

    return json({
      title: answer.title,
      body: answer.body,
      source: 'ai',
      usage: {
        input: message.usage?.input_tokens,
        output: message.usage?.output_tokens,
        cacheRead: message.usage?.cache_read_input_tokens,
      },
    });
  },
};
