/**
 * Vercel Function: turn a pasted schedule screenshot or typed description into
 * schedule rows for the current tournament.
 *
 * The client sends the tournament's game list so Claude maps "Black v Yellow" onto the
 * real game id rather than inventing one; anything it returns that isn't in that list is
 * dropped here rather than trusted.
 *
 * ANTHROPIC_API_KEY is read server-side only and never reaches the browser.
 */

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-5';

// Reading a schedule off a screenshot is extraction, not deep reasoning, and it runs
// against a hard function timeout — so this defaults lower than the archive assistant.
// Override with ANTHROPIC_SCHEDULE_EFFORT if a messy source needs more.
const EFFORT =
  process.env.ANTHROPIC_SCHEDULE_EFFORT || process.env.ANTHROPIC_EFFORT || 'low';

const MAX_TEXT_CHARS = 8000;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // Anthropic's per-image ceiling
const MAX_GAMES = 200;
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

const INSTRUCTIONS = `You convert a volleyball tournament schedule into structured rows.

The input is a screenshot of a schedule, a typed description, or both. Reproduce it faithfully — do not invent rows, times, or games that are not there.

## Row kinds

- \`double\` — a normal time slot with a game on court 1 and/or court 2.
- \`break\` — a break or lunch row. Put the wording in \`timeLabel\` (e.g. "Break (1:00 – 2:00 pm)") and leave everything else empty.
- \`note\` — a row of free text rather than scheduled league games, such as semifinals and finals. Put the time in \`timeLabel\` and the wording in \`noteCourt1\` (e.g. "Semifinal 1 (Seed 1 vs Seed 4)"). Use \`noteCourt2\` only when the row genuinely has different text for the second court.

## Assigning games

\`gameCourt1\` and \`gameCourt2\` must be a game id copied exactly from the available games list, or an empty string when that court is idle for that slot.

Match games by the pair of teams, not by the game number printed in the source — the source's own numbering (G1, G2…) usually will not line up with the ids in the list. "Black v Yellow" means the game in the list whose two teams are Black and Yellow, in either order. Team names may be shortened or differently cased in the source; map them to the closest team in the list. If a listed pairing genuinely has no match, leave the court empty and mention it in \`warnings\`.

Never use the same game id twice.

## Umpires

\`umpireCourt1\` and \`umpireCourt2\` are the umpiring teams for each court. Schedules often print a single umpire column per court, but some print one umpire for the whole row — in that case use the same team for both courts. Empty string when none is given.

## Output

Return every row in the order it appears, top to bottom. Put anything you could not represent — an unmatched pairing, an ambiguous team name, an unreadable cell — in \`warnings\`, one short sentence each. Return an empty \`warnings\` array when everything mapped cleanly.`;

const SCHEDULE_SCHEMA = {
  type: 'object',
  properties: {
    slots: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          timeLabel: { type: 'string', description: 'Time or label for the row, e.g. "8am".' },
          rowKind: { type: 'string', enum: ['double', 'break', 'note'] },
          gameCourt1: { type: 'string', description: 'Game id for court 1, or "" if none.' },
          gameCourt2: { type: 'string', description: 'Game id for court 2, or "" if none.' },
          umpireCourt1: { type: 'string' },
          umpireCourt2: { type: 'string' },
          noteCourt1: { type: 'string', description: 'Free text for note rows, else "".' },
          noteCourt2: { type: 'string' },
        },
        required: [
          'timeLabel',
          'rowKind',
          'gameCourt1',
          'gameCourt2',
          'umpireCourt1',
          'umpireCourt2',
          'noteCourt1',
          'noteCourt2',
        ],
        additionalProperties: false,
      },
    },
    warnings: { type: 'array', items: { type: 'string' } },
  },
  required: ['slots', 'warnings'],
  additionalProperties: false,
};

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

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Malformed request body.' }, 400);
    }

    const text = String(body.text ?? '').trim();
    const image = body.image || null;
    const games = Array.isArray(body.games) ? body.games.slice(0, MAX_GAMES) : [];
    const teams = Array.isArray(body.teams) ? body.teams.slice(0, 64) : [];

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
          system: INSTRUCTIONS,
          output_config: {
            effort: EFFORT,
            format: { type: 'json_schema', schema: SCHEDULE_SCHEMA },
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
      return json(
        {
          error:
            res.status === 429
              ? 'The schedule builder is rate limited right now — try again shortly.'
              : 'The schedule builder could not read that schedule.',
        },
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
      return {
        timeLabel,
        rowKind,
        gameCourt1: rowKind === 'double' ? takeGame(slot.gameCourt1, label, 1) : null,
        gameCourt2: rowKind === 'double' ? takeGame(slot.gameCourt2, label, 2) : null,
        umpireCourt1: rowKind === 'double' ? String(slot.umpireCourt1 ?? '').trim() : '',
        umpireCourt2: rowKind === 'double' ? String(slot.umpireCourt2 ?? '').trim() : '',
        noteCourt1: String(slot.noteCourt1 ?? '').trim(),
        noteCourt2: String(slot.noteCourt2 ?? '').trim(),
      };
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
