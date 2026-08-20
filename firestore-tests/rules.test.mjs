import fs from 'fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, writeBatch, collectionGroup, query, where, getDocs, serverTimestamp } from 'firebase/firestore';

const env = await initializeTestEnvironment({
  projectId: 'demo-clubs',
  firestore: { rules: fs.readFileSync(process.env.RULES_FILE,'utf8'), host:'127.0.0.1', port:8080 },
});
let pass=0, fail=0;
const t = async (l, fn) => { try { await fn(); console.log(`ok   ${l}`); pass++; }
  catch(e){ console.log(`FAIL ${l}\n     ${String(e.message).split('\n')[0]}`); fail++; } };

const ctx = (uid, email, verified=true) =>
  env.authenticatedContext(uid, email ? { email, email_verified: verified } : {}).firestore();

const superA = ctx('super','logontokartik@gmail.com');
const gAdmin = ctx('ga','gvbladmin@example.com');
const gScore = ctx('gs','gvblscorer@example.com');
const outsid = ctx('out','outsider@example.com');
const unver  = ctx('uv','invited@example.com', false);
const invited= ctx('iv','invited@example.com', true);
const anon   = env.unauthenticatedContext().firestore();

const TOURN = { name:'Summer', teams:['Black','Yellow'], scores:[], finalsMatches:[], scheduleSlots:[] };

await env.withSecurityRulesDisabled(async (c) => {
  const d = c.firestore();
  await setDoc(doc(d,'clubs/gvbl'), { name:'GVBL', slug:'gvbl', createdBy:'ga', archiveSheetId:'SHEET1', activeTournamentId:'t1' });
  await setDoc(doc(d,'slugs/gvbl'), { clubId:'gvbl' });
  await setDoc(doc(d,'clubs/gvbl/members/ga'), { uid:'ga', email:'gvbladmin@example.com', role:'admin' });
  await setDoc(doc(d,'clubs/gvbl/members/gs'), { uid:'gs', email:'gvblscorer@example.com', role:'scorer' });
  await setDoc(doc(d,'clubs/gvbl/tournaments/t1'), TOURN);
  await setDoc(doc(d,'clubs/gvbl/archive/snapshot'), { masterList: [] });
  await setDoc(doc(d,'clubs/gvbl/invites/invited@example.com'), { email:'invited@example.com', role:'scorer' });
  await setDoc(doc(d,'users/ga'), { email:'gvbladmin@example.com', displayName:'G Admin' });
  // A second, unrelated club
  await setDoc(doc(d,'clubs/other'), { name:'Other', slug:'other', createdBy:'zz' });
  await setDoc(doc(d,'clubs/other/members/zz'), { uid:'zz', email:'z@example.com', role:'admin' });
  await setDoc(doc(d,'clubs/other/tournaments/t9'), TOURN);
});

console.log('\n--- users/{uid}: the sign-in profile upsert ---');
const PROFILE = { email:'gvbladmin@example.com', displayName:'G Admin', photoURL:null, lastSeenAt:serverTimestamp() };
await t('user upserts their own profile',  ()=>assertSucceeds(setDoc(doc(gAdmin,'users/ga'), PROFILE, { merge:true })));
await t('user CANNOT write someone elses profile', ()=>assertFails(setDoc(doc(outsid,'users/ga'), PROFILE, { merge:true })));
await t('signed out CANNOT write a profile', ()=>assertFails(setDoc(doc(anon,'users/ga'), PROFILE, { merge:true })));
await t('user reads their own profile',    ()=>assertSucceeds(getDoc(doc(gAdmin,'users/ga'))));
await t('user CANNOT read someone elses profile', ()=>assertFails(getDoc(doc(outsid,'users/ga'))));
await t('super admin reads any profile',   ()=>assertSucceeds(getDoc(doc(superA,'users/ga'))));

