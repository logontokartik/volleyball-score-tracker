/**
 * Round-robin pairings. meetingsPerPair = 2 means each unordered pair plays twice.
 */
export function buildRoundRobinSchedule(teams, meetingsPerPair) {
  const trimmed = teams.map((t) => String(t).trim()).filter(Boolean);
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

export function matchesWithEmptySets(scheduledMatches, setsPerMatch) {
  const count = Math.max(1, Math.floor(Number(setsPerMatch)) || 1);
  return scheduledMatches.map((match) => ({
    ...match,
    sets: Array.from({ length: count }, () => ({ team1: 0, team2: 0 })),
  }));
}

/** One row on the day schedule (two courts + shared umpire, break, or note row). */
export function buildDefaultScheduleSlots(scores) {
  const list = scores || [];
  const slots = [];
  for (let i = 0; i < list.length; i += 2) {
    const m1 = list[i];
    const m2 = list[i + 1];
    slots.push({
      id: crypto.randomUUID(),
      timeLabel: `Round ${slots.length + 1}`,
      rowKind: 'double',
      gameCourt1: m1?.game ?? null,
      gameCourt2: m2?.game ?? null,
      umpire: '',
      noteCourt1: '',
      noteCourt2: '',
    });
  }
  return slots;
}

/** Match list order follows first appearance in schedule (then any unscheduled games). */
export function orderScoresBySchedule(scores, scheduleSlots) {
  if (!scheduleSlots?.length || !scores?.length) return scores || [];
  const order = [];
  scheduleSlots.forEach((s) => {
    if (s.gameCourt1) order.push(s.gameCourt1);
    if (s.gameCourt2) order.push(s.gameCourt2);
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

/** Title for score entry: time + court from schedule, no G1/G2 prefix. */
export function formatMatchHeadingForScores(match, scheduleSlots) {
  if (!match) return '';
  const versus = `${match.team1} vs ${match.team2}`;
  for (const slot of scheduleSlots || []) {
    const kind = slot.rowKind || 'double';
    if (kind !== 'double') continue;
    const when = (slot.timeLabel && String(slot.timeLabel).trim()) || 'Scheduled';
    if (slot.gameCourt1 === match.game) {
      return `${when} · Court 1 · ${versus}`;
    }
    if (slot.gameCourt2 === match.game) {
      return `${when} · Court 2 · ${versus}`;
    }
  }
  return versus;
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
 * Analyze one match for tournament points (GVBL-style).
 * Rules: 2 pts per set won; +2 bonus if winner sweeps (loser wins 0 sets); +1 bonus if loser won ≥1 set.
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

  let winBonus = 0;
  if (winner === match.team1) winBonus = s2 === 0 ? 2 : 1;
  else if (winner === match.team2) winBonus = s1 === 0 ? 2 : 1;

  const pts1 = s1 * 2 + (winner === match.team1 ? winBonus : 0);
  const pts2 = s2 * 2 + (winner === match.team2 ? winBonus : 0);

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
