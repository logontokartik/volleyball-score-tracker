import React from 'react';
import { useAuth } from './AuthContext';
import { useClubOptional } from './ClubContext';
import { isSuperAdmin } from './roles';

/**
 * What the badge next to the address says.
 *
 * Roles are club-scoped, so the badge has to be too: outside a club there is no role to
 * report and the badge is omitted entirely rather than guessing one. Inside a club it
 * says what this account may actually do there — a spectator seeing "Admin" while the
 * Admin tab is missing is exactly the confusion the badge exists to prevent.
 *
 * Returns null for "show nothing".
 */
function badgeFor(user, club) {
  if (!user) return null;
  // Installation operators are admin of every club, with or without one in scope.
  if (isSuperAdmin(user)) return { label: 'Super admin', className: 'bg-fuchsia-400 text-slate-900' };
  // No club provider (/clubs, /super, 404) or one still resolving: nothing honest to say.
  if (!club || !club.clubId || club.loading) return null;
  if (club.role === 'admin') return { label: 'Admin', className: 'bg-amber-400 text-slate-900' };
  if (club.role === 'scorer') return { label: 'Scorer', className: 'bg-white/20 text-slate-100' };
  // Signed in, but not a member of THIS club — read-only here.
  return { label: 'Signed in', className: 'bg-white/10 text-slate-300' };
}

/** Google mark, inline so it works offline courtside. */
function GoogleIcon() {
  return (
    <svg viewBox="0 0 48 48" className="w-4 h-4 shrink-0" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59A14.5 14.5 0 0 1 9.77 24c0-1.6.27-3.15.76-4.59l-7.98-6.19A23.94 23.94 0 0 0 0 24c0 3.88.93 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.9-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.17 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

export default function Login() {
  const { user, loading, signIn, signOut, error } = useAuth();
  // Null outside a club route — the nav renders on pages that have no club.
  const club = useClubOptional();
  const badge = badgeFor(user, club);

  // Render nothing until Firebase has answered, so the nav does not flash a
  // "Sign in" button at someone who is already signed in.
  if (loading) return null;

  if (user) {
    return (
      <div className="flex items-center gap-2 min-w-0 rounded-xl border border-white/15 bg-white/10 pl-3 pr-1 py-1">
        <span className="flex items-center gap-2 min-w-0">
          <span className="text-xs sm:text-sm text-slate-100 truncate max-w-[10rem] sm:max-w-none" title={user.email}>
            {user.email}
          </span>
          {/* Named so a scorer can see why there is no Admin tab, rather than
              assuming the page is broken. */}
          {badge && (
            <span
              className={`shrink-0 text-[0.65rem] font-bold uppercase tracking-wide px-2 py-0.5 rounded ${badge.className}`}
            >
              {badge.label}
            </span>
          )}
        </span>
        <button
          type="button"
          onClick={signOut}
          className="text-sm font-medium text-amber-300 min-h-[44px] px-3 py-2 rounded-lg hover:bg-white/10 shrink-0"
        >
          Log out
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 min-w-0">
      {error && <span className="text-red-300 text-xs max-w-[12rem]">{error}</span>}
      <button
        type="button"
        onClick={signIn}
        className="flex items-center gap-2 bg-white text-slate-900 px-4 py-2.5 rounded-xl text-sm font-semibold min-h-[44px] shrink-0 hover:bg-slate-100 transition-colors"
      >
        <GoogleIcon />
        Sign in with Google
      </button>
    </div>
  );
}