console.log('\n--- public scoreboard stays public ---');
await t('anyone reads a club',            ()=>assertSucceeds(getDoc(doc(anon,'clubs/gvbl'))));
await t('anyone reads a tournament',      ()=>assertSucceeds(getDoc(doc(anon,'clubs/gvbl/tournaments/t1'))));
await t('anyone reads the archive',       ()=>assertSucceeds(getDoc(doc(anon,'clubs/gvbl/archive/snapshot'))));
await t('member emails are NOT public',   ()=>assertFails(getDoc(doc(anon,'clubs/gvbl/members/ga'))));
await t('outsider cannot read members',   ()=>assertFails(getDoc(doc(outsid,'clubs/gvbl/members/ga'))));
await t('outsider cannot read invites',   ()=>assertFails(getDoc(doc(outsid,'clubs/gvbl/invites/invited@example.com'))));

console.log('\n--- cross-club isolation (the whole point) ---');
await t('gvbl admin CANNOT write other club tournament', ()=>assertFails(updateDoc(doc(gAdmin,'clubs/other/tournaments/t9'), { teams:['X'] })));
await t('gvbl admin CANNOT score in other club',         ()=>assertFails(updateDoc(doc(gAdmin,'clubs/other/tournaments/t9'), { scores:[] })));
await t('gvbl admin CANNOT edit other club doc',         ()=>assertFails(updateDoc(doc(gAdmin,'clubs/other'), { name:'Hijacked' })));
await t('gvbl admin CANNOT invite into other club',      ()=>assertFails(setDoc(doc(gAdmin,'clubs/other/invites/x@example.com'), { email:'x@example.com', role:'admin' })));
await t('gvbl admin CANNOT read other club members',     ()=>assertFails(getDoc(doc(gAdmin,'clubs/other/members/zz'))));

console.log('\n--- club admin within their own club ---');
await t('admin edits teams',              ()=>assertSucceeds(updateDoc(doc(gAdmin,'clubs/gvbl/tournaments/t1'), { teams:['A','B'] })));
await t('admin creates a tournament',     ()=>assertSucceeds(setDoc(doc(gAdmin,'clubs/gvbl/tournaments/t2'), TOURN)));
await t('admin deletes a tournament',     ()=>assertSucceeds(deleteDoc(doc(gAdmin,'clubs/gvbl/tournaments/t2'))));
await t('admin sets active tournament',   ()=>assertSucceeds(updateDoc(doc(gAdmin,'clubs/gvbl'), { activeTournamentId:'t1' })));
await t('admin writes the archive',       ()=>assertSucceeds(setDoc(doc(gAdmin,'clubs/gvbl/archive/snapshot'), { masterList:[1] })));
await t('admin invites a scorer',         ()=>assertSucceeds(setDoc(doc(gAdmin,'clubs/gvbl/invites/new@example.com'), { email:'new@example.com', role:'scorer' })));
await t('admin CANNOT delete the club',   ()=>assertFails(deleteDoc(doc(gAdmin,'clubs/gvbl'))));

console.log('\n--- scorer is still confined to score fields ---');
await t('scorer writes scores',           ()=>assertSucceeds(updateDoc(doc(gScore,'clubs/gvbl/tournaments/t1'), { scores:[{game:'G1'}] })));
await t('scorer writes finalsMatches',    ()=>assertSucceeds(updateDoc(doc(gScore,'clubs/gvbl/tournaments/t1'), { finalsMatches:[] })));
await t('scorer CANNOT edit teams',       ()=>assertFails(updateDoc(doc(gScore,'clubs/gvbl/tournaments/t1'), { teams:['Hacked'] })));
await t('scorer CANNOT smuggle a field',  ()=>assertFails(updateDoc(doc(gScore,'clubs/gvbl/tournaments/t1'), { scores:[], teams:['Hacked'] })));
await t('scorer CANNOT set active tournament', ()=>assertFails(updateDoc(doc(gScore,'clubs/gvbl'), { activeTournamentId:'zz' })));
await t('scorer CANNOT write the archive',()=>assertFails(setDoc(doc(gScore,'clubs/gvbl/archive/snapshot'), { masterList:[] })));
await t('scorer CANNOT invite',           ()=>assertFails(setDoc(doc(gScore,'clubs/gvbl/invites/x@example.com'), { email:'x@example.com', role:'scorer' })));
await t('scorer CANNOT promote themselves',()=>assertFails(updateDoc(doc(gScore,'clubs/gvbl/members/gs'), { role:'admin' })));

