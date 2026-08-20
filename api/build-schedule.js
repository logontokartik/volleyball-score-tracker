/**
 * Vercel Function: turn a pasted schedule screenshot or typed description into
 * schedule rows for the current tournament.
 *
 * The client sends the tournament's game list so Claude maps "Black v Yellow" onto the
 * real game id rather than inventing one; anything it returns that isn't in that list is
 * dropped here rather than trusted.
 *
 * ## Why this is not an open endpoint
 *
 * Same club-admin check as api/build-fixtures.js, and for the same reason: a model call
 * on the project's Anthropic key is worth money to a stranger. The caller's Firebase ID
 * token is passed straight through to the Firestore REST API to read their own
 * membership, `clubs/{clubId}/members/{uid}`, and the role on it has to be `admin`. The
 * uid comes out of the token's payload without being verified — safe because the
 * membership read is made with the whole token, so a payload edited to name another uid
 * no longer matches the signature and Firestore refuses it. This endpoint only ever runs
 * from the admin schedule editor, so a real caller always has a token to send.
 *
 * ANTHROPIC_API_KEY is read server-side only and never reaches the browser.
 */

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-5';

const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'volleyball-score-tracker';
const CLUB_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

// Reading a schedule off a screenshot is extraction, not deep reasoning, and it runs
// against a hard function timeout — so this defaults lower than the archive assistant.
// Override with ANTHROPIC_SCHEDULE_EFFORT if a messy source needs more.
// (The shared ANTHROPIC_EFFORT fallback went with api/ask-archive.js.)
const EFFORT =
  process.env.ANTHROPIC_SCHEDULE_EFFORT || 'low';

const MAX_TEXT_CHARS = 8000;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // Anthropic's per-image ceiling
const MAX_GAMES = 200;
// Mirrors MAX_COURT_COUNT in src/tournamentUtils.js — the client sends how many courts
// the tournament runs, and this is the ceiling it is clamped to here as well.
const MAX_COURTS = 8;
const DEFAULT_COURTS = 2;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 6;

const ALLOWED_MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

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

const firestoreDoc = (path) =>
  `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/${path}`;

/**
 * The `user_id` claim out of a Firebase ID token, or '' if it does not look like one.
 * Decoded, not verified — it is only ever used to build the Firestore path that is then
 * read WITH the same token, so Firestore's verification is what stands behind it.
 */
function uidFromToken(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return '';
  try {
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    return String(payload.user_id || payload.sub || '');
  } catch {
    return '';
  }
}

const instructions = (courtCount) => `You convert a volleyball tournament schedule into structured rows.

The input is a screenshot of a schedule, a typed description, or both. Reproduce it faithfully — do not invent rows, times, or games that are not there.

This tournament runs on ${courtCount} court${courtCount === 1 ? '' : 's'}. Every row's \`courts\` array has exactly ${courtCount} entries, in court order: the first entry is court 1, the last is court ${courtCount}. A court that is idle for a slot is still present, with empty strings.

## Row kinds

- \`double\` — a normal time slot with a game on one or more courts.
- \`break\` — a break or lunch row. Put the wording in \`timeLabel\` (e.g. "Break (1:00 – 2:00 pm)") and leave every court empty.
- \`note\` — a row of free text rather than scheduled league games, such as semifinals and finals. Put the time in \`timeLabel\` and the wording in the first court's \`note\` (e.g. "Semifinal 1 (Seed 1 vs Seed 4)"). Use a later court's \`note\` only when the row genuinely has different text for that court.

## Assigning games

Each court's \`game\` must be a game id copied exactly from the available games list, or an empty string when that court is idle for that slot.

Match games by the pair of teams, not by the game number printed in the source — the source's own numbering (G1, G2…) usually will not line up with the ids in the list. "Black v Yellow" means the game in the list whose two teams are Black and Yellow, in either order. Team names may be shortened or differently cased in the source; map them to the closest team in the list. If a listed pairing genuinely has no match, leave the court empty and mention it in \`warnings\`.

Never use the same game id twice.

## Umpires

Each court's \`umpire\` is the umpiring team for that court. Schedules often print an umpire column per court, but some print one umpire for the whole row — in that case use the same team for every court on the row. Empty string when none is given.

## Output

Return every row in the order it appears, top to bottom. Put anything you could not represent — an unmatched pairing, an ambiguous team name, an unreadable cell — in \`warnings\`, one short sentence each. Return an empty \`warnings\` array when everything mapped cleanly.`;

