// src/RequestScoringAccess.js
//
// "Ask a club admin for access" as an actual button rather than an instruction.
//
// One component, rendered everywhere a visitor is told they cannot score — the scores
// list and the score dialog both use it, so the two can never end up disagreeing about
// whether asking is possible or whether a request is already pending.
//
// It reads only `clubs/{clubId}/requests/{ownUid}`. That single-document read is exactly
// what the rules allow a requester: nobody but an admin may list the collection, so
// "have I already asked?" cannot be answered any other way.
import React, { useEffect, useState } from 'react';
import { deleteDoc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { normalizeEmail, requestDoc } from './clubPaths';
import { useAuth } from './AuthContext';
import { useClub } from './ClubContext';

function errorText(err) {
  const code = err?.code;
  if (code === 'permission-denied') {
    // Deliberately does NOT name a single cause. This used to assert "your account needs
    // a verified email address", which is the one explanation that cannot apply: sign-in
    // is Google-only and Google always sets email_verified. The real cause is almost
    // always that firestore.rules has not been published since the requests collection
    // was added, in which case every write here is default-denied — and telling someone
    // to verify an already-verified address sends them nowhere.
    return (
      'Firestore refused that request. The most likely reason is that this deployment ' +
      'is still running an older version of the security rules — ask an admin to ' +
      'publish firestore.rules.'
    );
  }
  return err?.message || 'Could not send that request. Check your connection and try again.';
}

export default function RequestScoringAccess({ className = '' }) {
  const { user } = useAuth();
  const { clubId, canScore } = useClub();
  const uid = user?.uid || null;

  // Tagged with the club it was read from, like the members screen: a club switch
  // repaints before the effect re-runs, and an untagged snapshot would briefly offer
  // "withdraw" in club B for a request that only exists in club A.
  const [state, setState] = useState({ clubId: null, loading: true, exists: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setError('');
    if (!clubId || !uid) {
      setState({ clubId: null, loading: false, exists: false });
      return undefined;
    }
    const unsub = onSnapshot(
      requestDoc(clubId, uid),
      (snap) => setState({ clubId, loading: false, exists: snap.exists() }),
      // A denied read here means the account cannot have a request either; treat it as
      // "none" so the button still shows and the real reason surfaces on the attempt.
      () => setState({ clubId, loading: false, exists: false })
    );
    return unsub;
  }, [clubId, uid]);

  // Signed out there is nothing to attach a request to, and a member already has what
  // they would be asking for.
  if (!user || canScore || !clubId) return null;

  const matches = state.clubId === clubId;
  const loading = !matches || state.loading;
  const requested = matches && state.exists;

  const send = async () => {
    setError('');
    const email = normalizeEmail(user.email);
    if (!email) {
      setError('Your account has no email address, so a club admin would have nothing to go on.');
      return;
    }
    setBusy(true);
    try {
      // uid and email are pinned by the rules to the caller's own — they are the whole
      // point of the document, since they are what the admin sees when deciding.
      await setDoc(requestDoc(clubId, user.uid), {
        uid: user.uid,
        email,
        displayName: user.displayName || null,
        createdAt: serverTimestamp(),
      });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async () => {
    setError('');
    setBusy(true);
    try {
      await deleteDoc(requestDoc(clubId, user.uid));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={className}>
      {loading ? (
        <p className="text-sm text-gray-500">Checking…</p>
      ) : requested ? (
        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
          <p className="text-sm text-gray-700">Request sent — a club admin will review it.</p>
          <button
            type="button"
            onClick={withdraw}
            disabled={busy}
            className="text-sm bg-white border border-gray-300 px-4 py-2 rounded-lg min-h-[44px] hover:bg-gray-50 disabled:opacity-50"
          >
            {busy ? 'Withdrawing…' : 'Withdraw request'}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={send}
          disabled={busy}
          className="text-sm bg-blue-600 text-white font-semibold px-4 py-2 rounded-lg min-h-[44px] hover:bg-blue-700 disabled:opacity-50"
        >
          {busy ? 'Sending…' : 'Request scoring access'}
        </button>
      )}
      {error && <p className="text-sm text-red-700 mt-2">{error}</p>}
    </div>
  );
}
