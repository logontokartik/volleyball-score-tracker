import React from 'react';
import { useAuth } from '../AuthContext';
import { useProfile } from '../ProfileContext';
import ProfileForm from './ProfileForm';
import { sectionLabel } from '../communityUi';

/**
 * First-run prompt after Google sign-in. Skippable for the session; posting a pickup
 * or RSVPing will nudge them back via needsOnboarding.
 */
export default function OnboardingModal() {
  const { user } = useAuth();
  const { showOnboarding, skipOnboarding, saveProfile, profile } = useProfile();

  if (!user || !showOnboarding) return null;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboard-title"
    >
      <button
        type="button"
        className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm"
        aria-label="Dismiss"
        onClick={skipOnboarding}
      />
      <div className="relative w-full sm:max-w-lg max-h-[92vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl border border-slate-700/80 bg-slate-900 shadow-2xl shadow-black/50 animate-scale-in p-5 sm:p-7">
        <p className={sectionLabel}>New England volleyball</p>
        <h2 id="onboard-title" className="font-display mt-2 text-2xl font-bold text-white">
          Set up your player card
        </h2>
        <p className="mt-2 text-sm text-slate-300 leading-relaxed">
          Make yourself findable for drop-ins across CT, MA, ME, NH, RI, and VT. You can
          edit this anytime from My profile.
        </p>
        <div className="mt-6">
          <ProfileForm
            initial={{
              displayName: profile?.displayName || user.displayName || '',
              city: profile?.city || '',
              state: profile?.state || '',
              skillLevel: profile?.skillLevel || '',
              positions: profile?.positions || [],
              lookingForPickup: profile?.lookingForPickup !== false,
              isPublic: profile?.isPublic !== false,
            }}
            photoURL={user.photoURL}
            compact
            submitLabel="Save & continue"
            onSave={saveProfile}
            onCancel={skipOnboarding}
          />
        </div>
      </div>
    </div>
  );
}
