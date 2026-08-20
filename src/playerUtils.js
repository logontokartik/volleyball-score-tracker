// src/playerUtils.js
//
// The player database, and how a tournament's teams point into it.
//
// Two separate things live here and they are deliberately not merged:
//
//   * A **player** is a person in the club — `clubs/{clubId}/players/{id}`, one document
//     each. Players outlive tournaments, which is the whole reason they are not stored
//     inside the tournament: the same person turns up next season on a different team,
//     and a season's worth of profiles should not have to be retyped. Separate documents
//     also mean the profile can grow (jersey number, phone, availability) without every
//     scoreboard reader downloading it, and without the tournament document walking
//     toward Firestore's 1MB ceiling.
//
//   * A **roster** is which of them played for which team *in one tournament* — a small
//     list of ids on the tournament document, because that is the only place the answer
//     is even meaningful. "Which team is Priya on" has no answer without naming the
//     tournament.
//
// Rosters are an ARRAY of `{ team, playerIds }`, not a map keyed by team name. A map
// looks tidier and is a trap: `setDoc(..., { merge: true })` merges nested maps key by
// key, so removing a team would leave its key behind forever, and team names are free
// text that can contain the '.' that Firestore reads as a field-path separator. An array
// is replaced wholesale on every write, which is exactly the semantics wanted.

/**
 * Positions offered in the dropdown. A free-typed position would be six spellings of
 * "Outside Hitter" within a season, and the field is optional anyway — the point of it
 * is grouping a roster at a glance, which only works if the values are shared.
 *
 * Stored as the display string rather than a code: nothing branches on the value, so a
 * code would only add a lookup table to keep in step.
 */
export const POSITIONS = [
  'Setter',
  'Outside Hitter',
  'Opposite',
  'Middle Blocker',
  'Libero',
  'Defensive Specialist',
  'Serving Specialist',
];

const text = (value) => String(value ?? '').trim();
const teamKey = (name) => text(name).toLowerCase();

/** Same shape the sign-in and invite code uses, so one player is one row either way. */
export const normalizePlayerEmail = (email) => text(email).toLowerCase();

/**
 * What actually gets written, from what was typed. Trimming here rather than at each
 * call site is what stops ' Priya ' and 'Priya' becoming two people.
 */
export function normalizePlayerInput(input) {
  const name = text(input?.name);
  return {
    name,
    // Lowercased for the same reason as `nameLower` below: so a later "do we already
    // know this person" lookup has something stable to match on.
    nameLower: name.toLowerCase(),
    position: POSITIONS.includes(text(input?.position)) ? text(input.position) : '',
    email: normalizePlayerEmail(input?.email),
  };
}

// Deliberately loose, and the same expression the invite endpoint uses. This is a typo
// catcher, not an address validator — the field is optional, and rejecting a real but
// unusual address is worse here than accepting a wrong one.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * '' when the input is fine, otherwise the message to show. Name is the only required
 * field: a roster of names is useful on its own, and demanding an email for a fourteen
 * year old is how a roster ends up full of `a@b.com`.
 */
export function validatePlayerInput(input) {
  const p = normalizePlayerInput(input);
  if (!p.name) return 'A player needs a name.';
  if (p.name.length > 80) return 'That name is too long.';
  if (p.email && !EMAIL_RE.test(p.email)) return 'That email address does not look right.';
  return '';
}

/** The ids on one team, or [] — never undefined, so callers can map straight over it. */
export function rosterPlayerIds(rosters, team) {
  const key = teamKey(team);
  const entry = (rosters || []).find((r) => teamKey(r?.team) === key);
  return (entry?.playerIds || []).map(text).filter(Boolean);
}

/**
 * A new rosters array with one team's list replaced.
 *
 * An emptied team drops out entirely rather than being stored as `playerIds: []` — the
 * two mean the same thing to every reader, and keeping the empty row would leave a
 * growing tail of teams from formats the tournament no longer uses.
 */
export function withRosterForTeam(rosters, team, playerIds) {
  const name = text(team);
  if (!name) return rosters || [];
  const key = teamKey(name);
  const ids = [];
  const seen = new Set();
  // De-duplicated because the UI can offer the same person twice — added by hand and
  // then picked again off the "already in this club" list.
  (playerIds || []).map(text).forEach((id) => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    ids.push(id);
  });

  const rest = (rosters || []).filter((r) => teamKey(r?.team) !== key);
  if (!ids.length) return rest;
  return [...rest, { team: name, playerIds: ids }];
}

/**
 * Follow the teams editor's renames and drop teams that no longer exist.
 *
 * Without this a rename silently orphans a roster — the team on the tournament is now
 * 'Storm', the roster still says 'Black', and every player on it disappears from the
 * Teams tab with nothing to explain why. The editor already tracks each row's original
 * name for exactly this reason; this is the same idea applied to the one other place
 * that stores a team name.
 *
 * @param renames Map of lowercased ORIGINAL name -> current name.
 * @param teamNames the teams that survive the save; anything else is dropped.
 */
export function remapRosters(rosters, renames, teamNames) {
  const survives = new Set((teamNames || []).map(teamKey).filter(Boolean));
  const follow = (name) => renames?.get(teamKey(name)) ?? text(name);

  const out = [];
  (rosters || []).forEach((entry) => {
    const team = follow(entry?.team);
    if (!survives.has(teamKey(team))) return;
    const ids = (entry?.playerIds || []).map(text).filter(Boolean);
    if (!ids.length) return;
    // A rename can collide with a team that already exists ('Black' -> 'Yellow'), and
    // two entries for one team is a shape nothing downstream expects. Merge instead.
    const existing = out.find((r) => teamKey(r.team) === teamKey(team));
    if (existing) {
      ids.forEach((id) => {
        if (!existing.playerIds.includes(id)) existing.playerIds.push(id);
      });
      return;
    }
    out.push({ team, playerIds: [...new Set(ids)] });
  });
  return out;
}

/** Every player id used by any team, for "who is unassigned" and for counting. */
export function rosteredPlayerIds(rosters) {
  const ids = new Set();
  (rosters || []).forEach((r) => (r?.playerIds || []).forEach((id) => {
    if (text(id)) ids.add(text(id));
  }));
  return ids;
}

/** Club players in the order a human reads a roster: by name, case-insensitively. */
export function sortPlayers(players) {
  return [...(players || [])].sort((a, b) =>
    text(a?.name).localeCompare(text(b?.name), undefined, { sensitivity: 'base' })
  );
}

/**
 * Resolve one team's ids against the club's players.
 *
 * An id with no player document is skipped rather than rendered as a blank row: it means
 * the player was deleted from the club while still rostered, and a nameless entry on a
 * public page is worse than a shorter list.
 */
export function rosterForTeam(rosters, team, playersById) {
  return rosterPlayerIds(rosters, team)
    .map((id) => playersById?.get?.(id))
    .filter(Boolean);
}
