const cleanTeams = (teams) => (teams || []).map((t) => String(t).trim()).filter(Boolean);

/**
 * Round-robin pairings. meetingsPerPair = 2 means each unordered pair plays twice.
 */
export function buildRoundRobinSchedule(teams, meetingsPerPair) {
  const trimmed = cleanTeams(teams);
  const n = trimmed.length;
  const meetings = Math.max(1, Math.floor(Number(meetingsPerPair)) || 1);
  const matches = [];
  let gameNum = 0;
  for (let round = 0; round < meetings; round++) {
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        gameNum += 1;
        matches.push({
          game: `G${gameNum}`,
          team1: trimmed[i],
          team2: trimmed[j],
        });
      }
    }
  }
  return matches;
}

/**
 * Round robin minus circle neighbours.
 *
 * Teams are treated as seated in a circle in the order given, and every team plays
 * everyone EXCEPT the team on its left and the team on its right. With 6 teams that
 * yields 9 games (each team plays 3) instead of the full 15.
 *
 * Ordering is therefore meaningful: teams[0] never plays teams[1] or the last team.
 */
export function buildSkipAdjacentSchedule(teams, meetingsPerPair) {
  const trimmed = cleanTeams(teams);
  const n = trimmed.length;
  const meetings = Math.max(1, Math.floor(Number(meetingsPerPair)) || 1);
  const matches = [];
  let gameNum = 0;
  for (let round = 0; round < meetings; round++) {
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        // Neighbours in the circle: consecutive, plus the wrap-around first/last pair.
        const adjacent = j === i + 1 || (i === 0 && j === n - 1);
        if (adjacent) continue;
        gameNum += 1;
        matches.push({
          game: `G${gameNum}`,
          team1: trimmed[i],
          team2: trimmed[j],
        });
      }
    }
  }
  return matches;
}

export const SCHEDULE_FORMATS = {
  roundRobin: {
    id: 'roundRobin',
    label: 'Full round robin',
    description: 'Every team plays every other team.',
    build: buildRoundRobinSchedule,
    gameCount: (n) => (n * (n - 1)) / 2,
    minTeams: 2,
  },
  skipAdjacent: {
    id: 'skipAdjacent',
    label: 'Round robin, skipping neighbours',
    description:
      'Teams sit in a circle in the order listed; nobody plays the team directly before or after them.',
    build: buildSkipAdjacentSchedule,
    gameCount: (n) => (n * (n - 3)) / 2,
    minTeams: 4,
  },
};

export const DEFAULT_SCHEDULE_FORMAT = 'roundRobin';

export function buildScheduleForFormat(formatId, teams, meetingsPerPair) {
  const format = SCHEDULE_FORMATS[formatId] || SCHEDULE_FORMATS[DEFAULT_SCHEDULE_FORMAT];
  return format.build(teams, meetingsPerPair);
}

/** Games this format produces, for previewing before the tournament is created. */
export function previewGameCount(formatId, teamCount, meetingsPerPair) {
  const format = SCHEDULE_FORMATS[formatId] || SCHEDULE_FORMATS[DEFAULT_SCHEDULE_FORMAT];
  const meetings = Math.max(1, Math.floor(Number(meetingsPerPair)) || 1);
  if (teamCount < format.minTeams) return 0;
  return Math.max(0, format.gameCount(teamCount)) * meetings;
}

/* ------------------------------------------------------------------ */
/* Regenerating a match list without losing played results             */
/* ------------------------------------------------------------------ */

// NUL separator, not a space: with a space, ["Red Team", "Blue"] and
// ["Red", "Team Blue"] would collide into the same key. Written as an escape rather
// than a literal byte, which made git treat this whole file as binary.
const pairKey = (a, b) =>
  [String(a ?? '').trim().toLowerCase(), String(b ?? '').trim().toLowerCase()].sort().join('\u0000');

/**
 * Carry results from an existing match list onto a freshly generated one.
 *
 * Matches are paired up by team pairing (order-insensitive), so renaming or adding a
 * team keeps every result whose two teams still face each other. Set scores are
 * flipped when the regenerated match lists the teams the other way round, and padded
 * or trimmed if setsPerMatch changed. Results for pairings that no longer exist are
 * dropped — that is the point of regenerating.
 */
