// api/build-fixtures.js: the authorization gate, and the validation of what the model
// returns. `fetch` is stubbed, so no model call is ever made and nothing leaves the
// process — the stub also counts outbound calls, which is how "refused before any model
// call" is asserted rather than assumed.
process.env.ANTHROPIC_API_KEY = 'test';
const mod = (await import('../api/build-fixtures.js')).default;

const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
const tokenFor = (uid) => `header.${b64({ user_id: uid })}.signature`;

const TEAMS = ['Red', 'Blue', 'Green', 'Black'];
const POOLS = [
  { name: 'A', teams: ['Red', 'Blue'] },
  { name: 'B', teams: ['Green', 'Black'] },
];

let ip = 0;
let calls;

/**
 * @param role      'admin' | 'scorer' | 'none' (Firestore denies the read)
 * @param modelOut  what the model "returns", or null to assert it is never called
 */
function stubFetch(role, modelOut) {
  calls = { firestore: 0, anthropic: 0 };
  globalThis.fetch = async (url, opts = {}) => {
    if (String(url).includes('firestore.googleapis.com')) {
      calls.firestore += 1;
      if (role === 'none') return { ok: false, status: 403, text: async () => '', json: async () => ({}) };
      return { ok: true, status: 200, text: async () => '',
        json: async () => ({ fields: { role: { stringValue: role } } }) };
    }
    if (String(url).includes('api.anthropic.com')) {
      calls.anthropic += 1;
      return { ok: true, status: 200, text: async () => '',
        json: async () => ({ stop_reason: 'end_turn', usage: {},
          content: [{ type: 'text', text: JSON.stringify(modelOut) }] }) };
    }
    throw new Error(`unexpected outbound call to ${url}`);
  };
}

const post = (body, { token, headers = {} } = {}) =>
  mod.fetch(new Request('https://x/api/build-fixtures', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': `10.0.0.${++ip}`,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: JSON.stringify(body),
  }));

const baseBody = (extra = {}) => ({
  clubId: 'club1',
  prompt: 'draw it up',
  teams: TEAMS,
  courtCount: 2,
  setsPerMatch: 3,
  meetingsPerPair: 1,
  ...extra,
});

let failures = 0;
const assert = (label, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail && !ok ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

/* ---- Auth ---- */

stubFetch('admin', { fixtures: [], warnings: [] });
let res = await post(baseBody());
assert('no token → 401 and zero outbound calls',
  res.status === 401 && calls.firestore === 0 && calls.anthropic === 0,
  `status=${res.status} firestore=${calls.firestore} anthropic=${calls.anthropic}`);

stubFetch('scorer', { fixtures: [], warnings: [] });
res = await post(baseBody(), { token: tokenFor('scorer-uid') });
assert("scorer's token → 403 with no model call",
  res.status === 403 && calls.anthropic === 0,
  `status=${res.status} anthropic=${calls.anthropic}`);

stubFetch('none', { fixtures: [], warnings: [] });
res = await post(baseBody(), { token: tokenFor('outsider-uid') });
assert('non-member (Firestore 403) → 403 with no model call',
  res.status === 403 && calls.anthropic === 0,
  `status=${res.status} anthropic=${calls.anthropic}`);

/* ---- Validation ---- */

stubFetch('admin', {
  fixtures: [
    { team1: '  rEd ', team2: 'Blue', pool: '' },   // canonical spelling substituted
    { team1: 'Red', team2: 'Purple', pool: '' },    // unknown team
    { team1: 'Green', team2: 'Green', pool: '' },   // self-pairing
    { team1: 'Green', team2: 'Black', pool: '' },
  ],
  warnings: [],
});
res = await post(baseBody(), { token: tokenFor('admin-uid') });
let data = await res.json();
assert('unknown team dropped with a warning naming it',
  data.fixtures.length === 2 && data.warnings.some((w) => w.includes('Purple')),
  JSON.stringify(data));
assert('self-pairing dropped with a warning',
  data.warnings.some((w) => w.includes('itself')), JSON.stringify(data.warnings));
assert("model's spelling replaced by the canonical name",
  data.fixtures[0].team1 === 'Red', JSON.stringify(data.fixtures[0]));
assert('ids are sequential and server-assigned',
  data.fixtures.map((f) => f.game).join(',') === 'G1,G2', JSON.stringify(data.fixtures));

stubFetch('admin', {
  fixtures: [
    { team1: 'Red', team2: 'Blue', pool: 'A' },
    { team1: 'Red', team2: 'Green', pool: 'A' },   // cross-pool
    { team1: 'Green', team2: 'Black', pool: 'C' }, // pool that does not exist
  ],
  warnings: [],
});
res = await post(baseBody({ pools: POOLS }), { token: tokenFor('admin-uid') });
data = await res.json();
assert('cross-pool fixture dropped when pools are supplied',
  data.fixtures.length === 1 && data.fixtures[0].pool === 'A', JSON.stringify(data));
assert('fixture naming an unknown pool dropped',
  data.warnings.some((w) => w.includes('"C"')), JSON.stringify(data.warnings));

stubFetch('admin', {
  fixtures: [
    { team1: 'Red', team2: 'Blue', pool: '' },
    { team1: 'Blue', team2: 'Red', pool: '' },
  ],
  warnings: [],
});
res = await post(baseBody(), { token: tokenFor('admin-uid') });
data = await res.json();
assert('a pairing over meetingsPerPair is warned about, not dropped',
  data.fixtures.length === 2 && data.warnings.some((w) => w.includes('appears 2 times')),
  JSON.stringify(data));

stubFetch('admin', {
  fixtures: [{ team1: 'Purple', team2: 'Orange', pool: '' }],
  warnings: [],
});
res = await post(baseBody(), { token: tokenFor('admin-uid') });
data = await res.json();
assert('everything invalid → 422 with a message, not an empty list',
  res.status === 422 && typeof data.error === 'string' && !('fixtures' in data),
  `status=${res.status} ${JSON.stringify(data)}`);

process.exitCode = failures ? 1 : 0;
console.log(failures ? `${failures} failed` : 'all passed');