console.log('\n--- outsiders cannot let themselves in ---');
await t('outsider CANNOT self-create membership', ()=>assertFails(setDoc(doc(outsid,'clubs/gvbl/members/out'), { uid:'out', email:'outsider@example.com', role:'scorer' })));
await t('outsider CANNOT score',          ()=>assertFails(updateDoc(doc(outsid,'clubs/gvbl/tournaments/t1'), { scores:[] })));

console.log('\n--- claiming an invite ---');
await t('invitee claims at the invited role', ()=>assertSucceeds(setDoc(doc(invited,'clubs/gvbl/members/iv'), { uid:'iv', email:'invited@example.com', role:'scorer' })));
await env.withSecurityRulesDisabled(async c => { await deleteDoc(doc(c.firestore(),'clubs/gvbl/members/iv')); });
await t('invitee CANNOT upgrade to admin while claiming', ()=>assertFails(setDoc(doc(invited,'clubs/gvbl/members/iv'), { uid:'iv', email:'invited@example.com', role:'admin' })));
await t('unverified email CANNOT claim',  ()=>assertFails(setDoc(doc(unver,'clubs/gvbl/members/uv'), { uid:'uv', email:'invited@example.com', role:'scorer' })));
await t('cannot claim someone else\'s invite', ()=>assertFails(setDoc(doc(outsid,'clubs/gvbl/members/out'), { uid:'out', email:'invited@example.com', role:'scorer' })));
await t('invitee may delete their own invite', ()=>assertSucceeds(deleteDoc(doc(invited,'clubs/gvbl/invites/invited@example.com'))));

console.log('\n--- creating a club (batch: club + slug + founding admin) ---');
const mk = async (d, clubId, slug, uid) => { const b = writeBatch(d);
  b.set(doc(d,`clubs/${clubId}`), { name:'New', slug, createdBy:uid });
  b.set(doc(d,`slugs/${slug}`),   { clubId });
  b.set(doc(d,`clubs/${clubId}/members/${uid}`), { uid, email:'outsider@example.com', role:'admin' });
  return b.commit(); };
await t('a signed-in stranger may create their own club', ()=>assertSucceeds(mk(outsid,'newclub','newslug','out')));
await t('cannot squat an existing slug',  ()=>assertFails(mk(outsid,'squat','gvbl','out')));
await t('cannot create a club owned by someone else', ()=>assertFails((async()=>{ const b=writeBatch(outsid);
  b.set(doc(outsid,'clubs/fake'), { name:'F', slug:'fakeslug', createdBy:'someone-else' });
  b.set(doc(outsid,'slugs/fakeslug'), { clubId:'fake' });
  return b.commit(); })()));
await t('cannot self-admin an existing club', ()=>assertFails(setDoc(doc(outsid,'clubs/gvbl/members/out'), { uid:'out', email:'outsider@example.com', role:'admin' })));
await t('signed out cannot create a club', ()=>assertFails(mk(anon,'anonclub','anonslug','nobody')));

console.log('\n--- super admin reaches everything ---');
await t('super edits any club tournament', ()=>assertSucceeds(updateDoc(doc(superA,'clubs/other/tournaments/t9'), { teams:['S'] })));
await t('super reads any members',        ()=>assertSucceeds(getDoc(doc(superA,'clubs/other/members/zz'))));
await t('super deletes a club',           ()=>assertSucceeds(deleteDoc(doc(superA,'clubs/other'))));

console.log('\n--- collection-group queries used by the UI ---');
await t('my clubs: collectionGroup members where uid==me', ()=>assertSucceeds(getDocs(query(collectionGroup(gAdmin,'members'), where('uid','==','ga')))));
await t('cannot list other peoples memberships', ()=>assertFails(getDocs(query(collectionGroup(gAdmin,'members'), where('uid','==','gs')))));
await t('my invites: collectionGroup invites where email==mine', ()=>assertSucceeds(getDocs(query(collectionGroup(invited,'invites'), where('email','==','invited@example.com')))));
await t('cannot list other peoples invites', ()=>assertFails(getDocs(query(collectionGroup(outsid,'invites'), where('email','==','invited@example.com')))));