export function mergeScoresPreservingResults(newScores, oldScores) {
  const buckets = new Map();
  for (const match of oldScores || []) {
    const key = pairKey(match.team1, match.team2);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(match);
  }

  const taken = new Map();
  return (newScores || []).map((match) => {
    const key = pairKey(match.team1, match.team2);
    const index = taken.get(key) || 0;
    const prior = buckets.get(key)?.[index];
    taken.set(key, index + 1);
    if (!prior) return match;

    const flipped =
      String(prior.team1 ?? '').trim().toLowerCase() !==
      String(match.team1 ?? '').trim().toLowerCase();
    const priorSets = (prior.sets || []).map((set) =>
      flipped
        ? { team1: Number(set.team2) || 0, team2: Number(set.team1) || 0 }
        : { team1: Number(set.team1) || 0, team2: Number(set.team2) || 0 }
    );
    const setCount = match.sets?.length ?? priorSets.length;
    const sets = Array.from(
      { length: setCount },
      (_, i) => priorSets[i] || { team1: 0, team2: 0 }
    );

    // Keep flags like `completed` / lock state, but take identity from the new match.
    const { game, team1, team2, sets: _priorSets, ...carried } = prior;
    return { ...carried, ...match, sets };
  });
}

/** True when a match has at least one non-zero set — i.e. losing it would lose data. */
export function matchHasResults(match) {
  return (match?.sets || []).some(
    (set) => (Number(set.team1) || 0) !== 0 || (Number(set.team2) || 0) !== 0
  );
}

/**
 * Rewrite the game ids referenced by schedule rows after the match list is rebuilt.
 * Rows pointing at a pairing that no longer exists are blanked rather than removed,
 * so the time slots and umpire assignments survive.
 */
export function remapScheduleSlots(slots, oldScores, newScores, courtCount) {
  const oldById = new Map((oldScores || []).map((m) => [m.game, m]));
  const available = new Map();
  for (const match of newScores || []) {
    const key = pairKey(match.team1, match.team2);
    if (!available.has(key)) available.set(key, []);
    available.get(key).push(match.game);
  }

  const claimed = new Map();
  const translate = (gameId) => {
    if (!gameId) return null;
    const prior = oldById.get(gameId);
    if (!prior) return null;
    const key = pairKey(prior.team1, prior.team2);
    const index = claimed.get(key) || 0;
    const next = available.get(key)?.[index] ?? null;
    if (next) claimed.set(key, index + 1);
    return next;
  };

  return (slots || []).map((slot) =>
    withCourts(
      slot,
      slotCourts(slot, courtCount).map((court) => ({ ...court, game: translate(court.game) }))
    )
  );
}

export function matchesWithEmptySets(scheduledMatches, setsPerMatch) {
  const count = Math.max(1, Math.floor(Number(setsPerMatch)) || 1);
  return scheduledMatches.map((match) => ({
    ...match,
    sets: Array.from({ length: count }, () => ({ team1: 0, team2: 0 })),
  }));
}

/* ------------------------------------------------------------------ */
/* Schedule rows: courts                                               */
/* ------------------------------------------------------------------ */

export const DEFAULT_COURT_COUNT = 2;

// Eight is past any hall this is used in; the cap exists so a typo in the admin form
// cannot produce a hundred-column schedule that nothing can render.
export const MAX_COURT_COUNT = 8;

export function normalizeCourtCount(value) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 1) return DEFAULT_COURT_COUNT;
  return Math.min(MAX_COURT_COUNT, n);
}

const trimmed = (value) => String(value ?? '').trim();

/** Legacy per-court field names, only ever read through slotCourts below. */
const LEGACY_COURT_KEYS = ['gameCourt1', 'gameCourt2', 'umpireCourt1', 'umpireCourt2', 'noteCourt1', 'noteCourt2', 'umpire'];

/**
 * Courts on one schedule row, as `[{ game, umpire, note }, …]`.
 *
 * Rows saved before the schedule supported more than two courts carry fixed
 * `gameCourt1`/`gameCourt2` fields (and their umpire/note siblings) instead of a
 * `courts` array; those are read here as courts 1 and 2, in order. Clubs are mid-season
 * on that shape, so this is the path most saved schedules still take — every consumer
 * goes through this function so none of them has to know two shapes exist.
 *
 * The even older pre-split single `umpire` field is honoured for the same reason the
 * old `slotUmpires` honoured it: it meant one team umpiring the whole row. That reader
 * is gone — this is now the only place either legacy shape is understood.
 */
