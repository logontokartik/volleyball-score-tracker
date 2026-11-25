import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { db } from './firebase';
import { useAuth } from './AuthContext';
import {
  initialsFromName,
  skillLabel,
  stateLabel,
} from './profileUtils';
import {
  cardQuiet,
  chipClass,
  ghostButtonClass,
  heroTitle,
  pageGlow,
  pageInner,
  pageShell,
  primaryButtonClass,
  sectionLabel,
} from './communityUi';

export default function ProfilePublicPage() {
  const { uid } = useParams();
  const { user } = useAuth();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const snap = await getDoc(doc(db, 'profiles', uid));
        if (cancelled) return;
        if (!snap.exists()) {
          setProfile(null);
          setError('notfound');
        } else {
          setProfile({ id: snap.id, ...snap.data() });
        }
      } catch (err) {
        console.error(err);
        if (!cancelled) setError('denied');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [uid]);

  const isOwner = user?.uid === uid;

  return (
    <div className={pageShell}>
      <div className={pageGlow} aria-hidden="true" />
      <div className={pageInner}>
        <Link to="/players" className={`${ghostButtonClass} -ml-3 mb-4`}>
          ‹ Players
        </Link>

        {loading ? (
          <div className="h-48 rounded-2xl border border-slate-800 bg-slate-900/40 animate-pulse" />
        ) : error === 'notfound' || error === 'denied' ? (
          <div className="text-center py-16">
            <h1 className="font-display text-2xl text-white">Profile not available</h1>
            <p className="mt-2 text-slate-400 text-sm">
              It may be private, or the link is wrong.
            </p>
            <Link to="/players" className={`${primaryButtonClass} mt-6`}>
              Browse players
            </Link>
          </div>
        ) : (
          <article className="animate-fade-up max-w-2xl">
            <p className={sectionLabel}>Player</p>
            <div className="mt-4 flex items-start gap-4">
              {profile.photoURL ? (
                <img
                  src={profile.photoURL}
                  alt=""
                  className="h-20 w-20 rounded-2xl object-cover ring-2 ring-slate-700"
                />
              ) : (
                <span className="h-20 w-20 rounded-2xl bg-gradient-to-br from-amber-500/30 to-sky-500/20 ring-2 ring-slate-700 flex items-center justify-center font-display font-bold text-amber-200 text-2xl">
                  {initialsFromName(profile.displayName)}
                </span>
              )}
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className={heroTitle}>{profile.displayName}</h1>
                  {profile.lookingForPickup && (
                    <span className="text-[0.65rem] font-bold uppercase tracking-wide px-2 py-1 rounded-lg bg-emerald-400/15 text-emerald-300 border border-emerald-400/30">
                      Looking for pickup
                    </span>
                  )}
                </div>
                <p className="mt-1 text-slate-400">
                  {[profile.city, stateLabel(profile.state)].filter(Boolean).join(', ') ||
                    'New England'}
                </p>
                {isOwner && (
                  <Link to="/me" className={`${primaryButtonClass} mt-4 !min-h-[40px] !text-sm`}>
                    Edit profile
                  </Link>
                )}
              </div>
            </div>

            <div className={`${cardQuiet} mt-8 space-y-5`}>
              {profile.skillLevel && (
                <div>
                  <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    Skill
                  </h2>
                  <p className="mt-1 text-white">{skillLabel(profile.skillLevel)}</p>
                </div>
              )}
              {(profile.positions || []).length > 0 && (
                <div>
                  <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    Positions
                  </h2>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {profile.positions.map((pos) => (
                      <span key={pos} className={chipClass}>
                        {pos}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {profile.availability && (
                <div>
                  <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    Availability
                  </h2>
                  <p className="mt-1 text-slate-200">{profile.availability}</p>
                </div>
              )}
              {profile.bio && (
                <div>
                  <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    About
                  </h2>
                  <p className="mt-1 text-slate-200 leading-relaxed whitespace-pre-wrap">
                    {profile.bio}
                  </p>
                </div>
              )}
              {!profile.bio &&
                !profile.availability &&
                !(profile.positions || []).length &&
                !profile.skillLevel && (
                  <p className="text-sm text-slate-500">This player has not added details yet.</p>
                )}
            </div>
          </article>
        )}
      </div>
    </div>
  );
}