console.log('\n--- legacy paths: readable by super admin only, never writable ---');
await env.withSecurityRulesDisabled(async (c) => {
  const d = c.firestore();
  await setDoc(doc(d,'tournaments/legacy1'), { name:'Old Summer', scores:[] });
  await setDoc(doc(d,'settings/app'), { activeTournamentId:'legacy1' });
  await setDoc(doc(d,'settings/archiveSnapshot'), { masterList:[] });
});
await t('super reads a legacy tournament (migration source)', ()=>assertSucceeds(getDoc(doc(superA,'tournaments/legacy1'))));
await t('super reads legacy settings/app',                    ()=>assertSucceeds(getDoc(doc(superA,'settings/app'))));
await t('super reads the legacy archive snapshot',            ()=>assertSucceeds(getDoc(doc(superA,'settings/archiveSnapshot'))));
await t('a club admin CANNOT read legacy data',               ()=>assertFails(getDoc(doc(gAdmin,'tournaments/legacy1'))));
await t('the public CANNOT read legacy data any more',        ()=>assertFails(getDoc(doc(anon,'tournaments/legacy1'))));
await t('super CANNOT write a legacy tournament',             ()=>assertFails(updateDoc(doc(superA,'tournaments/legacy1'), { name:'x' })));
await t('super CANNOT write legacy settings',                 ()=>assertFails(updateDoc(doc(superA,'settings/app'), { activeTournamentId:'x' })));
await t('super CANNOT delete a legacy tournament',            ()=>assertFails(deleteDoc(doc(superA,'tournaments/legacy1'))));


console.log('\n--- archiveSheetId is operator-only (the Claude-billed fetch-proxy lever) ---');
await t('club admin may still rename their club',
        ()=>assertSucceeds(updateDoc(doc(gAdmin,'clubs/gvbl'), { name:'GVBL Renamed' })));
await t('club admin may still set the active tournament',
        ()=>assertSucceeds(updateDoc(doc(gAdmin,'clubs/gvbl'), { activeTournamentId:'t1' })));
await t('club admin CANNOT point their club at another spreadsheet',
        ()=>assertFails(updateDoc(doc(gAdmin,'clubs/gvbl'), { archiveSheetId:'ATTACKER-SHEET' })));
await t('club admin CANNOT smuggle archiveSheetId in beside a legal field',
        ()=>assertFails(updateDoc(doc(gAdmin,'clubs/gvbl'), { name:'x', archiveSheetId:'ATTACKER-SHEET' })));
await t('club admin CANNOT reassign their club slug',
        ()=>assertFails(updateDoc(doc(gAdmin,'clubs/gvbl'), { slug:'stolen' })));
await t('club admin CANNOT rewrite createdBy',
        ()=>assertFails(updateDoc(doc(gAdmin,'clubs/gvbl'), { createdBy:'someone-else' })));
await t('super admin CAN attach a spreadsheet',
        ()=>assertSucceeds(updateDoc(doc(superA,'clubs/gvbl'), { archiveSheetId:'SHEET-OK' })));
// The full attack path from the review: create your own club, then try to attach a sheet.
await t('a stranger who created their own club still cannot attach a spreadsheet', async () => {
  const b = writeBatch(outsid);
  b.set(doc(outsid,'clubs/proxyclub'), { name:'P', slug:'proxyslug', createdBy:'out' });
  b.set(doc(outsid,'slugs/proxyslug'), { clubId:'proxyclub' });
  b.set(doc(outsid,'clubs/proxyclub/members/out'), { uid:'out', email:'outsider@example.com', role:'admin' });
  await assertSucceeds(b.commit());
  await assertFails(updateDoc(doc(outsid,'clubs/proxyclub'), { archiveSheetId:'ANY-PUBLIC-SHEET' }));
});


console.log('\n--- scoring-access requests ---');
await env.withSecurityRulesDisabled(async (c) => {
  await setDoc(doc(c.firestore(),'clubs/gvbl/requests/out'),
    { uid:'out', email:'outsider@example.com', displayName:'Outsider' });
});

