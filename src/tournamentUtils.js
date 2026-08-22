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

/* ------------------------------------------------------------------ */
/* Pools                                                               */
/* ------------------------------------------------------------------ */

export const MIN_POOL_COUNT = 2;
export const MAX_POOL_COUNT = 8;

/**
 * A pool-count text field -> a usable number.
 *
 * Lives here rather than in either admin screen because both edit pool counts, and a
 * per-screen copy is how one of them ends up clamping differently from the other.
 * Unparseable or out-of-range falls back to the nearest allowed value, so callers always
 * have a real number to render pool selects from.
 */
export function clampPoolCount(value) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return MIN_POOL_COUNT;
  return Math.min(MAX_POOL_COUNT, Math.max(MIN_POOL_COUNT, n));
}

// A pool of one plays nobody, so it is never a legal pool — not a warning, a block.
export const MIN_POOL_TEAMS = 2;

/** Pool names are positional: pool 1 is "A". Past Z (impossible here) fall back to P27. */
export function poolLetter(index) {
  return index < 26 ? String.fromCharCode(65 + index) : `P${index + 1}`;
}

/**
 * Pools as `[{ name, teams }]`, cleaned against the tournament's team list.
 *
 * Teams that were renamed or removed drop out of their pool here, so a regenerate after
 * a team edit produces no fixture for a team that no longer exists. A team listed in two
 * pools is kept only in the first — the schedule has to be unambiguous even if the stored
 * document is not. With no pools stored at all, everything is one pool: that makes the
 * format degrade to a plain round robin rather than to an empty schedule.
 */
export function normalizePools(pools, teams) {
  const known = new Set(cleanTeams(teams));
  const list = Array.isArray(pools) ? pools : [];
  if (!list.length) return [{ name: poolLetter(0), teams: cleanTeams(teams) }];
  const claimed = new Set();
  return list.map((pool, i) => ({
    name: String(pool?.name ?? '').trim() || poolLetter(i),
    teams: cleanTeams(pool?.teams).filter((t) => {
      if (!known.has(t) || claimed.has(t)) return false;
      claimed.add(t);
      return true;
    }),
  }));
}

/**
 * Round robin inside each pool and nothing across pools.
 *
 * Every match records the pool it belongs to, so standings can be grouped without
 * re-deriving who was in which pool from the tournament document.
 */
export function buildPoolsSchedule(teams, meetingsPerPair, options) {
  const pools = normalizePools(options?.pools, teams);
  const meetings = Math.max(1, Math.floor(Number(meetingsPerPair)) || 1);
  const matches = [];
  let gameNum = 0;
  for (let round = 0; round < meetings; round++) {
    for (const pool of pools) {
      for (let i = 0; i < pool.teams.length; i++) {
        for (let j = i + 1; j < pool.teams.length; j++) {
          gameNum += 1;
          matches.push({
            game: `G${gameNum}`,
            team1: pool.teams[i],
            team2: pool.teams[j],
            pool: pool.name,
          });
        }
      }
    }
  }
  return matches;
}

/**
 * The stored pools shape, built from the admin form's team rows (`{ name, pool }`, where
 * `pool` is a pool index or null). Both the create form and the teams editor enter teams
 * as an ordered row list, so both produce pools the same way.
 */
export function poolsFromRows(rows, poolCount) {
  return Array.from({ length: poolCount }, (_, i) => ({
    name: poolLetter(i),
    teams: (rows || [])
      .filter((r) => r.pool === i && String(r.name || '').trim())
      .map((r) => String(r.name).trim()),
  }));
}

/** Pool index for each team name, from a stored pools list. Unassigned teams get null. */
export function poolIndexByTeam(pools) {
  const map = new Map();
  (Array.isArray(pools) ? pools : []).forEach((pool, i) => {
    cleanTeams(pool?.teams).forEach((t) => {
      if (!map.has(t)) map.set(t, i);
    });
  });
  return map;
}

/**
 * Problems that would make a pools tournament unplayable, as a list of sentences.
 * Named pools rather than indexes, because "Pool D has 1 team" is actionable and
 * "some pool is too small" is not.
 */
