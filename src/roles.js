/**
 * Who may do what, at the installation level.
 *
 * The admin/scorer split is NOT here: it is club-scoped and comes from
 * `clubs/{clubId}/members/{uid}`, read by `ClubContext`. The env-var admin list this
 * module used to carry was the pre-multi-tenant model and is gone — with it removed
 * there is exactly one answer to "is this account an admin", and it is per club.
 */

const normalize = (email) => String(email ?? '').trim().toLowerCase();

/* --------------------------------------------------------------------------
 * Super admins (multi-tenant)
 *
 * A super admin is an operator of the whole installation: they administer every
 * club without holding a member document in any of them, and they alone reach
 * /super, which lists every club and runs the legacy migration. (Clubs themselves
 * are created from /clubs by any signed-in account, not there.)
 *
 * REACT_APP_* values are compiled into the public JS bundle, so this list is readable
 * by any visitor: it is configuration, not a secret, and is a UI gate only — it decides what
 * the nav and the pages offer, never what Firestore accepts. The enforced copy is
 * `superAdmins()` in firestore.rules (currently ['logontokartik@gmail.com']).
 * Changing one without the other either hides a working page or shows a page whose
 * every write is rejected, so keep the two in sync.
 * ------------------------------------------------------------------------ */

const RAW_SUPER = process.env.REACT_APP_SUPER_ADMIN_EMAILS || '';

export const SUPER_ADMIN_EMAILS = RAW_SUPER.split(',').map(normalize).filter(Boolean);

/**
 * There is deliberately no "empty list means everyone" fallback: an unconfigured deploy
 * must not hand every visitor operator rights over every club, and the rules would
 * reject them anyway.
 */
export function isSuperAdmin(user) {
  if (!user?.email) return false;
  return SUPER_ADMIN_EMAILS.includes(normalize(user.email));
}
