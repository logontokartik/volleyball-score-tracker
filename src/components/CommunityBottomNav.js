import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';

const itemClass = ({ isActive }) =>
  `flex flex-col items-center justify-center gap-0.5 flex-1 min-h-[3.25rem] text-[0.65rem] font-semibold tracking-wide ${
    isActive ? 'text-amber-300' : 'text-slate-400'
  }`;

/**
 * Phone tab bar for community routes (Play / Players / Clubs / Me).
 * Club routes already have ClubSectionNav; this only mounts on PlainLayout pages.
 */
export default function CommunityBottomNav() {
  const { pathname } = useLocation();
  // Hide on super admin — operator tooling, not community browsing.
  if (pathname.startsWith('/super')) return null;

  return (
    <nav
      className="sm:hidden fixed bottom-0 inset-x-0 z-40 border-t border-slate-700/80 bg-slate-900/95 backdrop-blur-md pb-[env(safe-area-inset-bottom)]"
      aria-label="Community sections"
    >
      <div className="flex h-16 max-w-6xl mx-auto">
        <NavLink to="/play" className={itemClass}>
          <span aria-hidden="true" className="text-base leading-none">
            ◈
          </span>
          Play
        </NavLink>
        <NavLink to="/players" className={itemClass}>
          <span aria-hidden="true" className="text-base leading-none">
            ◉
          </span>
          Players
        </NavLink>
        <NavLink to="/" end className={itemClass}>
          <span aria-hidden="true" className="text-base leading-none">
            ▣
          </span>
          Clubs
        </NavLink>
        <NavLink to="/me" className={itemClass}>
          <span aria-hidden="true" className="text-base leading-none">
            ○
          </span>
          Me
        </NavLink>
      </div>
    </nav>
  );
}