export function slotCourts(slot, courtCount) {
  const legacyUmpire = trimmed(slot?.umpire);
  const count =
    courtCount == null
      ? (Array.isArray(slot?.courts) ? Math.max(1, slot.courts.length) : DEFAULT_COURT_COUNT)
      : normalizeCourtCount(courtCount);
  const courts = [];
  for (let i = 0; i < count; i++) {
    const source = Array.isArray(slot?.courts)
      ? slot.courts[i] || {}
      : {
          game: slot?.[`gameCourt${i + 1}`],
          umpire: slot?.[`umpireCourt${i + 1}`],
          note: slot?.[`noteCourt${i + 1}`],
        };
    courts.push({
      game: trimmed(source.game) || null,
      umpire: trimmed(source.umpire) || legacyUmpire,
      note: trimmed(source.note),
    });
  }
  return courts;
}

/** A row in the current shape: legacy court fields dropped, `courts` replaced. */
function withCourts(slot, courts) {
  const next = { ...slot, courts };
  for (const key of LEGACY_COURT_KEYS) delete next[key];
  return next;
}

/**
 * How many courts a saved schedule uses.
 *
 * An explicit `courtCount` on the tournament wins, so adding a court shows up on rows
 * that were saved before it existed. Otherwise it is read off the rows themselves,
 * and rows with no `courts` array are legacy rows, which always had exactly two.
 */
export function scheduleCourtCount(scheduleSlots, courtCount) {
  const explicit = Math.floor(Number(courtCount));
  if (Number.isFinite(explicit) && explicit >= 1) return normalizeCourtCount(explicit);
  let widest = 0;
  for (const slot of scheduleSlots || []) {
    if (Array.isArray(slot?.courts)) widest = Math.max(widest, slot.courts.length);
  }
  return widest > 0 ? normalizeCourtCount(widest) : DEFAULT_COURT_COUNT;
}

/** Rewrite rows into the current shape — what gets written back to Firestore. */
export function normalizeScheduleSlots(slots, courtCount) {
  const count = normalizeCourtCount(courtCount);
  return (slots || []).map((slot) => withCourts(slot, slotCourts(slot, count)));
}

/** One row on the day schedule (a game per court, or a break / note row). */
export function buildDefaultScheduleSlots(scores, courtCount) {
  const count = normalizeCourtCount(courtCount);
  const list = scores || [];
  const slots = [];
  for (let i = 0; i < list.length; i += count) {
    slots.push(
      blankSlot(
        {
          timeLabel: `Round ${slots.length + 1}`,
          courts: Array.from({ length: count }, (_, c) => ({
            game: list[i + c]?.game ?? null,
            umpire: '',
            note: '',
          })),
        },
        count
      )
    );
  }
  return slots;
}

/**
 * A fresh row. Overrides may still name the legacy court fields — the AI builder and
 * older callers do — so they are read through the adapter rather than copied across.
 */
export function blankSlot(overrides, courtCount) {
  const merged = {
    id: crypto.randomUUID(),
    timeLabel: '',
    rowKind: 'double',
    ...overrides,
  };
  const count = Array.isArray(overrides?.courts) ? overrides.courts.length : courtCount;
  return withCourts(merged, slotCourts(merged, count));
}

/** A court with nothing on it, for the editor's "add court" control. */
export function blankCourt() {
  return { game: null, umpire: '', note: '' };
}

/**
 * Playoff rows for a top-4 knockout: two semifinals seeded 1v4 / 2v3, then the final.
 * Times match the club's usual day plan and are editable once added.
 */
export function buildFinalsSlots(courtCount) {
  const count = normalizeCourtCount(courtCount);
  const noteRow = (timeLabel, text) => {
    const slot = blankSlot({ rowKind: 'note', timeLabel }, count);
    slot.courts[0].note = text;
    return slot;
  };
  return [
    blankSlot({ rowKind: 'break', timeLabel: 'Break (1:00 – 2:00 pm)' }, count),
    noteRow('2:00 – 3:15 pm', 'Semifinal 1 (Seed 1 vs Seed 4)'),
    noteRow('3:15 – 4:30 pm', 'Semifinal 2 (Seed 2 vs Seed 3)'),
    blankSlot({ rowKind: 'break', timeLabel: 'Break (4:30 – 5:00 pm)' }, count),
    noteRow('5:00 – 6:30 pm', 'Final (Semis Winners)'),
  ];
}

