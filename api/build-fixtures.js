/**
 * Vercel Function: turn a description of a tournament into its FIXTURES — which teams
 * play which.
 *
 * This is not `api/build-schedule.js`. That one takes games that already exist and maps
 * them onto time slots and courts; this one decides the games in the first place. Until
 * now the only way to get a fixture list was `buildScheduleForFormat` — a fixed rule
 * picked from a dropdown — so anything the three rules cannot express ("the two clubs
 * that travelled furthest play first", "A plays everyone, B only plays the seeds") could
 * not be built at all.
 *
 * ## Why this is not an open endpoint
 *
 * A model call on the project's Anthropic key is worth money to a stranger, so this
 * borrows the authorisation trick from `api/send-invite.js`: the caller's Firebase ID
 * token is passed straight through to the Firestore REST API and Firestore decides. Here
 * the document read is the caller's own membership, `clubs/{clubId}/members/{uid}`, and
 * the role on it has to be `admin`. Both refusals happen before any model call.
 *
 * The one wrinkle send-invite does not have: that path is keyed by uid, and the uid is
 * only in the token. So the uid is read out of the token's payload segment WITHOUT
 * verifying it — and that is safe precisely because it is never trusted on its own. The
 * membership read is still made with the whole token, so a payload edited to name
 * somebody else's uid no longer matches the signature and Firestore rejects the request
 * outright (401 → 403 here). There is no path where a forged uid reaches a 200.
 *
 * ANTHROPIC_API_KEY is read server-side only and never reaches the browser.
 */

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-5';

// Working out a draw is more reasoning than the schedule reader does with a screenshot,
// but it still runs against a hard function timeout. Override with
// ANTHROPIC_FIXTURES_EFFORT when a club's format needs more thinking.
const EFFORT = process.env.ANTHROPIC_FIXTURES_EFFORT || 'medium';

const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'volleyball-score-tracker';

const MAX_PROMPT_CHARS = 4000;
const MAX_TEAMS = 64;
// Same ceiling as build-schedule's MAX_GAMES: past this nothing can render the day.
const MAX_FIXTURES = 200;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 6;
const CLUB_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

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

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const firestoreDoc = (path) =>
  `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/${path}`;

/**
 * The `user_id` claim out of a Firebase ID token, or '' if it does not look like one.
 *
 * Decoding only — no signature check, and deliberately so: see the header comment. The
 * value is used for one thing, building the Firestore path that is then read WITH the
 * same token, so Firestore's own verification is what stands behind it.
 */
function uidFromToken(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return '';
  try {
    // atob rather than Buffer: this handler is the web-request shape, which runs on
    // runtimes where the Node globals are not guaranteed to exist.
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    return String(payload.user_id || payload.sub || '');
  } catch {
    return '';
  }
}

const instructions = ({ teams, courtCount, setsPerMatch, meetingsPerPair, pools }) => {
  const poolBlock = pools.length
    ? `\n## Pools\n\nThis tournament is drawn into pools. A fixture must name the pool both its teams are in, and teams from different pools must never be paired:\n${pools
        .map((p) => `- Pool ${p.name}: ${p.teams.join(', ')}`)
        .join('\n')}\n`
    : '\n## Pools\n\nThis tournament has no pools. Leave `pool` as an empty string on every fixture.\n';

  return `You draw up the fixture list for a volleyball tournament — which teams play which. You do NOT assign times, courts or umpires; that is a separate step.

## The tournament

- Teams (${teams.length}): ${teams.join(', ')}
- Courts running at once: ${courtCount}
- Sets per match: ${setsPerMatch}
- Each pair of teams is expected to meet ${meetingsPerPair} time${meetingsPerPair === 1 ? '' : 's'}
${poolBlock}
## Rules

- \`team1\` and \`team2\` must be copied exactly from the team list above. Never invent, abbreviate or re-spell a team.
- A team never plays itself.
- Produce every fixture the description calls for, in the order they should be played. Repeat a pairing only when the description genuinely asks for it (a double round robin does).
- The court count and sets per match are context for how much can be played in a day — they do not change who plays who.

## Output

Return the fixtures, plus \`warnings\`: one short sentence for anything the description asked for that you could not express as a plain pairing, or anything you had to guess. Return an empty \`warnings\` array when the draw is exactly what was asked for.`;
};

