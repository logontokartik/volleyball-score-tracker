import React from 'react';
import { BrowserRouter, Routes, Route, NavLink, Navigate, Outlet, useParams } from 'react-router-dom';
import TrackerView from './TrackerView';
import ArchiveHub from './ArchiveHub';
import CompletedTournamentsView from './CompletedTournamentsView';
import AdminPage from './AdminPage';
import Login from './Login';
import ClubsPage from './ClubsPage';
import SuperAdminPage from './SuperAdminPage';
import { AuthProvider, useAuth } from './AuthContext';
import { ClubProvider, useClub, useClubOptional } from './ClubContext';
import { isSuperAdmin } from './roles';

/**
 * The club that the bare paths belong to. Before clubs existed this app served one
 * league from `/completed` and `/archive`, and those links are in players' phones and
 * group chats — they redirect here rather than 404. `/` is now the club directory, so
 * a shared bare link lands on the list rather than on this club.
 */
const DEFAULT_CLUB_SLUG = process.env.REACT_APP_DEFAULT_CLUB_SLUG || 'gvbl';

const navLinkClass = ({ isActive }) =>
  `px-4 py-2.5 rounded-xl text-sm font-semibold min-h-[44px] flex items-center transition-colors ${
    isActive ? 'bg-amber-500 text-slate-900 shadow' : 'bg-white/10 text-white hover:bg-white/20'
  }`;

function SiteNav() {
  const { user } = useAuth();
  // Null outside the club routes — the directory, /super and the 404 render the same
  // header but have no club in scope.
  const club = useClubOptional();
  const slug = club?.slug;
  // Only clubs with a spreadsheet attached have an archive to show. Without this the
  // tab leads every other club to an empty page for a feature they do not have.
  const hasArchive = Boolean(club?.club?.archiveSheetId);

  return (
    <header className="sticky top-0 z-50 border-b border-slate-700/80 bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 text-white shadow-lg">
      <div className="max-w-6xl mx-auto px-3 sm:px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-lg sm:text-xl font-black tracking-tight truncate">
            {/* Inside a club the club's own name is the title. The name arrives a beat
                after the slug does, so the slug stands in and the header does not jump. */}
            {slug ? (
              club?.club?.name || slug
            ) : (
              <>
                Volleyball <span className="text-amber-400 font-semibold">Clubs</span>
              </>
            )}
          </span>
        </div>
        <nav className="flex flex-wrap items-center gap-2" aria-label="Main">
          {/* The way back out of a club, and the whole nav when there is no club in
              scope. Public, so a signed-out visitor can browse to one. */}
          <NavLink to="/" end className={navLinkClass}>
            Clubs
          </NavLink>
          {/* Tabs are club-scoped, so outside a club they would be links to whichever
              club happened to be last — no club, no tabs. */}
          {slug && (
            <>
              <NavLink to={`/c/${slug}`} end className={navLinkClass}>
                Live score tracker
              </NavLink>
              <NavLink to={`/c/${slug}/completed`} className={navLinkClass}>
                Completed
              </NavLink>
              {hasArchive && (
                <NavLink to={`/c/${slug}/archive`} className={navLinkClass}>
                  Tournament archive
                </NavLink>
              )}
            </>
          )}
          {isSuperAdmin(user) && (
            <NavLink to="/super" className={navLinkClass}>
              Super admin
            </NavLink>
          )}
        </nav>
        {/* Sign-in lives in the nav so it is reachable from every page, not just the
            tracker. On a phone it wraps onto its own full-width row. */}
        <div className="w-full sm:w-auto flex justify-start sm:justify-end">
          <Login />
        </div>
      </div>
    </header>
  );
}

/** Shared shell for the full-page states below, so they match the dark app chrome. */
function PageMessage({ title, children }) {
  return (
    <div className="max-w-6xl mx-auto px-4 py-16 text-center text-slate-300">
      <h1 className="text-2xl font-black text-white">{title}</h1>
      {children && <div className="mt-3 text-sm">{children}</div>}
    </div>
  );
}

