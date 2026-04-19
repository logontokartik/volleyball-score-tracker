import React, { useMemo, useState, useCallback } from 'react';
import { doc, setDoc } from 'firebase/firestore';
import { db } from './firebase';
import {
  buildDefaultScheduleSlots,
  formatMatchHeadingForScores,
  getSetCap,
} from './tournamentUtils';

function firestoreRulesHint(err) {
  const code = err?.code;
  const message = typeof err?.message === 'string' ? err.message : '';
  if (
    code === 'permission-denied' ||
    message.toLowerCase().includes('permission') ||
    message.toLowerCase().includes('insufficient')
  ) {
    return 'Firestore blocked this save. Check security rules.';
  }
  return message || 'Save failed.';
}

export default function AdminMatchLocks({ tournament, user, onClose }) {
  const scores = tournament.scores || [];
  const scheduleSlots = useMemo(() => {
    if (tournament.scheduleSlots?.length) return tournament.scheduleSlots;
    return buildDefaultScheduleSlots(scores);
  }, [tournament.scheduleSlots, scores]);

  const [savingGame, setSavingGame] = useState(null);
  const [error, setError] = useState('');
  // Local edits keyed by game id: { [gameId]: sets[] }
  const [localSets, setLocalSets] = useState({});

  const getDisplaySets = (match) => localSets[match.game] || match.sets || [];

  const updateLocalScore = useCallback((gameId, setIndex, teamKey, rawValue, cap) => {
    setLocalSets((prev) => {
      const match = scores.find((m) => m.game === gameId);
      const base = (prev[gameId] || match?.sets || []).map((s) => ({ ...s }));
      const num = Math.max(0, Math.min(cap, parseInt(rawValue, 10) || 0));
      const next = base.map((s, i) =>
        i === setIndex ? { ...s, [teamKey]: num } : s
      );
      return { ...prev, [gameId]: next };
    });
  }, [scores]);

  const saveScores = useCallback(async (gameId) => {
    if (!user) return;
    const sets = localSets[gameId];
    if (!sets) return;
    setSavingGame(gameId);
    setError('');
    try {
      const next = scores.map((m) =>
        m.game === gameId ? { ...m, sets } : m
      );
      await setDoc(doc(db, 'tournaments', tournament.id), { scores: next }, { merge: true });
      setLocalSets((prev) => {
        const { [gameId]: _, ...rest } = prev;
        return rest;
      });
    } catch (e) {
      setError(firestoreRulesHint(e));
    } finally {
      setSavingGame(null);
    }
  }, [user, localSets, scores, tournament.id]);

  const unlockMatch = useCallback(async (gameId) => {
    if (!user) return;
    setSavingGame(gameId);
    setError('');
    try {
      const next = scores.map((m) =>
        m.game === gameId ? { ...m, completed: false } : m
      );
      await setDoc(doc(db, 'tournaments', tournament.id), { scores: next }, { merge: true });
    } catch (e) {
      setError(firestoreRulesHint(e));
    } finally {
      setSavingGame(null);
    }
  }, [user, scores, tournament.id]);

  const lockMatch = useCallback(async (gameId) => {
    if (!user) return;
    setSavingGame(gameId);
    setError('');
    try {
      const pendingSets = localSets[gameId];
      const next = scores.map((m) => {
        if (m.game !== gameId) return m;
        return { ...m, completed: true, ...(pendingSets ? { sets: pendingSets } : {}) };
      });
      await setDoc(doc(db, 'tournaments', tournament.id), { scores: next }, { merge: true });
      setLocalSets((prev) => {
        const { [gameId]: _, ...rest } = prev;
        return rest;
      });
    } catch (e) {
      setError(firestoreRulesHint(e));
    } finally {
      setSavingGame(null);
    }
  }, [user, localSets, scores, tournament.id]);

  return (
    <div className="mt-4 p-4 border-2 border-amber-200 rounded-xl bg-amber-50/50 space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <h4 className="font-bold text-gray-900">Score entry &amp; locks</h4>
          <p className="text-xs text-gray-600 mt-0.5">
            Unlock any match to edit its scores. Locked matches are read-only in the Scores tab.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-sm text-gray-600 min-h-[44px] px-3 py-2 rounded-lg hover:bg-white/80 self-start"
        >
          Close
        </button>
      </div>

      {error && <div className="text-red-600 text-sm">{error}</div>}
      {!user && <p className="text-sm text-amber-800">Log in to edit matches.</p>}

      {scores.length === 0 ? (
        <p className="text-sm text-gray-600">No matches in this tournament.</p>
      ) : (
        <div className="space-y-2">
          {scores.map((match) => {
            const locked = Boolean(match.completed);
            const heading = formatMatchHeadingForScores(match, scheduleSlots);
            const phase = match.phase || 'pool';
            const displaySets = getDisplaySets(match);
            const hasLocalChanges = Boolean(localSets[match.game]);
            const isSaving = savingGame === match.game;

            return (
              <div
                key={match.game}
                className={`bg-white rounded-xl border p-3 ${
                  locked ? 'border-gray-200' : 'border-blue-300 shadow-sm'
                }`}
              >
                {/* Header row */}
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 mb-2">
                  <div>
                    <div className="font-medium text-gray-900 text-sm leading-snug">{heading}</div>
                    <div className="text-xs text-gray-400 mt-0.5">
                      {phase === 'finals' ? 'Finals scoring' : 'Pool scoring'}
                      {' · '}
                      <span className={locked ? 'text-gray-400' : 'text-blue-600 font-medium'}>
                        {locked ? 'Locked' : 'Unlocked — editable'}
                      </span>
                    </div>
                  </div>
                  <div className="flex gap-2 shrink-0 flex-wrap">
                    {locked ? (
                      <button
                        type="button"
                        disabled={!user || isSaving}
                        onClick={() => unlockMatch(match.game)}
                        className="text-xs font-medium bg-amber-100 border border-amber-300 px-3 py-1.5 rounded-lg min-h-[36px] hover:bg-amber-200 disabled:opacity-50"
                      >
                        {isSaving ? 'Saving…' : 'Unlock'}
                      </button>
                    ) : (
                      <>
                        {hasLocalChanges && (
                          <button
                            type="button"
                            disabled={!user || isSaving}
                            onClick={() => saveScores(match.game)}
                            className="text-xs font-medium bg-blue-600 text-white px-3 py-1.5 rounded-lg min-h-[36px] hover:bg-blue-700 disabled:opacity-50"
                          >
                            {isSaving ? 'Saving…' : 'Save scores'}
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={!user || isSaving}
                          onClick={() => lockMatch(match.game)}
                          className="text-xs font-medium bg-green-100 border border-green-300 px-3 py-1.5 rounded-lg min-h-[36px] hover:bg-green-200 disabled:opacity-50"
                        >
                          {isSaving ? 'Saving…' : 'Mark complete'}
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* Sets — read-only when locked, editable when not */}
                <div className="space-y-1.5">
                  {displaySets.map((set, si) => {
                    const cap = getSetCap(phase, si);
                    return (
                      <div key={si} className="flex items-center gap-2 text-xs">
                        <span className="text-gray-400 w-9 shrink-0">Set {si + 1}</span>
                        {locked ? (
                          <span className="text-gray-600 tabular-nums">
                            {match.team1}: <strong>{set.team1}</strong>
                            {'  ·  '}
                            {match.team2}: <strong>{set.team2}</strong>
                          </span>
                        ) : (
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-gray-600 truncate max-w-[7rem]">{match.team1}</span>
                            <input
                              type="number"
                              inputMode="numeric"
                              min={0}
                              max={cap}
                              value={set.team1}
                              disabled={!user}
                              onChange={(e) =>
                                updateLocalScore(match.game, si, 'team1', e.target.value, cap)
                              }
                              className="border border-gray-300 rounded-lg w-14 text-center py-1 bg-white disabled:bg-gray-100 tabular-nums"
                            />
                            <span className="text-gray-400">–</span>
                            <input
                              type="number"
                              inputMode="numeric"
                              min={0}
                              max={cap}
                              value={set.team2}
                              disabled={!user}
                              onChange={(e) =>
                                updateLocalScore(match.game, si, 'team2', e.target.value, cap)
                              }
                              className="border border-gray-300 rounded-lg w-14 text-center py-1 bg-white disabled:bg-gray-100 tabular-nums"
                            />
                            <span className="text-gray-600 truncate max-w-[7rem]">{match.team2}</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
