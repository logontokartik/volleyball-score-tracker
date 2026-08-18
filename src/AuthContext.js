import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { auth, db, signInWithGoogle, signOutUser } from './firebase';

const AuthContext = createContext(null);

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
      // Closing or blocking the popup is a normal thing to do, not a failure worth
      // shouting about.
      if (err?.code === 'auth/popup-closed-by-user' || err?.code === 'auth/cancelled-popup-request') {
        setError(null);
      } else if (err?.code === 'auth/popup-blocked') {
        setError('Your browser blocked the sign-in popup. Allow popups for this site and try again.');
      } else {
        setError('Sign-in failed. Please try again.');
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
