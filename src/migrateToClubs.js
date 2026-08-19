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
    // A club that exists without its slug reservation is unreachable: /c/{slug} 404s
    // because nothing resolves the address. A run repairs that rather than reporting
    // success over a club nobody can open.
    willRepairSlug: clubExists && !slugSnap.exists(),
    willCopy: toCopy,
    willOverwrite: toOverwrite,
    archiveSheetId: GVBL_ARCHIVE_SHEET_ID,
    blockers,
  };
}

/**
 * Performs the migration described by `inspectMigration`.
 *
 * Re-runnable, and non-destructive on a second run by default:
 *  - the club/slug/member batch is skipped entirely when the club already exists (a
 *    missing slug reservation is repaired on its own);
 *  - tournaments are written with `setDoc` at their ORIGINAL ids, and a document that
 *    already exists under the club is SKIPPED. This is the whole point: once a club is
 *    live its tournaments carry scores entered AFTER the first run, and re-copying the
 *    legacy snapshot over them would silently delete those games. A first run that
 *    copied 8 of 10 must be re-runnable to finish the last 2 without eating the 8.
 *  - the archive snapshot is one fixed document id, and the same reasoning applies: the
 *    Archive page's Refresh button rewrites it from the live spreadsheet, so a copy that
 *    is already there is newer than the legacy one, not older.
 *
 * Pass `overwriteExisting: true` for the deliberate "put the legacy data back over what
 * is there" case. It is opt-in because it discards everything written since the last run.
 *
 * Returns an honest report: every tournament id lands in exactly one of `copied`,
 * `skipped` or `failed`.
 */
export async function runMigration(database, { clubId, slug, name, user, overwriteExisting = false } = {}) {
  const uid = user?.uid;
  if (!uid) throw new Error('runMigration needs the signed-in user.');

  const targetClubId = (clubId || DEFAULT_CLUB_ID).trim();
  const targetSlug = (slug || DEFAULT_CLUB_SLUG).trim();
  const clubName = (name || DEFAULT_CLUB_NAME).trim();

  // Re-survey rather than trust the plan the operator looked at: it may be minutes old,
  // and the club may have been created in the meantime (including by a first run of
  // this same tool in another tab).
  const plan = await inspectMigration(database, { clubId: targetClubId, slug: targetSlug, uid });

  const overwrite = Boolean(overwriteExisting);

  const report = {
    clubId: targetClubId,
    slug: targetSlug,
    overwriteExisting: overwrite,
    createdClub: false,
    skippedClubCreation: false,
    repairedSlug: false,
    copied: [],
    skipped: [],
    failed: [],
    archive: 'absent',
    notes: [],
    ok: false,
  };

  // Anything that went wrong outside the per-document `failed` list — a club field
  // patch, the slug repair, the archive. `report.ok` has to see these too, or the UI
  // prints "Migration finished" in green over a club whose address 404s.
  let sideOperationFailed = false;

  if (plan.blockers.length) {
    report.failed = plan.legacyTournamentIds.map((id) => ({ id, error: 'not attempted — blocked' }));
    report.notes.push(...plan.blockers);
    return report;
  }

  if (plan.clubExists) {
    report.skippedClubCreation = true;
    report.notes.push(
      `Club "${targetClubId}" already existed — creation skipped, ${
        overwrite
          ? 'and OVERWRITE was on, so tournaments already under it were re-copied over.'
          : 'and tournaments already under it were left alone.'
      }`
    );

    // A club without its slugs/{slug} row is unreachable. Repair it here rather than
    // finishing "successfully" over a /c/{slug} that 404s. The rules let the club's own
    // creator claim its slug, which for a club this tool created is the operator running
    // it; anything else is reported, not swallowed.
    if (!plan.slugExists) {
      try {
        await setDoc(slugDoc(targetSlug, database), { clubId: targetClubId });
        report.repairedSlug = true;
        report.notes.push(`Club "${targetClubId}" had no address reserved — created slugs/${targetSlug}.`);
      } catch (err) {
        sideOperationFailed = true;
        report.notes.push(
          `Club "${targetClubId}" has no slugs/${targetSlug}, so /c/${targetSlug} will not resolve, and it could not be created: ${describeError(
            err
          )}`
        );
      }
    }

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
        sideOperationFailed = true;
        report.notes.push(`Could not fill in ${Object.keys(patch).join(', ')}: ${describeError(err)}`);
      }
    }
  } else {
    // One batch, exactly the shape ClubsPage uses. It has to be one batch: the rules
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

  // The survey above is this run's own, seconds old, so it is what decides which
  // destination documents already exist.
  const alreadyThere = new Set(plan.destinationTournamentIds);
  const toWrite = [];
  for (const entry of legacyDocs) {
    if (!overwrite && alreadyThere.has(entry.id)) {
      report.skipped.push(entry.id);
      continue;
    }
    toWrite.push(entry);
  }
  if (report.skipped.length) {
    report.notes.push(
      `${report.skipped.length} tournament${report.skipped.length === 1 ? ' was' : 's were'} already under the club and ${
        report.skipped.length === 1 ? 'was' : 'were'
      } left untouched. Tick "overwrite" only if you mean to discard whatever has been scored in them since.`
    );
  }

  for (const group of chunk(toWrite, BATCH_LIMIT)) {
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
    if (plan.archiveAlreadyCopied && !overwrite) {
      // The Archive page's Refresh button rewrites this document from the live
      // spreadsheet, so the copy already under the club is newer than the legacy one.
      report.archive = 'skipped';
    } else {
      try {
        const snap = await getDoc(legacyArchiveDoc(database));
        await setDoc(archiveSnapshotDoc(targetClubId, database), snap.data());
        report.archive = 'copied';
      } catch (err) {
        report.archive = 'failed';
        report.notes.push(`Archive snapshot could not be copied: ${describeError(err)}`);
      }
    }
  }

  report.ok = report.failed.length === 0 && report.archive !== 'failed' && !sideOperationFailed;
  return report;
}

/** One line an operator can read without unpacking the report object. */
export function summarizeReport(report) {
  const parts = [];
  parts.push(report.createdClub ? `Created club "${report.clubId}"` : `Club "${report.clubId}" already existed`);
  parts.push(`${report.copied.length} tournament${report.copied.length === 1 ? '' : 's'} copied`);
  if (report.skipped.length) parts.push(`${report.skipped.length} already there, left alone`);
  if (report.failed.length) parts.push(`${report.failed.length} FAILED`);
  if (report.repairedSlug) parts.push(`address /c/${report.slug} repaired`);
  if (report.archive === 'copied') parts.push('archive snapshot copied');
  if (report.archive === 'skipped') parts.push('archive snapshot already there, left alone');
  if (report.archive === 'failed') parts.push('archive snapshot FAILED');
  if (report.archive === 'absent') parts.push('no archive snapshot to copy');
  return `${parts.join(' · ')}. Nothing was deleted.`;
}
