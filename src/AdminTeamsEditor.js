import React, { useMemo, useState } from 'react';
import { setDoc } from 'firebase/firestore';
import { tournamentDoc } from './clubPaths';
import { useClub } from './ClubContext';
import {
  DEFAULT_SCHEDULE_FORMAT,
  MAX_POOL_COUNT,
  clampPoolCount,
  MIN_POOL_COUNT,
  SCHEDULE_FORMATS,
  buildScheduleForFormat,
  evenSplitPoolIndexes,
  fixturesFromScores,
  matchHasResults,
  matchesWithEmptySets,
  mergeScoresPreservingResults,
  poolIndexByTeam,
  poolLetter,
  poolsFromRows,
  remapScheduleSlots,
  validatePoolAssignment,
} from './tournamentUtils';
import { remapRosters } from './playerUtils';

function firestoreRulesHint(err) {
  const message = typeof err?.message === 'string' ? err.message : '';
  if (
    err?.code === 'permission-denied' ||
    message.toLowerCase().includes('permission') ||
    message.toLowerCase().includes('insufficient')
  ) {
    return 'Firestore blocked this save. Check security rules.';
  }
  return message || 'Save failed.';
}

// `original` is the name this row was loaded with, or '' for a row added here. It is what
// lets a rename be followed rather than treated as "one team gone, one team new".
const rowFor = (name, pool = null, original = '') => ({
  id: crypto.randomUUID(),
  name,
  pool,
  original,
});

