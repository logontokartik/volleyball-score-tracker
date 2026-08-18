/**
 * Who may do what.
 *
 * Two kinds of signed-in account:
 *   admin  — everything: create/delete tournaments, edit teams and schedules, unlock games
 *   scorer — enter scores and mark games complete, and nothing else
 *
 * Membership comes from REACT_APP_ADMIN_EMAILS, a comma-separated list of admin
 * addresses. Anyone who signs in and is not on that list is a scorer.
 *
 * This module is a UI gate ONLY. Every REACT_APP_* value is compiled into the public
 * JS bundle, so this list is readable by any visitor — it is configuration, not a
 * secret, and must never hold anything that is. What actually stops a scorer writing
 * a schedule is the matching list in firestore.rules; keep the two in sync.
 */

const RAW = process.env.REACT_APP_ADMIN_EMAILS || '';

const normalize = (email) => String(email ?? '').trim().toLowerCase();

export const ADMIN_EMAILS = RAW.split(',').map(normalize).filter(Boolean);

/**
 * With no list configured, every signed-in account is an admin — which is exactly how
 * the app behaved before roles existed. A deploy that has not set the variable yet
 * therefore changes nothing, rather than locking the club out of Admin.
 */
export const ADMIN_LIST_CONFIGURED = ADMIN_EMAILS.length > 0;

export function isAdmin(user) {
  if (!user) return false;
  if (!ADMIN_LIST_CONFIGURED) return true;
  return ADMIN_EMAILS.includes(normalize(user.email));
}

/** Scoring is open to every signed-in account, admin or not. */
export function canScore(user) {
  return Boolean(user);
}

/** Short label for the signed-in badge, or null when signed out. */
export function roleLabel(user) {
  if (!user) return null;
  return isAdmin(user) ? 'Admin' : 'Scorer';
}

/* --------------------------------------------------------------------------
 * Super admins (multi-tenant)
 *
 * A super admin is an operator of the whole installation: they administer every
 * club without holding a member document in any of them, and they alone reach
 * /super to create clubs.
 *
 * Same caveat as the list above, and it matters more here: REACT_APP_* values are
 * compiled into the public bundle, so this list is a UI gate only — it decides what
 * the nav and the pages offer, never what Firestore accepts. The enforced copy is
 * `superAdmins()` in firestore.rules (currently ['logontokartik@gmail.com']).
 * Changing one without the other either hides a working page or shows a page whose
 * every write is rejected, so keep the two in sync.
 * ------------------------------------------------------------------------ */

const RAW_SUPER = process.env.REACT_APP_SUPER_ADMIN_EMAILS || '';

export const SUPER_ADMIN_EMAILS = RAW_SUPER.split(',').map(normalize).filter(Boolean);

/**
 * Unlike ADMIN_EMAILS there is no "empty list means everyone" fallback: an
 * unconfigured deploy must not hand every visitor club-creation rights, and the rules
 * would reject them anyway.
 */
export function isSuperAdmin(user) {
  if (!user?.email) return false;
  return SUPER_ADMIN_EMAILS.includes(normalize(user.email));
}