export function validatePoolAssignment(pools, teams) {
  const problems = [];
  const list = Array.isArray(pools) ? pools : [];
  const assigned = new Set();
  list.forEach((pool, i) => {
    const name = String(pool?.name ?? '').trim() || poolLetter(i);
    const members = cleanTeams(pool?.teams);
    members.forEach((t) => assigned.add(t));
    if (members.length < MIN_POOL_TEAMS) {
      problems.push(
        `Pool ${name} has ${members.length} team${members.length === 1 ? '' : 's'} — each pool needs at least ${MIN_POOL_TEAMS}.`
      );
    }
  });
  const missing = cleanTeams(teams).filter((t) => !assigned.has(t));
  if (missing.length) {
    problems.push(
      `${missing.length} team${missing.length === 1 ? ' is' : 's are'} not in a pool: ${missing.join(', ')}.`
    );
  }
  return problems;
}

/**
 * Pool index per team, filling pools in the order the teams are listed.
 *
 * Sizes are balanced (25 teams over 6 pools → 5,4,4,4,4,4) and each pool takes a
 * contiguous run, so the listed order still reads as "these teams are together".
 * A shortcut only: the assignment it writes is then editable team by team.
 */
export function evenSplitPoolIndexes(teamCount, poolCount) {
  const pools = Math.max(1, Math.floor(Number(poolCount)) || 1);
  const base = Math.floor(teamCount / pools);
  const remainder = teamCount % pools;
  const indexes = [];
  for (let p = 0; p < pools; p++) {
    const size = base + (p < remainder ? 1 : 0);
    for (let k = 0; k < size; k++) indexes.push(p);
  }
  return indexes;
}

/**
 * Team counts per pool, matching exactly what `buildPoolsSchedule` would produce for the
 * same input — including its "no pools stored means one pool of everyone" fallback, so
 * the preview can never disagree with the schedule that gets generated.
 */
function poolSizes(teamCount, options) {
  if (!Array.isArray(options?.pools) || !options.pools.length) return [teamCount];
  const teams = options.teams ?? options.pools.flatMap((p) => p?.teams || []);
  return normalizePools(options.pools, teams).map((p) => p.teams.length);
}

/* ------------------------------------------------------------------ */
/* Custom fixtures                                                     */
/* ------------------------------------------------------------------ */

/**
 * The fixtures handed in through `options.fixtures`, rather than derived from a rule.
 *
 * This is what makes an AI-built draw storable: every other format answers "who plays
 * who" from the team list, so a tournament whose fixtures came from a description had
 * nowhere to live. Anything that regenerates a match list from the stored format — the
 * teams editor does, on every save — reaches this and gets the fixtures back instead of
 * quietly rebuilding them into a round robin.
 *
 * Fixtures naming a team that is no longer in the list drop out, the same way
 * `normalizePools` drops a renamed team from its pool: a fixture for a team that does not
 * exist cannot be played. Ids are reassigned so they stay G1..Gn and dense.
 * `meetingsPerPair` is ignored — the fixture list already says how often a pair meets.
 */
export function buildCustomSchedule(teams, meetingsPerPair, options) {
  const known = new Map(cleanTeams(teams).map((t) => [t.toLowerCase(), t]));
  const fixtures = Array.isArray(options?.fixtures) ? options.fixtures : [];
  const matches = [];
  for (const fixture of fixtures) {
    const team1 = known.get(String(fixture?.team1 ?? '').trim().toLowerCase());
    const team2 = known.get(String(fixture?.team2 ?? '').trim().toLowerCase());
    if (!team1 || !team2 || team1 === team2) continue;
    const pool = String(fixture?.pool ?? '').trim();
    matches.push({
      game: `G${matches.length + 1}`,
      team1,
      team2,
      ...(pool ? { pool } : {}),
    });
  }
  return matches;
}

