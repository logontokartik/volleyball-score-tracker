import React from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { useProfile } from './ProfileContext';
import ProfileForm from './components/ProfileForm';
import {
  cardQuiet,
  ghostButtonClass,
  heroSub,
  heroTitle,
  pageGlow,
  pageInner,
  pageShell,
  primaryButtonClass,
  sectionLabel,
} from './communityUi';

export default function ProfileEditPage() {
  const { user, loading: authLoading, signIn } = useAuth();
  const { profile, loading, saveProfile, exists } = useProfile();

  return (
    <div className={pageShell}>
      <div className={pageGlow} aria-hidden="true" />
      <div className={`${pageInner} max-w-2xl`}>
        <Link to="/players" className={`${ghostButtonClass} -ml-3 mb-4`}>
          ‹ Players
        </Link>
        <p className={`${sectionLabel} animate-fade-up`}>Your card</p>
        <h1 className={heroTitle}>My profile</h1>
        <p className={heroSub}>
          Public fields only — your email stays private. Toggle visibility anytime.
        </p>

        {authLoading || (user && loading) ? (
          <div className="mt-8 h-64 rounded-2xl border border-slate-800 bg-slate-900/40 animate-pulse" />
        ) : !user ? (
          <div className={`${cardQuiet} mt-8 text-center py-10 animate-fade-up`}>
            <p className="text-slate-300">Sign in with Google to create your player profile.</p>
            <button type="button" className={`${primaryButtonClass} mt-5`} onClick={signIn}>
              Sign in / Sign up
            </button>
          </div>
        ) : (
          <div className={`${cardQuiet} mt-8 animate-fade-up`}>
            {exists && profile?.isPublic && (
              <p className="mb-5 text-sm text-slate-400">
                Live at{' '}
                <Link to={`/players/${user.uid}`} className="text-amber-300 hover:underline">
                  /players/{user.uid.slice(0, 8)}…
                </Link>
              </p>
            )}
            <ProfileForm
              initial={
                profile || {
                  displayName: user.displayName || '',
                  lookingForPickup: true,
                  isPublic: true,
                }
              }
              photoURL={user.photoURL}
              onSave={saveProfile}
              submitLabel={exists ? 'Save changes' : 'Create profile'}
            />
          </div>
        )}
      </div>
    </div>
  );
}
