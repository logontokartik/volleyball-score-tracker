import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import { db } from './firebase';
import {
  NE_STATES,
  POSITIONS,
  initialsFromName,
  profileSearchPrefix,
  skillLabel,
  stateLabel,
} from './profileUtils';
import {
  cardClass,
  chipActiveClass,
  chipClass,
  heroSub,
  heroTitle,
  inputClass,
  labelClass,
  pageGlow,
  pageInner,
  pageShell,
  primaryButtonClass,
  sectionLabel,
} from './communityUi';

export default function PlayersPage() {
  const [qText, setQText] = useState('');
  const [state, setState] = useState('');
  const [lookingOnly, setLookingOnly] = useState(false);
  const [position, setPosition] = useState('');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const col = collection(db, 'profiles');
        const constraints = [where('isPublic', '==', true)];
        if (lookingOnly) constraints.push(where('lookingForPickup', '==', true));
        if (state) constraints.push(where('state', '==', state));
        constraints.push(orderBy('displayNameLower'), limit(60));

        const snap = await getDocs(query(col, ...constraints));
        if (cancelled) return;
        setRows(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      } catch (err) {
        console.error(err);
        if (!cancelled) {
          setError('Could not load players. Indexes may still be building — try again shortly.');
          setRows([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [state, lookingOnly]);

  const filtered = useMemo(() => {
    const prefix = profileSearchPrefix(qText);
    return rows.filter((p) => {
      if (prefix && !(p.displayNameLower || '').startsWith(prefix)) return false;
      if (position && !(p.positions || []).includes(position)) return false;
      return true;
    });
  }, [rows, qText, position]);

  return (
    <div className={pageShell}>
      <div className={pageGlow} aria-hidden="true" />
      <div className={pageInner}>
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div>
            <p className={`${sectionLabel} animate-fade-up`}>Find players</p>
            <h1 className={heroTitle}>New England roster</h1>
            <p className={heroSub}>
              Search public profiles across the six states. Looking for a setter in
              Providence or a libero in Portland — start here.
            </p>
          </div>
          <Link to="/me" className={`${primaryButtonClass} animate-fade-up-delay shrink-0`}>
            My profile
          </Link>
        </div>

        <div className="mt-8 grid gap-3 sm:grid-cols-12 animate-fade-up-delay-2">
          <div className="sm:col-span-5">
            <label className={labelClass} htmlFor="pl-q">
              Name
            </label>
            <input
              id="pl-q"
              className={inputClass}
              value={qText}
              onChange={(e) => setQText(e.target.value)}
              placeholder="Search by name…"
            />
          </div>
          <div className="sm:col-span-3">
            <label className={labelClass} htmlFor="pl-state">
              State
            </label>
            <select
              id="pl-state"
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
          <div className="sm:col-span-4">
            <label className={labelClass} htmlFor="pl-pos">
              Position
            </label>
            <select
              id="pl-pos"
              className={inputClass}
              value={position}
              onChange={(e) => setPosition(e.target.value)}
            >
              <option value="">Any position</option>
              {POSITIONS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            className={lookingOnly ? chipActiveClass : chipClass}
            aria-pressed={lookingOnly}
            onClick={() => setLookingOnly((v) => !v)}
          >
            Looking for pickup
          </button>
        </div>

        {error && (
          <p className="mt-6 text-sm text-red-300" role="alert">
            {error}
          </p>
        )}

        {loading ? (
          <div className="mt-10 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-36 rounded-2xl border border-slate-800 bg-slate-900/40 animate-pulse"
              />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="mt-12 text-center text-slate-400">
            <p className="font-display text-xl text-white">No players match</p>
            <p className="mt-2 text-sm">
              Try clearing filters, or{' '}
              <Link to="/me" className="text-amber-300 hover:underline">
                publish your own profile
              </Link>
              .
            </p>
          </div>
        ) : (
          <ul className="mt-8 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((p, i) => (
              <li
                key={p.id}
                style={{ animationDelay: `${Math.min(i, 8) * 0.04}s` }}
                className="animate-fade-up"
              >
                <Link to={`/players/${p.id}`} className={`${cardClass} block h-full group`}>
                  <div className="flex items-start gap-3">
                    <Avatar photoURL={p.photoURL} name={p.displayName} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h2 className="font-display font-semibold text-white truncate group-hover:text-amber-200 transition-colors">
                          {p.displayName}
                        </h2>
                        {p.lookingForPickup && (
                          <span className="text-[0.65rem] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-emerald-400/15 text-emerald-300 border border-emerald-400/30">
                            Open
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-sm text-slate-400 truncate">
                        {[p.city, stateLabel(p.state)].filter(Boolean).join(', ') || 'New England'}
                      </p>
                      {p.skillLevel && (
                        <p className="mt-2 text-xs text-slate-500">{skillLabel(p.skillLevel)}</p>
                      )}
                      {(p.positions || []).length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {p.positions.slice(0, 3).map((pos) => (
                            <span key={pos} className={chipClass}>
                              {pos}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Avatar({ photoURL, name }) {
  if (photoURL) {
    return (
      <img
        src={photoURL}
        alt=""
        className="h-12 w-12 rounded-full object-cover ring-2 ring-slate-700 group-hover:ring-amber-400/50 transition"
      />
    );
  }
  return (
    <span className="h-12 w-12 rounded-full bg-gradient-to-br from-amber-500/30 to-sky-500/20 ring-2 ring-slate-700 flex items-center justify-center font-display font-bold text-amber-200 text-sm">
      {initialsFromName(name)}
    </span>
  );
}
