// End-to-end test of the legacy -> clubs migration, against the real firestore.rules.
//
// It imports ../src/migrateToClubs.js — the exact module the /super console calls — so
// there is no second copy of the migration logic to drift out of step. See
// cra-resolve-hook.mjs for why this needs a resolution hook.
//
// Run (from this directory):
//   ./node_modules/.bin/firebase emulators:exec --only firestore --project demo-clubs \
//     "RULES_FILE=$PWD/../firestore.rules node --import ./register-hooks.mjs migration.test.mjs"
import fs from 'fs';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, Timestamp } from 'firebase/firestore';
import { inspectMigration, runMigration } from '../src/migrateToClubs.js';
import { GVBL_ARCHIVE_SHEET_ID } from '../src/archiveRefreshUtils.js';

const env = await initializeTestEnvironment({
  projectId: 'demo-migration',
  firestore: { rules: fs.readFileSync(process.env.RULES_FILE, 'utf8'), host: '127.0.0.1', port: 8080 },
});

let pass = 0;
let fail = 0;
const t = (label, fn) => {
  try {
    fn();
    console.log(`ok   ${label}`);
    pass++;
  } catch (e) {
    console.log(`FAIL ${label}\n     ${String(e.message).split('\n')[0]}`);
    fail++;
  }
};
const eq = (a, b, what) => {
  const A = JSON.stringify(a);
  const B = JSON.stringify(b);
  if (A !== B) throw new Error(`${what || 'values differ'}: ${A} !== ${B}`);
};
const ok = (cond, what) => {
  if (!cond) throw new Error(what || 'expected true');
};

// ---- realistic legacy data ------------------------------------------------------
// Same shape AdminPage writes today: teams, a generated schedule, per-set scores,
// scheduleSlots, finals, and completed flags.
const match = (a, b, done) => ({
  id: `${a}-${b}`,
  teamA: a,
  teamB: b,
  sets: done ? [{ a: 25, b: 21 }, { a: 23, b: 25 }, { a: 15, b: 12 }] : [{ a: 0, b: 0 }],
  completed: Boolean(done),
  locked: Boolean(done),
});

const legacyTournament = (name, teams, completed) => ({
  name,
  teams,
  scheduleFormat: 'roundRobin',
  setsPerMatch: 3,
  meetingsPerPair: 1,
  pointsToWin: 25,
  scores: [match(teams[0], teams[1], completed), match(teams[1], teams[2], completed), match(teams[0], teams[2], false)],
  scheduleSlots: [
    { court: 1, time: '9:00', matchId: `${teams[0]}-${teams[1]}` },
    { court: 2, time: '9:00', matchId: `${teams[1]}-${teams[2]}` },
    { court: 1, time: '10:00', matchId: `${teams[0]}-${teams[2]}` },
  ],
  finalsMatches: completed ? [{ id: 'final', teamA: teams[0], teamB: teams[1], sets: [{ a: 25, b: 20 }], completed: true }] : [],
  scheduleTitle: `${teams.length} Teams Format`,
  scheduleSubtitle: name,
  completed: Boolean(completed),
  // A Timestamp on purpose: the copy must carry native field types through, not
  // stringify them.
  createdAt: Timestamp.fromMillis(1700000000000),
});

const LEGACY = {
  'spring-2024': legacyTournament('Spring 2024', ['Black', 'Yellow', 'Red'], true),
  'summer-2024': legacyTournament('Summer 2024', ['Blue', 'Green', 'White'], false),
  'fall-2024': legacyTournament('Fall 2024', ['Orange', 'Purple', 'Grey'], true),
};
const ACTIVE_ID = 'summer-2024';
const LEGACY_ARCHIVE = {
  masterList: [{ team: 'Black', wins: 12, losses: 3 }, { team: 'Yellow', wins: 9, losses: 6 }],
  seasons: ['2022', '2023', '2024'],
  refreshedAt: Timestamp.fromMillis(1700000500000),
};

await env.withSecurityRulesDisabled(async (c) => {
  const d = c.firestore();
  for (const [id, data] of Object.entries(LEGACY)) await setDoc(doc(d, 'tournaments', id), data);
  await setDoc(doc(d, 'settings', 'app'), { activeTournamentId: ACTIVE_ID });
  await setDoc(doc(d, 'settings', 'archiveSnapshot'), LEGACY_ARCHIVE);
});

