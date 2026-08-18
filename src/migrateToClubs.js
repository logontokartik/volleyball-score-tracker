// src/migrateToClubs.js
//
// One-off migration from the pre-multi-tenant layout to clubs.
//
//   tournaments/{id}            ->  clubs/{clubId}/tournaments/{id}      (same doc id)
//   settings/app                ->  clubs/{clubId}.activeTournamentId
//   settings/archiveSnapshot    ->  clubs/{clubId}/archive/snapshot
//
// It COPIES. Nothing is deleted or rewritten at the legacy paths — after this runs the
// old documents are still there, byte for byte, which is the whole rollback story.
//
// It runs in the browser, signed in as a super admin, on purpose: the alternative is a
// service-account key downloaded onto somebody's laptop, gitignored and then forgotten
// about. The `firestore.rules` legacy block (`match /tournaments/{id}` read-if-isSuper)
// exists exactly so this can read its own source data, and nothing else can.
//
// This module is plain functions over a Firestore instance so the emulator test in
// firestore-tests/migration.test.mjs exercises the same code the UI runs, rather than a
// second implementation that drifts.
import { collection, doc, getDoc, getDocs, serverTimestamp, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import {
  archiveSnapshotDoc,
  clubDoc,
  memberDoc,
  normalizeEmail,
  slugDoc,
  tournamentDoc,
  tournamentsCol,
} from './clubPaths';
import { GVBL_ARCHIVE_SHEET_ID } from './archiveRefreshUtils';

export const DEFAULT_CLUB_ID = 'gvbl';
export const DEFAULT_CLUB_SLUG = 'gvbl';
export const DEFAULT_CLUB_NAME = 'Greenville Volleyball League';

// Legacy sources get no clubPaths helpers on purpose: helpers are for paths the app
// keeps using, and these three are going away the moment this migration has run. Spelt
// out inline so a future `grep tournaments/` finds every last reader.
const legacyTournamentsCol = (database) => collection(database, 'tournaments');
const legacySettingsAppDoc = (database) => doc(database, 'settings', 'app');
const legacyArchiveDoc = (database) => doc(database, 'settings', 'archiveSnapshot');

// Firestore caps a batch at 500 writes. 400 leaves room for the odd extra operation
// without having to recount, and keeps each commit small enough that a failure loses
// little work — the copy is re-runnable, so a partial commit is recoverable anyway.
const BATCH_LIMIT = 400;

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function describeError(err) {
  if (!err) return 'Unknown error';
  if (err.code === 'permission-denied') return 'permission-denied (the rules rejected this write)';
  return err.code ? `${err.code}: ${err.message}` : String(err.message || err);
}

/**
 * Read-only survey of both sides of the migration: what is in the legacy paths, what
 * already exists at the destination, and therefore what a run would actually write.
 *
 * The UI shows this before offering the button that performs it — a migration whose
 * first click is also its only click is one nobody can check first.
 */
export async function inspectMigration(database, { clubId, slug, uid } = {}) {
  const targetClubId = (clubId || DEFAULT_CLUB_ID).trim();
  const targetSlug = (slug || DEFAULT_CLUB_SLUG).trim();

  const [legacySnap, settingsSnap, archiveSnap, clubSnap, slugSnap, destSnap, destArchiveSnap] =
    await Promise.all([
      getDocs(legacyTournamentsCol(database)),
      getDoc(legacySettingsAppDoc(database)),
      getDoc(legacyArchiveDoc(database)),
      getDoc(clubDoc(targetClubId, database)),
      getDoc(slugDoc(targetSlug, database)),
      getDocs(tournamentsCol(targetClubId, database)),
      getDoc(archiveSnapshotDoc(targetClubId, database)),
    ]);

  const legacyTournamentIds = legacySnap.docs.map((d) => d.id);
  const destinationIds = new Set(destSnap.docs.map((d) => d.id));
  const activeTournamentId = settingsSnap.exists() ? settingsSnap.data()?.activeTournamentId || null : null;

  // The member document is only readable by a super admin (or a member), which is the
  // same condition as being able to run this at all — a permission error here means the
  // signed-in account is not who it thinks it is, so it is reported, not swallowed.
  let memberExists = false;
  let memberError = '';
  if (uid) {
    try {
      const memberSnap = await getDoc(memberDoc(targetClubId, uid, database));
      memberExists = memberSnap.exists();
    } catch (err) {
      memberError = describeError(err);
    }
  }

  const clubExists = clubSnap.exists();
  const club = clubExists ? clubSnap.data() : null;
  const slugClubId = slugSnap.exists() ? slugSnap.data()?.clubId || null : null;

  const blockers = [];
  // The slug is a one-shot reservation: if it already points somewhere else, creating
  // the club would either fail on the rules or strand a club nobody can reach.
  if (slugSnap.exists() && slugClubId !== targetClubId) {
    blockers.push(`/c/${targetSlug} is already taken by club "${slugClubId}". Pick another address.`);
  }
  if (clubExists && club?.slug && club.slug !== targetSlug) {
    blockers.push(
      `Club "${targetClubId}" already exists at /c/${club.slug}, not /c/${targetSlug}. A club's address cannot be changed.`
    );
  }
  if (activeTournamentId && !legacyTournamentIds.includes(activeTournamentId)) {
    blockers.push(
      `settings/app points at tournament "${activeTournamentId}", which is not in the legacy collection. The pointer would land on nothing.`
    );
  }

  const toCopy = legacyTournamentIds.filter((id) => !destinationIds.has(id));
  const toOverwrite = legacyTournamentIds.filter((id) => destinationIds.has(id));

  return {
    clubId: targetClubId,
    slug: targetSlug,
    legacyTournamentIds,
    legacyTournamentCount: legacyTournamentIds.length,
    activeTournamentId,
    activeTournamentResolves: Boolean(activeTournamentId) && legacyTournamentIds.includes(activeTournamentId),
    archiveSnapshotExists: archiveSnap.exists(),
    archiveAlreadyCopied: destArchiveSnap.exists(),
    clubExists,
    club,
    slugExists: slugSnap.exists(),
    slugClubId,
    memberExists,
    memberError,
    destinationTournamentIds: Array.from(destinationIds),
    willCreateClub: !clubExists,
    willCopy: toCopy,
    willOverwrite: toOverwrite,
    archiveSheetId: GVBL_ARCHIVE_SHEET_ID,
    blockers,
  };
}

/**
 * Performs the migration described by `inspectMigration`.
 *
 * Idempotent by construction:
 *  - the club/slug/member batch is skipped entirely when the club already exists;
 *  - tournaments are written with `setDoc` at their ORIGINAL ids, so a second run
 *    rewrites the same documents with the same content rather than adding copies;
 *  - the archive snapshot is a single fixed document id, same story.
 *
 * Returns an honest report: every tournament id lands in either `copied` or `failed`.
 */
export async function runMigration(database, { clubId, slug, name, user } = {}) {
  const uid = user?.uid;
  if (!uid) throw new Error('runMigration needs the signed-in user.');

  const targetClubId = (clubId || DEFAULT_CLUB_ID).trim();
  const targetSlug = (slug || DEFAULT_CLUB_SLUG).trim();
  const clubName = (name || DEFAULT_CLUB_NAME).trim();

  // Re-survey rather than trust the plan the operator looked at: it may be minutes old,
  // and the club may have been created in the meantime (including by a first run of
  // this same tool in another tab).
  const plan = await inspectMigration(database, { clubId: targetClubId, slug: targetSlug, uid });

  const report = {
    clubId: targetClubId,
    slug: targetSlug,
    createdClub: false,
    skippedClubCreation: false,
    copied: [],
    failed: [],
    archive: 'absent',
    notes: [],
    ok: false,
  };

  if (plan.blockers.length) {
    report.failed = plan.legacyTournamentIds.map((id) => ({ id, error: 'not attempted — blocked' }));
    report.notes.push(...plan.blockers);
    return report;
  }

  if (plan.clubExists) {
    report.skippedClubCreation = true;
    report.notes.push(`Club "${targetClubId}" already existed — creation skipped, tournaments re-copied into it.`);

    // Only fill in fields the existing club is missing. Overwriting an
    // activeTournamentId a club admin has since changed would be a regression, not a
    // migration.
    const patch = {};
    if (!plan.club?.archiveSheetId) patch.archiveSheetId = GVBL_ARCHIVE_SHEET_ID;
    if (!plan.club?.activeTournamentId && plan.activeTournamentId) {
      patch.activeTournamentId = plan.activeTournamentId;
    }
    if (Object.keys(patch).length) {
      try {
        await updateDoc(clubDoc(targetClubId, database), patch);
        report.notes.push(`Filled in missing club fields: ${Object.keys(patch).join(', ')}.`);
      } catch (err) {
        report.notes.push(`Could not fill in ${Object.keys(patch).join(', ')}: ${describeError(err)}`);
      }
    }
  } else {
    // One batch, exactly the shape MyClubsPage uses. It has to be one batch: the rules
    // cross-check clubs/{id} against slugs/{slug} with getAfter(), and the founding
    // admin row against clubs/{id}.createdBy, so split writes are each denied on their
    // own.
    const clubData = {
      name: clubName,
      slug: targetSlug,
      createdBy: uid,
      createdAt: serverTimestamp(),
      archiveSheetId: GVBL_ARCHIVE_SHEET_ID,
    };
    if (plan.activeTournamentId) clubData.activeTournamentId = plan.activeTournamentId;

    const batch = writeBatch(database);
    batch.set(clubDoc(targetClubId, database), clubData);
    batch.set(slugDoc(targetSlug, database), { clubId: targetClubId });
    batch.set(memberDoc(targetClubId, uid, database), {
      uid,
      email: normalizeEmail(user.email),
      displayName: user.displayName || null,
      role: 'admin',
      joinedAt: serverTimestamp(),
    });
    try {
      await batch.commit();
      report.createdClub = true;
    } catch (err) {
      report.notes.push(`Could not create the club: ${describeError(err)}`);
      report.failed = plan.legacyTournamentIds.map((id) => ({
        id,
        error: 'not attempted — the club was not created',
      }));
      return report;
    }
  }

  // Read the legacy documents once more, here, because the survey only kept their ids.
  let legacyDocs;
  try {
    const snap = await getDocs(legacyTournamentsCol(database));
    legacyDocs = snap.docs.map((d) => ({ id: d.id, data: d.data() }));
  } catch (err) {
    report.notes.push(`Could not read the legacy tournaments: ${describeError(err)}`);
    return report;
  }

  for (const group of chunk(legacyDocs, BATCH_LIMIT)) {
    try {
      const batch = writeBatch(database);
      group.forEach(({ id, data }) => batch.set(tournamentDoc(targetClubId, id, database), data));
      await batch.commit();
      group.forEach(({ id }) => report.copied.push(id));
    } catch (batchErr) {
      // A batch is all-or-nothing, so one bad document fails 400 good ones and the
      // report would name the wrong culprits. Retry the group one document at a time to
      // find out which ones actually cannot be written.
      report.notes.push(
        `A batch of ${group.length} failed (${describeError(batchErr)}); retrying those documents individually.`
      );
      for (const { id, data } of group) {
        try {
          await setDoc(tournamentDoc(targetClubId, id, database), data);
          report.copied.push(id);
        } catch (err) {
          report.failed.push({ id, error: describeError(err) });
        }
      }
    }
  }

  if (plan.archiveSnapshotExists) {
    try {
      const snap = await getDoc(legacyArchiveDoc(database));
      await setDoc(archiveSnapshotDoc(targetClubId, database), snap.data());
      report.archive = 'copied';
    } catch (err) {
      report.archive = 'failed';
      report.notes.push(`Archive snapshot could not be copied: ${describeError(err)}`);
    }
  }

  report.ok = report.failed.length === 0 && report.archive !== 'failed';
  return report;
}

/** One line an operator can read without unpacking the report object. */
export function summarizeReport(report) {
  const parts = [];
  parts.push(report.createdClub ? `Created club "${report.clubId}"` : `Club "${report.clubId}" already existed`);
  parts.push(`${report.copied.length} tournament${report.copied.length === 1 ? '' : 's'} copied`);
  if (report.failed.length) parts.push(`${report.failed.length} FAILED`);
  if (report.archive === 'copied') parts.push('archive snapshot copied');
  if (report.archive === 'failed') parts.push('archive snapshot FAILED');
  if (report.archive === 'absent') parts.push('no archive snapshot to copy');
  return `${parts.join(' · ')}. Nothing was deleted.`;
}
