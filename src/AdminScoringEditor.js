import React, { useMemo, useState } from 'react';
import { setDoc } from 'firebase/firestore';
import { tournamentDoc } from './clubPaths';
import { useClub } from './ClubContext';
import {
  DEFAULT_SCORING,
  describeScoring,
  normalizeScoring,
  setsForPhase,
  tournamentScoring,
} from './tournamentUtils';

const MAX_SETS = 5;
const MIN_POINTS = 5;
const MAX_POINTS = 99;

/**
 * Text state with the number derived from it, not the other way round.
 *
 * Clamping on every keystroke is a bug this project has already shipped twice: clearing
 * the field snaps it to the minimum, and the next digit typed appends to that instead of
 * replacing it, so "25" becomes "525" or the field refuses to empty at all. The raw text
 * is what the input shows; the clamp happens on save.
 */
const clampInt = (text, min, max, fallback) => {
  const n = Math.floor(Number(String(text).trim()));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};

function NumberField({ label, hint, value, onChange, min, max }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-gray-700 mb-1">{label}</span>
      <input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full min-h-[44px] rounded-lg border border-gray-300 px-3 text-sm"
      />
      {hint && <span className="mt-1 block text-[11px] text-gray-500">{hint}</span>}
    </label>
  );
}

/** One phase's four numbers, plus how many sets a match of that phase runs to. */
function PhaseFields({ title, note, sets, onSets, values, onChange, setsLabel }) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-3">
      <h5 className="text-sm font-bold text-gray-900">{title}</h5>
      {note && <p className="mt-0.5 text-[11px] text-gray-500">{note}</p>}
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <NumberField
          label={setsLabel}
          hint={`1 to ${MAX_SETS}`}
          value={sets}
          onChange={onSets}
          min={1}
          max={MAX_SETS}
        />
        <NumberField
          label="Points to win a set"
          hint="21 and 25 are the usual choices"
          value={values.pointsToWin}
          onChange={(v) => onChange('pointsToWin', v)}
          min={MIN_POINTS}
          max={MAX_POINTS}
        />
        <NumberField
          label="Hard cap"
          hint="Win by 2 until here, then one point is enough"
          value={values.cap}
          onChange={(v) => onChange('cap', v)}
          min={MIN_POINTS}
          max={MAX_POINTS}
        />
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <div className="hidden sm:block" />
        <NumberField
          label="Deciding set, points"
          hint="The last set when the match is level"
          value={values.deciderPointsToWin}
          onChange={(v) => onChange('deciderPointsToWin', v)}
          min={MIN_POINTS}
          max={MAX_POINTS}
        />
        <NumberField
          label="Deciding set, cap"
          hint="Set equal to the points for no cap at all"
          value={values.deciderCap}
          onChange={(v) => onChange('deciderCap', v)}
          min={MIN_POINTS}
          max={MAX_POINTS}
        />
      </div>
    </section>
  );
}

/**
 * Per-tournament scoring format.
 *
 * These numbers were hardcoded until now, which meant every club that signed up played
 * this league's format. Existing tournaments have no `scoring` field and keep scoring
 * exactly as before — the defaults ARE the old constants — so opening this editor and
 * saving nothing changes nothing.
 */