/** Match list order follows first appearance in schedule (then any unscheduled games). */
export function orderScoresBySchedule(scores, scheduleSlots) {
  if (!scheduleSlots?.length || !scores?.length) return scores || [];
  const order = [];
  scheduleSlots.forEach((s) => {
    slotCourts(s).forEach((court) => {
      if (court.game) order.push(court.game);
    });
  });
  const seen = new Set(order);
  const byGame = Object.fromEntries(scores.map((m) => [m.game, m]));
  const primary = order.map((g) => byGame[g]).filter(Boolean);
  const rest = scores.filter((m) => !seen.has(m.game));
  return [...primary, ...rest];
}

export function formatMatchLabel(match) {
  if (!match) return '—';
  return `${match.team1} vs ${match.team2}`;
}

/** Where a match sits on the day schedule, or null when it isn't slotted anywhere. */
export function matchSlotInfo(match, scheduleSlots) {
  if (!match) return null;
  for (const slot of scheduleSlots || []) {
    const kind = slot.rowKind || 'double';
    if (kind !== 'double') continue;
    const when = (slot.timeLabel && String(slot.timeLabel).trim()) || 'Scheduled';
    const courts = slotCourts(slot);
    for (let i = 0; i < courts.length; i++) {
      if (courts[i].game === match.game) return { when, court: i + 1 };
    }
  }
  return null;
}

/** Title for score entry: time + court from schedule, no G1/G2 prefix. */
export function formatMatchHeadingForScores(match, scheduleSlots) {
  if (!match) return '';
  const versus = `${match.team1} vs ${match.team2}`;
  const info = matchSlotInfo(match, scheduleSlots);
  return info ? `${info.when} · Court ${info.court} · ${versus}` : versus;
}

/**
 * Sets won by each side so far, ignoring sets that haven't been played (0–0).
 * Used for the at-a-glance game tiles, so it deliberately says nothing about who
 * won the match — that is `calculateLeaderboard`'s job and it needs `completed`.
 */
export function matchSetSummary(match) {
  let team1 = 0;
  let team2 = 0;
  let setsPlayed = 0;
  for (const set of match?.sets || []) {
    const a = Number(set.team1) || 0;
    const b = Number(set.team2) || 0;
    if (a === 0 && b === 0) continue;
    setsPlayed += 1;
    if (a > b) team1 += 1;
    else if (b > a) team2 += 1;
  }
  return { team1, team2, setsPlayed };
}

/**
 * Scoring rules per match phase and set index.
 * Pool play: sets 1-2 → play to 21, win by 2, cap 25. Set 3 → play to 15, win by 2, cap 18.
 * Finals:    sets 1-2 → play to 25, win by 2, cap 28. Set 3 → play to 15 (no cap beyond 15).
 */
export function getSetCap(phase, setIndex) {
  if (phase === 'finals') {
    return setIndex < 2 ? 28 : 15;
  }
  // pool (default)
  return setIndex < 2 ? 25 : 18;
}

export function getSetTarget(phase, setIndex) {
  if (phase === 'finals') {
    return setIndex < 2 ? 25 : 15;
  }
  return setIndex < 2 ? 21 : 15;
}

/** Sets needed to win a match (e.g. 3-set cap → 2, 5-set → 3). */
export function setsNeededToWin(setsPerMatch) {
  const n = Math.max(1, Math.floor(Number(setsPerMatch)) || 1);
  return Math.floor(n / 2) + 1;
}

/**
 * Analyze one match for tournament points (GVBL rules).
 *
 * Winner points:
 *   3 (match win) + 3 bonus if sweep (2-0)  = 6 max
 *   3 (match win) + 2 bonus if won in 3 sets = 5 min for winner
 *
 * Loser points:
 *   1 point if loser won at least 1 set
 *   0 points if swept
 *
 * Tiebreakers (seeding):
 *   1) Total tournament points
 *   2) Point differential in sets of matches the team WON
 *   3) Head-to-head
 *
 * Only meaningful when match.completed — caller filters.
 */