// Court-count driven: the row shape follows whatever the tournament is set up for,
// rather than naming court 1 and court 2 in the schema.
const scheduleSchema = (courtCount) => ({
  type: 'object',
  properties: {
    slots: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          timeLabel: { type: 'string', description: 'Time or label for the row, e.g. "8am".' },
          rowKind: { type: 'string', enum: ['double', 'break', 'note'] },
          courts: {
            type: 'array',
            // The length is stated in the description, NOT as minItems/maxItems.
            // Structured outputs reject complex array constraints, and because this
            // function calls the API over raw fetch there is no SDK to strip them the
            // way the Python/TypeScript clients do — they went to the wire and the
            // request was refused outright. The array is padded and trimmed to
            // courtCount server-side below, so the constraint bought nothing anyway.
            description: `Exactly ${courtCount} entries, court 1 first.`,
            items: {
              type: 'object',
              properties: {
                game: { type: 'string', description: 'Game id for this court, or "" if none.' },
                umpire: { type: 'string', description: 'Umpiring team, or "".' },
                note: { type: 'string', description: 'Free text for note rows, else "".' },
              },
              required: ['game', 'umpire', 'note'],
              additionalProperties: false,
            },
          },
        },
        required: ['timeLabel', 'rowKind', 'courts'],
        additionalProperties: false,
      },
    },
    warnings: { type: 'array', items: { type: 'string' } },
  },
  required: ['slots', 'warnings'],
  additionalProperties: false,
});

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });

