// Walks the schema actually sent to the API and fails on anything outside the documented
// structured-outputs subset. This is the check that was missing when minItems/maxItems
// were added, so it exists now rather than relying on nobody adding another one.
const UNSUPPORTED = ['minItems','maxItems','uniqueItems','contains','minContains','maxContains',
  'minimum','maximum','exclusiveMinimum','exclusiveMaximum','multipleOf',
  'minLength','maxLength','pattern','minProperties','maxProperties','patternProperties','not','if','then','else'];

process.env.ANTHROPIC_API_KEY = 'test';
const mod = (await import('../api/build-schedule.js')).default;
// Capture the schema from the actual request body the function builds.
const schemaFor = async (courtCount) => {
  let captured = null;
  globalThis.fetch = async (url, opts = {}) => {
    if (String(url).includes('api.anthropic.com')) {
      captured = JSON.parse(opts.body).output_config.format.schema;
      return { ok: true, status: 200, json: async () => ({ stop_reason: 'end_turn',
        content: [{ type: 'text', text: JSON.stringify({ slots: [], warnings: [] }) }], usage: {} }) };
    }
    return { ok: false, status: 500, text: async () => '', json: async () => ({}) };
  };
  await mod.fetch(new Request('https://x/api/build-schedule', { method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `1.2.3.${courtCount}` },
    body: JSON.stringify({ text: 'x', courtCount,
      teams: ['A','B'], games: [{ game: 'G1', team1: 'A', team2: 'B' }] }) }));
  return captured;
};

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

for (const courts of [1,2,4,8]) {
  bad = []; objects = 0; objectsMissingAP = 0;
  const schema = await schemaFor(courts);
  if (!schema) { console.log(`FAIL courtCount=${courts}: no request captured`); process.exitCode = 1; continue; }
  walk(schema);
  const ok = bad.length === 0 && objectsMissingAP === 0;
  console.log(`${ok?'ok  ':'FAIL'} courtCount=${courts}: ${objects} objects, ` +
    `${bad.length?`unsupported: ${bad.join(', ')}`:'no unsupported keywords'}` +
    `${objectsMissingAP?`, ${objectsMissingAP} object(s) missing additionalProperties:false`:''}`);
  if (!ok) process.exitCode = 1;
}