const SUPER = { uid: 'super', email: 'logontokartik@gmail.com', displayName: 'Super Admin' };
const superDb = env
  .authenticatedContext(SUPER.uid, { email: SUPER.email, email_verified: true })
  .firestore();

// Verification reads go through a rules-disabled context: the point is what is in the
// database, not what a particular caller is allowed to see.
const readAll = async () => {
  let out;
  await env.withSecurityRulesDisabled(async (c) => {
    const d = c.firestore();
    const [legacy, club, slug, member, clubTourns, clubArchive, settings, legacyArchive] = await Promise.all([
      getDocs(collection(d, 'tournaments')),
      getDoc(doc(d, 'clubs', 'gvbl')),
      getDoc(doc(d, 'slugs', 'gvbl')),
      getDoc(doc(d, 'clubs', 'gvbl', 'members', SUPER.uid)),
      getDocs(collection(d, 'clubs', 'gvbl', 'tournaments')),
      getDoc(doc(d, 'clubs', 'gvbl', 'archive', 'snapshot')),
      getDoc(doc(d, 'settings', 'app')),
      getDoc(doc(d, 'settings', 'archiveSnapshot')),
    ]);
    out = {
      legacy: Object.fromEntries(legacy.docs.map((x) => [x.id, x.data()])),
      club: club.exists() ? club.data() : null,
      slug: slug.exists() ? slug.data() : null,
      member: member.exists() ? member.data() : null,
      clubTournaments: Object.fromEntries(clubTourns.docs.map((x) => [x.id, x.data()])),
      clubArchive: clubArchive.exists() ? clubArchive.data() : null,
      settingsApp: settings.exists() ? settings.data() : null,
      legacyArchive: legacyArchive.exists() ? legacyArchive.data() : null,
    };
  });
  return out;
};

const before = await readAll();

console.log('\n--- dry run reports the world as it is ---');
const plan = await inspectMigration(superDb, { clubId: 'gvbl', slug: 'gvbl', uid: SUPER.uid });
t('dry run finds all 3 legacy tournaments', () => eq(plan.legacyTournamentCount, 3));
t('dry run reads the active pointer', () => eq(plan.activeTournamentId, ACTIVE_ID));
t('dry run resolves the active pointer', () => ok(plan.activeTournamentResolves));
t('dry run sees the archive snapshot', () => ok(plan.archiveSnapshotExists));
t('dry run says the club does not exist yet', () => ok(!plan.clubExists && plan.willCreateClub));
t('dry run says the slug is free', () => ok(!plan.slugExists));
t('dry run has no blockers', () => eq(plan.blockers, []));
t('dry run plans to copy 3 and overwrite 0', () => {
  eq(plan.willCopy.length, 3, 'willCopy');
  eq(plan.willOverwrite.length, 0, 'willOverwrite');
});
const afterDry = await readAll();
t('dry run left the database untouched', () => eq(afterDry, before, 'database after dry run'));

console.log('\n--- first run ---');
const report1 = await runMigration(superDb, {
  clubId: 'gvbl',
  slug: 'gvbl',
  name: 'Greenville Volleyball League',
  user: SUPER,
});
const after1 = await readAll();

t('run 1 reports ok', () => ok(report1.ok, `report: ${JSON.stringify(report1)}`));
t('run 1 created the club', () => ok(report1.createdClub));
t('run 1 copied 3 documents, 0 failed', () => {
  eq(report1.copied.sort(), Object.keys(LEGACY).sort(), 'copied ids');
  eq(report1.failed, [], 'failed');
});
t('run 1 copied the archive', () => eq(report1.archive, 'copied'));

t('club document is correct', () => {
  ok(after1.club, 'clubs/gvbl missing');
  eq(after1.club.name, 'Greenville Volleyball League', 'name');
  eq(after1.club.slug, 'gvbl', 'slug');
  eq(after1.club.createdBy, SUPER.uid, 'createdBy');
  eq(after1.club.archiveSheetId, GVBL_ARCHIVE_SHEET_ID, 'archiveSheetId');
  ok(after1.club.createdAt, 'createdAt missing');
});
t('slug document points back at the club', () => eq(after1.slug, { clubId: 'gvbl' }));
t('founding admin member document is correct', () => {
  ok(after1.member, 'member missing');
  eq(after1.member.uid, SUPER.uid, 'uid');
  eq(after1.member.role, 'admin', 'role');
  eq(after1.member.email, SUPER.email, 'email');
});

