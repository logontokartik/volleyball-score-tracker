import React, { useMemo, useState } from 'react';
import { setDoc } from 'firebase/firestore';
import { tournamentDoc } from './clubPaths';
import { useClub } from './ClubContext';
import {
  DEFAULT_SCHEDULE_FORMAT,
  SCHEDULE_FORMATS,
  buildScheduleForFormat,
  matchHasResults,
  matchesWithEmptySets,
  mergeScoresPreservingResults,
  remapScheduleSlots,
} from './tournamentUtils';

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

const rowFor = (name) => ({ id: crypto.randomUUID(), name });

export default function AdminTeamsEditor({ tournament, onClose }) {
  const { clubId, isClubAdmin } = useClub();
  const [rows, setRows] = useState(() =>
    (tournament.teams || []).map(rowFor).concat((tournament.teams || []).length ? [] : [rowFor('')])
  );
  const [formatId, setFormatId] = useState(
    () => tournament.scheduleFormat || DEFAULT_SCHEDULE_FORMAT
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const oldScores = useMemo(() => tournament.scores || [], [tournament.scores]);

  const teamNames = useMemo(
    () => rows.map((r) => r.name.trim()).filter(Boolean),
    [rows]
  );

  const format = SCHEDULE_FORMATS[formatId] || SCHEDULE_FORMATS[DEFAULT_SCHEDULE_FORMAT];

  /** Everything the save would produce, computed live so the warnings are exact. */
  const preview = useMemo(() => {
    if (teamNames.length < format.minTeams) return null;
    const setsPerMatch = tournament.setsPerMatch || 3;
    const generated = buildScheduleForFormat(
      formatId,
      teamNames,
      tournament.meetingsPerPair || 1
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
  }, [teamNames, formatId, oldScores, tournament, format.minTeams]);

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
          scores: preview.scores,
          scheduleSlots: preview.slots,
          scheduleTitle: `${teamNames.length} Teams Format`,
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
          {Object.values(SCHEDULE_FORMATS).map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>
        <p className="text-xs text-gray-600 mt-1">{format.description}</p>
      </div>

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
