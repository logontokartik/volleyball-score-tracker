import fs from 'fs';
import {
  initializeTestEnvironment, assertFails, assertSucceeds,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';

const RULES = process.env.RULES_FILE;
const env = await initializeTestEnvironment({
  projectId: 'demo-vb',
  firestore: { rules: fs.readFileSync(RULES, 'utf8'), host: '127.0.0.1', port: 8080 },
});

let pass = 0, fail = 0;
const t = async (label, fn) => {
  try { await fn(); console.log(`ok   ${label}`); pass++; }
  catch (e) { console.log(`FAIL ${label}\n     ${String(e.message).split('\n')[0]}`); fail++; }
};

const admin  = env.authenticatedContext('u1', { email: 'boss@example.com' }).firestore();
const ADMIN2 = env.authenticatedContext('u4', { email: 'BOSS@EXAMPLE.COM' }).firestore();
const scorer = env.authenticatedContext('u2', { email: 'scorer@example.com' }).firestore();
const noEmail= env.authenticatedContext('u3', {}).firestore();
const anon   = env.unauthenticatedContext().firestore();

const TOURN = { name: 'Summer 2026', teams: ['Black','Yellow'], scheduleSlots: [],
                scores: [{ game:'G1', sets:[{team1:0,team2:0}] }], finalsMatches: [] };

const seed = async () => {
  await env.withSecurityRulesDisabled(async (c) => {
    await setDoc(doc(c.firestore(), 'tournaments/t1'), TOURN);
    await setDoc(doc(c.firestore(), 'settings/app'), { activeTournamentId: 't1' });
  });
};
await seed();

console.log('\n--- reads: the public scoreboard must stay public ---');
await t('anyone may read a tournament',        () => assertSucceeds(getDoc(doc(anon,   'tournaments/t1'))));
await t('anyone may read settings',            () => assertSucceeds(getDoc(doc(anon,   'settings/app'))));

console.log('\n--- signed out: no writes at all ---');
await t('signed out cannot score',             () => assertFails(updateDoc(doc(anon, 'tournaments/t1'), { scores: [] })));
await t('signed out cannot create',            () => assertFails(setDoc(doc(anon, 'tournaments/new'), TOURN)));
await t('signed out cannot delete',            () => assertFails(deleteDoc(doc(anon, 'tournaments/t1'))));
await t('signed out cannot switch active',     () => assertFails(setDoc(doc(anon, 'settings/app'), { activeTournamentId: 'x' })));

console.log('\n--- scorer: may score, and only score ---');
await t('scorer may write scores',             () => assertSucceeds(updateDoc(doc(scorer,'tournaments/t1'), { scores: [{ game:'G1', sets:[{team1:21,team2:18}] }] })));
await t('scorer may write finalsMatches',      () => assertSucceeds(updateDoc(doc(scorer,'tournaments/t1'), { finalsMatches: [{ id:'sf1' }] })));
await t('scorer may write both at once',       () => assertSucceeds(updateDoc(doc(scorer,'tournaments/t1'), { scores: [], finalsMatches: [] })));
await t('scorer may mark a game complete',     () => assertSucceeds(updateDoc(doc(scorer,'tournaments/t1'), { scores: [{ game:'G1', completed:true, sets:[] }] })));

await t('scorer CANNOT edit the schedule',     () => assertFails(updateDoc(doc(scorer,'tournaments/t1'), { scheduleSlots: [{ timeLabel:'8am' }] })));
await t('scorer CANNOT edit teams',            () => assertFails(updateDoc(doc(scorer,'tournaments/t1'), { teams: ['Hacked'] })));
await t('scorer CANNOT rename a tournament',   () => assertFails(updateDoc(doc(scorer,'tournaments/t1'), { name: 'Renamed' })));
await t('scorer CANNOT smuggle a field in beside scores',
                                               () => assertFails(updateDoc(doc(scorer,'tournaments/t1'), { scores: [], teams: ['Hacked'] })));
await t('scorer CANNOT create a tournament',   () => assertFails(setDoc(doc(scorer,'tournaments/new'), TOURN)));
await t('scorer CANNOT delete a tournament',   () => assertFails(deleteDoc(doc(scorer,'tournaments/t1'))));
await t('scorer CANNOT switch the active tournament',
                                               () => assertFails(setDoc(doc(scorer,'settings/app'), { activeTournamentId: 'x' }, { merge: true })));
await t('scorer CANNOT overwrite the whole doc with setDoc',
                                               () => assertFails(setDoc(doc(scorer,'tournaments/t1'), { ...TOURN, teams:['Hacked'] })));
await t('an account with no email claim is treated as a scorer',
                                               () => assertFails(updateDoc(doc(noEmail,'tournaments/t1'), { teams: ['Hacked'] })));
await t('...but that account can still score', () => assertSucceeds(updateDoc(doc(noEmail,'tournaments/t1'), { scores: [] })));

console.log('\n--- admin: everything ---');
await t('admin may edit the schedule',         () => assertSucceeds(updateDoc(doc(admin,'tournaments/t1'), { scheduleSlots: [{ timeLabel:'8am' }] })));
await t('admin may edit teams',                () => assertSucceeds(updateDoc(doc(admin,'tournaments/t1'), { teams: ['Black','Yellow','Red'] })));
await t('admin may score',                     () => assertSucceeds(updateDoc(doc(admin,'tournaments/t1'), { scores: [] })));
await t('admin may switch the active tournament',
                                               () => assertSucceeds(setDoc(doc(admin,'settings/app'), { activeTournamentId: 't1' }, { merge: true })));
await t('admin may create a tournament',       () => assertSucceeds(setDoc(doc(admin,'tournaments/t2'), TOURN)));
await t('admin may delete a tournament',       () => assertSucceeds(deleteDoc(doc(admin,'tournaments/t2'))));
await t('admin match is case-insensitive (BOSS@EXAMPLE.COM)',
                                               () => assertSucceeds(updateDoc(doc(ADMIN2,'tournaments/t1'), { teams: ['Case','Ok'] })));

// The empty-list fallback: before the club fills the list in, nothing should change.
console.log('\n--- empty admin list: every signed-in account is an admin (pre-roles behaviour) ---');
const openRules = fs.readFileSync(RULES,'utf8')
  .replace("'boss@example.com', 'cochair@example.com',", '');
const env2 = await initializeTestEnvironment({
  projectId: 'demo-vb-open',
  firestore: { rules: openRules, host: '127.0.0.1', port: 8080 },
});
await env2.withSecurityRulesDisabled(async (c) => {
  await setDoc(doc(c.firestore(), 'tournaments/t1'), TOURN);
});
const anyone = env2.authenticatedContext('u9', { email: 'nobody@example.com' }).firestore();
const anon2  = env2.unauthenticatedContext().firestore();
await t('empty list: any signed-in account may edit teams', () => assertSucceeds(updateDoc(doc(anyone,'tournaments/t1'), { teams:['A','B'] })));
await t('empty list: any signed-in account may delete',      () => assertSucceeds(deleteDoc(doc(anyone,'tournaments/t1'))));
await t('empty list: signed out still cannot write',         () => assertFails(setDoc(doc(anon2,'tournaments/t9'), TOURN)));

await env.cleanup(); await env2.cleanup();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
