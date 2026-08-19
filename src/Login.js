import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { useClubOptional } from './ClubContext';
import { isSuperAdmin } from './roles';

/**
 * What the badge in the account menu says.
 *
 * Roles are club-scoped, so the badge has to be too: outside a club there is no role to
 * report and the badge is omitted entirely rather than guessing one. Inside a club it
 * says what this account may actually do there — a spectator seeing "Admin" while the
 * Admin item is missing is exactly the confusion the badge exists to prevent.
 *
 * Returns null for "show nothing".
 */
function badgeFor(user, club) {
  if (!user) return null;
  // Installation operators are admin of every club, with or without one in scope.
  if (isSuperAdmin(user)) return { label: 'Super admin', className: 'bg-fuchsia-400 text-slate-900' };
  // No club provider (/, /super, 404) or one still resolving: nothing honest to say.
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

const menuItemClass =
  'w-full text-left min-h-[44px] flex items-center px-4 text-sm text-slate-100 hover:bg-white/10 focus:bg-white/10 focus:outline-none';

export default function Login() {
  const { user, loading, signIn, signOut, error } = useAuth();
  // Null outside a club route — the header renders on pages that have no club.
  const club = useClubOptional();
  const badge = badgeFor(user, club);
  const { pathname } = useLocation();

  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  // Focus is only pulled back to the trigger when the menu was actually open, so the
  // header does not steal focus from the page on first paint.
  const wasOpen = useRef(false);

  // Same Escape handling as ConfirmDialog: one window-level keydown while open.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    // pointerdown rather than click so the menu closes on the press, before the tap
    // lands on whatever is underneath it.
    const onPointerDown = (e) => {
      if (menuRef.current?.contains(e.target)) return;
      if (triggerRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  // A menu item is a link; navigating away has to dismiss the menu it was opened from.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (open) {
      wasOpen.current = true;
    } else if (wasOpen.current) {
      wasOpen.current = false;
      triggerRef.current?.focus();
    }
  }, [open]);

  // Render nothing until Firebase has answered, so the header does not flash a
  // "Sign in" button at someone who is already signed in.
  if (loading) return null;

  if (!user) {
    return (
      <div className="flex items-center gap-2 min-w-0">
        {/* Truncated rather than hidden on a phone: a sign-in failure with no visible
            cause is worse than a clipped one. The full text is in the title. */}
        {error && (
          <span className="text-red-300 text-xs truncate max-w-[7rem] sm:max-w-[12rem]" title={error}>
            {error}
          </span>
        )}
        {/* Filled: signing in is an action, unlike everything else in this header. */}
        <button
          type="button"
          onClick={signIn}
          className="flex items-center gap-2 bg-white text-slate-900 px-3 sm:px-4 py-2 rounded-xl text-sm font-semibold min-h-[44px] shrink-0 hover:bg-slate-100 transition-colors"
        >
          <GoogleIcon />
          Sign in
        </button>
      </div>
    );
  }

  const slug = club?.slug;
  const showAdmin = Boolean(slug && club?.isClubAdmin);
  const label = user.displayName || user.email || 'Account';

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        ref={triggerRef}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account: ${user.email}`}
        // An avatar, not the email address: the email is what forced the old header
        // onto a second row on a 390px phone.
        className="h-11 w-11 flex items-center justify-center rounded-full border border-white/20 bg-white/10 hover:bg-white/20 transition-colors"
      >
        {user.photoURL ? (
          <img src={user.photoURL} alt="" className="h-8 w-8 rounded-full object-cover" />
        ) : (
          <span className="text-sm font-bold text-white uppercase">{label.charAt(0)}</span>
        )}
      </button>

      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Account"
          className="absolute right-0 top-full mt-2 w-64 max-w-[calc(100vw-1.5rem)] rounded-xl border border-slate-700 bg-slate-800 shadow-xl overflow-hidden py-1 z-50"
        >
          <div className="px-4 py-2 border-b border-slate-700">
            <div className="text-xs text-slate-300 truncate" title={user.email}>
              {user.email}
            </div>
            {/* Named so a scorer can see why there is no Admin item, rather than
                assuming the page is broken. */}
            {badge && (
              <span
                className={`inline-block mt-1.5 text-[0.65rem] font-bold uppercase tracking-wide px-2 py-0.5 rounded ${badge.className}`}
              >
                {badge.label}
              </span>
            )}
          </div>

          {showAdmin && (
            <Link to={`/c/${slug}/admin`} role="menuitem" className={menuItemClass}>
              Admin
            </Link>
          )}
          <Link to="/" role="menuitem" className={menuItemClass}>
            All clubs
          </Link>
          {isSuperAdmin(user) && (
            <Link to="/super" role="menuitem" className={menuItemClass}>
              Super admin
            </Link>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              signOut();
            }}
            className={`${menuItemClass} border-t border-slate-700 text-amber-300`}
          >
            Log out
          </button>
        </div>
      )}
    </div>
  );
}