export default function AdminTeamsEditor({ tournament, onClose }) {
  const { clubId, isClubAdmin } = useClub();
  const [rows, setRows] = useState(() => {
    // Existing pool membership is read back by team name, so reopening the editor shows
    // the draw as it stands rather than an empty one that would have to be redone.
    const byTeam = poolIndexByTeam(tournament.pools);
    const list = (tournament.teams || []).map((t) =>
      rowFor(t, byTeam.get(String(t).trim()) ?? null, t)
    );
    return list.length ? list : [rowFor('')];
  });
  const [formatId, setFormatId] = useState(
    () => tournament.scheduleFormat || DEFAULT_SCHEDULE_FORMAT
  );
  // Raw text, with the number derived from it — same reason as the create form: clamping
  // on every keystroke means clearing the field snaps to the minimum, and the digit typed
  // next appends to that instead of replacing it.
  const [poolCountText, setPoolCountText] = useState(() =>
    String(clampPoolCount((tournament.pools || []).length || MIN_POOL_COUNT))
  );
  const poolCount = clampPoolCount(poolCountText);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const oldScores = useMemo(() => tournament.scores || [], [tournament.scores]);

  const teamNames = useMemo(
    () => rows.map((r) => r.name.trim()).filter(Boolean),
    [rows]
  );

  const format = SCHEDULE_FORMATS[formatId] || SCHEDULE_FORMATS[DEFAULT_SCHEDULE_FORMAT];
  const usePools = formatId === 'pools';
  const isCustom = formatId === 'custom';

  /**
   * The fixtures a custom tournament already has.
   *
   * This editor rebuilds the match list from the format on every save. Without a custom
   * format to rebuild *from*, a tournament whose fixtures were written for it — by the AI
   * panel or by hand — would come back out of here as a plain round robin, silently, with
   * the real draw gone. Reading them off the stored match list and feeding them back in
   * is what makes the rebuild a no-op for the pairings while still letting teams be
   * renamed, reordered or removed.
   *
   * Renames are followed through each row's original name, because the fixtures identify
   * teams by name: without this, renaming one team would silently delete every fixture it
   * appeared in. Removing a team still removes its fixtures — that one is the point.
   */
  // Old name -> new name, for everything stored BY team name rather than by id: the
  // fixture list below, and the rosters. Both would silently lose their contents on a
  // rename without it.
  const renames = useMemo(
    () =>
      new Map(
        rows
          .filter((r) => r.original && r.name.trim())
          .map((r) => [r.original.trim().toLowerCase(), r.name.trim()])
      ),
    [rows]
  );

  const existingFixtures = useMemo(() => {
    const follow = (name) => renames.get(String(name ?? '').trim().toLowerCase()) ?? name;
    return fixturesFromScores(oldScores).map((f) => ({
      ...f,
      team1: follow(f.team1),
      team2: follow(f.team2),
    }));
  }, [oldScores, renames]);
  const pools = useMemo(() => poolsFromRows(rows, poolCount), [rows, poolCount]);
  const poolProblems = useMemo(
    () => (usePools ? validatePoolAssignment(pools, teamNames) : []),
    [usePools, pools, teamNames]
  );

  /** Everything the save would produce, computed live so the warnings are exact. */
  const preview = useMemo(() => {
    if (teamNames.length < format.minTeams) return null;
    if (poolProblems.length) return null;
    const setsPerMatch = tournament.setsPerMatch || 3;
    const generated = buildScheduleForFormat(
      formatId,
      teamNames,
      tournament.meetingsPerPair || 1,
      { pools, fixtures: existingFixtures }
    );
    const withSets = matchesWithEmptySets(generated, setsPerMatch);
    const merged = mergeScoresPreservingResults(withSets, oldScores);

    const playedBefore = oldScores.filter(matchHasResults);
    const keptGames = new Set(merged.filter(matchHasResults).map((m) => `${m.team1}|${m.team2}`));
    const lost = playedBefore.filter((m) => {
      const key = [m.team1, m.team2].map((t) => String(t).trim().toLowerCase()).sort().join('|');
      return !merged.some(
        (n) =>
          [n.team1, n.team2].map((t) => String(t).trim().toLowerCase()).sort().join('|') === key
      );
    });

    return {
      scores: merged,
      slots: remapScheduleSlots(tournament.scheduleSlots || [], oldScores, merged),
      gameCount: merged.length,
      keptCount: keptGames.size,
      lost,
    };
  }, [teamNames, formatId, oldScores, tournament, format.minTeams, pools, poolProblems, existingFixtures]);

  const duplicate = useMemo(() => {
    const seen = new Set(teamNames.map((t) => t.toLowerCase()));
    return seen.size !== teamNames.length;
  }, [teamNames]);

  const move = (index, delta) => {
    const j = index + delta;
    if (j < 0 || j >= rows.length) return;
    setRows((prev) => {
      const next = [...prev];
      [next[index], next[j]] = [next[j], next[index]];
      return next;
    });
  };

  const handleSave = async () => {
    if (!isClubAdmin) {
      setError('Only a club admin can edit teams.');
      return;
    }
    if (teamNames.length < format.minTeams) {
      setError(`This format needs at least ${format.minTeams} teams.`);
      return;
    }
    if (duplicate) {
      setError('Team names must be unique.');
      return;
    }
    if (poolProblems.length) {
      setError(poolProblems.join(' '));
      return;
    }
    if (!preview) return;

    if (preview.lost.length) {
      const list = preview.lost.map((m) => `${m.team1} vs ${m.team2}`).join('\n  ');
      const ok = window.confirm(
        `${preview.lost.length} played match${preview.lost.length === 1 ? '' : 'es'} will lose ` +
          `${preview.lost.length === 1 ? 'its' : 'their'} score because that pairing no longer exists:\n\n  ${list}\n\nContinue?`
      );
      if (!ok) return;
    }

    setError('');
    setSaving(true);
    try {
      await setDoc(
        tournamentDoc(clubId, tournament.id),
        {
          teams: teamNames,
          scheduleFormat: formatId,
          // Cleared when the format is switched away from pools, so the standings never
          // group by a draw that no longer produced the match list. A custom fixture list
          // is the exception: its fixtures carry their own pool labels, so the stored
          // draw still describes them and is left alone.
          pools: usePools ? pools : isCustom ? tournament.pools || [] : [],
          scores: preview.scores,
          scheduleSlots: preview.slots,
          scheduleTitle: `${teamNames.length} Teams Format`,
          // Rosters are stored against the team name, so this save is the one moment
          // they can be orphaned: rename 'Black' to 'Storm' and its players vanish from
          // the Teams tab with nothing to explain it. Following the renames and dropping
          // the teams that no longer exist keeps the two in step.
          rosters: remapRosters(tournament.rosters || [], renames, teamNames),
        },
        { merge: true }
      );
      if (onClose) onClose();
    } catch (e) {
      setError(firestoreRulesHint(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-4 p-4 border-2 border-emerald-200 rounded-xl bg-emerald-50/40 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <h4 className="font-bold text-gray-900">Teams &amp; format · {tournament.name}</h4>
        <button
          type="button"
          onClick={onClose}
          className="text-sm text-gray-600 min-h-[44px] px-3 py-2 rounded-lg hover:bg-white/80"
        >
          Close
        </button>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Schedule format</label>
        <select
          value={formatId}
          onChange={(e) => setFormatId(e.target.value)}
          className="w-full border rounded-lg px-3 py-3 text-base min-h-[44px] bg-white"
        >
          {/* `custom` is only listed while the tournament IS custom: it is not a rule you
              can switch to, it is the fixture list this tournament already has. Choosing
              anything else here throws that list away, which is what the warning says. */}
          {Object.values(SCHEDULE_FORMATS)
            .filter((f) => !f.manual || f.id === tournament.scheduleFormat)
            .map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
        </select>
        <p className="text-xs text-gray-600 mt-1">{format.description}</p>
      </div>

      {isCustom && (
        <div className="text-sm rounded-lg border border-violet-200 bg-violet-50 p-3 text-violet-900">
          <span className="font-semibold">Fixtures are kept exactly as they are.</span> Saving
          re-uses this tournament's own {existingFixtures.length} fixture
          {existingFixtures.length === 1 ? '' : 's'} rather than regenerating them from a rule —
          renaming or reordering teams is safe. Removing a team removes its fixtures with it.
        </div>
      )}

      {!isCustom && tournament.scheduleFormat === 'custom' && (
        <div className="text-sm rounded-lg border border-red-300 bg-red-50 p-3 text-red-800">
          <span className="font-semibold">This replaces the custom fixture list.</span> Saving with
          "{format.label}" regenerates every pairing from that rule, and the draw written for this
          tournament is gone. Switch back to Custom fixtures to keep it.
        </div>
      )}

      {usePools && (
        <div className="rounded-lg border border-indigo-200 bg-white/70 p-3">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="edit-pool-count">
                Number of pools
              </label>
              <input
                id="edit-pool-count"
                type="number"
                min={MIN_POOL_COUNT}
                max={MAX_POOL_COUNT}
                value={poolCountText}
                onChange={(e) => setPoolCountText(e.target.value)}
                onBlur={() => setPoolCountText(String(clampPoolCount(poolCountText)))}
                className="border p-2 rounded w-24 min-h-[44px] bg-white"
              />
            </div>
            <button
              type="button"
              onClick={() =>
                setRows((prev) => {
                  const named = prev.filter((r) => r.name.trim());
                  const indexes = evenSplitPoolIndexes(named.length, poolCount);
                  let next = 0;
                  return prev.map((r) =>
                    r.name.trim() ? { ...r, pool: indexes[next++] ?? null } : r
                  );
                })
              }
              className="text-sm bg-white border px-3 py-2 rounded-lg min-h-[44px] hover:bg-gray-100"
            >
              Even split
            </button>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-700">
            {pools.map((pool) => (
              <span key={pool.name} className={pool.teams.length < 2 ? 'text-red-700' : ''}>
                <span className="font-semibold">Pool {pool.name}</span>: {pool.teams.length}
              </span>
            ))}
          </div>
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-gray-700">
            Teams{' '}
            {formatId === 'skipAdjacent' && (
              <span className="font-normal text-gray-500">— order = seating around the circle</span>
            )}
          </span>
          <button
            type="button"
            onClick={() => setRows((r) => [...r, rowFor('')])}
            className="text-sm text-blue-600 underline min-h-[44px] px-2"
          >
            Add team
          </button>
        </div>
        <div className="space-y-2">
          {rows.map((row, index) => (
            <div key={row.id} className="flex gap-2 items-center">
              <span className="text-xs font-semibold text-gray-400 w-5 shrink-0">{index + 1}</span>
              <input
                type="text"
                value={row.name}
                onChange={(e) =>
                  setRows((prev) =>
                    prev.map((r) => (r.id === row.id ? { ...r, name: e.target.value } : r))
                  )
                }
                className="border p-2 rounded flex-1 min-w-0"
                placeholder="Team name"
              />
              {usePools && (
                <select
                  aria-label={`Pool for ${row.name || 'this team'}`}
                  value={row.pool != null && row.pool < poolCount ? row.pool : ''}
                  onChange={(e) =>
                    setRows((prev) =>
                      prev.map((r) =>
                        r.id === row.id
                          ? { ...r, pool: e.target.value === '' ? null : Number(e.target.value) }
                          : r
                      )
                    )
                  }
                  className="border p-2 rounded bg-white min-h-[44px] shrink-0"
                >
                  <option value="">Pool…</option>
                  {Array.from({ length: poolCount }, (_, i) => (
                    <option key={i} value={i}>
                      {poolLetter(i)}
                    </option>
                  ))}
                </select>
              )}
              <button
                type="button"
                aria-label="Move up"
                onClick={() => move(index, -1)}
                disabled={index === 0}
                className="min-w-[44px] min-h-[44px] rounded-lg bg-white border text-lg disabled:opacity-30 shrink-0"
              >
                ↑
              </button>
              <button
                type="button"
                aria-label="Move down"
                onClick={() => move(index, 1)}
                disabled={index === rows.length - 1}
                className="min-w-[44px] min-h-[44px] rounded-lg bg-white border text-lg disabled:opacity-30 shrink-0"
              >
                ↓
              </button>
              <button
                type="button"
                onClick={() => setRows((prev) => prev.filter((r) => r.id !== row.id))}
                className="text-sm text-red-600 px-2 shrink-0 min-h-[44px]"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      </div>

      {formatId === 'skipAdjacent' && teamNames.length >= 4 && (
        <div className="text-xs text-gray-700 bg-white/70 border border-emerald-200 rounded-lg p-3">
          <span className="font-semibold">Nobody plays their neighbours:</span>{' '}
          {teamNames.map((t, i) => (
            <span key={t + i}>
              {i > 0 && ' → '}
              {t}
            </span>
          ))}
          {' → '}
          {teamNames[0]}
        </div>
      )}

      {duplicate && <div className="text-red-600 text-sm">Team names must be unique.</div>}

      {poolProblems.length > 0 && (
        <ul className="text-amber-700 text-sm list-disc pl-5 space-y-0.5">
          {poolProblems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}

      {teamNames.length < format.minTeams ? (
        <div className="text-amber-700 text-sm">
          This format needs at least {format.minTeams} teams — {teamNames.length} entered.
        </div>
      ) : (
        preview && (
          <div className="text-sm bg-white rounded-lg border p-3 space-y-1">
            <div>
              <span className="font-semibold">{preview.gameCount}</span> league game
              {preview.gameCount === 1 ? '' : 's'} for {teamNames.length} teams
              {tournament.meetingsPerPair > 1 && <> ({tournament.meetingsPerPair}× each pairing)</>}.
            </div>
            {preview.keptCount > 0 && (
              <div className="text-emerald-700">
                {preview.keptCount} existing result{preview.keptCount === 1 ? '' : 's'} kept.
              </div>
            )}
            {preview.lost.length > 0 && (
              <div className="text-red-700">
                {preview.lost.length} played match{preview.lost.length === 1 ? '' : 'es'} will lose{' '}
                {preview.lost.length === 1 ? 'its score' : 'their scores'} (pairing removed):{' '}
                {preview.lost.map((m) => `${m.team1} vs ${m.team2}`).join(', ')}
              </div>
            )}
            <div className="text-gray-500 text-xs pt-1">
              Schedule rows keep their times and umpires; any row pointing at a removed pairing is
              cleared for you to reassign.
            </div>
          </div>
        )
      )}

      {error && <div className="text-red-600 text-sm">{error}</div>}

      <button
        type="button"
        onClick={handleSave}
        disabled={saving || !isClubAdmin || !preview || duplicate}
        className="w-full bg-emerald-600 text-white px-4 py-3 rounded-lg font-semibold disabled:opacity-50 min-h-[48px]"
      >
        {saving ? 'Saving…' : 'Save teams and rebuild match list'}
      </button>
      {!isClubAdmin && (
        <p className="text-sm text-amber-700">Only a club admin can edit teams.</p>
      )}
    </div>
  );
}
