// src/waiver.js
//
// The participation waiver: its text, its versioning, and the rules for who may sign it.
//
// ## This is a template, not legal advice
//
// The wording below is a general-purpose assumption-of-risk and release agreement of the
// kind recreational sports organisers commonly use. It has NOT been reviewed by a lawyer,
// and nobody involved in writing it is one. Whether any of it is enforceable depends
// entirely on the jurisdiction:
//
//   * Many jurisdictions will not enforce a release of liability for ordinary negligence
//     at all, and none will enforce one for gross negligence, recklessness or wilful
//     misconduct — which is why the text below carves those out explicitly rather than
//     over-claiming and risking the whole clause being struck.
//   * **A parent's release signed on behalf of a minor is void or sharply limited in a
//     large number of US states.** The minor flow here collects the signature that a
//     court may or may not honour; it is not a substitute for the club's own insurance.
//
// Have a lawyer in the club's jurisdiction review this before relying on it. Treat it as
// a starting draft.
//
// ## Why the text is versioned and stored with each signature
//
// A waiver is only worth anything if you can show WHAT was agreed to, not merely that
// something was. Editing the wording below without bumping WAIVER_VERSION would silently
// re-attribute new language to old signatures. Each stored consent therefore keeps the
// version, a hash, and the full text exactly as it was displayed.

/**
 * Bump this whenever the wording changes — any change at all, including typos.
 *
 * Dated rather than numbered so a signature's version says when its wording was written
 * without a lookup table.
 */
export const WAIVER_VERSION = '2026-08-21';

/** Age of majority assumed by the form. Below this, a parent or guardian must sign. */
export const AGE_OF_MAJORITY = 18;

const CLUB = '{CLUB}';

/**
 * The agreement, as titled sections.
 *
 * Kept as data rather than a blob of JSX so the exact same source renders the page, feeds
 * the hash, and produces the plain-text copy stored with the signature. Three renderings
 * of one string cannot drift; three copies of the wording would.
 */
const SECTIONS = [
  {
    heading: 'Voluntary participation',
    body:
      `I am choosing to take part in volleyball activities organised, hosted or run by ${CLUB} ` +
      '— including practices, drills, warm-ups, scrimmages, matches, tournaments, and travel ' +
      'to and from the venue (together, the "Activities"). My participation is entirely voluntary.',
  },
  {
    heading: 'Assumption of risk',
    body:
      'I understand that volleyball is a strenuous, fast-moving physical activity that carries ' +
      'inherent risks which cannot be eliminated no matter how carefully it is run. Those risks ' +
      'include, but are not limited to: sprains, strains, and torn muscles, tendons or ligaments; ' +
      'broken bones and dislocated joints; concussion and other head, neck and spinal injuries; ' +
      'dental, facial and eye injuries; collisions with other participants, the floor, walls, ' +
      'poles, nets or equipment; slips, trips and falls; overexertion, dehydration and heat ' +
      'illness; cardiac events; exposure to communicable illness; loss of or damage to personal ' +
      'property; and, in the most serious cases, permanent disability, paralysis or death. ' +
      'I knowingly and freely assume all such risks, both known and unknown, and accept ' +
      'responsibility for my participation.',
  },
  {
    heading: 'Who is released',
    body:
      `"Released Parties" means ${CLUB} together with its organisers, directors, officers, ` +
      'employees, coaches, captains, referees, officials, scorekeepers, volunteers, members and ' +
      'sponsors, any affiliated league or association, and the owners, operators, lessees and ' +
      'staff of any facility or venue where the Activities take place.',
  },
  {
    heading: 'Release of liability',
    body:
      'To the fullest extent permitted by law, I release, waive and discharge the Released ' +
      'Parties from, and agree not to sue them over, any and all claims, demands, damages, ' +
      'losses, costs, expenses and causes of action of any kind arising out of or connected ' +
      'with my participation in the Activities, including those arising from the ordinary ' +
      'negligence of the Released Parties. ' +
      'This release does NOT apply to gross negligence, recklessness or wilful misconduct, ' +
      'nor to any liability which cannot lawfully be released; nothing here is intended to ' +
      'limit any right that applicable law does not permit to be waived.',
  },
  {
    heading: 'Indemnity',
    body:
      'I agree to indemnify and hold the Released Parties harmless from any loss, liability, ' +
      'damage, claim or cost, including reasonable legal fees, that they incur as a result of ' +
      'my participation in the Activities or my breach of this agreement, except to the extent ' +
      'it arises from their own gross negligence, recklessness or wilful misconduct.',
  },
  {
    heading: 'Fitness, medical treatment and insurance',
    body:
      'I confirm that I am physically fit to take part and know of no medical condition that ' +
      'would make my participation unsafe, and that I have been advised to consult a physician ' +
      'if in any doubt. If I am injured or become unwell, I authorise the Released Parties to ' +
      'arrange or administer first aid and emergency medical treatment, and I accept ' +
      'responsibility for the cost of any treatment or transport. ' +
      'I understand that no accident, health or medical insurance is provided to me for the ' +
      'Activities, and that arranging my own cover is my responsibility.',
  },
  {
    heading: 'Rules and conduct',
    body:
      'I agree to follow the rules of the game, the venue and the club, to behave respectfully ' +
      'toward other participants, officials and staff, and to accept the decisions of officials. ' +
      'I understand that I may be removed from the Activities for unsafe or unacceptable conduct.',
  },
  {
    heading: 'Personal property',
    body:
      'I understand that the Released Parties are not responsible for loss of or damage to my ' +
      'personal belongings at any venue or event.',
  },
  {
    heading: 'How this agreement is read',
    body:
      'If any part of this agreement is found to be unenforceable, the rest of it remains in ' +
      'full effect, and the unenforceable part is to be read as narrowly as necessary to make ' +
      'it valid. This agreement is governed by the law of the jurisdiction in which the ' +
      'Activities take place. I have read it in full, I understand that it affects my legal ' +
      'rights, and I am signing it freely.',
  },
];

