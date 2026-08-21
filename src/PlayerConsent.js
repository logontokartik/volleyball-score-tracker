import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { deleteDoc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { useClub } from './ClubContext';
import { consentDoc, consentRequestDoc, consentRequestsCol, consentsCol } from './clubPaths';
import { newConsentToken, WAIVER_VERSION } from './waiver';

/**
 * Waiver state for every player in the club, live.
 *
 * Members only. Both collections are club-private — `consents` holds dates of birth and
 * guardian contact details — so this subscribes nothing at all for a signed-out visitor
 * rather than opening reads that are supposed to be denied.
 */
export function useClubConsents(clubId, isMember) {
  const [requests, setRequests] = useState([]);
  const [consents, setConsents] = useState([]);

  useEffect(() => {
    if (!clubId || !isMember) {
      setRequests([]);
      setConsents([]);
      return undefined;
    }
    const unsubReq = onSnapshot(
      consentRequestsCol(clubId),
      (snap) => setRequests(snap.docs.map((d) => ({ token: d.id, ...d.data() }))),
      () => setRequests([])
    );
    const unsubCon = onSnapshot(
      consentsCol(clubId),
      (snap) => setConsents(snap.docs.map((d) => ({ token: d.id, ...d.data() }))),
      () => setConsents([])
    );
    return () => {
      unsubReq();
      unsubCon();
    };
  }, [clubId, isMember]);

  /**
   * One entry per player: the signature if there is one, otherwise the outstanding link.
   *
   * A player can accumulate several requests over time — a link that was never opened,
   * then a replacement. The signature always wins, and among unsigned requests the newest
   * is the one to show, so the admin is never handed a stale link to re-send.
   */
  return useMemo(() => {
    const byPlayer = new Map();
    consents.forEach((c) => {
      if (!c.playerId) return;
      byPlayer.set(c.playerId, { status: 'signed', consent: c });
    });
    requests
      .filter((r) => r.playerId && r.status !== 'signed' && !byPlayer.has(r.playerId))
      .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0))
      .forEach((r) => {
        if (!byPlayer.has(r.playerId)) byPlayer.set(r.playerId, { status: 'pending', request: r });
      });
    return byPlayer;
  }, [requests, consents]);
}

const fmtDate = (ts) => {
  const d = ts?.toDate?.();
  return d ? d.toLocaleDateString() : '';
};

/** A one-word state for a player's waiver, safe to show to any club member. */
export function ConsentBadge({ entry }) {
  if (entry?.status === 'signed') {
    return (
      <span
        className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700"
        title={`Signed ${fmtDate(entry.consent?.agreedAt)}${
          entry.consent?.signedByMinorGuardian ? ' by a parent or guardian' : ''
        }`}
      >
        Consent ✓
      </span>
    );
  }
  if (entry?.status === 'pending') {
    return (
      <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
        Sent
      </span>
    );
  }
  return (
    <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-500">
      No consent
    </span>
  );
}

/**
 * The admin's controls for one player's waiver: issue a link, copy it, withdraw it.
 *
 * There is no "mark as signed by hand" here on purpose. A waiver's value is the record of
 * what a specific person agreed to; an admin ticking a box on someone else's behalf
 * produces a record that says nothing and could be worse than having none.
 */
export function ConsentControl({ player, entry }) {
  const { clubId, slug, isClubAdmin } = useClub();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const token = entry?.status === 'pending' ? entry.request?.token : null;
  const url = token ? `${window.location.origin}/c/${slug}/consent/${token}` : '';

  const issue = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const fresh = newConsentToken();
      await setDoc(consentRequestDoc(clubId, fresh), {
        token: fresh,
        playerId: player.id,
        // Denormalised so the signing page can name the participant without reading the
        // player document, which would otherwise have to be public to an anonymous
        // visitor holding only a token.
        playerName: player.name || '',
        status: 'pending',
        waiverVersion: WAIVER_VERSION,
        createdAt: serverTimestamp(),
      });
    } catch (e) {
      setError(e?.message || 'Could not create a consent link.');
    } finally {
      setBusy(false);
    }
  }, [clubId, player.id, player.name]);

  const cancel = useCallback(async () => {
    if (!token) return;
    setBusy(true);
    setError('');
    try {
      await deleteDoc(consentRequestDoc(clubId, token));
    } catch (e) {
      setError(e?.message || 'Could not cancel that link.');
    } finally {
      setBusy(false);
    }
  }, [clubId, token]);

  const withdraw = useCallback(async () => {
    const t = entry?.consent?.token;
    if (!t) return;
    if (
      !window.confirm(
        `Withdraw and delete the signed consent for ${player.name}? The record is deleted permanently — it cannot be edited or restored.`
      )
    ) {
      return;
    }
    setBusy(true);
    setError('');
    try {
      await deleteDoc(consentDoc(clubId, t));
      await deleteDoc(consentRequestDoc(clubId, t)).catch(() => {});
    } catch (e) {
      setError(e?.message || 'Could not withdraw that consent.');
    } finally {
      setBusy(false);
    }
  }, [clubId, entry, player.name]);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access needs a secure context and a user gesture, and refuses often
      // enough that the URL is always on screen to select by hand as well.
      setError('Could not copy automatically — select the link above and copy it.');
    }
  }, [url]);

  if (!isClubAdmin) return null;

  if (entry?.status === 'signed') {
    const c = entry.consent;
    return (
      <div className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50/50 p-2 text-xs text-emerald-900">
        <p>
          Signed by <strong>{c?.signedName}</strong>
          {c?.signedByMinorGuardian ? ` (${c.guardianRelationship || 'guardian'})` : ''}
          {fmtDate(c?.agreedAt) ? ` on ${fmtDate(c.agreedAt)}` : ''} · waiver{' '}
          {c?.waiverVersion || '?'}
          {c?.mediaConsent ? ' · photos OK' : ' · no photo consent'}
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={withdraw}
          className="mt-1 min-h-[36px] text-[11px] font-medium text-red-700 hover:underline disabled:opacity-50"
        >
          Withdraw consent
        </button>
        {error && <p className="mt-1 text-red-700">{error}</p>}
      </div>
    );
  }

  return (
    <div className="mt-2 rounded-lg border border-gray-200 bg-white p-2">
      {token ? (
        <>
          <p className="text-[11px] text-gray-600">
            Send this link to the player, or to a parent if they are under 18. It works
            once.
          </p>
          <input
            readOnly
            value={url}
            onFocus={(e) => e.target.select()}
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-[11px] text-gray-700"
          />
          <div className="mt-1 flex gap-2">
            <button
              type="button"
              onClick={copy}
              className="min-h-[36px] flex-1 rounded border border-gray-300 text-[11px] font-semibold text-gray-800 hover:bg-gray-50"
            >
              {copied ? 'Copied' : 'Copy link'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={cancel}
              className="min-h-[36px] px-2 text-[11px] font-medium text-red-700 hover:underline disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={issue}
          className="min-h-[36px] w-full rounded border border-gray-300 text-[11px] font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-50"
        >
          {busy ? 'Creating…' : 'Create consent link'}
        </button>
      )}
      {error && <p className="mt-1 text-[11px] text-red-700">{error}</p>}
    </div>
  );
}
