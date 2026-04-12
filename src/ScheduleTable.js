import React from 'react';
import { formatMatchLabel } from './tournamentUtils';

function matchByGame(scores, gameId) {
  if (!gameId) return null;
  return scores.find((m) => m.game === gameId) || null;
}

/**
 * Day-of schedule: two courts, optional shared umpire — responsive like GVBL-style sheet.
 */
export default function ScheduleTable({
  title,
  subtitle,
  scores,
  scheduleSlots,
  onMatchClick,
}) {
  const slots = scheduleSlots?.length ? scheduleSlots : [];

  if (!slots.length) {
    return (
      <p className="text-sm text-gray-600 text-center py-6">
        No schedule rows yet. Use Admin → Schedule to build the lineup.
      </p>
    );
  }

  return (
    <div className="w-full max-w-5xl mx-auto">
      <div className="hidden md:block rounded-lg border border-gray-300 overflow-hidden shadow-sm">
        <div className="grid grid-cols-[minmax(5rem,7rem)_1fr_1fr] bg-emerald-200 text-center text-sm font-bold py-2 px-2">
          <div className="col-span-3">{title || 'Tournament schedule'}</div>
        </div>
        <div className="grid grid-cols-[minmax(5rem,7rem)_1fr_1fr] text-xs sm:text-sm">
          <div className="bg-amber-200 font-semibold p-2 border-t border-gray-300 flex items-center">
            {subtitle || ''}
          </div>
          <div className="bg-sky-200 font-semibold p-2 text-center border-t border-l border-gray-300">
            Court 1
          </div>
          <div className="bg-orange-200 font-semibold p-2 text-center border-t border-l border-gray-300">
            Court 2
          </div>
        </div>
        <div className="grid grid-cols-[minmax(5rem,7rem)_1fr_1fr] bg-gray-50 text-[10px] sm:text-xs font-medium border-t border-gray-300">
          <div className="p-1 border-r border-gray-200" />
          <div className="grid grid-cols-2 border-r border-gray-200">
            <span className="p-1 text-center border-r border-gray-200">Playing</span>
            <span className="p-1 text-center">Umpire</span>
          </div>
          <div className="grid grid-cols-2">
            <span className="p-1 text-center border-r border-gray-200">Playing</span>
            <span className="p-1 text-center">Umpire</span>
          </div>
        </div>

        {slots.map((slot) => {
          const rowKind = slot.rowKind || 'double';
          if (rowKind === 'break') {
            return (
              <div
                key={slot.id}
                className="bg-pink-200 text-center text-sm font-medium py-2 border-t border-gray-300"
              >
                {slot.timeLabel || 'Break'}
              </div>
            );
          }
          if (rowKind === 'note') {
            return (
              <div
                key={slot.id}
                className="grid grid-cols-[minmax(5rem,7rem)_1fr_1fr] border-t border-gray-300 bg-amber-50"
              >
                <div className="p-2 font-medium border-r border-gray-200 bg-gray-50">
                  {slot.timeLabel}
                </div>
                <div className="p-2 text-center border-r border-gray-200 bg-sky-50">
                  {slot.noteCourt1 || '—'}
                </div>
                <div className="p-2 text-center bg-orange-50">{slot.noteCourt2 || ''}</div>
              </div>
            );
          }

          const m1 = matchByGame(scores, slot.gameCourt1);
          const m2 = matchByGame(scores, slot.gameCourt2);
          const ump = slot.umpire || '—';
          const clickable = typeof onMatchClick === 'function';

          return (
            <div
              key={slot.id}
              className="grid grid-cols-[minmax(5rem,7rem)_1fr_1fr] border-t border-gray-300 text-sm"
            >
              <div className="p-2 font-medium border-r border-gray-200 bg-gray-50 flex items-center">
                {slot.timeLabel}
              </div>
              <div className="grid grid-cols-2 border-r border-gray-200 bg-sky-50/80">
                <button
                  type="button"
                  disabled={!clickable || !m1}
                  onClick={() => m1 && onMatchClick(m1.game)}
                  className={`p-2 text-center border-r border-sky-100 ${
                    clickable && m1 ? 'hover:bg-sky-100 active:bg-sky-200 cursor-pointer' : ''
                  } disabled:cursor-default disabled:opacity-90`}
                >
                  {slot.noteCourt1 || formatMatchLabel(m1)}
                </button>
                <div className="p-2 text-center text-xs sm:text-sm">{ump}</div>
              </div>
              <div className="grid grid-cols-2 bg-orange-50/80">
                <button
                  type="button"
                  disabled={!clickable || !m2}
                  onClick={() => m2 && onMatchClick(m2.game)}
                  className={`p-2 text-center border-r border-orange-100 ${
                    clickable && m2 ? 'hover:bg-orange-100 active:bg-orange-200 cursor-pointer' : ''
                  } disabled:cursor-default disabled:opacity-90`}
                >
                  {slot.noteCourt2 || formatMatchLabel(m2)}
                </button>
                <div className="p-2 text-center text-xs sm:text-sm">{ump}</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Mobile: stacked cards */}
      <div className="md:hidden space-y-3">
        <div className="text-center">
          <h2 className="text-lg font-bold text-emerald-900">{title || 'Schedule'}</h2>
          {subtitle ? <p className="text-sm text-amber-900 font-medium">{subtitle}</p> : null}
        </div>
        {slots.map((slot) => {
          const rowKind = slot.rowKind || 'double';
          if (rowKind === 'break') {
            return (
              <div
                key={slot.id}
                className="rounded-xl bg-pink-200 text-center font-medium py-3 px-4 shadow-sm"
              >
                {slot.timeLabel || 'Break'}
              </div>
            );
          }
          if (rowKind === 'note') {
            return (
              <div key={slot.id} className="rounded-xl border border-amber-200 overflow-hidden shadow-sm">
                <div className="bg-amber-100 px-3 py-2 text-sm font-semibold">{slot.timeLabel}</div>
                <div className="p-3 space-y-2 text-sm">
                  <div>
                    <span className="text-gray-500 text-xs">Court 1 · </span>
                    {slot.noteCourt1 || '—'}
                  </div>
                  <div>
                    <span className="text-gray-500 text-xs">Court 2 · </span>
                    {slot.noteCourt2 || ''}
                  </div>
                </div>
              </div>
            );
          }

          const m1 = matchByGame(scores, slot.gameCourt1);
          const m2 = matchByGame(scores, slot.gameCourt2);
          const ump = slot.umpire || '—';
          const clickable = typeof onMatchClick === 'function';

          return (
            <div
              key={slot.id}
              className="rounded-xl border border-gray-200 overflow-hidden shadow-sm bg-white"
            >
              <div className="bg-gray-100 px-3 py-2 font-semibold text-sm">{slot.timeLabel}</div>
              <div className="divide-y divide-gray-100">
                <div className="bg-sky-50/90 p-3">
                  <div className="text-[10px] uppercase tracking-wide text-sky-800 font-semibold mb-1">
                    Court 1
                  </div>
                  <button
                    type="button"
                    disabled={!clickable || !m1}
                    onClick={() => m1 && onMatchClick(m1.game)}
                    className={`text-left w-full text-base font-medium ${
                      clickable && m1 ? 'text-blue-700 active:text-blue-900' : ''
                    }`}
                  >
                    {slot.noteCourt1 || formatMatchLabel(m1)}
                  </button>
                  <div className="text-xs text-gray-600 mt-1">Umpire: {ump}</div>
                </div>
                <div className="bg-orange-50/90 p-3">
                  <div className="text-[10px] uppercase tracking-wide text-orange-900 font-semibold mb-1">
                    Court 2
                  </div>
                  <button
                    type="button"
                    disabled={!clickable || !m2}
                    onClick={() => m2 && onMatchClick(m2.game)}
                    className={`text-left w-full text-base font-medium ${
                      clickable && m2 ? 'text-blue-700 active:text-blue-900' : ''
                    }`}
                  >
                    {slot.noteCourt2 || formatMatchLabel(m2)}
                  </button>
                  <div className="text-xs text-gray-600 mt-1">Umpire: {ump}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
