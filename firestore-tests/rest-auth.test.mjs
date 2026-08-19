// The send-invite design assumes: a Firebase ID token passed as a Bearer to the
// Firestore REST API is evaluated against security rules. If that is false the whole
// authorization story collapses, so it is tested rather than assumed.
const PROJECT = 'demo-rest';
const HOST = 'http://127.0.0.1:8080';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
// The emulator accepts unsigned tokens; production requires a real signature, but the
// rules-evaluation path being exercised here is the same one.
const token = (uid, email) => `${b64({alg:'none',typ:'JWT'})}.${b64({
  iss:`https://securetoken.google.com/${PROJECT}`, aud:PROJECT, sub:uid, user_id:uid,
  email, email_verified:true, auth_time:Math.floor(Date.now()/1000),
  iat:Math.floor(Date.now()/1000), exp:Math.floor(Date.now()/1000)+3600,
  firebase:{identities:{email:[email]},sign_in_provider:'google.com'}})}.`;

const docUrl = (p) => `${HOST}/v1/projects/${PROJECT}/databases/(default)/documents/${p}`;
const seed = async (path, fields) => {
  const r = await fetch(`${docUrl(path)}?` , { method:'PATCH',
    headers:{'content-type':'application/json','Authorization':'Bearer owner'},
    body: JSON.stringify({ fields }) });
  if (!r.ok) throw new Error(`seed ${path}: ${r.status} ${await r.text()}`);
};
const S = (v) => ({ stringValue: v });

await seed('clubs/gvbl', { name:S('GVW'), slug:S('gvbl'), createdBy:S('adminuid') });
await seed('clubs/gvbl/members/adminuid', { uid:S('adminuid'), email:S('boss@example.com'), role:S('admin') });
await seed('clubs/gvbl/members/scoreruid', { uid:S('scoreruid'), email:S('scorer@example.com'), role:S('scorer') });
await seed('clubs/gvbl/invites/invitee@example.com', { email:S('invitee@example.com'), role:S('scorer') });

let pass=0, fail=0;
const t = async (label, fn) => { try { await fn(); console.log('ok   '+label); pass++; }
  catch(e){ console.log('FAIL '+label+'\n     '+e.message); fail++; } };
const get = (path, auth) => fetch(docUrl(path), auth ? { headers:{ authorization:auth } } : {});

await t('club admin token CAN read the invite (this is the authorization)', async()=>{
  const r = await get('clubs/gvbl/invites/invitee@example.com', `Bearer ${token('adminuid','boss@example.com')}`);
  if (r.status !== 200) throw new Error(`expected 200, got ${r.status} ${await r.text()}`);
  const b = await r.json();
  if (b.fields?.role?.stringValue !== 'scorer') throw new Error('role not readable'); });

await t('scorer token CANNOT read the invite', async()=>{
  const r = await get('clubs/gvbl/invites/invitee@example.com', `Bearer ${token('scoreruid','scorer@example.com')}`);
  if (r.status === 200) throw new Error('a scorer read an invite — rules not enforced over REST'); });

await t('no token CANNOT read the invite', async()=>{
  const r = await get('clubs/gvbl/invites/invitee@example.com');
  if (r.status === 200) throw new Error('anonymous read succeeded — rules not enforced over REST'); });

await t('the public club doc IS readable with no token (used for the club name)', async()=>{
  const r = await get('clubs/gvbl');
  if (r.status !== 200) throw new Error(`expected 200, got ${r.status}`); });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
