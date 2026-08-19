/**
 * Vercel Function: email someone the invite a club admin just created for them.
 *
 * ## Why this is not an open email relay
 *
 * An endpoint that takes an address and sends mail is a spam relay by default, and it
 * would be sending on this project's Resend account and domain reputation. Two things
 * stop that, and neither needs a service-account key:
 *
 * 1. **The caller proves they are a club admin by proxy.** The request carries the
 *    caller's Firebase ID token, and this function uses that token to read
 *    `clubs/{clubId}/invites/{email}` through the Firestore REST API. That document is
 *    readable only by admins of that club (`firestore.rules`), so a 200 means Firestore
 *    itself has already decided the caller is one. No JWT verification code here, no
 *    second copy of the permission logic that could drift from the rules.
 * 2. **The recipient comes from the document, never from the request.** Even a valid
 *    admin cannot point this at an arbitrary address — only at one they have already
 *    written an invite for, which is itself an admin-only write.
 *
 * The residual risk is re-sending an invite that genuinely exists, which the rate limit
 * bounds. RESEND_API_KEY is read server-side only and never reaches the browser.
 */

const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'volleyball-score-tracker';
/**
 * Sender address.
 *
 * Vercel's Resend integration provisions RESEND_API_KEY and RESEND_EMAIL_DOMAIN — a bare
 * verified domain, not a full address — so that is what gets used when present. Resend
 * rejects a `from` on an unverified domain outright, which is why this is derived rather
 * than hardcoded. RESEND_FROM overrides it when a specific mailbox or display name is
 * wanted.
 */
const RESEND_FROM =
  process.env.RESEND_FROM ||
  (process.env.RESEND_EMAIL_DOMAIN
    ? `VolleyScores <invites@${process.env.RESEND_EMAIL_DOMAIN.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '')}>`
    : 'VolleyScores <invites@volleyscores.app>');

/**
 * Where the invite link points. Deliberately configuration and NOT the request's Host
 * header: an attacker who can set Host would otherwise get us to send a real, expected
 * email containing a link to their own site.
 */
const APP_BASE_URL = (process.env.APP_BASE_URL || 'https://volleyscores.app').replace(/\/+$/, '');

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 20; // per IP per window
const CLUB_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
// Deliberately loose: this only guards URL construction. The address that actually gets
// mailed comes out of Firestore, not out of this check.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const rateLimiter = new Map();

