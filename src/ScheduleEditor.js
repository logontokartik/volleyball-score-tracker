import React, { useMemo, useState } from 'react';
import { setDoc } from 'firebase/firestore';
import { tournamentDoc } from './clubPaths';
import { useClub } from './ClubContext';
import ScheduleAIBuilder from './ScheduleAIBuilder';
import {
  blankSlot,
  buildDefaultScheduleSlots,
  buildFinalsSlots,
  formatMatchLabel,
  slotUmpires,
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

function newSlot(kind) {
  const base = blankSlot({ rowKind: kind });
  if (kind === 'break') base.timeLabel = 'Mini-Break';
  if (kind === 'note') {
    base.timeLabel = '7:00 PM';
    base.noteCourt1 = 'Final (Top 2 Seeds)';
  }
  return base;
}

export default function ScheduleEditor({ tournament, onClose, onSaved }) {
  const { clubId, isClubAdmin } = useClub();
  const scores = tournament.scores || [];
  const initialSlots = useMemo(() => {
    if (tournament.scheduleSlots?.length) {
      return tournament.scheduleSlots.map((s) => ({ ...s }));
    }
    return buildDefaultScheduleSlots(scores);
  }, [tournament.id, tournament.scheduleSlots, scores]);

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
    // Resolve any legacy shared `umpire` into explicit per-court fields and drop it, so
    // the fallback in slotUmpires only ever applies to rows this editor hasn't saved yet.
    const normalized = slots.map((slot) => {
      const { umpire, ...rest } = slot;
      if (slot.rowKind && slot.rowKind !== 'double') return rest;
      const { court1, court2 } = slotUmpires(slot);
      return { ...rest, umpireCourt1: court1, umpireCourt2: court2 };
    });
    try {
      await setDoc(
        tournamentDoc(clubId, tournament.id),
        {
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
    setSlots(buildDefaultScheduleSlots(scores));
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
      <p className="text-xs text-gray-600">
        Reorder rows with the arrows. Assign which game ({scores[0]?.game || 'G1'}…) plays on each
        court, and the umpiring team for each court — they can differ, or use “Same as court 1”.
      </p>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setSlots((s) => [...s, newSlot('double')])}
          className="text-sm bg-white border px-3 py-2 rounded-lg min-h-[44px]"
        >
          + Match row
        </button>
        <button
          type="button"
          onClick={() => setSlots((s) => [...s, newSlot('break')])}
          className="text-sm bg-pink-100 border border-pink-300 px-3 py-2 rounded-lg min-h-[44px]"
        >
          + Break row
        </button>
        <button
          type="button"
          onClick={() => setSlots((s) => [...s, newSlot('note')])}
          className="text-sm bg-amber-100 border border-amber-300 px-3 py-2 rounded-lg min-h-[44px]"
        >
          + Note / final row
        </button>
        <button
          type="button"
          onClick={() => setSlots((s) => [...s, ...buildFinalsSlots()])}
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

      <ScheduleAIBuilder tournament={tournament} scores={scores} onSlots={setSlots} />

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
                <div>
                  <label className="text-xs font-medium text-gray-600">Court 1 text</label>
                  <input
                    type="text"
                    value={slot.noteCourt1}
                    onChange={(e) => updateSlot(slot.id, { noteCourt1: e.target.value })}
                    className="w-full border rounded-lg px-3 py-3 text-base min-h-[44px]"
                    placeholder="Final (Top 2 Seeds)"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600">Court 2 text</label>
                  <input
                    type="text"
                    value={slot.noteCourt2}
                    onChange={(e) => updateSlot(slot.id, { noteCourt2: e.target.value })}
                    className="w-full border rounded-lg px-3 py-3 text-base min-h-[44px]"
                    placeholder="Optional"
                  />
                </div>
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
                  <div>
                    <label className="text-xs font-medium text-sky-800">
                      Court 1 — umpiring team
                    </label>
                    <input
                      type="text"
                      value={slotUmpires(slot).court1}
                      onChange={(e) => updateSlot(slot.id, { umpireCourt1: e.target.value })}
                      className="w-full border rounded-lg px-3 py-3 text-base min-h-[44px]"
                      placeholder="e.g. Green"
                      list={`teams-${tournament.id}`}
                    />
                  </div>
                  <div>
                    <div className="flex items-baseline justify-between gap-2">
                      <label className="text-xs font-medium text-orange-900">
                        Court 2 — umpiring team
                      </label>
                      <button
                        type="button"
                        onClick={() =>
                          updateSlot(slot.id, { umpireCourt2: slotUmpires(slot).court1 })
                        }
                        className="text-xs text-blue-700 underline"
                      >
                        Same as court 1
                      </button>
                    </div>
                    <input
                      type="text"
                      value={slotUmpires(slot).court2}
                      onChange={(e) => updateSlot(slot.id, { umpireCourt2: e.target.value })}
                      className="w-full border rounded-lg px-3 py-3 text-base min-h-[44px]"
                      placeholder="e.g. Red"
                      list={`teams-${tournament.id}`}
                    />
                  </div>
                </div>
                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-sky-800">Court 1 — game</label>
                    <select
                      value={slot.gameCourt1 || ''}
                      onChange={(e) =>
                        updateSlot(slot.id, {
                          gameCourt1: e.target.value || null,
                          noteCourt1: e.target.value ? '' : slot.noteCourt1,
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
                      value={slot.noteCourt1}
                      onChange={(e) => updateSlot(slot.id, { noteCourt1: e.target.value })}
                      className="w-full border rounded-lg px-3 py-2 text-sm"
                      placeholder="Overrides match text"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-orange-900">Court 2 — game</label>
                    <select
                      value={slot.gameCourt2 || ''}
                      onChange={(e) =>
                        updateSlot(slot.id, {
                          gameCourt2: e.target.value || null,
                          noteCourt2: e.target.value ? '' : slot.noteCourt2,
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
                      value={slot.noteCourt2}
                      onChange={(e) => updateSlot(slot.id, { noteCourt2: e.target.value })}
                      className="w-full border rounded-lg px-3 py-2 text-sm"
                      placeholder="Overrides match text"
                    />
                  </div>
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
