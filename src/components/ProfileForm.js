import React, { useMemo, useState } from 'react';
import {
  NE_STATES,
  POSITIONS,
  SKILL_LEVELS,
  normalizeProfileInput,
  validateProfileInput,
} from '../profileUtils';
import {
  inputClass,
  labelClass,
  primaryButtonClass,
  secondaryButtonClass,
  chipClass,
  chipActiveClass,
} from '../communityUi';

export default function ProfileForm({
  initial,
  photoURL,
  onSave,
  onCancel,
  submitLabel = 'Save profile',
  compact = false,
}) {
  const [displayName, setDisplayName] = useState(initial?.displayName || '');
  const [city, setCity] = useState(initial?.city || '');
  const [state, setState] = useState(initial?.state || '');
  const [skillLevel, setSkillLevel] = useState(initial?.skillLevel || '');
  const [positions, setPositions] = useState(initial?.positions || []);
  const [bio, setBio] = useState(initial?.bio || '');
  const [availability, setAvailability] = useState(initial?.availability || '');
  const [lookingForPickup, setLookingForPickup] = useState(
    initial?.lookingForPickup !== false
  );
  const [isPublic, setIsPublic] = useState(initial?.isPublic !== false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const draft = useMemo(
    () =>
      normalizeProfileInput(
        {
          displayName,
          city,
          state,
          skillLevel,
          positions,
          bio,
          availability,
          lookingForPickup,
          isPublic,
        },
        { photoURL }
      ),
    [
      displayName,
      city,
      state,
      skillLevel,
      positions,
      bio,
      availability,
      lookingForPickup,
      isPublic,
      photoURL,
    ]
  );

  const togglePosition = (pos) => {
    setPositions((prev) =>
      prev.includes(pos) ? prev.filter((p) => p !== pos) : [...prev, pos]
    );
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const msg = validateProfileInput(draft);
    if (msg) {
      setError(msg);
      return;
    }
    setBusy(true);
    setError('');
    try {
      await onSave(draft);
    } catch (err) {
      setError(err?.message || 'Could not save. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className={compact ? 'grid gap-4' : 'grid sm:grid-cols-2 gap-4'}>
        <div className="sm:col-span-2">
          <label className={labelClass} htmlFor="pf-name">
            Display name
          </label>
          <input
            id="pf-name"
            className={inputClass}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="How players should know you"
            autoComplete="nickname"
            required
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="pf-city">
            City
          </label>
          <input
            id="pf-city"
            className={inputClass}
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder="Cambridge"
            autoComplete="address-level2"
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="pf-state">
            State
          </label>
          <select
            id="pf-state"
            className={inputClass}
            value={state}
            onChange={(e) => setState(e.target.value)}
            required
          >
            <option value="">New England state…</option>
            {NE_STATES.map((s) => (
              <option key={s.code} value={s.code}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className={labelClass} htmlFor="pf-skill">
            Skill level
          </label>
          <select
            id="pf-skill"
            className={inputClass}
            value={skillLevel}
            onChange={(e) => setSkillLevel(e.target.value)}
          >
            <option value="">Prefer not to say</option>
            {SKILL_LEVELS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <div className={labelClass}>Positions</div>
        <div className="flex flex-wrap gap-2">
          {POSITIONS.map((pos) => {
            const active = positions.includes(pos);
            return (
              <button
                key={pos}
                type="button"
                onClick={() => togglePosition(pos)}
                className={active ? chipActiveClass : chipClass}
                aria-pressed={active}
              >
                {pos}
              </button>
            );
          })}
        </div>
      </div>

      {!compact && (
        <>
          <div>
            <label className={labelClass} htmlFor="pf-bio">
              Bio
            </label>
            <textarea
              id="pf-bio"
              className={`${inputClass} min-h-[96px] py-3 resize-y`}
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="Years playing, favorite format, home gym…"
              maxLength={400}
            />
          </div>
          <div>
            <label className={labelClass} htmlFor="pf-avail">
              Availability
            </label>
            <input
              id="pf-avail"
              className={inputClass}
              value={availability}
              onChange={(e) => setAvailability(e.target.value)}
              placeholder="Weeknights after 7 · weekends flexible"
              maxLength={200}
            />
          </div>
        </>
      )}

      <div className="flex flex-col gap-3">
        <label className="flex items-start gap-3 cursor-pointer select-none">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4 rounded border-slate-500 bg-slate-900 text-amber-500 focus:ring-amber-400"
            checked={lookingForPickup}
            onChange={(e) => setLookingForPickup(e.target.checked)}
          />
          <span>
            <span className="block text-sm font-semibold text-white">Looking for pickup</span>
            <span className="block text-xs text-slate-400">
              Show a badge so hosts know you want open play.
            </span>
          </span>
        </label>
        <label className="flex items-start gap-3 cursor-pointer select-none">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4 rounded border-slate-500 bg-slate-900 text-amber-500 focus:ring-amber-400"
            checked={isPublic}
            onChange={(e) => setIsPublic(e.target.checked)}
          />
          <span>
            <span className="block text-sm font-semibold text-white">Public profile</span>
            <span className="block text-xs text-slate-400">
              Appear in player search. Turn off anytime.
            </span>
          </span>
        </label>
      </div>

      {error && (
        <p className="text-sm text-red-300" role="alert">
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-3 pt-1">
        <button type="submit" className={primaryButtonClass} disabled={busy}>
          {busy ? 'Saving…' : submitLabel}
        </button>
        {onCancel && (
          <button type="button" className={secondaryButtonClass} onClick={onCancel} disabled={busy}>
            Skip for now
          </button>
        )}
      </div>
    </form>
  );
}
