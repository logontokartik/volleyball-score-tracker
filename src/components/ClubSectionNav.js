import React from 'react';
import { NavLink } from 'react-router-dom';
import { useClubOptional } from '../ClubContext';

/**
 * The club's three sections, rendered as a bottom tab bar on a phone and as text links
 * in the header from `sm:` up.
 *
 * Both variants come from the same array so the two surfaces cannot drift — the failure
 * mode when they are written twice is a section that exists on desktop and not on a
 * phone, which is the device this app is actually used on.
 *
 * Admin is deliberately absent: it is an account-level destination, not a section of the
 * scoreboard, and it lives in the account menu.
 *
 * NavLink puts `aria-current="page"` on the active anchor itself, so neither variant
 * sets it by hand.
 */
function useClubSections() {
  // Null outside the club routes — the directory, /super and the 404 render the same
  // header but have no club in scope.
  const club = useClubOptional();
  const slug = club?.slug;
  if (!slug) return null;
  return [
    // `end` only on the index: without it Live matches every sub-path and all three
    // tabs light up at once.
    { to: `/c/${slug}`, end: true, label: 'Live' },
    { to: `/c/${slug}/completed`, end: false, label: 'Completed' },
    // Only clubs with a spreadsheet attached have an archive to show. Without this the
    // tab leads every other club to an empty page for a feature they do not have.
    ...(club?.club?.archiveSheetId
      ? [{ to: `/c/${slug}/archive`, end: false, label: 'Archive' }]
      : []),
  ];
}

export default function ClubSectionNav({ variant }) {
  const sections = useClubSections();
  if (!sections) return null;

  if (variant === 'header') {
    return (
      <nav className="hidden sm:flex items-center gap-5" aria-label="Club sections">
        {sections.map((s) => (
          <NavLink
            key={s.to}
            to={s.to}
            end={s.end}
            className={({ isActive }) =>
              `min-h-[44px] flex items-center text-sm transition-colors ${
                isActive
                  ? 'text-white font-semibold underline decoration-2 decoration-amber-400 underline-offset-8'
                  : 'text-slate-300 font-medium hover:text-white'
              }`
            }
          >
            {s.label}
          </NavLink>
        ))}
      </nav>
    );
  }

  return (
    <nav
      // Thumb-reachable on a phone held one-handed courtside, which is the whole point.
      // The safe-area padding keeps the labels clear of the iPhone home indicator.
      className="sm:hidden fixed bottom-0 inset-x-0 z-50 border-t border-slate-700/80 bg-slate-900/95 backdrop-blur-sm pb-[env(safe-area-inset-bottom)]"
      aria-label="Club sections"
    >
      {/* h-16 = 4rem. ClubLayout reserves exactly this much padding under the club
          pages; change one and change the other. */}
      <div className="flex h-16">
        {sections.map((s) => (
          <NavLink
            key={s.to}
            to={s.to}
            end={s.end}
            className={({ isActive }) =>
              `flex-1 min-h-[44px] flex flex-col items-center justify-center gap-1 text-xs transition-colors ${
                isActive ? 'text-amber-400 font-bold' : 'text-slate-400 font-medium'
              }`
            }
          >
            {({ isActive }) => (
              <>
                {/* The active marker is a rule above the label rather than a filled
                    pill: filled shapes are reserved for actions in this app. */}
                <span
                  aria-hidden="true"
                  className={`h-0.5 w-8 rounded-full ${isActive ? 'bg-amber-400' : 'bg-transparent'}`}
                />
                <span>{s.label}</span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
