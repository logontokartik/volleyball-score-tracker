// Community player profiles — global, Auth-uid keyed, distinct from club `players`.
//
// Club players are admin-created roster rows under `clubs/{id}/players`. A community
// profile is something a signed-in person owns and can make public for pickup discovery.

import { POSITIONS } from './playerUtils';

export { POSITIONS };

export const NE_STATES = [
  { code: 'CT', name: 'Connecticut' },
  { code: 'MA', name: 'Massachusetts' },
  { code: 'ME', name: 'Maine' },
  { code: 'NH', name: 'New Hampshire' },
  { code: 'RI', name: 'Rhode Island' },
  { code: 'VT', name: 'Vermont' },
];

export const NE_STATE_CODES = NE_STATES.map((s) => s.code);

export const SKILL_LEVELS = [
  { id: 'beginner', label: 'Beginner' },
  { id: 'intermediate', label: 'Intermediate' },
  { id: 'advanced', label: 'Advanced' },
  { id: 'open', label: 'Open / all levels' },
];

export const SKILL_LEVEL_IDS = SKILL_LEVELS.map((s) => s.id);

const text = (value) => String(value ?? '').trim();

export function stateLabel(code) {
  return NE_STATES.find((s) => s.code === code)?.name || code || '';
}

export function skillLabel(id) {
  return SKILL_LEVELS.find((s) => s.id === id)?.label || id || '';
}

export function initialsFromName(name) {
  const parts = text(name).split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

/**
 * Shape written to `profiles/{uid}`. Email never belongs here — it stays on `users/{uid}`.
 */
export function normalizeProfileInput(input, { photoURL } = {}) {
  const displayName = text(input?.displayName);
  const positions = Array.isArray(input?.positions)
    ? input.positions.filter((p) => POSITIONS.includes(p))
    : [];
  const skillLevel = SKILL_LEVEL_IDS.includes(input?.skillLevel) ? input.skillLevel : '';
  const state = NE_STATE_CODES.includes(input?.state) ? input.state : '';
  const city = text(input?.city);
  const bio = text(input?.bio).slice(0, 400);
  const availability = text(input?.availability).slice(0, 200);

  return {
    displayName,
    displayNameLower: displayName.toLowerCase(),
    photoURL: photoURL === undefined ? input?.photoURL || null : photoURL || null,
    bio,
    positions,
    skillLevel,
    city,
    state,
    availability,
    lookingForPickup: Boolean(input?.lookingForPickup),
    isPublic: input?.isPublic !== false,
  };
}

/** '' when fine, otherwise the message to show. */
export function validateProfileInput(input) {
  const name = text(input?.displayName);
  if (!name) return 'Add a display name.';
  if (name.length < 2) return 'Display name is too short.';
  if (input?.state && !NE_STATE_CODES.includes(input.state)) {
    return 'Pick a New England state.';
  }
  if (input?.skillLevel && !SKILL_LEVEL_IDS.includes(input.skillLevel)) {
    return 'Pick a skill level.';
  }
  return '';
}

export function profileNeedsOnboarding(profile) {
  if (!profile) return true;
  return !text(profile.displayName) || !profile.state;
}

export function profileSearchPrefix(query) {
  return text(query).toLowerCase();
}
