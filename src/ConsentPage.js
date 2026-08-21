import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { getDoc, serverTimestamp, writeBatch } from 'firebase/firestore';
import { db } from './firebase';
import { useClub } from './ClubContext';
import { consentDoc, consentRequestDoc } from './clubPaths';
import {
  AGE_OF_MAJORITY,
  MEDIA_CONSENT,
  WAIVER_VERSION,
  hashWaiverText,
  isMinor,
  validateConsent,
  waiverPlainText,
  waiverSections,
} from './waiver';

/**
 * The page a player (or their parent) opens from the link an admin sent them.
 *
 * Public and unauthenticated by design: almost no player has an account and none should
 * need one to sign a waiver. The link's token is the authorisation — see firestore.rules.
 *
 * The whole agreement is on screen before the box can be ticked. That is not decoration:
 * a release nobody was shown is the first thing an opposing lawyer goes after, so the
 * text is rendered in full rather than hidden behind "I have read the terms".
 */
export default function ConsentPage() {
  const { token } = useParams();
  const { clubId, club, slug } = useClub();
  const clubName = club?.name || slug;

  const [request, setRequest] = useState(null);
  const [state, setState] = useState('loading'); // loading | ready | used | missing | error
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(null);
  // Whether the agreement has actually been scrolled to the bottom. A release nobody
  // was shown is the weakest kind there is, and "it was in a scroll box they never
  // reached" is exactly the argument this closes.
  const [readToEnd, setReadToEnd] = useState(false);
  const textRef = useRef(null);

  const [form, setForm] = useState({
    dateOfBirth: '',
    signedName: '',
    guardianRelationship: '',
    guardianEmail: '',
    agreed: false,
    media: false,
  });

  useEffect(() => {
    let cancelled = false;
    if (!clubId || !token) return undefined;
    // A one-shot get, not a listener: the document is read once to render the form, and
    // a live subscription would keep an anonymous reader attached to it after signing.
    getDoc(consentRequestDoc(clubId, token))
      .then((snap) => {
        if (cancelled) return;
        if (!snap.exists()) {
          setState('missing');
          return;
        }
        const data = snap.data();
        setRequest(data);
        setState(data.status === 'signed' ? 'used' : 'ready');
      })
      .catch(() => {
        if (!cancelled) setState('error');
      });
    return () => {
      cancelled = true;
    };
  }, [clubId, token]);

  const participantName = request?.playerName || '';
  const minor = isMinor(form.dateOfBirth);
  // Until a usable date of birth is entered, show the adult agreement — the guardian
  // section appears the moment the date says it is needed, so nobody reads terms that
  // do not apply to them.
  const sections = useMemo(
    () => waiverSections(clubName, { minor: minor === true }),
    [clubName, minor]
  );

  // The agreement grows a section when the participant turns out to be a minor, so the
  // "have you reached the bottom" answer has to be recomputed when it changes. And if the
  // text fits without scrolling there is nothing to scroll to — requiring a scroll event
  // that can never fire would make the form impossible to submit on a large screen.
  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    setReadToEnd(el.scrollHeight <= el.clientHeight + 4);
  }, [sections]);

  const onTextScroll = useCallback((e) => {
    const el = e.currentTarget;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 8) setReadToEnd(true);
  }, []);

  const submit = useCallback(
    async (e) => {
      e.preventDefault();
      const problem = validateConsent({ ...form, participantName });
      if (problem) {
        setError(problem);
        return;
      }
      setError('');
      setSaving(true);
      try {
        const asMinor = isMinor(form.dateOfBirth) === true;
        // Hash the exact text this page rendered, not a freshly built copy: what is
        // stored has to be what was on screen.
        const waiverText = waiverPlainText(clubName, { minor: asMinor });
        const waiverHash = await hashWaiverText(waiverText);

        const batch = writeBatch(db);
        batch.set(consentDoc(clubId, token), {
          token,
          playerId: request?.playerId || null,
          participantName,
          dateOfBirth: form.dateOfBirth,
          signedByMinorGuardian: asMinor,
          signedName: form.signedName.trim(),
          guardianRelationship: asMinor ? form.guardianRelationship.trim() : '',
          guardianEmail: asMinor ? form.guardianEmail.trim().toLowerCase() : '',
          mediaConsent: Boolean(form.media),
          // Recorded because it is the fact worth being able to state later: the whole
          // agreement was scrolled through on this device before it was signed.
          acknowledgedFullText: true,
          waiverVersion: WAIVER_VERSION,
          waiverHash,
          waiverText,
          // Recorded for the record's own sake; deliberately no IP address, which we
          // would have to collect through a third party and then be responsible for.
          userAgent: String(navigator.userAgent || '').slice(0, 300),
          agreedAt: serverTimestamp(),
        });
        // Flips the request out of 'pending' so the link cannot be signed twice.
        batch.update(consentRequestDoc(clubId, token), {
          status: 'signed',
          signedAt: serverTimestamp(),
        });
        await batch.commit();
        setDone({ minor: asMinor, name: form.signedName.trim() });
      } catch (err) {
        setError(
          err?.code === 'permission-denied'
            ? 'This link could not be used. It may already have been signed, or withdrawn by the club.'
            : err?.message || 'Could not record your consent. Check your connection and try again.'
        );
      } finally {
        setSaving(false);
      }
    },
    [clubId, token, form, participantName, clubName, request]
  );

  const Shell = ({ children }) => (
    <div className="min-h-screen bg-gray-50/80">
      <div className="max-w-2xl mx-auto p-3 sm:p-6">{children}</div>
    </div>
  );

  if (state === 'loading') {
    return (
      <Shell>
        <p className="p-8 text-center text-gray-600">Loading…</p>
      </Shell>
    );
  }

  if (state === 'missing' || state === 'error') {
    return (
      <Shell>
        <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
          <h1 className="text-xl font-bold text-gray-900">This link is not valid</h1>
          <p className="mt-3 text-sm text-gray-600">
            It may have expired, been withdrawn, or been copied incompletely. Ask{' '}
            {clubName} for a new one.
          </p>
        </div>
      </Shell>
    );
  }

  if (state === 'used' && !done) {
    return (
      <Shell>
        <div className="rounded-2xl border border-emerald-200 bg-white p-8 text-center shadow-sm">
          <div className="text-4xl">✓</div>
          <h1 className="mt-3 text-xl font-bold text-gray-900">Already signed</h1>
          <p className="mt-3 text-sm text-gray-600">
            A consent has already been recorded using this link. Contact {clubName} if you
            need to change or withdraw it.
          </p>
        </div>
      </Shell>
    );
  }

  if (done) {
    return (
      <Shell>
        <div className="rounded-2xl border border-emerald-200 bg-white p-8 text-center shadow-sm">
          <div className="text-4xl">✓</div>
          <h1 className="mt-3 text-xl font-bold text-gray-900">Thank you</h1>
          <p className="mt-3 text-sm text-gray-700">
            Consent for <strong>{participantName}</strong> has been recorded
            {done.minor ? ' by their parent or guardian' : ''}, signed by{' '}
            <strong>{done.name}</strong>.
          </p>
          <p className="mt-3 text-xs text-gray-500">
            {clubName} holds the copy. This link cannot be used again — ask the club if you
            need to change or withdraw your consent.
          </p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          {clubName}
        </p>
        <h1 className="mt-1 text-2xl font-black text-gray-900">Participation consent</h1>
        {participantName && (
          <p className="mt-2 text-sm text-gray-700">
            For <strong>{participantName}</strong>
          </p>
        )}
        <p className="mt-3 text-sm text-gray-600">
          Please read this in full. It affects your legal rights. If the participant is
          under {AGE_OF_MAJORITY}, a parent or legal guardian must complete it.
        </p>

        <form onSubmit={submit} className="mt-5 space-y-5">
          <label className="block">
            <span className="block text-sm font-medium text-gray-800 mb-1">
              Participant’s date of birth <span className="text-red-600">*</span>
            </span>
            <input
              type="date"
              value={form.dateOfBirth}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setForm((f) => ({ ...f, dateOfBirth: e.target.value }))}
              className="w-full min-h-[44px] rounded-lg border border-gray-300 px-3 text-sm"
            />
            <span className="mt-1 block text-xs text-gray-500">
              This decides which agreement applies, so it is required.
            </span>
          </label>

          {minor === true && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              The participant is under {AGE_OF_MAJORITY}. A parent or legal guardian must
              read and sign this, in their own name.
            </p>
          )}

          {/* The agreement itself, in full, above the signature — never behind a link. */}
          <div
            ref={textRef}
            onScroll={onTextScroll}
            className="rounded-xl border border-gray-200 bg-gray-50/70 p-4 max-h-[26rem] overflow-y-auto"
          >
            {sections.map((s) => (
              <section key={s.heading} className="mb-4 last:mb-0">
                <h2 className="text-sm font-bold text-gray-900">{s.heading}</h2>
                <p className="mt-1 text-sm leading-relaxed text-gray-700">{s.body}</p>
              </section>
            ))}
            <p className="mt-4 border-t border-gray-200 pt-2 text-xs text-gray-500">
              Version {WAIVER_VERSION}
            </p>
          </div>

          {minor === true && (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="block text-sm font-medium text-gray-800 mb-1">
                  Your relationship to the participant <span className="text-red-600">*</span>
                </span>
                <input
                  value={form.guardianRelationship}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, guardianRelationship: e.target.value }))
                  }
                  placeholder="Mother, father, legal guardian…"
                  className="w-full min-h-[44px] rounded-lg border border-gray-300 px-3 text-sm"
                />
              </label>
              <label className="block">
                <span className="block text-sm font-medium text-gray-800 mb-1">
                  Your email <span className="text-red-600">*</span>
                </span>
                <input
                  value={form.guardianEmail}
                  inputMode="email"
                  onChange={(e) => setForm((f) => ({ ...f, guardianEmail: e.target.value }))}
                  placeholder="you@example.com"
                  className="w-full min-h-[44px] rounded-lg border border-gray-300 px-3 text-sm"
                />
              </label>
            </div>
          )}

          {!readToEnd && (
            <p className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
              Scroll to the end of the agreement above to continue.
            </p>
          )}

          <label className={`flex items-start gap-3 ${readToEnd ? '' : 'opacity-50'}`}>
            <input
              type="checkbox"
              checked={form.agreed}
              disabled={!readToEnd}
              onChange={(e) => setForm((f) => ({ ...f, agreed: e.target.checked }))}
              className="mt-1 h-5 w-5 shrink-0"
            />
            <span className="text-sm text-gray-800">
              I have read and agree to the terms above
              {minor === true
                ? ', on my own behalf and on behalf of the participant as their parent or legal guardian'
                : ''}
              . <span className="text-red-600">*</span>
            </span>
          </label>

          {/* Separate, optional, and visibly not part of the release. */}
          <label className="flex items-start gap-3 rounded-lg border border-gray-200 p-3">
            <input
              type="checkbox"
              checked={form.media}
              onChange={(e) => setForm((f) => ({ ...f, media: e.target.checked }))}
              className="mt-1 h-5 w-5 shrink-0"
            />
            <span className="text-sm text-gray-700">
              <strong className="block text-gray-900">{MEDIA_CONSENT.heading}</strong>
              {MEDIA_CONSENT.body}
            </span>
          </label>

          <label className="block">
            <span className="block text-sm font-medium text-gray-800 mb-1">
              Type your full name to sign <span className="text-red-600">*</span>
            </span>
            <input
              value={form.signedName}
              onChange={(e) => setForm((f) => ({ ...f, signedName: e.target.value }))}
              placeholder={minor === true ? 'Parent or guardian’s full name' : 'Your full name'}
              className="w-full min-h-[48px] rounded-lg border border-gray-300 px-3 text-base"
            />
            <span className="mt-1 block text-xs text-gray-500">
              Typing your name here is your electronic signature, dated today.
            </span>
          </label>

          {error && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={saving || !readToEnd}
            className="min-h-[52px] w-full rounded-xl bg-blue-600 px-4 text-base font-bold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Recording…' : 'Agree and sign'}
          </button>
        </form>
      </div>
    </Shell>
  );
}
