// src/clubPaths.js
//
// Every Firestore path in the app is built here. Components used to spell out
// collection names inline, which is how a rename ends up half-done; with clubs in the
// path there is also a club id to thread through, and one typo silently reads an empty
// collection instead of failing.
import { collection, doc } from 'firebase/firestore';
import { db } from './firebase';

// Invite documents are keyed BY the email address, so the same normalisation has to run
// on both the write and the lookup or an invite simply never matches.
export function normalizeEmail(email) {
  return (email || '').trim().toLowerCase();
}

export const clubDoc = (clubId) => doc(db, 'clubs', clubId);

export const tournamentsCol = (clubId) => collection(db, 'clubs', clubId, 'tournaments');
export const tournamentDoc = (clubId, tournamentId) =>
  doc(db, 'clubs', clubId, 'tournaments', tournamentId);

export const membersCol = (clubId) => collection(db, 'clubs', clubId, 'members');
export const memberDoc = (clubId, uid) => doc(db, 'clubs', clubId, 'members', uid);

export const invitesCol = (clubId) => collection(db, 'clubs', clubId, 'invites');
export const inviteDoc = (clubId, email) =>
  doc(db, 'clubs', clubId, 'invites', normalizeEmail(email));

// One snapshot document per club, so the archive can be replaced atomically.
export const archiveSnapshotDoc = (clubId) => doc(db, 'clubs', clubId, 'archive', 'snapshot');

export const slugDoc = (slug) => doc(db, 'slugs', slug);
export const userDoc = (uid) => doc(db, 'users', uid);
