import React from 'react';
import { formatMatchLabel, scheduleCourtCount, slotCourts } from './tournamentUtils';

function matchByGame(scores, gameId) {
  if (!gameId) return null;
  return scores.find((m) => m.game === gameId) || null;
}

/** Check if a match has any non-zero scores entered. */
function hasScoresEntered(match) {
  if (!match?.sets) return false;
  return match.sets.some((s) => (Number(s.team1) || 0) > 0 || (Number(s.team2) || 0) > 0);
}

/** Check if a match is currently in progress (scores entered but not completed). */
function isInProgress(match) {
  return match && !match.completed && hasScoresEntered(match);
}

/** Format a compact score line, e.g. "15-12, 8-3". */
function formatScoreSummary(match) {
  if (!match?.sets) return null;
  const parts = match.sets
    .filter((s) => (Number(s.team1) || 0) > 0 || (Number(s.team2) || 0) > 0)
    .map((s) => `${Number(s.team1) || 0}-${Number(s.team2) || 0}`);
  if (!parts.length) return null;
  return parts.join(', ');
}

// Per-court colours, cycled. Written out in full because Tailwind only sees class names
// that appear literally in the source — a computed `bg-${colour}-200` is not built.
const COURT_STYLES = [
  { head: 'bg-sky-200', cell: 'bg-sky-50/80', card: 'bg-sky-50/90', note: 'bg-sky-50', label: 'text-sky-800', divider: 'border-sky-100', hover: 'hover:bg-sky-100 active:bg-sky-200' },
  { head: 'bg-orange-200', cell: 'bg-orange-50/80', card: 'bg-orange-50/90', note: 'bg-orange-50', label: 'text-orange-900', divider: 'border-orange-100', hover: 'hover:bg-orange-100 active:bg-orange-200' },
  { head: 'bg-violet-200', cell: 'bg-violet-50/80', card: 'bg-violet-50/90', note: 'bg-violet-50', label: 'text-violet-800', divider: 'border-violet-100', hover: 'hover:bg-violet-100 active:bg-violet-200' },
  { head: 'bg-teal-200', cell: 'bg-teal-50/80', card: 'bg-teal-50/90', note: 'bg-teal-50', label: 'text-teal-800', divider: 'border-teal-100', hover: 'hover:bg-teal-100 active:bg-teal-200' },
];

const courtStyle = (index) => COURT_STYLES[index % COURT_STYLES.length];

/**
 * Widest court count the side-by-side table stays readable at.
 *
 * Past this the columns either go off-screen or squeeze the team names into two
 * characters each, so every width falls back to the stacked cards instead. The
 * leaderboard learned the same lesson: a table that scrolls sideways gets half-read.
 */
const MAX_TABLE_COURTS = 3;

/**
 * Day-of schedule. Side by side for a couple of courts, stacked cards on a phone —
 * and stacked at every width once there are more courts than fit across.
 */