/**
 * Layout route for everything under /c/:slug. Being a layout route is the point: the
 * provider — and with it the slug lookup and the club subscription — survives moving
 * between a club's tabs, instead of remounting and re-reading on every click.
 */
function ClubLayout() {
  const { slug } = useParams();
  return (
    <ClubProvider slug={slug}>
      <SiteNav />
      <ClubGate />
    </ClubProvider>
  );
}

function ClubGate() {
  const { loading, notFound, error, slug } = useClub();
  if (loading) return <PageMessage title="Loading club…" />;
  if (notFound) {
    return (
      <PageMessage title="No such club">
        Nothing is set up at <span className="font-mono text-amber-300">/c/{slug}</span>. Check the
        link, or pick a club from the Clubs list.
      </PageMessage>
    );
  }
  if (error) {
    return (
      <PageMessage title="Could not load this club">
        Check your connection and reload.
      </PageMessage>
    );
  }
  return <Outlet />;
}

/**
 * Club admin, gated on being an admin of THIS club. The account menu only shows the link
 * to admins, but a hidden menu item is not a gate and `/c/{slug}/admin` is guessable. This
 * check is UI only — firestore.rules is the real boundary, and it rejects every admin
 * write behind this page no matter what React decides to render.
 */
function ClubAdminRoute() {
  const { isClubAdmin, slug } = useClub();
  if (!isClubAdmin) {
    return (
      <PageMessage title="Admin is not available">
        Your account is not an admin of{' '}
        <span className="font-mono text-amber-300">/c/{slug}</span>. Ask a club admin for access.
      </PageMessage>
    );
  }
  // AdminPage was built to sit inside the tracker's light surface; the app shell behind
  // the routes is dark, so the page brings its own background now that it stands alone.
  return (
    <div className="min-h-screen bg-gray-50/80 p-3 sm:p-4">
      <AdminPage />
    </div>
  );
}

/** Layout for the pages that exist outside any club. */
function PlainLayout() {
  return (
    <>
      <SiteNav />
      <Outlet />
    </>
  );
}

function NotFoundPage() {
  return <PageMessage title="Page not found">That address does not exist.</PageMessage>;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <div className="min-h-screen bg-slate-950">
          <Routes>
            {/* Legacy single-club paths. Outside any layout so no header paints for
                the instant before the redirect lands. `/` is no longer among them: the
                landing page is the club directory, so a visitor who does not already
                know a club can find one. */}
            <Route
              path="/completed"
              element={<Navigate to={`/c/${DEFAULT_CLUB_SLUG}/completed`} replace />}
            />
            <Route
              path="/archive"
              element={<Navigate to={`/c/${DEFAULT_CLUB_SLUG}/archive`} replace />}
            />
            {/* /clubs was the members-only page before the directory absorbed it. */}
            <Route path="/clubs" element={<Navigate to="/" replace />} />

            <Route path="/c/:slug" element={<ClubLayout />}>
              <Route index element={<TrackerView />} />
              <Route path="completed" element={<CompletedTournamentsView />} />
              <Route path="archive" element={<ArchiveHub />} />
              <Route path="admin" element={<ClubAdminRoute />} />
            </Route>

            <Route element={<PlainLayout />}>
              {/* The directory is public — the club documents it lists are world-readable,
                  the same permission that makes a scoreboard shareable. */}
              <Route path="/" element={<ClubsPage />} />
              {/* SuperAdminPage gates itself on the signed-in account: SiteNav hides its
                  link, but a hidden link is not a gate and the URL is guessable. That is
                  not security either — firestore.rules is, and it rejects the reads and
                  writes behind the page no matter what React decides to render. */}
              <Route path="/super" element={<SuperAdminPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Routes>
        </div>
      </BrowserRouter>
    </AuthProvider>
  );
}
