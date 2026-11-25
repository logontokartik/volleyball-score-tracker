import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Timestamp,
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import { db } from './firebase';
import { useAuth } from './AuthContext';
import { NE_STATES } from './profileUtils';
import {
  EVENT_FORMATS,
  eventLocationLine,
  formatEventWhen,
  formatLabel,
  skillLabel,
} from './eventUtils';
import {
  cardClass,
  chipClass,
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

export default function PlayPage() {
  const { user, signIn } = useAuth();
  const [state, setState] = useState('');
  const [format, setFormat] = useState('');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const now = Timestamp.now();
        // At most one equality filter besides status, so we stay on the composite
        // indexes in firestore.indexes.json; format is applied client-side when
        // state is also selected.
        const constraints = [
          where('status', '==', 'scheduled'),
          where('startsAt', '>=', now),
        ];
        if (state) constraints.push(where('state', '==', state));
        else if (format) constraints.push(where('format', '==', format));
        constraints.push(orderBy('startsAt'), limit(50));

        const snap = await getDocs(query(collection(db, 'events'), ...constraints));
        if (cancelled) return;
        let list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        if (state && format) list = list.filter((e) => e.format === format);
        setRows(list);
      } catch (err) {
        console.error(err);
        if (!cancelled) {
          setError(
            'Could not load sessions. If you just deployed indexes, wait a minute and refresh.'
          );
          setRows([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [state, format]);

  const grouped = useMemo(() => {
    const map = new Map();
    for (const ev of rows) {
      const start = ev.startsAt?.toDate?.() || new Date(ev.startsAt);
      const key = start.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      });
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(ev);
    }
    return [...map.entries()];
  }, [rows]);

  return (
    <div className={pageShell}>
      <div className={pageGlow} aria-hidden="true" />
      <div className={pageInner}>
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6">
          <div className="max-w-2xl">
            <p className={`${sectionLabel} animate-fade-up`}>Open play</p>
            <h1 className={heroTitle}>Find a court this week</h1>
            <p className={heroSub}>
              Drop-ins and pickups across New England — posted by players and clubs, plus
              curated public calendars as we add them.
            </p>
          </div>
          <div className="flex flex-wrap gap-3 animate-fade-up-delay shrink-0">
            {user ? (
              <Link to="/play/new" className={primaryButtonClass}>
                Post a session
              </Link>
            ) : (
              <button type="button" className={primaryButtonClass} onClick={signIn}>
                Sign in to post
              </button>
            )}
            <Link to="/players" className={secondaryButtonClass}>
              Browse players
            </Link>
          </div>
        </div>

        <div className="mt-8 grid sm:grid-cols-2 gap-3 max-w-xl animate-fade-up-delay-2">
          <div>
            <label className={labelClass} htmlFor="play-state">
              State
            </label>
            <select
              id="play-state"
              className={inputClass}
              value={state}
              onChange={(e) => setState(e.target.value)}
            >
              <option value="">All New England</option>
              {NE_STATES.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor="play-format">
              Format
            </label>
            <select
              id="play-format"
              className={inputClass}
              value={format}
              onChange={(e) => setFormat(e.target.value)}
            >
              <option value="">Any format</option>
              {EVENT_FORMATS.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {error && (
          <p className="mt-6 text-sm text-red-300" role="alert">
            {error}
          </p>
        )}

        {loading ? (
          <div className="mt-10 space-y-3">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-28 rounded-2xl border border-slate-800 bg-slate-900/40 animate-pulse"
              />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="mt-14 text-center max-w-md mx-auto">
            <p className="font-display text-2xl text-white">Nothing scheduled yet</p>
            <p className="mt-3 text-sm text-slate-400 leading-relaxed">
              Be the first to post an open gym in your city. Community posts keep this
              board alive until curated feeds are plugged in.
            </p>
            {user ? (
              <Link to="/play/new" className={`${primaryButtonClass} mt-6`}>
                Post the first session
              </Link>
            ) : (
              <button type="button" className={`${primaryButtonClass} mt-6`} onClick={signIn}>
                Sign in to post
              </button>
            )}
          </div>
        ) : (
          <div className="mt-10 space-y-10">
            {grouped.map(([day, events]) => (
              <section key={day}>
                <h2 className="font-display text-sm font-semibold text-slate-400 tracking-wide uppercase">
                  {day}
                </h2>
                <ul className="mt-3 space-y-3">
                  {events.map((ev, i) => (
                    <li
                      key={ev.id}
                      className="animate-fade-up"
                      style={{ animationDelay: `${Math.min(i, 6) * 0.04}s` }}
                    >
                      <Link to={`/play/${ev.id}`} className={`${cardClass} block group`}>
                        <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6">
                          <div className="sm:w-40 shrink-0">
                            <p className="text-amber-300 font-semibold text-sm">
                              {formatEventWhen(ev.startsAt, ev.endsAt).split(' · ')[1] ||
                                formatEventWhen(ev.startsAt)}
                            </p>
                            <p className="text-xs text-slate-500 mt-0.5">
                              {formatLabel(ev.format)}
                              {ev.skillLevel ? ` · ${skillLabel(ev.skillLevel)}` : ''}
                            </p>
                          </div>
                          <div className="min-w-0 flex-1">
                            <h3 className="font-display font-semibold text-lg text-white group-hover:text-amber-200 transition-colors truncate">
                              {ev.title}
                            </h3>
                            <p className="mt-1 text-sm text-slate-400 truncate">
                              {eventLocationLine(ev)}
                            </p>
                            {ev.cost && (
                              <span className={`${chipClass} mt-2`}>{ev.cost}</span>
                            )}
                          </div>
                          <span className="text-slate-500 text-sm group-hover:text-amber-300 transition-colors sm:pr-1">
                            Details →
                          </span>
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
