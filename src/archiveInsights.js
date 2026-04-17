/**
 * Derived stats and simple natural-language answers from archive JSON (no server / no AI).
 */

export const GOOGLE_SHEETS_ARCHIVE_URL =
  'https://docs.google.com/spreadsheets/d/19YcFZs8Q-FleLOjePIgHEFFJKnWstb0xBx8zsVpC-OE/edit?gid=312171328#gid=312171328';

function normName(s) {
  return String(s || '')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Pairs (unordered) that appeared in the same tournament signup list; count = seasons together. */
export function pairCooccurrence(tournamentSignups) {
  const counts = new Map();
  for (const t of tournamentSignups) {
    const names = [
      ...new Set((t.signups || []).map(normName).filter(Boolean)),
    ].sort((a, b) => a.localeCompare(b));
    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        const key = `${names[i]}|||${names[j]}`;
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    }
  }
  return [...counts.entries()]
    .map(([key, count]) => {
      const [a, b] = key.split('|||');
      return { a, b, seasonsTogether: count };
    })
    .sort((x, y) => y.seasonsTogether - x.seasonsTogether);
}

/**
 * Pairs (unordered) who were on the same winning roster for a tournament season.
 * Each tournament's winners list is treated as one champion team; count = titles together as teammates.
 */
export function pairWinningRosterCooccurrence(champions, tournamentNames) {
  const counts = new Map();
  const winnersByTournament = champions?.winners || {};
  for (const tn of tournamentNames || []) {
    const names = [
      ...new Set((winnersByTournament[tn] || []).map(normName).filter(Boolean)),
    ].sort((a, b) => a.localeCompare(b));
    if (names.length < 2) continue;
    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        const key = `${names[i]}|||${names[j]}`;
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    }
  }
  return [...counts.entries()]
    .map(([key, count]) => {
      const [a, b] = key.split('|||');
      return { a, b, titlesTogether: count };
    })
    .sort((x, y) => y.titlesTogether - x.titlesTogether);
}

export function computeArchiveStats(data) {
  const { masterList, tournamentSignups, directory, champions, tournamentNames } = data;

  const uniqueCanonicalPlayers = new Set(
    (directory || []).map((d) => normName(d.canonicalName)).filter(Boolean)
  ).size;

  const totalTournaments = (tournamentSignups || []).length;
  const totalSignupSlots = (tournamentSignups || []).reduce(
    (s, t) => s + (t.signups?.length || 0),
    0
  );

  let championSlots = 0;
  (tournamentNames || []).forEach((tn) => {
    championSlots += (champions?.winners?.[tn] || []).length;
  });

  const firstName = (p) => normName(p.name).split(' ')[0] || normName(p.name);

  const sortedByPlayed = [...(masterList || [])].sort(
    (a, b) =>
      b.tournamentsPlayed - a.tournamentsPlayed ||
      firstName(a).localeCompare(firstName(b))
  );
  const sortedByWon = [...(masterList || [])].sort(
    (a, b) =>
      b.tournamentsWon - a.tournamentsWon ||
      firstName(a).localeCompare(firstName(b))
  );
  const sortedByRunner = [...(masterList || [])].sort(
    (a, b) => b.runnersUp - a.runnersUp
  );

  const totalWins = (masterList || []).reduce((s, p) => s + (p.tournamentsWon || 0), 0);
  const totalRunnerUps = (masterList || []).reduce((s, p) => s + (p.runnersUp || 0), 0);
  const avgPlayed =
    masterList?.length > 0
      ? (masterList.reduce((s, p) => s + (p.tournamentsPlayed || 0), 0) / masterList.length).toFixed(1)
      : '0';

  const topPairs = pairWinningRosterCooccurrence(champions, tournamentNames).slice(0, 12);

  const masterByName = Object.fromEntries(
    (masterList || []).map((p) => [normName(p.name).toLowerCase(), p])
  );

  return {
    uniqueCanonicalPlayers,
    masterListCount: (masterList || []).length,
    totalTournaments,
    totalSignupSlots,
    championSlots,
    seasonsWithResults: (tournamentNames || []).filter(
      (tn) =>
        (champions?.winners?.[tn] || []).length > 0 ||
        (champions?.runnersUp?.[tn] || []).length > 0
    ).length,
    totalWins,
    totalRunnerUps,
    avgPlayed,
    topPlayed: sortedByPlayed.slice(0, 7),
    topWon: sortedByWon.slice(0, 7),
    topRunner: sortedByRunner.slice(0, 5),
    topPairs,
    masterByName,
  };
}