t('every legacy tournament exists under the club, same id, identical content', () => {
  eq(Object.keys(after1.clubTournaments).sort(), Object.keys(LEGACY).sort(), 'ids');
  for (const id of Object.keys(LEGACY)) {
    eq(after1.clubTournaments[id], before.legacy[id], `content of ${id}`);
  }
});
t('activeTournamentId survived and resolves to a real tournament', () => {
  eq(after1.club.activeTournamentId, ACTIVE_ID, 'pointer');
  ok(after1.clubTournaments[ACTIVE_ID], 'pointer does not resolve under the club');
});
t('archive snapshot moved across intact', () => eq(after1.clubArchive, before.legacyArchive));

t('legacy tournaments are untouched', () => eq(after1.legacy, before.legacy));
t('legacy settings/app is untouched', () => eq(after1.settingsApp, before.settingsApp));
t('legacy settings/archiveSnapshot is untouched', () => eq(after1.legacyArchive, before.legacyArchive));

console.log('\n--- second run: idempotency ---');
const plan2 = await inspectMigration(superDb, { clubId: 'gvbl', slug: 'gvbl', uid: SUPER.uid });
t('dry run now says the club exists', () => ok(plan2.clubExists && !plan2.willCreateClub));
t('dry run now plans 0 new and 3 overwrites', () => {
  eq(plan2.willCopy.length, 0, 'willCopy');
  eq(plan2.willOverwrite.length, 3, 'willOverwrite');
});
t('dry run sees the founding member', () => ok(plan2.memberExists));

const report2 = await runMigration(superDb, {
  clubId: 'gvbl',
  slug: 'gvbl',
  name: 'Greenville Volleyball League',
  user: SUPER,
});
const after2 = await readAll();

t('run 2 reports ok', () => ok(report2.ok, `report: ${JSON.stringify(report2)}`));
t('run 2 skipped club creation', () => ok(report2.skippedClubCreation && !report2.createdClub));
t('run 2 wrote nothing: all 3 were already there', () => {
  eq(report2.copied, [], 'copied ids');
  eq(report2.skipped.sort(), Object.keys(LEGACY).sort(), 'skipped ids');
  eq(report2.failed, [], 'failed');
});
t('run 2 left the archive snapshot alone rather than re-copying it', () => eq(report2.archive, 'skipped'));
t('run 2 did not duplicate anything', () => eq(Object.keys(after2.clubTournaments).length, 3));
t('run 2 left the club document byte-identical', () => eq(after2.club, after1.club));
t('run 2 left the member document byte-identical', () => eq(after2.member, after1.member));
t('run 2 left tournament content identical', () => eq(after2.clubTournaments, after1.clubTournaments));
t('run 2 left the archive identical', () => eq(after2.clubArchive, after1.clubArchive));
t('run 2 still deleted nothing from the legacy paths', () => {
  eq(after2.legacy, before.legacy, 'legacy tournaments');
  eq(after2.settingsApp, before.settingsApp, 'settings/app');
});

console.log('\n--- re-running after the club has gone live must not eat live scores ---');
// The scenario the default protects: a first run copies most of the tournaments, a club
// admin then scores games in the migrated club, and the operator re-runs to pick up what
// the first run missed. Simulated by editing one copied tournament (as a scorer would)
// and deleting another (as a run that failed on it would have left things).
const LIVE_EDIT = { a: 25, b: 23 };
await env.withSecurityRulesDisabled(async (c) => {
  const d = c.firestore();
  const live = { ...LEGACY['spring-2024'] };
  live.scores = live.scores.map((m, i) => (i === 2 ? { ...m, sets: [LIVE_EDIT], completed: true } : m));
  live.name = 'Spring 2024 (scored since the migration)';
  await setDoc(doc(d, 'clubs', 'gvbl', 'tournaments', 'spring-2024'), live);
  await deleteDoc(doc(d, 'clubs', 'gvbl', 'tournaments', 'fall-2024'));
});
const liveBefore = (await readAll()).clubTournaments['spring-2024'];