export default {
  async fetch(request) {
    if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);

    if (!process.env.ANTHROPIC_API_KEY) {
      return json({ error: 'The AI schedule builder is not configured on this deployment.' }, 503);
    }

    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
      request.headers.get('x-real-ip') ||
      'unknown';
    if (rateLimited(ip)) {
      return json({ error: 'Too many requests in a row — give it a minute.' }, 429);
    }

    // The caller's Firebase ID token. Passed straight through to Firestore below; this
    // function never trusts it on its own.
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
      console.error('[build-schedule] membership lookup network error:', err);
      return json({ error: 'Could not reach the membership store.' }, 502);
    }

    if (memberRes.status === 401 || memberRes.status === 403 || memberRes.status === 404) {
      return json({ error: 'Only a club admin can build the schedule for this club.' }, 403);
    }
    if (!memberRes.ok) {
      console.error(
        '[build-schedule] membership lookup failed',
        memberRes.status,
        await memberRes.text()
      );
      return json({ error: 'Could not read your club membership.' }, 502);
    }
    const memberDoc = await memberRes.json();
    if ((memberDoc.fields?.role?.stringValue || '') !== 'admin') {
      // A scorer is a real member; editing the schedule is still admin territory, and
      // firestore.rules would refuse the save even if this let the call through.
      return json({ error: 'Only a club admin can build the schedule for this club.' }, 403);
    }

    /* ---- Everything below this line runs only for a club admin ---- */

    const text = String(body.text ?? '').trim();
    const image = body.image || null;
    const games = Array.isArray(body.games) ? body.games.slice(0, MAX_GAMES) : [];
    const teams = Array.isArray(body.teams) ? body.teams.slice(0, 64) : [];
    const requestedCourts = Math.floor(Number(body.courtCount));
    const courtCount =
      Number.isFinite(requestedCourts) && requestedCourts >= 1
        ? Math.min(MAX_COURTS, requestedCourts)
        : DEFAULT_COURTS;

    if (!text && !image) {
      return json({ error: 'Paste a screenshot or describe the schedule first.' }, 400);
    }
    if (text.length > MAX_TEXT_CHARS) {
      return json({ error: `Keep the description under ${MAX_TEXT_CHARS} characters.` }, 400);
    }
    if (!games.length) {
      return json({ error: 'This tournament has no games to schedule yet.' }, 400);
    }

    const content = [];

    if (image) {
      if (!ALLOWED_MEDIA_TYPES.has(image.mediaType)) {
        return json({ error: 'Image must be PNG, JPEG, GIF or WebP.' }, 400);
      }
      const data = String(image.data || '');
      // base64 decodes to roughly 3/4 of its own length
      if (data.length * 0.75 > MAX_IMAGE_BYTES) {
        return json({ error: 'That image is too large — keep it under 5 MB.' }, 400);
      }
      content.push({
        type: 'image',
        source: { type: 'base64', media_type: image.mediaType, data },
      });
    }

    const gameList = games
      .map((g) => `${g.game}: ${g.team1} vs ${g.team2}`)
      .join('\n');

    content.push({
      type: 'text',
      text:
        `Teams: ${teams.join(', ') || '(none listed)'}\n\n` +
        `Available games — use these ids exactly:\n${gameList}\n\n` +
        (text
          ? `Schedule to convert:\n${text}`
          : 'Convert the schedule in the image above.'),
    });

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
          system: instructions(courtCount),
          output_config: {
            effort: EFFORT,
            format: { type: 'json_schema', schema: scheduleSchema(courtCount) },
          },
          messages: [{ role: 'user', content }],
        }),
      });
    } catch (err) {
      console.error('[build-schedule] network error:', err);
      return json({ error: 'Could not reach the schedule builder.' }, 502);
    }

    if (!res.ok) {
      const detail = await res.text();
      console.error('[build-schedule] anthropic error', res.status, detail);

      // "Could not read that schedule" was a dead end: it says the input was bad when
      // the actual causes are usually configuration — a rejected schema, a bad key, an
      // unknown model. None of those improve by rewording the prompt, and the only way
      // to tell them apart was the function logs. Pass the upstream reason through.
      let upstream = '';
      try {
        upstream = JSON.parse(detail)?.error?.message || '';
      } catch {
        upstream = detail.slice(0, 200);
      }

      if (res.status === 429) {
        return json(
          { error: 'The schedule builder is rate limited right now — try again shortly.' },
          502
        );
      }
      if (res.status === 401 || res.status === 403) {
        return json(
          { error: `The Anthropic API rejected our key (${res.status}). Check ANTHROPIC_API_KEY in the deployment settings.` },
          502
        );
      }
      if (res.status === 400) {
        // A 400 is our request, not the user's schedule — say so, so nobody wastes time
        // rewording a description that was never the problem.
        return json(
          { error: `The schedule builder sent an invalid request and Anthropic refused it: ${upstream || 'no detail returned'}. This is a bug on our side, not a problem with what you typed.` },
          502
        );
      }
      return json(
        { error: `The schedule builder failed (Anthropic returned ${res.status})${upstream ? `: ${upstream}` : ''}.` },
        502
      );
    }

    const message = await res.json();
    console.log(
      `[build-schedule] ${MODEL} effort=${EFFORT} took ${Date.now() - startedAt}ms ` +
        `stop=${message.stop_reason} in=${message.usage?.input_tokens} out=${message.usage?.output_tokens}`
    );

    if (message.stop_reason === 'refusal') {
      return json({ error: 'That input could not be processed.' }, 422);
    }
    if (message.stop_reason === 'max_tokens') {
      // The JSON is truncated, so parsing below would fail with a vaguer message.
      return json(
        {
          error:
            'That schedule was too long to convert in one go. Try a screenshot of just the league games, then add the finals rows separately.',
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
      console.error('[build-schedule] unparseable model output:', raw.slice(0, 500));
      return json({ error: 'The schedule builder returned an unreadable result.' }, 502);
    }

    // Trust nothing about the game ids: keep only ids that exist, and only once each.
    const validIds = new Set(games.map((g) => g.game));
    const used = new Set();
    const warnings = Array.isArray(parsed.warnings) ? [...parsed.warnings] : [];

    const takeGame = (value, rowLabel, court) => {
      const id = String(value ?? '').trim();
      if (!id) return null;
      if (!validIds.has(id)) {
        warnings.push(`Ignored unknown game "${id}" on ${rowLabel} court ${court}.`);
        return null;
      }
      if (used.has(id)) {
        warnings.push(`${id} was assigned more than once; kept the first slot only.`);
        return null;
      }
      used.add(id);
      return id;
    };

    const slots = (Array.isArray(parsed.slots) ? parsed.slots : []).map((slot) => {
      const rowKind = ['double', 'break', 'note'].includes(slot.rowKind) ? slot.rowKind : 'double';
      const timeLabel = String(slot.timeLabel ?? '').trim();
      const label = timeLabel || 'a row';
      // Padded and trimmed to the tournament's court count regardless of what came
      // back, so a short or long `courts` array cannot reshape the saved schedule.
      const returned = Array.isArray(slot.courts) ? slot.courts : [];
      const courts = Array.from({ length: courtCount }, (_, i) => {
        const court = returned[i] || {};
        return {
          game: rowKind === 'double' ? takeGame(court.game, label, i + 1) : null,
          umpire: rowKind === 'double' ? String(court.umpire ?? '').trim() : '',
          note: String(court.note ?? '').trim(),
        };
      });
      return { timeLabel, rowKind, courts };
    });

    if (!slots.length) {
      return json({ error: 'No schedule rows could be read from that.' }, 422);
    }

    const unscheduled = games.filter((g) => !used.has(g.game)).map((g) => g.game);
    if (unscheduled.length) {
      warnings.push(`Not placed in any slot: ${unscheduled.join(', ')}.`);
    }

    return json({ slots, warnings });
  },
};
