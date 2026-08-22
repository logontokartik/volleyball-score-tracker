import React, { useMemo, useState } from 'react';
import { setDoc } from 'firebase/firestore';
import { tournamentDoc } from './clubPaths';
import { useClub } from './ClubContext';
import AdminUnscheduledGames from './AdminUnscheduledGames';
import ScheduleAIBuilder from './ScheduleAIBuilder';
import {
  MAX_COURT_COUNT,
  blankCourt,
  blankSlot,
  buildDefaultScheduleSlots,
  buildFinalsSlots,
  formatMatchLabel,
  normalizeScheduleSlots,
  scheduleCourtCount,
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

function newSlot(kind, courtCount) {
  const base = blankSlot({ rowKind: kind }, courtCount);
  if (kind === 'break') base.timeLabel = 'Mini-Break';
  if (kind === 'note') {
    base.timeLabel = '7:00 PM';
    base.courts[0].note = 'Final (Top 2 Seeds)';
  }
  return base;
}

export default function ScheduleEditor({ tournament, onClose, onSaved }) {
  const { clubId, isClubAdmin } = useClub();
  const scores = tournament.scores || [];
  const initialCourtCount = useMemo(
    () => scheduleCourtCount(tournament.scheduleSlots, tournament.courtCount),
    [tournament.scheduleSlots, tournament.courtCount]
  );
  // Rows are converted to the current shape on the way in, so everything below this
  // point edits one shape only — legacy rows stop existing the moment they are loaded.
  const initialSlots = useMemo(() => {
    if (tournament.scheduleSlots?.length) {
      return normalizeScheduleSlots(tournament.scheduleSlots, initialCourtCount);
    }
    return buildDefaultScheduleSlots(scores, initialCourtCount);
  }, [tournament.id, tournament.scheduleSlots, scores, initialCourtCount]);

  const [courtCount, setCourtCount] = useState(initialCourtCount);
  const [slots, setSlots] = useState(initialSlots);
  const [scheduleTitle, setScheduleTitle] = useState(
    () => tournament.scheduleTitle || `${(tournament.teams || []).length} Teams Format`
  );
  const [scheduleSubtitle, setScheduleSubtitle] = useState(
    () => tournament.scheduleSubtitle || tournament.name || ''
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const gameOptions = useMemo(
    () =>
      scores.map((m) => ({
        value: m.game,
        label: `${m.game}: ${formatMatchLabel(m)}`,
      })),
    [scores]
  );

  const updateSlot = (id, patch) => {
    setSlots((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  };

  const updateCourt = (id, index, patch) => {
    setSlots((prev) =>
      prev.map((s) =>
        s.id === id
          ? { ...s, courts: s.courts.map((c, i) => (i === index ? { ...c, ...patch } : c)) }
          : s
      )
    );
  };

  const addCourt = () => {
    if (courtCount >= MAX_COURT_COUNT) return;
    setCourtCount(courtCount + 1);
    setSlots((prev) => prev.map((s) => ({ ...s, courts: [...s.courts, blankCourt()] })));
  };

  // Dropping a court throws away whatever was on it, so it is refused while the last
  // court still holds a game, an umpire or a note on any row.
  const lastCourtInUse =
    courtCount > 1 &&
    slots.some((s) => {
      const court = s.courts[courtCount - 1];
      return Boolean(court && (court.game || court.umpire || court.note));
    });

  const removeCourt = () => {
    if (courtCount <= 1 || lastCourtInUse) return;
    setCourtCount(courtCount - 1);
    setSlots((prev) => prev.map((s) => ({ ...s, courts: s.courts.slice(0, courtCount - 1) })));
  };

  const move = (index, delta) => {
    const j = index + delta;
    if (j < 0 || j >= slots.length) return;
    setSlots((prev) => {
      const next = [...prev];
      [next[index], next[j]] = [next[j], next[index]];
      return next;
    });
  };

  const removeSlot = (index) => {
    setSlots((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    if (!isClubAdmin) {
      setError('Only a club admin can save the schedule.');
      return;
    }
    setError('');
    setSaving(true);
    // Write the current shape only: the legacy per-court fields and the older shared
    // `umpire` are resolved here and dropped, so the fallbacks in slotCourts only ever
    // apply to rows this editor has not saved yet.
    const normalized = normalizeScheduleSlots(slots, courtCount);
    try {
      await setDoc(
        tournamentDoc(clubId, tournament.id),
        {
          courtCount,
          scheduleSlots: normalized,
          scheduleTitle: scheduleTitle.trim() || tournament.scheduleTitle || '',
          scheduleSubtitle: scheduleSubtitle.trim() || tournament.scheduleSubtitle || '',
        },
        { merge: true }
      );
      if (onSaved) onSaved();
      if (onClose) onClose();
    } catch (e) {
      setError(firestoreRulesHint(e));
    } finally {
      setSaving(false);
    }
  };

  const resetFromMatches = () => {
    setSlots(buildDefaultScheduleSlots(scores, courtCount));
  };

  return (
    <div className="mt-4 p-4 border-2 border-blue-200 rounded-xl bg-blue-50/40 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <h4 className="font-bold text-gray-900">Schedule · {tournament.name}</h4>
        <button
          type="button"
          onClick={onClose}
          className="text-sm text-gray-600 min-h-[44px] px-3 py-2 rounded-lg hover:bg-white/80"
        >
          Close
        </button>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-gray-600">Schedule title (top banner)</label>
          <input
            type="text"
            value={scheduleTitle}
            onChange={(e) => setScheduleTitle(e.target.value)}
            className="w-full border rounded-lg px-3 py-3 text-base min-h-[44px]"
            placeholder="e.g. Five Teams Format"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-600">Subtitle (e.g. season)</label>
          <input
            type="text"
            value={scheduleSubtitle}
            onChange={(e) => setScheduleSubtitle(e.target.value)}
            className="w-full border rounded-lg px-3 py-3 text-base min-h-[44px]"
            placeholder="e.g. GVBL 2026 Spring"
          />
        </div>
      </div>
      <AdminUnscheduledGames tournament={tournament} slots={slots} />
      <p className="text-xs text-gray-600">
        Reorder rows with the arrows. Assign which game ({scores[0]?.game || 'G1'}…) plays on each
        court, and the umpiring team for each court — they can differ, or use “Same as court 1”.
      </p>

      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white p-2">
        <span className="text-sm font-medium text-gray-700">
          Courts: <span className="font-bold">{courtCount}</span>
        </span>
        <button
          type="button"
          onClick={removeCourt}
          disabled={courtCount <= 1 || lastCourtInUse}
          className="text-sm bg-white border px-3 py-2 rounded-lg min-h-[44px] disabled:opacity-40"
          title={
            lastCourtInUse
              ? `Clear court ${courtCount} on every row before removing it`
              : 'Remove the last court'
          }
        >
          − Remove court
        </button>
        <button
          type="button"
          onClick={addCourt}
          disabled={courtCount >= MAX_COURT_COUNT}
          className="text-sm bg-white border px-3 py-2 rounded-lg min-h-[44px] disabled:opacity-40"
        >
          + Add court
        </button>
        {lastCourtInUse && (
          <span className="text-xs text-amber-700">
            Court {courtCount} is in use — clear it on every row to remove it.
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setSlots((s) => [...s, newSlot('double', courtCount)])}
          className="text-sm bg-white border px-3 py-2 rounded-lg min-h-[44px]"
        >
          + Match row
        </button>
        <button
          type="button"
          onClick={() => setSlots((s) => [...s, newSlot('break', courtCount)])}
          className="text-sm bg-pink-100 border border-pink-300 px-3 py-2 rounded-lg min-h-[44px]"
        >
          + Break row
        </button>
        <button
          type="button"
          onClick={() => setSlots((s) => [...s, newSlot('note', courtCount)])}
          className="text-sm bg-amber-100 border border-amber-300 px-3 py-2 rounded-lg min-h-[44px]"
        >
          + Note / final row
        </button>
        <button
          type="button"
          onClick={() => setSlots((s) => [...s, ...buildFinalsSlots(courtCount)])}
          className="text-sm bg-emerald-100 border border-emerald-300 px-3 py-2 rounded-lg min-h-[44px]"
          title="Adds break, both semifinals (1v4, 2v3) and the final"
        >
          + Semis &amp; final
        </button>
        <button
          type="button"
          onClick={resetFromMatches}
          className="text-sm text-blue-700 underline min-h-[44px] px-2 py-2"
        >
          Reset from match list
        </button>
      </div>

      <ScheduleAIBuilder
        tournament={tournament}
        scores={scores}
        courtCount={courtCount}
        onSlots={setSlots}
      />

      {slots.length === 0 && (
        <p className="text-sm text-gray-600 bg-white border rounded-lg p-3">
          No rows yet. Add them by hand, use “Reset from match list”, or build them from a
          screenshot with “Build with AI”.
        </p>
      )}

      <div className="space-y-3 max-h-[min(70vh,520px)] overflow-y-auto pr-1">
        {slots.map((slot, index) => (
          <div
            key={slot.id}
            className="bg-white rounded-lg border border-gray-200 p-3 shadow-sm space-y-2"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-gray-500 w-8">#{index + 1}</span>
              <button
                type="button"
                aria-label="Move up"
                onClick={() => move(index, -1)}
                disabled={index === 0}
                className="min-w-[44px] min-h-[44px] rounded-lg bg-gray-100 border text-lg disabled:opacity-30"
              >
                ↑
              </button>
              <button
                type="button"
                aria-label="Move down"
                onClick={() => move(index, 1)}
                disabled={index === slots.length - 1}
                className="min-w-[44px] min-h-[44px] rounded-lg bg-gray-100 border text-lg disabled:opacity-30"
              >
                ↓
              </button>
              <button
                type="button"
                onClick={() => removeSlot(index)}
                className="text-sm text-red-600 min-h-[44px] px-3 ml-auto"
              >
                Remove
              </button>
            </div>

            <label className="block text-xs font-medium text-gray-600">Time or label</label>
            <input
              type="text"
              value={slot.timeLabel}
              onChange={(e) => updateSlot(slot.id, { timeLabel: e.target.value })}
              className="w-full border rounded-lg px-3 py-3 text-base min-h-[44px]"
              placeholder="e.g. 1:30 PM"
            />

            {slot.rowKind === 'break' && (
              <p className="text-xs text-gray-500">This row shows as a full-width break on the schedule.</p>
            )}

            {slot.rowKind === 'note' && (
              <div className="grid sm:grid-cols-2 gap-2">
                {slot.courts.map((court, courtIndex) => (
                  <div key={courtIndex}>
                    <label className="text-xs font-medium text-gray-600">
                      Court {courtIndex + 1} text
                    </label>
                    <input
                      type="text"
                      value={court.note}
                      onChange={(e) => updateCourt(slot.id, courtIndex, { note: e.target.value })}
                      className="w-full border rounded-lg px-3 py-3 text-base min-h-[44px]"
                      placeholder={courtIndex === 0 ? 'Final (Top 2 Seeds)' : 'Optional'}
                    />
                  </div>
                ))}
              </div>
            )}

            {slot.rowKind === 'double' && (
              <>
                <datalist id={`teams-${tournament.id}`}>
                  {(tournament.teams || []).map((t) => (
                    <option key={t} value={t} />
                  ))}
                </datalist>
                <div className="grid sm:grid-cols-2 gap-3">
                  {slot.courts.map((court, courtIndex) => (
                    <div
                      key={courtIndex}
                      className="rounded-lg border border-gray-200 p-2 space-y-1"
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-xs font-bold text-gray-700">
                          Court {courtIndex + 1}
                        </span>
                        {courtIndex > 0 && (
                          <button
                            type="button"
                            onClick={() =>
                              updateCourt(slot.id, courtIndex, {
                                umpire: slot.courts[0].umpire,
                              })
                            }
                            className="text-xs text-blue-700 underline"
                          >
                            Same umpire as court 1
                          </button>
                        )}
                      </div>
                      <label className="text-xs font-medium text-gray-600 block">
                        Umpiring team
                      </label>
                      <input
                        type="text"
                        value={court.umpire}
                        onChange={(e) =>
                          updateCourt(slot.id, courtIndex, { umpire: e.target.value })
                        }
                        className="w-full border rounded-lg px-3 py-3 text-base min-h-[44px]"
                        placeholder="e.g. Green"
                        list={`teams-${tournament.id}`}
                      />
                      <label className="text-xs font-medium text-gray-600 block">Game</label>
                      <select
                        value={court.game || ''}
                        onChange={(e) =>
                          updateCourt(slot.id, courtIndex, {
                            game: e.target.value || null,
                            note: e.target.value ? '' : court.note,
                          })
                        }
                        className="w-full border rounded-lg px-2 py-3 text-base min-h-[44px] bg-white"
                      >
                        <option value="">—</option>
                        {gameOptions.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                      <label className="text-xs text-gray-500 mt-1 block">Or custom label</label>
                      <input
                        type="text"
                        value={court.note}
                        onChange={(e) => updateCourt(slot.id, courtIndex, { note: e.target.value })}
                        className="w-full border rounded-lg px-3 py-2 text-sm"
                        placeholder="Overrides match text"
                      />
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        ))}
      </div>

      {error && <div className="text-red-600 text-sm">{error}</div>}

      <div className="flex flex-col sm:flex-row gap-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || !isClubAdmin}
          className="flex-1 bg-blue-600 text-white font-medium py-3 px-4 rounded-xl min-h-[48px] disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save schedule'}
        </button>
      </div>
    </div>
  );
}
