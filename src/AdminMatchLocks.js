import React, { useMemo, useState } from 'react';
import { doc, setDoc } from 'firebase/firestore';
import { db } from './firebase';
import {
  buildDefaultScheduleSlots,
  formatMatchHeadingForScores,
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

  const unlockMatch = async (gameId) => {
    if (!user) return;
    setError('');
    setSavingGame(gameId);
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
  };

  const completedCount = scores.filter((m) => m.completed).length;

  return (
    <div className="mt-4 p-4 border-2 border-amber-200 rounded-xl bg-amber-50/50 space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <h4 className="font-bold text-gray-900">Unlock score entry</h4>
          <p className="text-xs text-gray-600 mt-0.5">
            Completed games are read-only on the Scores tab. Unlock here to allow edits again.
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

      {!user && (
        <p className="text-sm text-amber-800">Log in to unlock matches.</p>
      )}

      {completedCount === 0 ? (
        <p className="text-sm text-gray-600">No completed games to unlock.</p>
      ) : (
        <ul className="space-y-2">
          {scores
            .filter((m) => m.completed)
            .map((m) => (
              <li
                key={m.game}
                className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 bg-white rounded-lg border border-gray-200 p-3"
              >
                <div className="text-sm">
                  <div className="font-medium text-gray-900">
                    {formatMatchHeadingForScores(m, scheduleSlots)}
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">Locked</div>
                </div>
                <button
                  type="button"
                  disabled={!user || savingGame === m.game}
                  onClick={() => unlockMatch(m.game)}
                  className="text-sm font-medium bg-amber-100 border border-amber-300 px-4 py-2 rounded-lg min-h-[44px] hover:bg-amber-200 disabled:opacity-50 shrink-0"
                >
                  {savingGame === m.game ? 'Unlocking…' : 'Unlock for editing'}
                </button>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}
