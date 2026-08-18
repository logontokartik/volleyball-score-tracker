import React, { useEffect, useRef } from 'react';
import { formatMatchHeadingForScores, getSetCap, getSetTarget } from './tournamentUtils';

/**
 * Score entry for a single game, as a modal.
 *
 * Holds no score state of its own — every edit goes straight to the caller's `scores`,
 * which is what lets the dialog be closed and reopened mid-game and come back exactly
 * where it was left.
 */
export default function MatchScoreDialog({
  match,
  scheduleSlots,
  canScore,
  signedIn,
  onClose,
  onAdjust,
  onInput,
  onTogglePhase,
  onMarkComplete,
}) {
  const closeRef = useRef(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    // The page behind a full-screen dialog should not scroll with it.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  if (!match) return null;

  const locked = Boolean(match.completed);
  const phase = match.phase || 'pool';

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="match-score-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full sm:max-w-2xl max-h-[92vh] sm:max-h-[88vh] flex flex-col bg-white rounded-t-2xl sm:rounded-2xl shadow-xl border border-gray-200 overflow-hidden">
        <div className="flex items-start gap-3 px-4 py-3 border-b border-gray-200 bg-white">
          <div className="min-w-0 flex-1">
            <h2 id="match-score-title" className="text-base sm:text-lg font-bold text-gray-900 leading-snug">
              {formatMatchHeadingForScores(match, scheduleSlots)}
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {phase === 'finals'
                ? 'Finals: 25 pts (cap 28), 3rd set 15'
                : 'Pool: 21 pts (cap 25), 3rd set 15 (cap 18)'}
              {' · win by 2'}
            </p>
          </div>
          <button
            type="button"
            ref={closeRef}
            onClick={onClose}
            aria-label="Close scoring"
            className="shrink-0 flex items-center justify-center min-w-[44px] min-h-[44px] rounded-xl text-2xl leading-none text-gray-500 hover:bg-gray-100"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain p-4">
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden text-xs font-semibold">
              <button
                type="button"
                disabled={!canScore || locked}
                onClick={() => phase !== 'pool' && onTogglePhase(match.game)}
                className={`px-3 py-2 transition-colors ${
                  phase === 'pool'
                    ? 'bg-blue-600 text-white'
                    : 'bg-white text-gray-500 hover:bg-gray-50 disabled:hover:bg-white'
                }`}
              >
                Pool play
              </button>
              <button
                type="button"
                disabled={!canScore || locked}
                onClick={() => phase !== 'finals' && onTogglePhase(match.game)}
                className={`px-3 py-2 border-l border-gray-200 transition-colors ${
                  phase === 'finals'
                    ? 'bg-amber-500 text-white'
                    : 'bg-white text-gray-500 hover:bg-gray-50 disabled:hover:bg-white'
                }`}
              >
                Finals
              </button>
            </div>
            {locked && (
              <span className="inline-flex items-center text-xs font-semibold uppercase tracking-wide text-gray-600 bg-gray-200/80 px-3 py-1.5 rounded-lg">
                Complete · locked
              </span>
            )}
          </div>

          {locked && (
            <p className="text-xs text-gray-600 mb-4">
              Scores are read-only. An admin can unlock this game under Admin → Locks.
            </p>
          )}
          {!canScore && (
            <p className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-4">
              {signedIn
                ? 'Your account is not on this club’s scoring team, so scores are read-only. Ask a club admin for scorer access.'
                : 'Log in to enter or adjust scores.'}
            </p>
          )}

          {match.sets.map((set, setIndex) => {
            const setCap = getSetCap(phase, setIndex);
            const setTarget = getSetTarget(phase, setIndex);
            return (
              <div key={setIndex} className="mb-4 last:mb-0">
                <h3 className="font-semibold text-sm text-gray-600 mb-2">
                  Set {setIndex + 1}
                  <span className="font-normal text-xs text-gray-400 ml-2">
                    (to {setTarget}, cap {setCap})
                  </span>
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {['team1', 'team2'].map((teamKey) => (
                    <div
                      key={teamKey}
                      className="flex flex-col gap-2 bg-gray-50 rounded-xl px-3 py-3"
                    >
                      <label className="font-medium text-sm text-gray-800">
                        {match[teamKey]}
                      </label>
                      <div className="flex items-center justify-center gap-2 sm:gap-3">
                        <button
                          type="button"
                          aria-label={`Subtract one point for ${match[teamKey]}`}
                          disabled={!canScore || locked || set[teamKey] <= 0}
                          onClick={() => onAdjust(match.game, setIndex, teamKey, -1)}
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
                          onChange={(e) => onInput(match.game, setIndex, teamKey, e.target.value)}
                          disabled={!canScore || locked}
                          className="border border-gray-300 rounded-xl w-[4.5rem] sm:w-24 text-center text-xl font-semibold py-3 min-h-[52px] bg-white disabled:bg-gray-100 disabled:text-gray-700"
                        />
                        <button
                          type="button"
                          aria-label={`Add one point for ${match[teamKey]}`}
                          disabled={!canScore || locked || set[teamKey] >= setCap}
                          onClick={() => onAdjust(match.game, setIndex, teamKey, 1)}
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
        </div>

        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 px-4 py-3 border-t border-gray-200 bg-gray-50">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[48px] px-5 rounded-xl border border-gray-300 bg-white font-medium text-gray-700 hover:bg-gray-100"
          >
            Close
          </button>
          {canScore && !locked && (
            <button
              type="button"
              // Closing is the caller's signal that the mark actually went through —
              // it returns false when the confirm was dismissed.
              onClick={() => {
                if (onMarkComplete(match.game)) onClose();
              }}
              className="min-h-[48px] px-5 rounded-xl bg-green-700 text-white font-semibold hover:bg-green-800 active:bg-green-900"
            >
              Mark game complete
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