const report3 = await runMigration(superDb, {
  clubId: 'gvbl',
  slug: 'gvbl',
  name: 'Greenville Volleyball League',
  user: SUPER,
});
const after3 = await readAll();

t('run 3 reports ok', () => ok(report3.ok, `report: ${JSON.stringify(report3)}`));
t('run 3 copied only the tournament that was missing', () => {
  eq(report3.copied, ['fall-2024'], 'copied ids');
  eq(report3.skipped.sort(), ['spring-2024', 'summer-2024'], 'skipped ids');
  eq(report3.failed, [], 'failed');
});
t('the live edit SURVIVED the re-run', () => eq(after3.clubTournaments['spring-2024'], liveBefore));
t('the missing tournament was restored from the legacy copy', () =>
  eq(after3.clubTournaments['fall-2024'], before.legacy['fall-2024']));
t('run 3 defaulted to not overwriting', () => ok(report3.overwriteExisting === false));

console.log('\n--- overwriteExisting: true is the deliberate, destructive re-copy ---');
const report4 = await runMigration(superDb, {
  clubId: 'gvbl',
  slug: 'gvbl',
  name: 'Greenville Volleyball League',
  user: SUPER,
  overwriteExisting: true,
});
const after4 = await readAll();

t('run 4 reports ok', () => ok(report4.ok, `report: ${JSON.stringify(report4)}`));
t('run 4 copied all 3 and skipped none', () => {
  eq(report4.copied.sort(), Object.keys(LEGACY).sort(), 'copied ids');
  eq(report4.skipped, [], 'skipped ids');
});
t('the live edit was deliberately overwritten', () =>
  eq(after4.clubTournaments['spring-2024'], before.legacy['spring-2024']));

console.log('\n--- a club whose slug reservation is missing is repaired, not called a success ---');
await env.withSecurityRulesDisabled(async (c) => {
  await deleteDoc(doc(c.firestore(), 'slugs', 'gvbl'));
});
const plan5 = await inspectMigration(superDb, { clubId: 'gvbl', slug: 'gvbl', uid: SUPER.uid });
t('dry run notices the club exists with no address reserved', () =>
  ok(plan5.clubExists && !plan5.slugExists && plan5.willRepairSlug));
t('a missing slug is not a blocker (the run repairs it)', () => eq(plan5.blockers, []));

const report5 = await runMigration(superDb, {
  clubId: 'gvbl',
  slug: 'gvbl',
  name: 'Greenville Volleyball League',
  user: SUPER,
});
const after5 = await readAll();
t('run 5 recreated slugs/gvbl', () => {
  ok(report5.repairedSlug, `report: ${JSON.stringify(report5)}`);
  eq(after5.slug, { clubId: 'gvbl' }, 'slug document');
});
t('run 5 reports ok', () => ok(report5.ok, `report: ${JSON.stringify(report5)}`));

console.log('\n--- a non-super-admin is stopped by the rules ---');
const outsiderDb = env
  .authenticatedContext('out', { email: 'outsider@example.com', email_verified: true })
  .firestore();
const OUT = { uid: 'out', email: 'outsider@example.com', displayName: 'Outsider' };

let outsiderError = null;
try {
  await runMigration(outsiderDb, { clubId: 'sneaky', slug: 'sneaky', name: 'Sneaky', user: OUT });
} catch (err) {
  outsiderError = err;
}
t('outsider migration is rejected', () => {
  ok(outsiderError, 'the migration did NOT throw for a non-super-admin');
  ok(
    String(outsiderError.code || outsiderError.message).includes('permission-denied'),
    `expected permission-denied, got ${outsiderError.code || outsiderError.message}`
  );
});
let sneaky;
await env.withSecurityRulesDisabled(async (c) => {
  sneaky = await getDoc(doc(c.firestore(), 'clubs', 'sneaky'));
});
t('outsider created no club', () => ok(!sneaky.exists()));
let outsiderRead = null;
try {
  await getDocs(collection(outsiderDb, 'tournaments'));
} catch (err) {
  outsiderRead = err;
}
t('outsider read of tournaments/ is denied', () => ok(outsiderRead, 'the read succeeded'));

console.log(`\n${pass} passed, ${fail} failed`);
await env.cleanup();
process.exit(fail ? 1 : 0);