/** The fixture shape (`{ team1, team2, pool }`) of an existing match list. */
export function fixturesFromScores(scores) {
  return (scores || []).map((m) => ({
    team1: m.team1,
    team2: m.team2,
    ...(m.pool ? { pool: m.pool } : {}),
  }));
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
  pools: {
    id: 'pools',
    label: 'Pools (round robin within each pool)',
    description:
      'Teams are split into pools you assign by hand; each pool plays its own round robin and nobody plays across pools.',
    build: buildPoolsSchedule,
    // The only format whose game count depends on the shape of the draw rather than on
    // the number of teams: 24 teams is 36 games as 6 pools of 4 and 66 as 4 pools of 6.
    // Hence the second argument, which every other format ignores.
    gameCount: (n, options) => poolSizes(n, options).reduce((t, s) => t + (s * (s - 1)) / 2, 0),
    minTeams: MIN_POOL_COUNT * MIN_POOL_TEAMS,
  },
  custom: {
    id: 'custom',
    label: 'Custom fixtures',
    description:
      'The fixture list was written for this tournament rather than generated from a rule — editing teams keeps it as it is.',
    build: buildCustomSchedule,
    // Counted through the builder when the team list is to hand, so the preview drops the
    // same fixtures the save would — a team renamed after the fixtures were generated
    // must not still be counted.
    gameCount: (n, options) =>
      Array.isArray(options?.teams)
        ? buildCustomSchedule(options.teams, 1, options).length
        : (options?.fixtures || []).length,
    minTeams: 2,
    // Not offered in the format dropdowns: it is not something to switch TO, it is what a
    // tournament already is once its fixtures were built by hand or by the AI panel.
    manual: true,
    // The fixture list is already the whole draw, repeats included, so it must not be
    // multiplied by meetingsPerPair the way a per-pairing rule is.
    countsMeetings: false,
  },
};

export const DEFAULT_SCHEDULE_FORMAT = 'roundRobin';

export function buildScheduleForFormat(formatId, teams, meetingsPerPair, options) {
  const format = SCHEDULE_FORMATS[formatId] || SCHEDULE_FORMATS[DEFAULT_SCHEDULE_FORMAT];
  return format.build(teams, meetingsPerPair, options);
}

/**
 * Games this format produces, for previewing before the tournament is created.
 * `options` carries whatever else the format's count depends on — for pools, the
 * `{ pools, teams }` shape of the draw. Formats that only need a team count ignore it.
 */
