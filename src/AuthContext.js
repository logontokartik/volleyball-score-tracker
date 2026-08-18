import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { auth, db, signInWithGoogle, signOutUser } from './firebase';

const AuthContext = createContext(null);

/**
 * Sign-in failures worth naming. The three configuration ones are the whole reason this
 * map exists: they look identical to a transient error in the UI, but retrying can never
 * fix them — each needs a change in the Firebase console.
 */
const SIGN_IN_ERRORS = {
  'auth/popup-blocked':
    'Your browser blocked the sign-in popup. Allow popups for this site and try again.',
  'auth/unauthorized-domain':
    'This site\u2019s domain is not authorised for sign-in. Add it under Firebase Console \u2192 Authentication \u2192 Settings \u2192 Authorized domains.',
  'auth/operation-not-allowed':
    'Google sign-in is not enabled for this Firebase project. Enable it under Authentication \u2192 Sign-in method.',
  'auth/configuration-not-found':
    'Google sign-in is not configured for this Firebase project. Enable it under Authentication \u2192 Sign-in method.',
  'auth/network-request-failed':
    'Could not reach Google. Check your connection and try again.',
  'auth/internal-error': 'Google sign-in returned an internal error. Try again.',
};

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  // `loading` is true until Firebase has replied once. Without it every page would
  // paint a "Sign in" prompt on load and then flip to the signed-in badge a moment
  // later — consumers need to tell "signed out" apart from "not known yet".
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    // The single auth subscription for the whole app.
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
      if (u) touchUserProfile(u);
    });
    return unsub;
  }, []);

  const signIn = useCallback(async () => {
    setError(null);
    try {
      await signInWithGoogle();
    } catch (err) {
      // Every branch below keeps err.code, because the generic "try again" wording is
      // useless for the failures that are actually configuration: they will never come
      // right by retrying, and without the code there is nothing to search for.
      const code = err?.code || 'unknown';
      console.error('[auth] sign-in failed:', code, err);

      // Closing or blocking the popup is a normal thing to do, not a failure worth
      // shouting about.
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        setError(null);
      } else {
        setError(`${SIGN_IN_ERRORS[code] || 'Sign-in failed.'} (${code})`);
      }
    }
  }, []);

  const signOut = useCallback(async () => {
    setError(null);
    try {
      await signOutUser();
    } catch {
      // Signing out is a network call and can fail offline. Say so, rather than
      // leaving the badge up with no explanation for why nothing happened.
      setError('Could not sign out. Check your connection and try again.');
    }
  }, []);

  const value = useMemo(
    () => ({ user, loading, signIn, signOut, error }),
    [user, loading, signIn, signOut, error]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * Record who signed in and when. This is best-effort: there are no Firestore rules
 * for `users/` yet, so this write is rejected today and must never block sign-in.
 */
function touchUserProfile(u) {
  setDoc(
    doc(db, 'users', u.uid),
    {
      email: u.email || null,
      displayName: u.displayName || null,
      photoURL: u.photoURL || null,
      lastSeenAt: serverTimestamp(),
    },
    { merge: true }
  ).catch((err) => console.error('users/ profile write failed (expected until rules land):', err));
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