await t('a signed-in stranger may ask for access, for themselves',
  ()=>assertSucceeds(setDoc(doc(outsid,'clubs/gvbl/requests/out'),
    { uid:'out', email:'outsider@example.com' })));
await t('...but CANNOT file a request in someone else\'s name',
  ()=>assertFails(setDoc(doc(outsid,'clubs/gvbl/requests/gs'),
    { uid:'gs', email:'gvblscorer@example.com' })));
await t('...and CANNOT claim an address that is not theirs',
  ()=>assertFails(setDoc(doc(outsid,'clubs/gvbl/requests/out'),
    { uid:'out', email:'someone.else@example.com' })));
await t('an unverified account cannot request',
  ()=>assertFails(setDoc(doc(unver,'clubs/gvbl/requests/uv'), { uid:'uv', email:'invited@example.com' })));
await t('signed out cannot request',
  ()=>assertFails(setDoc(doc(anon,'clubs/gvbl/requests/x'), { uid:'x', email:'x@example.com' })));

await t('the requester can read their own request', ()=>assertSucceeds(getDoc(doc(outsid,'clubs/gvbl/requests/out'))));
await t('a club admin can read requests',            ()=>assertSucceeds(getDoc(doc(gAdmin,'clubs/gvbl/requests/out'))));
await t('a scorer CANNOT read requests (they are email addresses)',
  ()=>assertFails(getDoc(doc(gScore,'clubs/gvbl/requests/out'))));
await t('the public CANNOT read requests',           ()=>assertFails(getDoc(doc(anon,'clubs/gvbl/requests/out'))));
await t('an admin of ANOTHER club cannot read them', ()=>assertFails(getDoc(doc(ctx('zz','z@example.com'),'clubs/gvbl/requests/out'))));

console.log('\n--- approving a request ---');
await t('an admin may add a member who actually asked', async()=>{
  const b = writeBatch(gAdmin);
  b.set(doc(gAdmin,'clubs/gvbl/members/out'), { uid:'out', email:'outsider@example.com', role:'scorer' });
  b.delete(doc(gAdmin,'clubs/gvbl/requests/out'));
  await assertSucceeds(b.commit());
});
await env.withSecurityRulesDisabled(async (c) => {
  await deleteDoc(doc(c.firestore(),'clubs/gvbl/members/out'));
  await setDoc(doc(c.firestore(),'clubs/gvbl/requests/out'), { uid:'out', email:'outsider@example.com' });
});
await t('an admin may approve as admin if they choose',
  ()=>assertSucceeds(setDoc(doc(gAdmin,'clubs/gvbl/members/out'), { uid:'out', email:'outsider@example.com', role:'admin' })));
await env.withSecurityRulesDisabled(async (c) => { await deleteDoc(doc(c.firestore(),'clubs/gvbl/members/out')); });

await t('an admin CANNOT invent a role',
  ()=>assertFails(setDoc(doc(gAdmin,'clubs/gvbl/members/out'), { uid:'out', email:'outsider@example.com', role:'owner' })));
// The whole point: the request document is the consent.
await t('an admin CANNOT add somebody who never asked',
  ()=>assertFails(setDoc(doc(gAdmin,'clubs/gvbl/members/nobody'), { uid:'nobody', email:'nobody@example.com', role:'scorer' })));
await t('a scorer CANNOT approve a request',
  ()=>assertFails(setDoc(doc(gScore,'clubs/gvbl/members/out'), { uid:'out', email:'outsider@example.com', role:'scorer' })));
await t('an admin CANNOT approve a request into ANOTHER club',
  ()=>assertFails(setDoc(doc(gAdmin,'clubs/other/members/out'), { uid:'out', email:'outsider@example.com', role:'scorer' })));
await t('a requester CANNOT approve themselves',
  ()=>assertFails(setDoc(doc(outsid,'clubs/gvbl/members/out'), { uid:'out', email:'outsider@example.com', role:'scorer' })));
await t('the requester may withdraw their own request',
  ()=>assertSucceeds(deleteDoc(doc(outsid,'clubs/gvbl/requests/out'))));

await env.cleanup();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
