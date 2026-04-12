import React from 'react';
import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom';
import TrackerView from './TrackerView';
import ArchiveHub from './ArchiveHub';

function SiteNav() {
  return (
    <header className="sticky top-0 z-50 border-b border-slate-700/80 bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 text-white shadow-lg">
      <div className="max-w-6xl mx-auto px-3 sm:px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-lg sm:text-xl font-black tracking-tight truncate">
            GVBL <span className="text-amber-400 font-semibold">Volleyball</span>
          </span>
        </div>
        <nav className="flex flex-wrap items-center gap-2" aria-label="Main">
          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              `px-4 py-2.5 rounded-xl text-sm font-semibold min-h-[44px] flex items-center transition-colors ${
                isActive
                  ? 'bg-amber-500 text-slate-900 shadow'
                  : 'bg-white/10 text-white hover:bg-white/20'
              }`
            }
          >
            Live score tracker
          </NavLink>
          <NavLink
            to="/archive"
            className={({ isActive }) =>
              `px-4 py-2.5 rounded-xl text-sm font-semibold min-h-[44px] flex items-center transition-colors ${
                isActive
                  ? 'bg-amber-500 text-slate-900 shadow'
                  : 'bg-white/10 text-white hover:bg-white/20'
              }`
            }
          >
            Tournament archive
          </NavLink>
        </nav>
      </div>
    </header>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-slate-950">
        <SiteNav />
        <Routes>
          <Route path="/" element={<TrackerView />} />
          <Route path="/archive" element={<ArchiveHub />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}
