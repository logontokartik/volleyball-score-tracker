// src/clubPaths.js
//
// Every Firestore path in the app is built here. Components used to spell out
// collection names inline, which is how a rename ends up half-done; with clubs in the
// path there is also a club id to thread through, and one typo silently reads an empty
// collection instead of failing.
//
// Each helper takes an optional trailing Firestore instance, defaulting to the app's
// singleton. The app never passes it; the migration does, because it also has to run
// under the rules-unit-testing harness against an emulator instance that is not `db`.
import { collection, doc } from 'firebase/firestore';
import { db } from './firebase';

// Invite documents are keyed BY the email address, so the same normalisation has to run
// on both the write and the lookup or an invite simply never matches.
export function normalizeEmail(email) {
  return (email || '').trim().toLowerCase();
}

export const clubDoc = (clubId, database = db) => doc(database, 'clubs', clubId);
export const clubsCol = (database = db) => collection(database, 'clubs');

export const tournamentsCol = (clubId, database = db) =>
  collection(database, 'clubs', clubId, 'tournaments');
export const tournamentDoc = (clubId, tournamentId, database = db) =>
  doc(database, 'clubs', clubId, 'tournaments', tournamentId);

export const membersCol = (clubId, database = db) =>
  collection(database, 'clubs', clubId, 'members');
export const memberDoc = (clubId, uid, database = db) =>
  doc(database, 'clubs', clubId, 'members', uid);

export const invitesCol = (clubId, database = db) =>
  collection(database, 'clubs', clubId, 'invites');
export const inviteDoc = (clubId, email, database = db) =>
  doc(database, 'clubs', clubId, 'invites', normalizeEmail(email));

// Scoring-access requests, keyed by uid rather than email: the requester is already
// signed in when they ask, and keying by uid means asking twice updates one row instead
// of piling up duplicates in the admin's list.
export const requestsCol = (clubId, database = db) =>
  collection(database, 'clubs', clubId, 'requests');
export const requestDoc = (clubId, uid, database = db) =>
  doc(database, 'clubs', clubId, 'requests', uid);

// One snapshot document per club, so the archive can be replaced atomically.
export const archiveSnapshotDoc = (clubId, database = db) =>
  doc(database, 'clubs', clubId, 'archive', 'snapshot');

export const slugDoc = (slug, database = db) => doc(database, 'slugs', slug);
export const userDoc = (uid, database = db) => doc(database, 'users', uid);
