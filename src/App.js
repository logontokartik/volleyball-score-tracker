import React from 'react';
import { BrowserRouter, Routes, Route, NavLink, Navigate, Outlet, useParams } from 'react-router-dom';
import TrackerView from './TrackerView';
import ArchiveHub from './ArchiveHub';
import CompletedTournamentsView from './CompletedTournamentsView';
import AdminPage from './AdminPage';
import Login from './Login';
import ClubsPage from './ClubsPage';
import SuperAdminPage from './SuperAdminPage';
import { AuthProvider } from './AuthContext';
import { ClubProvider, useClub, useClubOptional } from './ClubContext';
import ClubSectionNav from './components/ClubSectionNav';

/**
 * The club that the bare paths belong to. Before clubs existed this app served one
 * league from `/completed` and `/archive`, and those links are in players' phones and
 * group chats — they redirect here rather than 404. `/` is now the club directory, so
 * a shared bare link lands on the list rather than on this club.
 */
const DEFAULT_CLUB_SLUG = process.env.REACT_APP_DEFAULT_CLUB_SLUG || 'gvbl';

/**
 * One compact row on every viewport: back affordance, club name, account.
 *
 * The three club sections are NOT here on a phone — they are the bottom tab bar, which
 * is where a thumb is while the other hand is holding a whistle. From `sm:` up they come
 * back into this row as text links.
 */
function SiteNav() {
  // Null outside the club routes — the directory, /super and the 404 render the same
  // header but have no club in scope.
  const club = useClubOptional();
  const slug = club?.slug;

  return (
    <header
      // Height comes from the shared custom property rather than a literal, because the
      // tracker's sub-tab row pins itself directly below this header and the two numbers
      // must be the same one. See SITE_HEADER_H in App().
      className="sticky top-0 z-50 h-[var(--site-header-h)] border-b border-slate-700/80 bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 text-white shadow-lg"
    >
      <div className="max-w-6xl mx-auto h-full px-3 sm:px-4 flex items-center gap-3">
        {/* The way back out of a club. `/` is the directory now, so this replaces the
            old "Clubs" nav item rather than sitting alongside it. */}
        {slug && (
          <NavLink
            to="/"
            end
            className="shrink-0 min-h-[44px] flex items-center gap-1 -ml-1 px-1 text-sm font-medium text-slate-300 hover:text-white transition-colors"
          >
            <span aria-hidden="true" className="text-lg leading-none">
              ‹
            </span>
            All clubs
          </NavLink>
        )}
        <span className="flex-1 min-w-0 leading-tight">
          {/* Inside a club the club's own name is the title. The name arrives a beat
              after the slug does, so the slug stands in and the header does not jump. */}
          {slug ? (
            <span className="block text-base sm:text-xl font-black tracking-tight truncate">
              {club?.club?.name || slug}
            </span>
          ) : (
            <>
              <span className="block text-base sm:text-xl font-black tracking-tight truncate">
                Volley<span className="text-amber-400">Scores</span>
              </span>
              {/* The tagline is hidden on a phone on purpose: this header is a fixed
                  56px (--site-header-h) that the sub-tabs pin beneath, and a second line
                  at 390px would overflow it. ClubsPage carries the same line where it
                  has room, so a phone visitor still sees it. */}
              <span className="hidden sm:block text-xs font-medium text-slate-300 truncate">
                Your one stop shop to manage clubs, schedule, scores
              </span>
            </>
          )}
        </span>
        <ClubSectionNav variant="header" />
        {/* Reachable from every page, not just the tracker. Collapsed to an avatar so it
            cannot push this row to a second line on a 390px phone. */}
        <Login />
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
      {/* TrackerView, CompletedTournamentsView and ArchiveHub each bring their own page
          wrapper, so the room for the fixed bottom bar is reserved here, once, for all of
          them — otherwise the last score tile sits under the bar and cannot be tapped.
          The reserved strip is exactly the bar's own height, so at full scroll the bar
          covers it and the dark shell never shows through. */}
      <div className="pb-[calc(4rem+env(safe-area-inset-bottom))] sm:pb-0">
        <ClubGate />
      </div>
      <ClubSectionNav variant="bottom" />
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

/**
 * The site header's height, in one place.
 *
 * TrackerView pins its sub-tab row directly below the header. That offset used to be a
 * literal `top-16` in another file, which is only correct as long as nobody touches the
 * header — and the header just changed. Declaring it as a custom property on the shell
 * means both the header (`h-[var(--site-header-h)]`) and the sub-tabs
 * (`top-[var(--site-header-h)]`) read the same number, and it inherits to every route.
 */
const SITE_HEADER_H = '56px';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <div className="min-h-screen bg-slate-950" style={{ '--site-header-h': SITE_HEADER_H }}>
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
