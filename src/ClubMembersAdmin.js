// src/ClubMembersAdmin.js
//
// Who is in this club, who has been invited, and the admin controls for both.
//
// Member documents are the only thing under a club that is not publicly readable —
// they carry email addresses — so everything here needs a membership to even read,
// and a club-admin membership to write.
import React, { useEffect, useState } from 'react';
import {
  deleteDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { invitesCol, inviteDoc, memberDoc, membersCol, normalizeEmail } from './clubPaths';
import { useClub } from './ClubContext';
import { useAuth } from './AuthContext';
import ConfirmDialog from './components/ConfirmDialog';

const ROLES = [
  { value: 'scorer', label: 'Scorer' },
  { value: 'admin', label: 'Admin' },
];

function errorText(err) {
  const code = err?.code;
  const message = typeof err?.message === 'string' ? err.message : '';
  if (code === 'permission-denied' || message.toLowerCase().includes('permission')) {
    return 'Firestore blocked that. Only a club admin can manage members.';
  }
  return message || 'Request failed.';
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function ClubMembersAdmin({ onClose }) {
  const { clubId, isClubAdmin } = useClub();
  const { user } = useAuth();

  // Both lists are stored WITH the club they were read from and only used while that
  // still matches the club in scope. Clearing them inside the effect would be a frame
  // too late — the effect runs after React has painted a render already carrying the new
  // clubId, and in that frame a "Remove" click would target clubs/B/members/<uidFromA>.
  const [membersState, setMembersState] = useState({ clubId: null, list: [], loading: true, error: '' });
  const [invitesState, setInvitesState] = useState({ clubId: null, list: [] });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('scorer');
  const [pendingRemove, setPendingRemove] = useState(null);

  const membersMatch = membersState.clubId === clubId;
  const members = membersMatch ? membersState.list : [];
  const loading = !membersMatch || membersState.loading;
  const listenError = membersMatch ? membersState.error : '';
  // Also gated on isClubAdmin, so losing admin in a club empties the list rather than
  // leaving the last snapshot on screen.
  const invites = invitesState.clubId === clubId && isClubAdmin ? invitesState.list : [];

  useEffect(() => {
    if (!clubId) return undefined;
    const unsubMembers = onSnapshot(
      membersCol(clubId),
      (snap) => {
        setMembersState({
          clubId,
          list: snap.docs.map((d) => ({ id: d.id, ...d.data() })),
          loading: false,
          error: '',
        });
      },
      (err) => {
        setMembersState({ clubId, list: [], loading: false, error: errorText(err) });
      }
    );
    return unsubMembers;
  }, [clubId]);

  useEffect(() => {
    if (!clubId || !isClubAdmin) return undefined;
    // Invites are admin-only reads, so this listener is not even opened for a scorer —
    // otherwise every scorer opening this screen would trip a permission error.
    const unsub = onSnapshot(
      invitesCol(clubId),
      (snap) => setInvitesState({ clubId, list: snap.docs.map((d) => ({ id: d.id, ...d.data() })) }),
      (err) => setMembersState((s) => (s.clubId === clubId ? { ...s, error: errorText(err) } : s))
    );
    return unsub;
  }, [clubId, isClubAdmin]);

  const admins = members.filter((m) => m.role === 'admin');
  // The rules happily let the last admin demote or delete themselves, and a club with
  // no admins can only be rescued by a super admin. So the UI is the only thing
  // standing between an admin and locking their own club out — hence these guards.
  const isLastAdmin = (member) => member.role === 'admin' && admins.length <= 1;
  const isSelf = (member) => member.uid === user?.uid;

  const handleInvite = async (e) => {
    e.preventDefault();
    setError('');
    const email = normalizeEmail(inviteEmail);
    if (!EMAIL_RE.test(email)) {
      setError('Enter a valid email address.');
      return;
    }
    if (members.some((m) => normalizeEmail(m.email) === email)) {
      setError('That address is already a member of this club.');
      return;
    }
    setBusy(true);
    try {
      // The document id IS the lowercased address, so re-inviting the same person
      // overwrites the pending invite instead of creating a second one.
      await setDoc(inviteDoc(clubId, email), {
        email,
        role: inviteRole,
        invitedBy: user.uid,
        createdAt: serverTimestamp(),
      });
      setInviteEmail('');
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const handleRevoke = async (invite) => {
    setError('');
    setBusy(true);
    try {
      await deleteDoc(inviteDoc(clubId, invite.id));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const handleRoleChange = async (member, role) => {
    setError('');
    if (role === member.role) return;
    if (isSelf(member) && role !== 'admin' && isLastAdmin(member)) {
      setError('You are the only admin. Promote someone else before stepping down.');
      return;
    }
    setBusy(true);
    try {
      await updateDoc(memberDoc(clubId, member.id), { role });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async () => {
    if (!pendingRemove) return;
    setError('');
    setBusy(true);
    try {
      await deleteDoc(memberDoc(clubId, pendingRemove.id));
      setPendingRemove(null);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const askRemove = (member) => {
    setError('');
    if (isSelf(member) && isLastAdmin(member)) {
      setError('You are the only admin. Promote someone else before leaving the club.');
      return;
    }
    setPendingRemove(member);
  };

  return (
    <div className="p-4 border rounded-lg bg-white shadow-sm">
      <ConfirmDialog
        open={Boolean(pendingRemove)}
        title="Remove this member?"
        confirmLabel="Remove member"
        busy={busy}
        onCancel={() => (busy ? null : setPendingRemove(null))}
        onConfirm={handleRemove}
      >
        <p>
          <span className="font-semibold text-gray-900">
            {pendingRemove?.displayName || pendingRemove?.email}
          </span>{' '}
          will lose access to this club immediately. They can be invited again later.
        </p>
      </ConfirmDialog>

      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h3 className="text-lg font-bold">Members</h3>
          <p className="text-sm text-gray-600">
            Admins run tournaments; scorers only enter scores.
          </p>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="text-sm bg-white border px-3 py-2 rounded-lg min-h-[44px] hover:bg-gray-50 shrink-0"
          >
            Close
          </button>
        )}
      </div>

      {listenError && (
        <div className="p-3 mb-3 border border-red-200 bg-red-50 text-red-800 text-sm rounded-lg">
          {listenError}
        </div>
      )}
      {error && <div className="text-red-600 text-sm mb-3">{error}</div>}

      {loading ? (
        <p className="text-sm text-gray-600">Loading members…</p>
      ) : (
        <ul className="divide-y mb-5">
          {members.map((member) => (
            <li
              key={member.id}
              className="py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2"
            >
              <div className="min-w-0">
                <div className="font-medium truncate">
                  {member.displayName || member.email || member.id}
                  {isSelf(member) && <span className="text-xs text-gray-500 ml-2">(you)</span>}
                </div>
                {member.displayName && member.email && (
                  <div className="text-xs text-gray-500 truncate">{member.email}</div>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <select
                  value={member.role || 'scorer'}
                  onChange={(e) => handleRoleChange(member, e.target.value)}
                  disabled={busy || !isClubAdmin}
                  className="border p-2 rounded-lg bg-white min-h-[44px] disabled:opacity-50"
                  aria-label={`Role for ${member.email || member.id}`}
                >
                  {ROLES.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => askRemove(member)}
                  disabled={busy || !isClubAdmin}
                  className="text-sm bg-white border border-red-300 text-red-700 px-3 py-2 rounded-lg min-h-[44px] hover:bg-red-50 disabled:opacity-50"
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
          {members.length === 0 && <li className="py-3 text-sm text-gray-600">No members yet.</li>}
        </ul>
      )}

      {isClubAdmin && (
        <>
          <form onSubmit={handleInvite} className="border-t pt-4">
            <h4 className="font-bold mb-2">Invite someone</h4>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="player@example.com"
                className="border p-2 rounded-lg flex-1 min-h-[44px]"
                aria-label="Email address to invite"
              />
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value)}
                className="border p-2 rounded-lg bg-white min-h-[44px]"
                aria-label="Role to invite as"
              >
                {ROLES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                disabled={busy}
                className="bg-blue-600 text-white px-4 rounded-lg min-h-[44px] disabled:opacity-50"
              >
                Invite
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-2">
              They join by signing in with that exact Google address and accepting from My clubs.
            </p>
          </form>

          <div className="mt-5">
            <h4 className="font-bold mb-2">Pending invites</h4>
            {invites.length === 0 ? (
              <p className="text-sm text-gray-600">No invites waiting.</p>
            ) : (
              <ul className="divide-y">
                {invites.map((invite) => (
                  <li key={invite.id} className="py-3 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium truncate">{invite.email || invite.id}</div>
                      <div className="text-xs text-gray-500">
                        Invited as {invite.role === 'admin' ? 'Admin' : 'Scorer'}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRevoke(invite)}
                      disabled={busy}
                      className="text-sm bg-white border border-red-300 text-red-700 px-3 py-2 rounded-lg min-h-[44px] hover:bg-red-50 disabled:opacity-50 shrink-0"
                    >
                      Revoke
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