export default function ScheduleTable({
  title,
  subtitle,
  scores,
  scheduleSlots,
  courtCount,
  onMatchClick,
}) {
  const slots = scheduleSlots?.length ? scheduleSlots : [];
  const courts = scheduleCourtCount(slots, courtCount);
  const showTable = courts <= MAX_TABLE_COURTS;

  // A named grid template per court count is not expressible in Tailwind's static
  // classes, so the one dynamic value on the page is set inline.
  const rowGrid = { gridTemplateColumns: `minmax(5rem,7rem) repeat(${courts}, minmax(0,1fr))` };

  if (!slots.length) {
    return (
      <p className="text-sm text-gray-600 text-center py-6">
        No schedule rows yet. Use Admin → Schedule to build the lineup.
      </p>
    );
  }

  const readRow = (slot) => {
    const list = slotCourts(slot, courts).map((court) => {
      const match = matchByGame(scores, court.game);
      return {
        ...court,
        match,
        live: isInProgress(match),
        score: formatScoreSummary(match),
      };
    });
    return { list, live: list.some((c) => c.live) };
  };

  const clickable = typeof onMatchClick === 'function';

  return (
    <div className="w-full max-w-5xl mx-auto">
      {showTable && (
        <div className="hidden md:block rounded-lg border border-gray-300 overflow-hidden shadow-sm">
          <div className="grid bg-emerald-200 text-center text-sm font-bold py-2 px-2" style={rowGrid}>
            <div style={{ gridColumn: `span ${courts + 1}` }}>{title || 'Tournament schedule'}</div>
          </div>
          <div className="grid text-xs sm:text-sm" style={rowGrid}>
            <div className="bg-amber-200 font-semibold p-2 border-t border-gray-300 flex items-center">
              {subtitle || ''}
            </div>
            {Array.from({ length: courts }, (_, i) => (
              <div
                key={i}
                className={`${courtStyle(i).head} font-semibold p-2 text-center border-t border-l border-gray-300`}
              >
                Court {i + 1}
              </div>
            ))}
          </div>
          <div
            className="grid bg-gray-50 text-[10px] sm:text-xs font-medium border-t border-gray-300"
            style={rowGrid}
          >
            <div className="p-1 border-r border-gray-200" />
            {Array.from({ length: courts }, (_, i) => (
              <div
                key={i}
                className={`grid grid-cols-2 ${i < courts - 1 ? 'border-r border-gray-200' : ''}`}
              >
                <span className="p-1 text-center border-r border-gray-200">Playing</span>
                <span className="p-1 text-center">Umpire</span>
              </div>
            ))}
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
                  className="grid border-t border-gray-300 bg-amber-50"
                  style={rowGrid}
                >
                  <div className="p-2 font-medium border-r border-gray-200 bg-gray-50">
                    {slot.timeLabel}
                  </div>
                  {slotCourts(slot, courts).map((court, i) => (
                    <div
                      key={i}
                      className={`p-2 text-center ${
                        i < courts - 1 ? 'border-r border-gray-200' : ''
                      } ${courtStyle(i).note}`}
                    >
                      {court.note || (i === 0 ? '—' : '')}
                    </div>
                  ))}
                </div>
              );
            }

            const { list, live: rowLive } = readRow(slot);

            return (
              <div
                key={slot.id}
                className={`grid border-t border-gray-300 text-sm ${
                  rowLive ? 'ring-2 ring-inset ring-green-400' : ''
                }`}
                style={rowGrid}
              >
                <div
                  className={`p-2 font-medium border-r border-gray-200 flex items-center ${
                    rowLive ? 'bg-green-50' : 'bg-gray-50'
                  }`}
                >
                  <span>
                    {slot.timeLabel}
                    {rowLive && (
                      <span className="block text-[10px] font-semibold text-green-700 uppercase tracking-wide mt-0.5">
                        Live
                      </span>
                    )}
                  </span>
                </div>
                {list.map((court, i) => (
                  <div
                    key={i}
                    className={`grid grid-cols-2 ${
                      i < courts - 1 ? 'border-r border-gray-200' : ''
                    } ${court.live ? 'bg-green-50/80' : courtStyle(i).cell}`}
                  >
                    <button
                      type="button"
                      disabled={!clickable || !court.match}
                      onClick={() => court.match && onMatchClick(court.match.game)}
                      className={`p-2 text-center border-r ${courtStyle(i).divider} ${
                        clickable && court.match ? `${courtStyle(i).hover} cursor-pointer` : ''
                      } disabled:cursor-default disabled:opacity-90`}
                    >
                      <span>{court.note || formatMatchLabel(court.match)}</span>
                      {court.score && (
                        <span
                          className={`block text-xs font-semibold mt-0.5 ${
                            court.match?.completed ? 'text-gray-500' : 'text-green-700'
                          }`}
                        >
                          {court.score}
                          {court.match?.completed ? ' (Final)' : ''}
                        </span>
                      )}
                    </button>
                    <div className="p-2 text-center text-xs sm:text-sm">{court.umpire || '—'}</div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}

      {/* Stacked cards: always on a phone, and at every width once the table is too wide */}
      <div className={`${showTable ? 'md:hidden' : ''} space-y-3`}>
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
                  {slotCourts(slot, courts).map((court, i) => (
                    <div key={i}>
                      <span className="text-gray-500 text-xs">Court {i + 1} · </span>
                      {court.note || (i === 0 ? '—' : '')}
                    </div>
                  ))}
                </div>
              </div>
            );
          }

          const { list, live: cardLive } = readRow(slot);

          return (
            <div
              key={slot.id}
              className={`rounded-xl border overflow-hidden shadow-sm bg-white ${
                cardLive ? 'border-green-400 ring-2 ring-green-400' : 'border-gray-200'
              }`}
            >
              <div
                className={`px-3 py-2 font-semibold text-sm flex items-center justify-between ${
                  cardLive ? 'bg-green-50' : 'bg-gray-100'
                }`}
              >
                <span>{slot.timeLabel}</span>
                {cardLive && (
                  <span className="text-[10px] font-bold text-green-700 uppercase tracking-wide bg-green-100 px-2 py-0.5 rounded-full">
                    Live
                  </span>
                )}
              </div>
              <div className="divide-y divide-gray-100">
                {list.map((court, i) => (
                  <div key={i} className={`p-3 ${court.live ? 'bg-green-50/90' : courtStyle(i).card}`}>
                    <div
                      className={`text-[10px] uppercase tracking-wide font-semibold mb-1 ${
                        court.live ? 'text-green-800' : courtStyle(i).label
                      }`}
                    >
                      Court {i + 1}
                    </div>
                    <button
                      type="button"
                      disabled={!clickable || !court.match}
                      onClick={() => court.match && onMatchClick(court.match.game)}
                      className={`text-left w-full text-base font-medium ${
                        clickable && court.match ? 'text-blue-700 active:text-blue-900' : ''
                      }`}
                    >
                      {court.note || formatMatchLabel(court.match)}
                    </button>
                    {court.score && (
                      <div
                        className={`text-sm font-semibold mt-1 ${
                          court.match?.completed ? 'text-gray-500' : 'text-green-700'
                        }`}
                      >
                        {court.score}
                        {court.match?.completed ? ' (Final)' : ''}
                      </div>
                    )}
                    <div className="text-xs text-gray-600 mt-1">Umpire: {court.umpire || '—'}</div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
