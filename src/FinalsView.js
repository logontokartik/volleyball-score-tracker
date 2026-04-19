import React, { useState, useCallback } from 'react';
import { Card, CardContent } from './components/ui/card';
import { getSetCap, getSetTarget } from './tournamentUtils';

const ROUND_OPTIONS = [
  { value: 'quarter-finals', label: 'Quarter Finals' },
  { value: 'semi-finals',    label: 'Semi Finals'   },
  { value: 'finals',         label: 'Finals'        },
];

const ROUND_COLORS = {
  'quarter-finals': 'bg-sky-100 text-sky-800 border-sky-200',
  'semi-finals':    'bg-violet-100 text-violet-800 border-violet-200',
  'finals':         'bg-amber-100 text-amber-800 border-amber-200',
};

function MatchScoreCard({ match, user, onUpdate, onDelta, onComplete }) {
  const locked = Boolean(match.completed);
  const phase = 'finals'; // finals bracket always uses finals scoring rules

  return (
    <Card>
      <CardContent className="p-4">
        {/* Header */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between mb-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-xs font-bold uppercase tracking-wide px-2 py-0.5 rounded border ${ROUND_COLORS[match.round] || ROUND_COLORS['finals']}`}>
                {ROUND_OPTIONS.find(r => r.value === match.round)?.label || match.round}
              </span>
              <h2 className="text-lg font-bold text-gray-900 leading-snug">
                {match.team1} vs {match.team2}
              </h2>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Finals: 25 pts (cap 28), 3rd set 15 · win by 2
            </p>
          </div>
          <div className="shrink-0">
            {locked ? (
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-600 bg-gray-200/80 px-3 py-1.5 rounded-lg">
                Complete · locked
              </span>
            ) : (
              user && (
                <button
                  type="button"
                  onClick={() => onComplete(match.id)}
                  className="text-sm font-semibold bg-green-700 text-white px-4 py-3 rounded-xl min-h-[48px] hover:bg-green-800 active:bg-green-900"
                >
                  Mark game complete
                </button>
              )
            )}
          </div>
        </div>

        {locked && (
          <p className="text-xs text-gray-600 mb-3">
            Scores are read-only. An admin can delete this match to unlock.
          </p>
        )}

        {/* Sets */}
        {match.sets.map((set, setIndex) => {
          const setCap    = getSetCap(phase, setIndex);
          const setTarget = getSetTarget(phase, setIndex);
          return (
            <div key={setIndex} className="mb-4 last:mb-0">
              <h3 className="font-semibold text-sm text-gray-600 mb-2">
                Set {setIndex + 1}
                <span className="font-normal text-xs text-gray-400 ml-2">
                  (to {setTarget}, cap {setCap})
                </span>
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {['team1', 'team2'].map((teamKey) => (
                  <div key={teamKey} className="flex flex-col gap-2 bg-gray-50 rounded-xl px-3 py-3">
                    <label className="font-medium text-sm text-gray-800">
                      {match[teamKey]}
                    </label>
                    <div className="flex items-center justify-center gap-2 sm:gap-3">
                      <button
                        type="button"
                        aria-label={`Subtract one point for ${match[teamKey]}`}
                        disabled={!user || locked || set[teamKey] <= 0}
                        onClick={() => onDelta(match.id, setIndex, teamKey, -1)}
                        className="flex items-center justify-center min-w-[52px] min-h-[52px] rounded-xl border-2 border-gray-300 bg-white text-2xl font-bold text-gray-800 shadow-sm active:bg-gray-100 disabled:opacity-40 disabled:active:bg-white"
                      >
                        −
                      </button>
                      <input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        max={setCap}
                        value={set[teamKey]}
                        onChange={(e) => onUpdate(match.id, setIndex, teamKey, e.target.value)}
                        disabled={!user || locked}
                        className="border border-gray-300 rounded-xl w-[4.5rem] sm:w-24 text-center text-xl font-semibold py-3 min-h-[52px] bg-white disabled:bg-gray-100 disabled:text-gray-700"
                      />
                      <button
                        type="button"
                        aria-label={`Add one point for ${match[teamKey]}`}
                        disabled={!user || locked || set[teamKey] >= setCap}
                        onClick={() => onDelta(match.id, setIndex, teamKey, 1)}
                        className="flex items-center justify-center min-w-[52px] min-h-[52px] rounded-xl border-2 border-gray-300 bg-white text-2xl font-bold text-gray-800 shadow-sm active:bg-gray-100 disabled:opacity-40 disabled:active:bg-white"
                      >
                        +
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

export default function FinalsView({ teams, finalsMatches, setFinalsMatches, user, setsPerMatch }) {
  const [round, setRound]   = useState('semi-finals');
  const [team1, setTeam1]   = useState('');
  const [team2, setTeam2]   = useState('');
  const [formError, setFormError] = useState('');

  const numSets = Math.max(1, setsPerMatch || 3);

  const addMatch = useCallback(() => {
    setFormError('');
    if (!team1 || !team2) { setFormError('Select both teams.'); return; }
    if (team1 === team2)  { setFormError('Teams must be different.'); return; }
    const newMatch = {
      id:    `F-${Date.now()}`,
      round,
      team1,
      team2,
      phase: 'finals',
      sets:  Array.from({ length: numSets }, () => ({ team1: 0, team2: 0 })),
      completed: false,
    };
    setFinalsMatches((prev) => [...prev, newMatch]);
    setTeam1('');
    setTeam2('');
  }, [round, team1, team2, numSets, setFinalsMatches]);

  const removeMatch = useCallback((id) => {
    if (!window.confirm('Remove this finals match?')) return;
    setFinalsMatches((prev) => prev.filter((m) => m.id !== id));
  }, [setFinalsMatches]);

  const updateScore = useCallback((id, setIndex, teamKey, value) => {
    setFinalsMatches((prev) => prev.map((m) => {
      if (m.id !== id || m.completed) return m;
      const cap = getSetCap('finals', setIndex);
      const num = Math.max(0, Math.min(cap, parseInt(value, 10) || 0));
      const sets = m.sets.map((s, si) =>
        si === setIndex ? { ...s, [teamKey]: num } : s
      );
      return { ...m, sets };
    }));
  }, [setFinalsMatches]);

  const deltaScore = useCallback((id, setIndex, teamKey, delta) => {
    setFinalsMatches((prev) => prev.map((m) => {
      if (m.id !== id || m.completed) return m;
      const cap = getSetCap('finals', setIndex);
      const cur = Math.max(0, Math.min(cap, parseInt(m.sets[setIndex][teamKey], 10) || 0));
      const next = Math.max(0, Math.min(cap, cur + delta));
      if (next === cur) return m;
      const sets = m.sets.map((s, si) =>
        si === setIndex ? { ...s, [teamKey]: next } : s
      );
      return { ...m, sets };
    }));
  }, [setFinalsMatches]);

  const markComplete = useCallback((id) => {
    if (!window.confirm('Mark this finals game complete? It will be locked.')) return;
    setFinalsMatches((prev) =>
      prev.map((m) => m.id === id ? { ...m, completed: true } : m)
    );
  }, [setFinalsMatches]);

  // Group matches by round for display
  const byRound = ROUND_OPTIONS.map((r) => ({
    ...r,
    matches: (finalsMatches || []).filter((m) => m.round === r.value),
  })).filter((r) => r.matches.length > 0);

  return (
    <div className="grid gap-6">
      {/* Add match form — admin only */}
      {user && (
        <Card>
          <CardContent className="p-4 sm:p-5">
            <h3 className="text-base font-bold text-gray-900 mb-4">Add finals match</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
              {/* Round */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Round</label>
                <select
                  value={round}
                  onChange={(e) => setRound(e.target.value)}
                  className="w-full border border-gray-300 rounded-xl px-3 py-3 text-sm min-h-[48px] bg-white"
                >
                  {ROUND_OPTIONS.map((r) => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              </div>
              {/* Team 1 */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Team 1</label>
                <select
                  value={team1}
                  onChange={(e) => setTeam1(e.target.value)}
                  className="w-full border border-gray-300 rounded-xl px-3 py-3 text-sm min-h-[48px] bg-white"
                >
                  <option value="">— select team —</option>
                  {(teams || []).map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
              {/* Team 2 */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Team 2</label>
                <select
                  value={team2}
                  onChange={(e) => setTeam2(e.target.value)}
                  className="w-full border border-gray-300 rounded-xl px-3 py-3 text-sm min-h-[48px] bg-white"
                >
                  <option value="">— select team —</option>
                  {(teams || []).filter((t) => t !== team1).map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
            </div>
            {formError && <p className="text-red-600 text-sm mb-2">{formError}</p>}
            <button
              type="button"
              onClick={addMatch}
              className="bg-amber-500 hover:bg-amber-600 text-white font-semibold px-5 py-3 rounded-xl text-sm min-h-[48px]"
            >
              + Add match
            </button>
          </CardContent>
        </Card>
      )}

      {/* No matches yet */}
      {(!finalsMatches || finalsMatches.length === 0) && (
        <Card>
          <CardContent className="p-6 text-center text-gray-500">
            {user
              ? 'No finals matches yet. Use the form above to add Quarter Finals, Semi Finals, or Finals.'
              : 'No finals matches have been added yet.'}
          </CardContent>
        </Card>
      )}

      {/* Matches grouped by round */}
      {byRound.map(({ value: roundValue, label: roundLabel, matches }) => (
        <div key={roundValue}>
          <h2 className={`text-sm font-bold uppercase tracking-wider px-1 mb-3 ${
            roundValue === 'finals'         ? 'text-amber-700' :
            roundValue === 'semi-finals'    ? 'text-violet-700' :
                                             'text-sky-700'
          }`}>
            {roundLabel}
          </h2>
          <div className="grid gap-4">
            {matches.map((match) => (
              <div key={match.id} className="relative">
                <MatchScoreCard
                  match={match}
                  user={user}
                  onUpdate={updateScore}
                  onDelta={deltaScore}
                  onComplete={markComplete}
                />
                {user && !match.completed && (
                  <button
                    type="button"
                    onClick={() => removeMatch(match.id)}
                    className="absolute top-3 right-3 text-xs text-red-500 hover:text-red-700 font-medium px-2 py-1 rounded-lg hover:bg-red-50"
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