export function previewGameCount(formatId, teamCount, meetingsPerPair, options) {
  const format = SCHEDULE_FORMATS[formatId] || SCHEDULE_FORMATS[DEFAULT_SCHEDULE_FORMAT];
  const meetings = Math.max(1, Math.floor(Number(meetingsPerPair)) || 1);
  if (teamCount < format.minTeams) return 0;
  // Formats that count per pairing scale with meetings; a custom fixture list already
  // contains its repeats, so it does not.
  const multiplier = format.countsMeetings === false ? 1 : meetings;
  return Math.max(0, format.gameCount(teamCount, options)) * multiplier;
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
 * Scoring rules, per phase.
 *
 * These numbers used to be hardcoded in getSetCap/getSetTarget, which meant every club
 * played to this league's format whether or not it was theirs. They are now the DEFAULTS
 * — a tournament with no `scoring` field of its own scores exactly as it did before, and
 * that equivalence is asserted in the tests rather than assumed.
 *
 * `decider` is the last set of the match when there is more than one: the short set that
 * settles a tie. Note `finals.deciderCap === finals.deciderPointsToWin`, i.e. no extra
 * room beyond 15, which is what the old code did.
 */
export const DEFAULT_SCORING = {
  pool: { pointsToWin: 21, cap: 25, deciderPointsToWin: 15, deciderCap: 18 },
  finals: { pointsToWin: 25, cap: 28, deciderPointsToWin: 15, deciderCap: 15 },
};

export const SCORING_PHASES = ['pool', 'finals'];

const posInt = (value, fallback) => {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/**
 * A stored `scoring` object cleaned into something safe to score with.
 *
 * A cap below the target is the failure worth naming: it would clamp every input below
 * the score needed to win the set, so the set could never be finished and no amount of
 * tapping + would fix it. Raised to the target rather than rejected, because refusing to
 * render a tournament because of one bad number is worse.
 */
export function normalizeScoring(raw) {
  const out = {};
  SCORING_PHASES.forEach((phase) => {
    const d = DEFAULT_SCORING[phase];
    const r = raw?.[phase] || {};
    const pointsToWin = posInt(r.pointsToWin, d.pointsToWin);
    const deciderPointsToWin = posInt(r.deciderPointsToWin, d.deciderPointsToWin);
    out[phase] = {
      pointsToWin,
      cap: Math.max(pointsToWin, posInt(r.cap, d.cap)),
      deciderPointsToWin,
      deciderCap: Math.max(deciderPointsToWin, posInt(r.deciderCap, d.deciderCap)),
    };
  });
  return out;
}

/** The scoring a tournament actually uses — its own, or this league's originals. */
export function tournamentScoring(tournament) {
  return normalizeScoring(tournament?.scoring);
}

/**
 * How many sets a match in this phase is played over.
 *
 * Knockout matches can be a different length from pool matches — a pool of one-set games
 * feeding best-of-three semifinals is an ordinary shape — so finals have their own field,
 * falling back to the pool length for every tournament created before it existed.
 */
export function setsForPhase(tournament, phase) {
  const pool = posInt(tournament?.setsPerMatch, 3);
  if (phase !== 'finals') return pool;
  return posInt(tournament?.finalsSetsPerMatch, pool);
}

/**
 * Target and cap for one set.
 *
 * The decider is the LAST set, not "set 3 onwards" — which is what the old code said, and
 * is why a five-set match used to play sets 3, 4 and 5 all to 15. That was latent rather
 * than harmless: nothing stopped an admin choosing five sets. With three sets, the two
 * readings are the same, so no existing three-set tournament changes.
 */
export function setRules(scoring, phase, setIndex, setsInMatch) {
  const p = scoring?.[phase] || scoring?.pool || DEFAULT_SCORING.pool;
  const total = posInt(setsInMatch, 3);
  const isDecider = total > 1 && setIndex === total - 1;
  return isDecider
    ? { pointsToWin: p.deciderPointsToWin, cap: p.deciderCap }
    : { pointsToWin: p.pointsToWin, cap: p.cap };
}

/**
 * Whether a set is over on the scoreboard, and who took it.
 *
 * Two ways to finish: reach the target with a two-point lead, or reach the cap, where a
 * one-point lead is enough. `null` means play on — including a tie at cap, which cannot
 * happen under the rules but can certainly be typed in.
 */
export function setOutcome(set, rules) {
  const a = Math.max(0, parseInt(set?.team1, 10) || 0);
  const b = Math.max(0, parseInt(set?.team2, 10) || 0);
  if (a === b) return null;
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  const reached = hi >= rules.cap || (hi >= rules.pointsToWin && hi - lo >= 2);
  if (!reached) return null;
  return { winner: a > b ? 'team1' : 'team2', points: hi, against: lo };
}

/** One line describing a phase's format, for the scoreboard header and the admin form. */
export function describeScoring(scoring, phase, setsInMatch) {
  const p = scoring?.[phase] || DEFAULT_SCORING[phase];
  const total = posInt(setsInMatch, 3);
  const main = `${p.pointsToWin} pts (cap ${p.cap})`;
  if (total <= 1) return main;
  const decider =
    p.deciderCap > p.deciderPointsToWin
      ? `${p.deciderPointsToWin} (cap ${p.deciderCap})`
      : `${p.deciderPointsToWin}`;
  return `best of ${total}, ${main}, deciding set ${decider}`;
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
 *   2) Overall point differential — every set of every completed match
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
 * Standings: tournament points from completed games, then
 * 1) total points, 2) overall point differential, 3) head-to-head (series wins if multiple).
 *
 * Tiebreak 2 used to count only the sets of matches a team WON, which left every team
 * that had not won one sitting at exactly 0 — a "no data" value competing on the same
 * scale as measured ones, and ranking above anyone whose wins were scrappy enough to
 * total negative. Counting every set of every completed match gives each team a figure
 * that means something.
 *
 * `winMatchPointDiff` is still computed and returned: it is a genuine "how convincingly
 * did you win" statistic, just not the tiebreak any more.
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

    // A match marked complete without a decisive result — 1-1 in a best of three, say —
    // awards nobody a point, so it must not move the tiebreak either. It used to be
    // harmless because overallPointDiff was not read by anything; now that it decides
    // placings, an abandoned game with a lopsided set in it would hand out ranking a
    // scoreline nobody was awarded points for.
    if (a.winner) {
      (match.sets || []).forEach((set) => {
        const x = Number(set.team1) || 0;
        const y = Number(set.team2) || 0;
        // A padded, never-played set. Counting it would be a phantom 0-0.
        if (x === 0 && y === 0) return;
        stats[match.team1].overallPointDiff += x - y;
        stats[match.team2].overallPointDiff += y - x;
      });
    }
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
    if (db.overallPointDiff !== da.overallPointDiff) {
      return db.overallPointDiff - da.overallPointDiff;
    }
    const h2h = headToHeadCompare(a[0], b[0]);
    if (h2h !== 0) return h2h;
    return a[0].localeCompare(b[0]);
  });

  return entries;
}