/**
 * The section a parent or guardian is agreeing to on top of everything above.
 *
 * Shown only when the participant is under AGE_OF_MAJORITY, and stored as part of the
 * signed text so a minor's record is visibly a different document from an adult's.
 */
const MINOR_SECTION = {
  heading: 'Parent or legal guardian (participant under 18)',
  body:
    'I confirm that I am the parent or legal guardian of the participant named above and ' +
    'that I have the authority to sign on their behalf. I give permission for them to take ' +
    'part in the Activities. Having read this agreement in full, I accept its terms both on ' +
    'my own behalf and, to the fullest extent permitted by law, on behalf of the participant ' +
    'and our respective heirs and representatives, and I agree to the release and indemnity ' +
    'above in that capacity. I authorise the Released Parties to arrange or administer ' +
    'emergency medical treatment for the participant, and I accept responsibility for its cost.',
};

/**
 * The optional, separate permission to use photographs and video.
 *
 * Deliberately NOT part of the release, and deliberately not required: bundling a media
 * release into a liability waiver is what gets the whole thing characterised as a
 * take-it-or-leave-it consent that was never freely given. Declining it must not stop
 * anyone playing.
 */
export const MEDIA_CONSENT = {
  heading: 'Photos and video (optional)',
  body:
    'I give permission for photographs and video taken during the Activities that include ' +
    'the participant to be used by the club for scoreboards, results pages, social media and ' +
    'promotion, without payment. This permission is optional, may be withdrawn by writing to ' +
    'the club, and declining it does not affect participation in any way.',
};

/** The agreement for one club and one participant, as ordered sections. */
export function waiverSections(clubName, { minor = false } = {}) {
  const name = String(clubName || '').trim() || 'the club';
  const filled = SECTIONS.map((s) => ({ ...s, body: s.body.split(CLUB).join(name) }));
  return minor ? [...filled, MINOR_SECTION] : filled;
}

/**
 * The exact plain text that gets hashed and stored.
 *
 * Built from the same `waiverSections` the page renders, so what is stored is provably
 * what was displayed rather than a second transcription of it.
 */
export function waiverPlainText(clubName, options) {
  return waiverSections(clubName, options)
    .map((s) => `${s.heading}\n${s.body}`)
    .join('\n\n');
}

/**
 * SHA-256 of the signed text, hex.
 *
 * The full text is stored alongside it, so this is not how the wording is recovered — it
 * is how you show that a stored record has not been edited since it was signed.
 * Returns '' where WebCrypto is unavailable (an insecure origin); the signature is still
 * valid, it simply cannot carry this check.
 */
export async function hashWaiverText(text) {
  try {
    if (!globalThis.crypto?.subtle) return '';
    const bytes = new TextEncoder().encode(text);
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  } catch {
    return '';
  }
}

/**
 * An unguessable consent-link id — 192 bits from the platform CSPRNG.
 *
 * The link IS the authorisation: whoever holds it may sign that one consent without an
 * account, which is the only way this works for players who will never sign in. So it has
 * to be long enough that guessing is hopeless, and it must never be derived from the
 * player's name, id or anything else an outsider could reconstruct.
 */
export function newConsentToken() {
  const bytes = new Uint8Array(24);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Age in whole years on `on`, or null when the date is unusable. */
export function ageOn(dateOfBirth, on = new Date()) {
  const dob = new Date(`${String(dateOfBirth || '').trim()}T00:00:00`);
  if (Number.isNaN(dob.getTime())) return null;
  if (dob > on) return null;
  let age = on.getFullYear() - dob.getFullYear();
  const m = on.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && on.getDate() < dob.getDate())) age -= 1;
  return age;
}

/** True when a parent or guardian has to sign instead of the participant. */
export function isMinor(dateOfBirth, on = new Date()) {
  const age = ageOn(dateOfBirth, on);
  return age === null ? null : age < AGE_OF_MAJORITY;
}

/**
 * '' when the form may be submitted, otherwise what to tell the signer.
 *
 * The date of birth is required even for an obvious adult, because it is the only thing
 * that decides which of the two agreements they are actually signing — and "did a
 * guardian need to sign this one?" is the first question anyone will ask of the record.
 */
export function validateConsent(input, on = new Date()) {
  const signedName = String(input?.signedName || '').trim();
  const participantName = String(input?.participantName || '').trim();
  const dob = String(input?.dateOfBirth || '').trim();

  if (!dob) return 'Enter the participant’s date of birth.';
  const age = ageOn(dob, on);
  if (age === null) return 'That date of birth is not a valid past date.';
  if (age > 120) return 'Check the date of birth — that age is not plausible.';

  if (!signedName) return 'Type your full name to sign.';
  if (signedName.length > 120) return 'That name is too long.';
  if (!input?.agreed) return 'Tick the box to confirm you agree.';

  if (age < AGE_OF_MAJORITY) {
    if (!String(input?.guardianRelationship || '').trim()) {
      return 'Say how you are related to the participant.';
    }
    const email = String(input?.guardianEmail || '').trim();
    if (!email) return 'Enter a parent or guardian email address.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return 'That email address does not look right.';
    }
    // A guardian signing their own name is the common typo — and it is the one case
    // where the record would look like the minor signed for themselves.
    if (participantName && signedName.toLowerCase() === participantName.toLowerCase()) {
      return 'A participant under 18 cannot sign for themselves — enter the parent or guardian’s name.';
    }
  }
  return '';
}