function formatPairList(pairs, n = 8) {
  return pairs
    .slice(0, n)
    .map((p) => `• **${p.a}** & **${p.b}** — same winning team ${p.titlesTogether}×`)
    .join('\n');
}

function formatPlayers(list, key) {
  return list
    .map((p) => `• **${p.name}** — ${key}: ${p[key]}`)
    .join('\n');
}

/**
 * Free-form questions: pattern-based answers from local data only.
 */
export function answerArchiveQuestion(question, data, stats) {
  const q = normName(question).toLowerCase();
  if (!q) {
    return {
      title: 'Ask something',
      body: 'Try one of the example questions below. Answers use master stats, winner lists, and signups from this snapshot only (not live AI).',
    };
  }

  const pairIntent =
    /\bpairs?\b|\bduos?\b|\bduo\b|\btogether\b|\bteammate\b|\bchemistry\b|\bwinning team\b|\bchampion roster\b/i.test(
      q
    ) || (/\bchance(s)?\b|\blikely\b|\bodds\b/i.test(q) && /\bpair\b/i.test(q));

  if (pairIntent || (/\btwo\b/.test(q) && /\b(best|strong|often)\b/.test(q))) {
    const lines = stats.topPairs.slice(0, 10);
    return {
      title: 'Pairs most often on the same winning team',
      body:
        'These players appear together on **the same tournament winner list** most often (teammates on a championship roster in the archive). Not a prediction — historical co-wins only.\n\n' +
        formatPairList(lines, 10),
    };
  }

  if (/\b(win|won|winner|championship|title)\b/.test(q) && !/\bpair\b/.test(q)) {
    return {
      title: 'Most tournament wins (master list)',
      body: formatPlayers(stats.topWon, 'tournamentsWon'),
    };
  }

  if (/\b(runner|second|2nd|final)\b/.test(q)) {
    return {
      title: 'Most runner-up finishes',
      body: formatPlayers(stats.topRunner, 'runnersUp'),
    };
  }

  if (/\b(play|played|games|participat|appear|active|experience)\b/.test(q)) {
    return {
      title: 'Most tournaments played',
      body: formatPlayers(stats.topPlayed, 'tournamentsPlayed'),
    };
  }

  if (/\bhow many\b.*\b(tournament|season)\b/.test(q) || /\btotal tournament\b/.test(q)) {
    return {
      title: 'Tournament seasons in archive',
      body: `There are **${stats.totalTournaments}** tournament columns in the signup data.`,
    };
  }

  if (/\bunique\b.*\bplayer\b/.test(q) || /\bhow many player\b/.test(q)) {
    return {
      title: 'Player counts',
      body:
        `**${stats.uniqueCanonicalPlayers}** unique canonical names in the directory (VLookups).\n` +
        `**${stats.masterListCount}** rows on the master stats list.\n` +
        `**${stats.totalSignupSlots}** total signup slots across all seasons.`,
    };
  }

  if (/\bsetter\b/.test(q) || /\boutside\b/.test(q) || /\bmiddle\b/.test(q)) {
    const role = q.includes('setter')
      ? 'S:'
      : q.includes('outside')
        ? 'OH:'
        : q.includes('middle')
          ? 'MB:'
          : '';
    const hits = (data.masterList || []).filter((p) =>
      (p.speciality || '').toLowerCase().includes(role.toLowerCase())
    );
    const top = [...hits].sort((a, b) => b.tournamentsWon - a.tournamentsWon).slice(0, 8);
    return {
      title: role ? `Players tagged ${role}` : 'Players by role search',
      body: top.length
        ? top.map((p) => `• **${p.name}** (${p.speciality || '—'}) — ${p.tournamentsWon} wins`).join('\n')
        : 'No matches for that role in the master list.',
    };
  }

  return {
    title: 'Quick answer',
    body:
      'I matched your question to general archive stats:\n\n' +
      `• **${stats.uniqueCanonicalPlayers}** unique players (canonical)\n` +
      `• **${stats.totalTournaments}** seasons in signup grid\n` +
      `• **${stats.totalSignupSlots}** signup entries\n\n` +
      'Try asking about **pairs**, **who won the most**, **most played**, or **runners-up**.\n\n' +
      'Top pairs by **same winning team** (archive winner lists):\n' +
      formatPairList(stats.topPairs, 6),
  };
}