function rateLimited(ip) {
  const now = Date.now();
  const hits = (rateLimiter.get(ip) || []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (hits.length >= RATE_LIMIT_MAX) return true;
  hits.push(now);
  rateLimiter.set(ip, hits);
  if (rateLimiter.size > 500) {
    for (const [key, times] of rateLimiter) {
      if (!times.some((t) => now - t < RATE_LIMIT_WINDOW_MS)) rateLimiter.delete(key);
    }
  }
  return false;
}

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const normalizeEmail = (value) => String(value ?? '').trim().toLowerCase();

const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const ROLE_COPY = {
  admin: {
    label: 'club admin',
    blurb:
      'As a club admin you can create and run tournaments, edit teams and the schedule, unlock completed games, and invite other people.',
  },
  scorer: {
    label: 'scorer',
    blurb:
      'As a scorer you can enter and adjust live scores, mark games complete, and record knockout results.',
  },
};

const firestoreDoc = (path) =>
  `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/${path}`;

function inviteEmailHtml({ clubName, roleLabel, blurb, url, inviterEmail }) {
  const club = escapeHtml(clubName);
  const role = escapeHtml(roleLabel);
  const from = inviterEmail ? escapeHtml(inviterEmail) : null;
  return `<!doctype html>
<html><body style="margin:0;padding:24px;background:#0f172a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;">
    <tr><td style="padding:28px 28px 8px;">
      <p style="margin:0 0 4px;font-size:20px;font-weight:800;color:#0f172a;">Volley<span style="color:#f59e0b;">Scores</span></p>
      <h1 style="margin:16px 0 8px;font-size:22px;line-height:1.3;color:#0f172a;">
        You have been invited to ${club}
      </h1>
      <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">
        ${from ? `${from} invited you` : 'You have been invited'} to join
        <strong>${club}</strong> on VolleyScores as a <strong>${role}</strong>.
      </p>
      <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#334155;">${escapeHtml(blurb)}</p>
      <p style="margin:0 0 24px;">
        <a href="${url}" style="display:inline-block;background:#f59e0b;color:#0f172a;font-weight:700;font-size:15px;text-decoration:none;padding:14px 24px;border-radius:12px;">
          Sign in and join ${club}
        </a>
      </p>
      <p style="margin:0 0 8px;font-size:13px;line-height:1.6;color:#64748b;">
        Sign in with Google using <strong>this email address</strong> — the invite is tied
        to it, and signing in with a different one will not pick it up.
      </p>
      <p style="margin:0 0 24px;font-size:13px;line-height:1.6;color:#64748b;">
        If you were not expecting this you can ignore it; nothing happens until you sign in.
      </p>
    </td></tr>
    <tr><td style="padding:16px 28px 24px;border-top:1px solid #e2e8f0;">
      <p style="margin:0;font-size:12px;color:#94a3b8;word-break:break-all;">${url}</p>
    </td></tr>
  </table>
</body></html>`;
}

export default {
  async fetch(request) {
    if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);

    if (!process.env.RESEND_API_KEY) {
      return json({ error: 'Invite email is not configured on this deployment.' }, 503);
    }

    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
      request.headers.get('x-real-ip') ||
      'unknown';
    if (rateLimited(ip)) {
      return json({ error: 'Too many invites in a row — give it a minute.' }, 429);
    }

    // The caller's Firebase ID token. Passed straight through to Firestore below; this
    // function never decodes or trusts it on its own.
    const authorization = request.headers.get('authorization') || '';
    if (!/^Bearer\s+\S+/i.test(authorization)) {
      return json({ error: 'Sign in again and retry.' }, 401);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Malformed request body.' }, 400);
    }

    const clubId = String(body.clubId ?? '').trim();
    const email = normalizeEmail(body.email);

    if (!CLUB_ID_RE.test(clubId)) return json({ error: 'Invalid club.' }, 400);
    if (!EMAIL_RE.test(email)) return json({ error: 'Invalid email address.' }, 400);

    // Reading the invite AS THE CALLER is the whole authorization step: firestore.rules
    // allows this document only to admins of this club, so a 200 proves both that the
    // caller is a club admin and that the invite exists.
    let inviteRes;
    try {
      inviteRes = await fetch(
        firestoreDoc(`clubs/${encodeURIComponent(clubId)}/invites/${encodeURIComponent(email)}`),
        { headers: { authorization } }
      );
    } catch (err) {
      console.error('[send-invite] invite lookup network error:', err);
      return json({ error: 'Could not reach the invite store.' }, 502);
    }

    if (inviteRes.status === 401 || inviteRes.status === 403) {
      return json({ error: 'Only a club admin can send this invite.' }, 403);
    }
    if (inviteRes.status === 404) {
      return json({ error: 'That invite no longer exists.' }, 404);
    }
    if (!inviteRes.ok) {
      console.error('[send-invite] invite lookup failed', inviteRes.status, await inviteRes.text());
      return json({ error: 'Could not read the invite.' }, 502);
    }

    const inviteDoc = await inviteRes.json();
    const role = inviteDoc.fields?.role?.stringValue || '';
    // The address actually mailed comes from the document, never from the request body.
    const recipient = normalizeEmail(inviteDoc.fields?.email?.stringValue) || email;
    const copy = ROLE_COPY[role];
    if (!copy) {
      console.error('[send-invite] unexpected role on invite:', role);
      return json({ error: 'That invite has an unrecognised role.' }, 422);
    }

    // Club name and slug are public, so this needs no credentials.
    let clubName = 'a club';
    let slug = '';
    try {
      const clubRes = await fetch(firestoreDoc(`clubs/${encodeURIComponent(clubId)}`));
      if (clubRes.ok) {
        const clubDoc = await clubRes.json();
        clubName = clubDoc.fields?.name?.stringValue || clubName;
        slug = clubDoc.fields?.slug?.stringValue || '';
      }
    } catch (err) {
      // A missing club name costs the email some polish; it is not worth failing over.
      console.error('[send-invite] club lookup failed:', err);
    }

    // The invite is claimed from the clubs list once signed in, so that is where the
    // link goes; the club page is included as context rather than as the destination.
    const url = `${APP_BASE_URL}/`;
    const inviterEmail = normalizeEmail(inviteDoc.fields?.invitedByEmail?.stringValue) || '';

    const startedAt = Date.now();
    let res;
    try {
      // Resend's REST API rather than the `resend` SDK: this is one HTTP POST, the other
      // functions in this directory already call their APIs with fetch, and it keeps the
      // dependency list unchanged.
      res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        },
        body: JSON.stringify({
          from: RESEND_FROM,
          to: [recipient],
          subject: `You have been invited to ${clubName} on VolleyScores`,
          html: inviteEmailHtml({
            clubName,
            roleLabel: copy.label,
            blurb: copy.blurb,
            url,
            inviterEmail,
          }),
          text:
            `${inviterEmail ? `${inviterEmail} invited you` : 'You have been invited'} to join ` +
            `${clubName} on VolleyScores as a ${copy.label}.\n\n${copy.blurb}\n\n` +
            `Sign in and join: ${url}\n\n` +
            `Sign in with Google using this email address — the invite is tied to it.\n` +
            `If you were not expecting this you can ignore it; nothing happens until you sign in.`,
        }),
      });
    } catch (err) {
      console.error('[send-invite] resend network error:', err);
      return json({ error: 'Could not reach the email service.' }, 502);
    }

    if (!res.ok) {
      const detail = await res.text();
      console.error('[send-invite] resend error', res.status, detail);
      return json(
        {
          error:
            res.status === 429
              ? 'The email service is rate limited right now — try again shortly.'
              : 'The invite was saved, but the email could not be sent.',
        },
        502
      );
    }

    const sent = await res.json().catch(() => ({}));
    console.log(
      `[send-invite] club=${clubId} slug=${slug} role=${role} id=${sent?.id || '?'} ` +
        `took ${Date.now() - startedAt}ms`
    );
    return json({ ok: true, id: sent?.id || null });
  },
};
