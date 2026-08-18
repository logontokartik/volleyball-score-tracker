// src/ClubContext.js
//
// Which club the current page is about, and what the signed-in account may do in it.
//
// Everything below the club routes reads this instead of resolving the slug itself —
// one slug lookup and one club subscription per visit, not one per component.
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { getDoc, onSnapshot } from 'firebase/firestore';
import { clubDoc, memberDoc, slugDoc } from './clubPaths';
import { useAuth } from './AuthContext';
import { isSuperAdmin } from './roles';

const ClubContext = createContext(null);

// The four outcomes of resolving a slug are deliberately distinct. Collapsing
// 'loading' into 'notFound' is what makes a 404 flash on every page load.
const LOADING = 'loading';
const READY = 'ready';
const NOT_FOUND = 'notFound'; // no slugs/{slug}, or it points at a club that is gone
const ERROR = 'error'; // network or permission failure — retrying may work

export function ClubProvider({ slug, children }) {
  const { user } = useAuth();

  // One state object rather than four useStates: clubId and club must never be
  // observed out of step with the status a consumer is branching on.
  const [resolved, setResolved] = useState({ status: LOADING, clubId: null, club: null });
  const [membership, setMembership] = useState({ loading: true, role: null });

  useEffect(() => {
    let cancelled = false;
    let unsubClub = null;

    // Reset synchronously so a slug change never paints the previous club's name or
    // scoreboard while the new one resolves.
    setResolved({ status: LOADING, clubId: null, club: null });

    getDoc(slugDoc(slug))
      .then((snap) => {
        if (cancelled) return;
        const clubId = snap.exists() ? snap.data()?.clubId : null;
        if (!clubId) {
          setResolved({ status: NOT_FOUND, clubId: null, club: null });
          return;
        }
        // Live, not a one-shot read: activeTournamentId lives on the club doc and an
        // admin switching tournaments has to reach every scoreboard already open.
        unsubClub = onSnapshot(
          clubDoc(clubId),
          (clubSnap) => {
            if (cancelled) return;
            if (!clubSnap.exists()) {
              // The slug survived a deleted club. Same dead end for the visitor.
              setResolved({ status: NOT_FOUND, clubId, club: null });
              return;
            }
            setResolved({ status: READY, clubId, club: { id: clubId, ...clubSnap.data() } });
          },
          () => {
            if (cancelled) return;
            setResolved({ status: ERROR, clubId, club: null });
          }
        );
      })
      .catch(() => {
        if (cancelled) return;
        setResolved({ status: ERROR, clubId: null, club: null });
      });

    // Cleanup runs before the next effect, so a rapid slug change cannot leave the old
    // club subscribed. `cancelled` covers the gap where the slug read is still in
    // flight — without it the late .then() would attach a listener nothing unsubscribes.
    return () => {
      cancelled = true;
      if (unsubClub) unsubClub();
    };
  }, [slug]);

  const clubId = resolved.clubId;
  const uid = user?.uid || null;

  useEffect(() => {
    if (!clubId || !uid) {
      setMembership({ loading: false, role: null });
      return undefined;
    }
    setMembership({ loading: true, role: null });
    // Live too: an admin promoting a scorer mid-tournament should not require a reload.
    const unsub = onSnapshot(
      memberDoc(clubId, uid),
      (snap) => setMembership({ loading: false, role: snap.exists() ? snap.data()?.role ?? null : null }),
      // Non-members are denied this read by the rules; that is a "not a member",
      // not an error worth surfacing.
      () => setMembership({ loading: false, role: null })
    );
    return unsub;
  }, [clubId, uid]);

  const value = useMemo(() => {
    const superAdmin = isSuperAdmin(user);
    // A super admin administers every club without a member document, matching
    // isSuper() in firestore.rules.
    const role = superAdmin ? 'admin' : membership.role;
    return {
      slug,
      clubId,
      club: resolved.club,
      loading: resolved.status === LOADING || membership.loading,
      notFound: resolved.status === NOT_FOUND,
      error: resolved.status === ERROR,
      role,
      isClubAdmin: role === 'admin',
      isSuperAdmin: superAdmin,
      canScore: role === 'admin' || role === 'scorer',
    };
  }, [slug, clubId, resolved.club, resolved.status, membership.loading, membership.role, user]);

  return <ClubContext.Provider value={value}>{children}</ClubContext.Provider>;
}

export function useClub() {
  const ctx = useContext(ClubContext);
  if (!ctx) throw new Error('useClub must be used inside <ClubProvider>');
  return ctx;
}

/**
 * For chrome that renders both inside and outside a club — the site nav, mainly —
 * where "no club in scope" is a normal state rather than a bug.
 */
export function useClubOptional() {
  return useContext(ClubContext);
}
