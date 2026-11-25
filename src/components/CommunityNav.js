import React from 'react';
import { NavLink } from 'react-router-dom';

const linkBase =
  'min-h-[40px] px-2.5 sm:px-3 rounded-lg text-sm font-semibold transition-colors inline-flex items-center';

/**
 * Top-level community links in the site header (Play / Players / Clubs).
 * Hidden inside a club route — those pages already have club section chrome.
 */
export default function CommunityNav() {
  return (
    <nav
      className="hidden sm:flex items-center gap-1 mr-1"
      aria-label="Community"
    >
      <NavLink
        to="/play"
        className={({ isActive }) =>
          `${linkBase} ${
            isActive
              ? 'bg-white/15 text-amber-300'
              : 'text-slate-300 hover:text-white hover:bg-white/10'
          }`
        }
      >
        Play
      </NavLink>
      <NavLink
        to="/players"
        className={({ isActive }) =>
          `${linkBase} ${
            isActive
              ? 'bg-white/15 text-amber-300'
              : 'text-slate-300 hover:text-white hover:bg-white/10'
          }`
        }
      >
        Players
      </NavLink>
      <NavLink
        to="/"
        end
        className={({ isActive }) =>
          `${linkBase} ${
            isActive
              ? 'bg-white/15 text-amber-300'
              : 'text-slate-300 hover:text-white hover:bg-white/10'
          }`
        }
      >
        Clubs
      </NavLink>
    </nav>
  );
}