function analyzeMatchForPoints(match, needToWin) {
  let s1 = 0;
  let s2 = 0;
  let anyPlayed = false;
  for (const set of match.sets || []) {
    const a = Number(set.team1) || 0;
    const b = Number(set.team2) || 0;
    if (a === 0 && b === 0) continue;
    anyPlayed = true;
    if (a > b) s1 += 1;
    else if (b > a) s2 += 1;
  }
  if (!anyPlayed) return null;

  let winner = null;
  if (s1 >= needToWin && s1 > s2) winner = match.team1;
  else if (s2 >= needToWin && s2 > s1) winner = match.team2;

  // Winner: 3 (win) + 3 (sweep bonus) or + 2 (3-set win bonus)
  // Loser:  1 if they won ≥1 set, else 0
  let pts1 = 0;
  let pts2 = 0;
  if (winner === match.team1) {
    pts1 = 3 + (s2 === 0 ? 3 : 2); // sweep → 6, 3-set win → 5
    pts2 = s2 > 0 ? 1 : 0;          // consolation point if loser won a set
  } else if (winner === match.team2) {
    pts2 = 3 + (s1 === 0 ? 3 : 2);
    pts1 = s1 > 0 ? 1 : 0;
  }

  let winPdTeam1 = 0;
  let winPdTeam2 = 0;
  for (const set of match.sets || []) {
    const a = Number(set.team1) || 0;
    const b = Number(set.team2) || 0;
    if (a === 0 && b === 0) continue;
    if (winner === match.team1) winPdTeam1 += a - b;
    else if (winner === match.team2) winPdTeam2 += b - a;
  }

  return {
    winner,
    s1,
    s2,
    pts1,
    pts2,
    winPdTeam1,
    winPdTeam2,
  };
}

/**
 * Standings: tournament points from completed games, tiebreakers per sheet —
 * 1) total points, 2) point diff in sets of matches won, 3) head-to-head (series wins if multiple).
 */
export function calculateLeaderboard(scores, teams, setsPerMatch = 3) {
  const need = setsNeededToWin(setsPerMatch);
  const teamList = teams || [];
  const stats = {};
  teamList.forEach((t) => {
    stats[t] = {
      tournamentPoints: 0,
      winMatchPointDiff: 0,
      setsWon: 0,
      overallPointDiff: 0,
      matchesWon: 0,
    };
  });

  const completed = (scores || []).filter((m) => m.completed === true);

  completed.forEach((match) => {
    const a = analyzeMatchForPoints(match, need);
    if (!a) return;
    if (!stats[match.team1]) stats[match.team1] = { tournamentPoints: 0, winMatchPointDiff: 0, setsWon: 0, overallPointDiff: 0, matchesWon: 0 };
    if (!stats[match.team2]) stats[match.team2] = { tournamentPoints: 0, winMatchPointDiff: 0, setsWon: 0, overallPointDiff: 0, matchesWon: 0 };

    stats[match.team1].tournamentPoints += a.pts1;
    stats[match.team2].tournamentPoints += a.pts2;
    stats[match.team1].winMatchPointDiff += a.winPdTeam1;
    stats[match.team2].winMatchPointDiff += a.winPdTeam2;
    stats[match.team1].setsWon += a.s1;
    stats[match.team2].setsWon += a.s2;
    if (a.winner === match.team1) stats[match.team1].matchesWon += 1;
    if (a.winner === match.team2) stats[match.team2].matchesWon += 1;

    (match.sets || []).forEach((set) => {
      const x = Number(set.team1) || 0;
      const y = Number(set.team2) || 0;
      if (x === 0 && y === 0) return;
      stats[match.team1].overallPointDiff += x - y;
      stats[match.team2].overallPointDiff += y - x;
    });
  });

  const h2hSeries = {};
  completed.forEach((match) => {
    const a = analyzeMatchForPoints(match, need);
    if (!a || !a.winner) return;
    const loser = a.winner === match.team1 ? match.team2 : match.team1;
    const key = JSON.stringify(a.winner < loser ? [a.winner, loser] : [loser, a.winner]);
    if (!h2hSeries[key]) h2hSeries[key] = {};
    h2hSeries[key][a.winner] = (h2hSeries[key][a.winner] || 0) + 1;
  });

  function headToHeadCompare(teamA, teamB) {
    const key = JSON.stringify(teamA < teamB ? [teamA, teamB] : [teamB, teamA]);
    const rec = h2hSeries[key];
    if (!rec) return 0;
    return (rec[teamB] || 0) - (rec[teamA] || 0);
  }

  const entries = Object.entries(stats).sort((a, b) => {
    const [, da] = a;
    const [, db] = b;
    if (db.tournamentPoints !== da.tournamentPoints) {
      return db.tournamentPoints - da.tournamentPoints;
    }
    if (db.winMatchPointDiff !== da.winMatchPointDiff) {
      return db.winMatchPointDiff - da.winMatchPointDiff;
    }
    const h2h = headToHeadCompare(a[0], b[0]);
    if (h2h !== 0) return h2h;
    return a[0].localeCompare(b[0]);
  });

  return entries;
}