export default function AdminScoringEditor({ tournament, onClose }) {
  const { clubId, isClubAdmin } = useClub();

  const stored = useMemo(() => tournamentScoring(tournament), [tournament]);
  const [poolSets, setPoolSets] = useState(() => String(setsForPhase(tournament, 'pool')));
  const [finalsSets, setFinalsSets] = useState(() => String(setsForPhase(tournament, 'finals')));
  const [form, setForm] = useState(() => ({
    pool: { ...stored.pool },
    finals: { ...stored.finals },
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const update = (phase, key, value) =>
    setForm((f) => ({ ...f, [phase]: { ...f[phase], [key]: value } }));

  /** Exactly what the save would write, so the preview cannot describe something else. */
  const resolved = useMemo(() => {
    const clampPhase = (phase) => ({
      pointsToWin: clampInt(form[phase].pointsToWin, MIN_POINTS, MAX_POINTS, DEFAULT_SCORING[phase].pointsToWin),
      cap: clampInt(form[phase].cap, MIN_POINTS, MAX_POINTS, DEFAULT_SCORING[phase].cap),
      deciderPointsToWin: clampInt(form[phase].deciderPointsToWin, MIN_POINTS, MAX_POINTS, DEFAULT_SCORING[phase].deciderPointsToWin),
      deciderCap: clampInt(form[phase].deciderCap, MIN_POINTS, MAX_POINTS, DEFAULT_SCORING[phase].deciderCap),
    });
    // normalizeScoring is what the scoreboard itself will apply, so running the preview
    // through it means a cap raised to meet its target shows up here rather than
    // surprising someone mid-match.
    return {
      scoring: normalizeScoring({ pool: clampPhase('pool'), finals: clampPhase('finals') }),
      poolSets: clampInt(poolSets, 1, MAX_SETS, 3),
      finalsSets: clampInt(finalsSets, 1, MAX_SETS, 3),
    };
  }, [form, poolSets, finalsSets]);

  const capRaised =
    resolved.scoring.pool.cap !== clampInt(form.pool.cap, MIN_POINTS, MAX_POINTS, DEFAULT_SCORING.pool.cap) ||
    resolved.scoring.finals.cap !== clampInt(form.finals.cap, MIN_POINTS, MAX_POINTS, DEFAULT_SCORING.finals.cap);

  const playedSets = (tournament?.scores || []).some((m) =>
    (m.sets || []).some((s) => (Number(s.team1) || 0) > 0 || (Number(s.team2) || 0) > 0)
  );

  const handleSave = async () => {
    if (!isClubAdmin) {
      setError('Only a club admin can change scoring.');
      return;
    }
    setError('');
    setSaving(true);
    try {
      await setDoc(
        tournamentDoc(clubId, tournament.id),
        {
          scoring: resolved.scoring,
          setsPerMatch: resolved.poolSets,
          finalsSetsPerMatch: resolved.finalsSets,
        },
        { merge: true }
      );
      if (onClose) onClose();
    } catch (e) {
      setError(e?.message || 'Could not save the scoring settings.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-4 p-4 border-2 border-sky-200 rounded-xl bg-sky-50/40 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <h4 className="font-bold text-gray-900">Scoring · {tournament.name}</h4>
        <button
          type="button"
          onClick={onClose}
          className="text-sm text-gray-600 min-h-[44px] px-3 py-2 rounded-lg hover:bg-white/80"
        >
          Close
        </button>
      </div>

      <PhaseFields
        title="Pool play"
        note="Every group game in this tournament."
        setsLabel="Sets per match"
        sets={poolSets}
        onSets={setPoolSets}
        values={form.pool}
        onChange={(k, v) => update('pool', k, v)}
      />

      <PhaseFields
        title="Knockout"
        note="Quarters, semis and the final. These can differ from pool play."
        setsLabel="Sets per match"
        sets={finalsSets}
        onSets={setFinalsSets}
        values={form.finals}
        onChange={(k, v) => update('finals', k, v)}
      />

      <div className="rounded-xl border border-gray-200 bg-white p-3 text-sm">
        <p className="font-semibold text-gray-900">This is how it will read on the scoreboard</p>
        <p className="mt-1 text-gray-700">
          Pool: {describeScoring(resolved.scoring, 'pool', resolved.poolSets)}
        </p>
        <p className="text-gray-700">
          Knockout: {describeScoring(resolved.scoring, 'finals', resolved.finalsSets)}
        </p>
      </div>

      {capRaised && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          A cap below the points needed to win would make the set impossible to finish, so
          it has been raised to match. The preview above shows what will be saved.
        </p>
      )}

      {/* Changing the set count on a tournament that is already being played is the
          destructive case: matchesWithEmptySets is not re-run from here, so existing
          matches keep the number of sets they were created with. */}
      {playedSets && String(resolved.poolSets) !== String(setsForPhase(tournament, 'pool')) && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Scores have already been entered. Changing the number of pool sets affects the
          standings and future matches, but does not add or remove sets on games that
          already exist — rebuild the match list under <strong>Teams &amp; format</strong>{' '}
          if you need that.
        </p>
      )}

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}

      <div className="flex flex-col sm:flex-row gap-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="min-h-[48px] flex-1 rounded-xl bg-blue-600 px-4 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save scoring'}
        </button>
        <button
          type="button"
          onClick={() => {
            setForm({ pool: { ...DEFAULT_SCORING.pool }, finals: { ...DEFAULT_SCORING.finals } });
          }}
          className="min-h-[48px] rounded-xl border border-gray-300 bg-white px-4 text-sm font-semibold text-gray-700 hover:bg-gray-50"
        >
          Reset to defaults
        </button>
      </div>
    </div>
  );
}
