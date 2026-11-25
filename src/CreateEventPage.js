import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Timestamp,
  addDoc,
  collection,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from './firebase';
import { useAuth } from './AuthContext';
import { useProfile } from './ProfileContext';
import { NE_STATES, SKILL_LEVELS } from './profileUtils';
import {
  EVENT_FORMATS,
  combineLocalDateTime,
  normalizeEventInput,
  toDateInputValue,
  toTimeInputValue,
  validateEventInput,
} from './eventUtils';
import {
  cardQuiet,
  ghostButtonClass,
  heroSub,
  heroTitle,
  inputClass,
  labelClass,
  pageGlow,
  pageInner,
  pageShell,
  primaryButtonClass,
  secondaryButtonClass,
  sectionLabel,
} from './communityUi';

export default function CreateEventPage() {
  const { user, loading: authLoading, signIn } = useAuth();
  const { profile, needsOnboarding, openOnboarding } = useProfile();
  const navigate = useNavigate();

  const defaultDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(19, 0, 0, 0);
    return d;
  }, []);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [venueName, setVenueName] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [format, setFormat] = useState('indoor');
  const [skillLevel, setSkillLevel] = useState('open');
  const [cost, setCost] = useState('Free');
  const [capacity, setCapacity] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [date, setDate] = useState(toDateInputValue(defaultDate));
  const [startTime, setStartTime] = useState(toTimeInputValue(defaultDate));
  const [endTime, setEndTime] = useState('21:00');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (profile?.city) setCity((c) => c || profile.city);
    if (profile?.state) setState((s) => s || profile.state);
  }, [profile?.city, profile?.state]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!user) return;
    if (needsOnboarding) {
      openOnboarding();
      setError('Finish your player profile first — then post the session.');
      return;
    }

    const startsAt = combineLocalDateTime(date, startTime);
    const endsAt = endTime ? combineLocalDateTime(date, endTime) : null;
    const normalized = normalizeEventInput({
      title,
      description,
      venueName,
      address,
      city,
      state,
      format,
      skillLevel,
      cost,
      capacity,
      sourceUrl,
    });
    const msg = validateEventInput(normalized, { startsAt, endsAt });
    if (msg) {
      setError(msg);
      return;
    }

    setBusy(true);
    setError('');
    try {
      const ref = await addDoc(collection(db, 'events'), {
        ...normalized,
        hostUid: user.uid,
        hostName: profile?.displayName || user.displayName || 'Host',
        source: 'user',
        sourceKey: null,
        startsAt: Timestamp.fromDate(startsAt),
        endsAt: endsAt ? Timestamp.fromDate(endsAt) : null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      navigate(`/play/${ref.id}`, { replace: true });
    } catch (err) {
      console.error(err);
      setError(err?.message || 'Could not create the session.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={pageShell}>
      <div className={pageGlow} aria-hidden="true" />
      <div className={`${pageInner} max-w-2xl`}>
        <Link to="/play" className={`${ghostButtonClass} -ml-3 mb-4`}>
          ‹ Play
        </Link>
        <p className={`${sectionLabel} animate-fade-up`}>Host</p>
        <h1 className={heroTitle}>Post a pickup</h1>
        <p className={heroSub}>
          Share an open gym, beach night, or grass session. Players across New England
          can find it and RSVP.
        </p>

        {authLoading ? (
          <div className="mt-8 h-64 rounded-2xl border border-slate-800 bg-slate-900/40 animate-pulse" />
        ) : !user ? (
          <div className={`${cardQuiet} mt-8 text-center py-10`}>
            <p className="text-slate-300">Sign in to post a session.</p>
            <button type="button" className={`${primaryButtonClass} mt-5`} onClick={signIn}>
              Sign in / Sign up
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className={`${cardQuiet} mt-8 space-y-5 animate-fade-up`}>
            <div>
              <label className={labelClass} htmlFor="ev-title">
                Title
              </label>
              <input
                id="ev-title"
                className={inputClass}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Thursday open gym · Intermediate+"
                required
              />
            </div>
            <div className="grid sm:grid-cols-3 gap-3">
              <div>
                <label className={labelClass} htmlFor="ev-date">
                  Date
                </label>
                <input
                  id="ev-date"
                  type="date"
                  className={inputClass}
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  required
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="ev-start">
                  Start
                </label>
                <input
                  id="ev-start"
                  type="time"
                  className={inputClass}
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  required
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="ev-end">
                  End
                </label>
                <input
                  id="ev-end"
                  type="time"
                  className={inputClass}
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                />
              </div>
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className={labelClass} htmlFor="ev-venue">
                  Venue
                </label>
                <input
                  id="ev-venue"
                  className={inputClass}
                  value={venueName}
                  onChange={(e) => setVenueName(e.target.value)}
                  placeholder="Court name or gym"
                  required
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="ev-city">
                  City
                </label>
                <input
                  id="ev-city"
                  className={inputClass}
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  required
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="ev-state">
                  State
                </label>
                <select
                  id="ev-state"
                  className={inputClass}
                  value={state}
                  onChange={(e) => setState(e.target.value)}
                  required
                >
                  <option value="">Select…</option>
                  {NE_STATES.map((s) => (
                    <option key={s.code} value={s.code}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass} htmlFor="ev-address">
                  Address (optional)
                </label>
                <input
                  id="ev-address"
                  className={inputClass}
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Street or landmark"
                />
              </div>
            </div>
            <div className="grid sm:grid-cols-3 gap-3">
              <div>
                <label className={labelClass} htmlFor="ev-format">
                  Format
                </label>
                <select
                  id="ev-format"
                  className={inputClass}
                  value={format}
                  onChange={(e) => setFormat(e.target.value)}
                >
                  {EVENT_FORMATS.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass} htmlFor="ev-skill">
                  Skill
                </label>
                <select
                  id="ev-skill"
                  className={inputClass}
                  value={skillLevel}
                  onChange={(e) => setSkillLevel(e.target.value)}
                >
                  {SKILL_LEVELS.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass} htmlFor="ev-cost">
                  Cost
                </label>
                <input
                  id="ev-cost"
                  className={inputClass}
                  value={cost}
                  onChange={(e) => setCost(e.target.value)}
                  placeholder="Free / $10"
                />
              </div>
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className={labelClass} htmlFor="ev-cap">
                  Capacity (optional)
                </label>
                <input
                  id="ev-cap"
                  type="number"
                  min="1"
                  className={inputClass}
                  value={capacity}
                  onChange={(e) => setCapacity(e.target.value)}
                  placeholder="24"
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="ev-url">
                  Source link (optional)
                </label>
                <input
                  id="ev-url"
                  type="url"
                  className={inputClass}
                  value={sourceUrl}
                  onChange={(e) => setSourceUrl(e.target.value)}
                  placeholder="https://…"
                />
              </div>
            </div>
            <div>
              <label className={labelClass} htmlFor="ev-desc">
                Details
              </label>
              <textarea
                id="ev-desc"
                className={`${inputClass} min-h-[100px] py-3 resize-y`}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Net height, bring balls, parking, level notes…"
              />
            </div>

            {error && (
              <p className="text-sm text-red-300" role="alert">
                {error}
              </p>
            )}

            <div className="flex flex-wrap gap-3 pt-1">
              <button type="submit" className={primaryButtonClass} disabled={busy}>
                {busy ? 'Posting…' : 'Publish session'}
              </button>
              <Link to="/play" className={secondaryButtonClass}>
                Cancel
              </Link>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
