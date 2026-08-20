// Walks the schema actually sent to the API and fails on anything outside the documented
// structured-outputs subset. This is the check that was missing when minItems/maxItems
// were added, so it exists now rather than relying on nobody adding another one.
//
// Both AI functions are covered: build-schedule's court-count-driven row schema and
// build-fixtures' fixture list. Both are gated on a club-admin membership read, so the
// stub below answers Firestore as well as Anthropic — no network either way.
const UNSUPPORTED = ['minItems','maxItems','uniqueItems','contains','minContains','maxContains',
  'minimum','maximum','exclusiveMinimum','exclusiveMaximum','multipleOf',
  'minLength','maxLength','pattern','minProperties','maxProperties','patternProperties','not','if','then','else'];

process.env.ANTHROPIC_API_KEY = 'test';
const schedule = (await import('../api/build-schedule.js')).default;
const fixtures = (await import('../api/build-fixtures.js')).default;

// A token shaped like a Firebase ID token: the functions read the uid out of the payload
// segment, then prove it by reading the membership document with the whole token.
const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
const tokenFor = (uid) => `header.${b64({ user_id: uid })}.signature`;

const memberDoc = (role) => ({
  ok: true,
  status: 200,
  json: async () => ({ fields: { role: { stringValue: role } } }),
  text: async () => '',
});

// Capture the schema from the actual request body the function builds.
const captureSchema = async (call) => {
  let captured = null;
  globalThis.fetch = async (url, opts = {}) => {
    if (String(url).includes('firestore.googleapis.com')) return memberDoc('admin');
    if (String(url).includes('api.anthropic.com')) {
      captured = JSON.parse(opts.body).output_config.format.schema;
      return { ok: true, status: 200, json: async () => ({ stop_reason: 'end_turn',
        content: [{ type: 'text', text: JSON.stringify({ slots: [], fixtures: [], warnings: [] }) }], usage: {} }) };
    }
    return { ok: false, status: 500, text: async () => '', json: async () => ({}) };
  };
  await call();
  return captured;
};

const scheduleSchemaFor = (courtCount) =>
  captureSchema(() =>
    schedule.fetch(new Request('https://x/api/build-schedule', { method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${tokenFor('u1')}`,
        'x-forwarded-for': `1.2.3.${courtCount}` },
      body: JSON.stringify({ clubId: 'club1', text: 'x', courtCount,
        teams: ['A','B'], games: [{ game: 'G1', team1: 'A', team2: 'B' }] }) })));

const fixturesSchemaFor = (poolCount) =>
  captureSchema(() =>
    fixtures.fetch(new Request('https://x/api/build-fixtures', { method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${tokenFor('u1')}`,
        'x-forwarded-for': `4.5.6.${poolCount}` },
      body: JSON.stringify({ clubId: 'club1', prompt: 'everyone plays everyone',
        teams: ['A','B','C','D'], courtCount: 2, setsPerMatch: 3, meetingsPerPair: 1,
        pools: poolCount ? [{ name: 'A', teams: ['A','B'] }, { name: 'B', teams: ['C','D'] }] : [] }) })));

let bad = [], objectsMissingAP = 0, objects = 0;
const walk = (node, path='$') => {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) return node.forEach((n,i)=>walk(n, `${path}[${i}]`));
  for (const k of Object.keys(node)) if (UNSUPPORTED.includes(k)) bad.push(`${path}.${k}`);
  if (node.type === 'object') {
    objects++;
    if (node.additionalProperties !== false) objectsMissingAP++;
  }
  for (const [k,v] of Object.entries(node)) walk(v, `${path}.${k}`);
};

const check = async (label, getSchema) => {
  bad = []; objects = 0; objectsMissingAP = 0;
  const schema = await getSchema();
  if (!schema) { console.log(`FAIL ${label}: no request captured`); process.exitCode = 1; return; }
  walk(schema);
  const ok = bad.length === 0 && objectsMissingAP === 0;
  console.log(`${ok?'ok  ':'FAIL'} ${label}: ${objects} objects, ` +
    `${bad.length?`unsupported: ${bad.join(', ')}`:'no unsupported keywords'}` +
    `${objectsMissingAP?`, ${objectsMissingAP} object(s) missing additionalProperties:false`:''}`);
  if (!ok) process.exitCode = 1;
};

for (const courts of [1,2,4,8]) {
  await check(`build-schedule courtCount=${courts}`, () => scheduleSchemaFor(courts));
}
for (const pools of [0,2]) {
  await check(`build-fixtures pools=${pools}`, () => fixturesSchemaFor(pools));
}
