import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import { db } from './firebase';
import { useAuth } from './AuthContext';
import {
  normalizeProfileInput,
  profileNeedsOnboarding,
  validateProfileInput,
} from './profileUtils';

const ProfileContext = createContext(null);

const SKIP_KEY = 'vs.profileOnboardingSkip';

function skipKeyFor(uid) {
  return `${SKIP_KEY}.${uid}`;
}

export function ProfileProvider({ children }) {
  const { user } = useAuth();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [exists, setExists] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [saveError, setSaveError] = useState('');

  useEffect(() => {
    if (!user?.uid) {
      setProfile(null);
      setExists(false);
      setLoading(false);
      setShowOnboarding(false);
      return undefined;
    }

    setLoading(true);
    const ref = doc(db, 'profiles', user.uid);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        if (snap.exists()) {
          const data = { id: snap.id, ...snap.data() };
          setProfile(data);
          setExists(true);
          const skipped =
            typeof sessionStorage !== 'undefined' &&
            sessionStorage.getItem(skipKeyFor(user.uid)) === '1';
          setShowOnboarding(!skipped && profileNeedsOnboarding(data));
        } else {
          setProfile(null);
          setExists(false);
          const skipped =
            typeof sessionStorage !== 'undefined' &&
            sessionStorage.getItem(skipKeyFor(user.uid)) === '1';
          setShowOnboarding(!skipped);
        }
        setLoading(false);
      },
      (err) => {
        console.error('profiles/ subscription failed:', err);
        setLoading(false);
      }
    );
    return unsub;
  }, [user?.uid]);

  const skipOnboarding = useCallback(() => {
    if (user?.uid && typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(skipKeyFor(user.uid), '1');
    }
    setShowOnboarding(false);
  }, [user?.uid]);

  const openOnboarding = useCallback(() => {
    setShowOnboarding(true);
  }, []);

  const saveProfile = useCallback(
    async (input) => {
      if (!user?.uid) throw new Error('Sign in to save your profile.');
      setSaveError('');
      const normalized = normalizeProfileInput(input, {
        photoURL: input?.photoURL !== undefined ? input.photoURL : user.photoURL || null,
      });
      const err = validateProfileInput(normalized);
      if (err) {
        setSaveError(err);
        throw new Error(err);
      }

      const ref = doc(db, 'profiles', user.uid);
      const prev = await getDoc(ref);
      const payload = {
        ...normalized,
        updatedAt: serverTimestamp(),
      };
      if (!prev.exists()) {
        payload.createdAt = serverTimestamp();
      }

      await setDoc(ref, payload, { merge: true });
      setShowOnboarding(false);
      if (user?.uid && typeof sessionStorage !== 'undefined') {
        sessionStorage.removeItem(skipKeyFor(user.uid));
      }
      return payload;
    },
    [user]
  );

  const value = useMemo(
    () => ({
      profile,
      loading,
      exists,
      showOnboarding,
      skipOnboarding,
      openOnboarding,
      saveProfile,
      saveError,
      needsOnboarding: profileNeedsOnboarding(profile) || !exists,
    }),
    [
      profile,
      loading,
      exists,
      showOnboarding,
      skipOnboarding,
      openOnboarding,
      saveProfile,
      saveError,
    ]
  );

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

export function useProfile() {
  const ctx = useContext(ProfileContext);
  if (!ctx) throw new Error('useProfile must be used inside <ProfileProvider>');
  return ctx;
}