/**
 * Structured-output schema.
 *
 * No `minItems`/`maxItems` and no string or numeric constraints anywhere. Structured
 * outputs reject complex array constraints, and because this function calls the API over
 * raw fetch there is no SDK sitting in front of it to strip them the way the Python and
 * TypeScript clients do — the same mistake on build-schedule's `courts` array went to the
 * wire and Anthropic refused every request with a 400. `api-tests/schema.test.mjs` walks
 * this object and fails on anything outside the supported subset. Limits are enforced
 * below, on the way back, where they belong.
 */
const fixturesSchema = {
  type: 'object',
  properties: {
    fixtures: {
      type: 'array',
      description: 'The fixtures, in playing order.',
      items: {
        type: 'object',
        properties: {
          team1: { type: 'string', description: 'Team name, copied exactly from the team list.' },
          team2: { type: 'string', description: 'The other team, copied exactly from the team list.' },
          pool: {
            type: 'string',
            description: 'Pool name both teams are in, or "" when the tournament has no pools.',
          },
        },
        required: ['team1', 'team2', 'pool'],
        additionalProperties: false,
      },
    },
    warnings: { type: 'array', items: { type: 'string' } },
  },
  required: ['fixtures', 'warnings'],
  additionalProperties: false,
};

export default {
  async fetch(request) {
    if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);

    if (!process.env.ANTHROPIC_API_KEY) {
      return json({ error: 'The AI fixture builder is not configured on this deployment.' }, 503);
    }

    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
      request.headers.get('x-real-ip') ||
      'unknown';
    if (rateLimited(ip)) {
      return json({ error: 'Too many requests in a row — give it a minute.' }, 429);
    }

    // The caller's Firebase ID token. Passed straight through to Firestore below.
    const authorization = request.headers.get('authorization') || '';
    const bearer = /^Bearer\s+(\S+)/i.exec(authorization);
    if (!bearer) return json({ error: 'Sign in again and retry.' }, 401);

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Malformed request body.' }, 400);
    }

    const clubId = String(body.clubId ?? '').trim();
    if (!CLUB_ID_RE.test(clubId)) return json({ error: 'Invalid club.' }, 400);

    const uid = uidFromToken(bearer[1]);
    if (!uid) return json({ error: 'Sign in again and retry.' }, 401);

    // Reading the membership AS THE CALLER is the authorization step: a non-member is
    // refused by firestore.rules, and a member's own document carries the role.
    let memberRes;
    try {
      memberRes = await fetch(
        firestoreDoc(`clubs/${encodeURIComponent(clubId)}/members/${encodeURIComponent(uid)}`),
        { headers: { authorization } }
      );
    } catch (err) {
      console.error('[build-fixtures] membership lookup network error:', err);
      return json({ error: 'Could not reach the membership store.' }, 502);
    }

    if (memberRes.status === 401 || memberRes.status === 403 || memberRes.status === 404) {
      return json({ error: 'Only a club admin can build fixtures for this club.' }, 403);
    }
    if (!memberRes.ok) {
      console.error(
        '[build-fixtures] membership lookup failed',
        memberRes.status,
        await memberRes.text()
      );
      return json({ error: 'Could not read your club membership.' }, 502);
    }

    const memberDoc = await memberRes.json();
    if ((memberDoc.fields?.role?.stringValue || '') !== 'admin') {
      // A scorer is a legitimate member — they just cannot create tournaments, so
      // building a draw is not theirs to do either.
      return json({ error: 'Only a club admin can build fixtures for this club.' }, 403);
    }

    /* ---- Everything below this line runs only for a club admin ---- */

    const prompt = String(body.prompt ?? '').trim();
    const teams = (Array.isArray(body.teams) ? body.teams : [])
      .map((t) => String(t ?? '').trim())
      .filter(Boolean)
      .slice(0, MAX_TEAMS);
    const courtCount = Math.max(1, Math.min(8, Math.floor(Number(body.courtCount)) || 2));
    const setsPerMatch = Math.max(1, Math.min(5, Math.floor(Number(body.setsPerMatch)) || 3));
    const meetingsPerPair = Math.max(1, Math.min(10, Math.floor(Number(body.meetingsPerPair)) || 1));
    const pools = (Array.isArray(body.pools) ? body.pools : [])
      .map((p, i) => ({
        name: String(p?.name ?? '').trim() || String.fromCharCode(65 + i),
        teams: (Array.isArray(p?.teams) ? p.teams : [])
          .map((t) => String(t ?? '').trim())
          .filter(Boolean),
      }))
      .filter((p) => p.teams.length);

    if (!prompt) return json({ error: 'Describe the tournament first.' }, 400);
    if (prompt.length > MAX_PROMPT_CHARS) {
      return json({ error: `Keep the description under ${MAX_PROMPT_CHARS} characters.` }, 400);
    }
    if (teams.length < 2) return json({ error: 'Add at least two teams first.' }, 400);

    const startedAt = Date.now();
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
          max_tokens: 8000,
          system: instructions({ teams, courtCount, setsPerMatch, meetingsPerPair, pools }),
          output_config: {
            effort: EFFORT,
            format: { type: 'json_schema', schema: fixturesSchema },
          },
          messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
        }),
      });
    } catch (err) {
      console.error('[build-fixtures] network error:', err);
      return json({ error: 'Could not reach the fixture builder.' }, 502);
    }

    if (!res.ok) {
      const detail = await res.text();
      console.error('[build-fixtures] anthropic error', res.status, detail);

      // Status-specific, like build-schedule: a single "could not build that" message
      // blames the description for what is nearly always a configuration problem, and
      // the only way to tell them apart was reading the function logs.
      let upstream = '';
      try {
        upstream = JSON.parse(detail)?.error?.message || '';
      } catch {
        upstream = detail.slice(0, 200);
      }

      if (res.status === 429) {
        return json(
          { error: 'The fixture builder is rate limited right now — try again shortly.' },
          502
        );
      }
      if (res.status === 401 || res.status === 403) {
        return json(
          {
            error: `The Anthropic API rejected our key (${res.status}). Check ANTHROPIC_API_KEY in the deployment settings.`,
          },
          502
        );
      }
      if (res.status === 400) {
        return json(
          {
            error: `The fixture builder sent an invalid request and Anthropic refused it: ${upstream || 'no detail returned'}. This is a bug on our side, not a problem with what you typed.`,
          },
          502
        );
      }
      return json(
        {
          error: `The fixture builder failed (Anthropic returned ${res.status})${upstream ? `: ${upstream}` : ''}.`,
        },
        502
      );
    }

    const message = await res.json();
    console.log(
      `[build-fixtures] club=${clubId} ${MODEL} effort=${EFFORT} took ${Date.now() - startedAt}ms ` +
        `stop=${message.stop_reason} in=${message.usage?.input_tokens} out=${message.usage?.output_tokens}`
    );

    if (message.stop_reason === 'refusal') {
      return json({ error: 'That input could not be processed.' }, 422);
    }
    if (message.stop_reason === 'max_tokens') {
      return json(
        {
          error:
            'That draw was too long to produce in one go. Try describing the league games only, and add any knockout rounds to the schedule afterwards.',
        },
        422
      );
    }

    const raw = (message.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('');

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      console.error('[build-fixtures] unparseable model output:', raw.slice(0, 500));
      return json({ error: 'The fixture builder returned an unreadable result.' }, 502);
    }

    /* ---- Validation. The model does not get to define what a legal fixture is ---- */

    const warnings = Array.isArray(parsed.warnings) ? [...parsed.warnings] : [];
    const returned = Array.isArray(parsed.fixtures) ? parsed.fixtures : [];

    // Case- and whitespace-insensitive lookup that yields the CANONICAL spelling, so the
    // model's rendering of a name is never what ends up stored: "black" becomes "Black".
    // Standings, schedule rows and the teams editor all match on the exact string.
    const canonical = new Map(teams.map((t) => [t.trim().toLowerCase(), t]));
    const poolByName = new Map(pools.map((p) => [p.name.trim().toLowerCase(), p]));
    const poolOfTeam = new Map();
    for (const pool of pools) {
      for (const t of pool.teams) {
        const key = t.trim().toLowerCase();
        if (!poolOfTeam.has(key)) poolOfTeam.set(key, pool.name);
      }
    }

    const fixtures = [];
    const pairCounts = new Map();

    for (const item of returned) {
      if (fixtures.length >= MAX_FIXTURES) {
        warnings.push(
          `Only the first ${MAX_FIXTURES} fixtures were kept — the rest were dropped.`
        );
        break;
      }

      const rawTeam1 = String(item?.team1 ?? '').trim();
      const rawTeam2 = String(item?.team2 ?? '').trim();
      const team1 = canonical.get(rawTeam1.toLowerCase());
      const team2 = canonical.get(rawTeam2.toLowerCase());

      if (!team1 || !team2) {
        const unknown = [!team1 ? rawTeam1 : null, !team2 ? rawTeam2 : null]
          .filter(Boolean)
          .map((n) => `"${n || '(blank)'}"`)
          .join(' and ');
        warnings.push(`Dropped a fixture naming ${unknown} — not in this tournament's team list.`);
        continue;
      }
      if (team1 === team2) {
        warnings.push(`Dropped a fixture pairing ${team1} with itself.`);
        continue;
      }

      let pool = '';
      if (pools.length) {
        const named = poolByName.get(String(item?.pool ?? '').trim().toLowerCase());
        const home = poolOfTeam.get(team1.toLowerCase());
        const away = poolOfTeam.get(team2.toLowerCase());
        if (!named) {
          warnings.push(
            `Dropped ${team1} vs ${team2} — "${String(item?.pool ?? '').trim() || '(none)'}" is not one of this tournament's pools.`
          );
          continue;
        }
        // Both halves matter: a fixture labelled Pool A between two Pool B teams is just
        // as wrong as a genuine cross-pool pairing, and both would corrupt the standings.
        if (home !== named.name || away !== named.name) {
          warnings.push(
            `Dropped ${team1} vs ${team2} — they are not both in pool ${named.name} (${team1} is in ${home || 'no pool'}, ${team2} is in ${away || 'no pool'}).`
          );
          continue;
        }
        pool = named.name;
      }

      const key = [team1.toLowerCase(), team2.toLowerCase()].sort().join(' ');
      pairCounts.set(key, (pairCounts.get(key) || 0) + 1);

      // Ids are assigned here, never taken from the model: they are the join key between
      // the match list and the schedule rows, and a duplicate or missing one silently
      // detaches a game from its slot.
      fixtures.push({
        game: `G${fixtures.length + 1}`,
        team1,
        team2,
        ...(pool ? { pool } : {}),
      });
    }

    // A repeat is not automatically an error — a double round robin is meant to repeat
    // every pairing — so this warns and keeps the fixture rather than dropping it.
    for (const [key, count] of pairCounts) {
      if (count > meetingsPerPair) {
        const [a, b] = key.split(' ');
        const t1 = canonical.get(a) || a;
        const t2 = canonical.get(b) || b;
        warnings.push(
          `${t1} vs ${t2} appears ${count} times, but this tournament is set to ${meetingsPerPair} meeting${meetingsPerPair === 1 ? '' : 's'} per pair.`
        );
      }
    }

    if (!fixtures.length) {
      return json(
        {
          error:
            'No usable fixtures came back — every pairing named a team that is not in this tournament, or crossed pools. Check the team names in your description and try again.',
          warnings,
        },
        422
      );
    }

    return json({ fixtures, warnings });
  },
};
