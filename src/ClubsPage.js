// src/ClubsPage.js
//
// The landing page, and the one page that exists outside any club: every club on the
// installation, plus — when signed in — which of them this account belongs to, which
// have invited it, and how to start a new one.
//
// The public directory is a plain `clubs` read, which the rules allow for anyone
// (`allow read: if true`), the same permission that makes a club's scoreboard shareable.
// The personal half is two collection-group queries, and the rules only allow those
// scoped to yourself (`uid == auth.uid`, `email == token email`) — so those `where`
// filters are not a convenience; drop either and the whole query is denied.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db } from './firebase';
import { clubDoc, inviteDoc, memberDoc, normalizeEmail, slugDoc } from './clubPaths';
import { useAuth } from './AuthContext';

/**
 * A club's public address. Kept to `[a-z0-9-]` because it is the whole of `/c/{slug}`
 * and doubles as the `slugs/{slug}` document id, where a slash or a dot would be a
 * different path entirely.
 */
export function slugify(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function isPermissionError(err) {
  const code = err?.code;
  const message = typeof err?.message === 'string' ? err.message.toLowerCase() : '';
  return code === 'permission-denied' || message.includes('permission') || message.includes('insufficient');
}

const roleLabels = { admin: 'Admin', scorer: 'Scorer' };

const cardClass = 'rounded-2xl border border-slate-700/70 bg-slate-900/70 p-4 sm:p-5 shadow';
const primaryButtonClass =
  'min-h-[48px] px-5 rounded-xl bg-amber-500 text-slate-900 font-bold hover:bg-amber-400 disabled:opacity-50';
const secondaryButtonClass =
  'min-h-[44px] px-4 rounded-xl border border-slate-600 bg-slate-800 text-white font-semibold hover:bg-slate-700 disabled:opacity-50';

export default function ClubsPage() {
  const { user, loading: authLoading, signIn } = useAuth();
  const navigate = useNavigate();

  // The public directory loads for everyone and is kept separate from the personal
  // half, so a signed-out visitor — or a signed-in one whose membership query fails —
  // still gets a usable list of clubs to browse.
  const [directory, setDirectory] = useState({ loading: true, error: '', clubs: [] });
  const [state, setState] = useState({ loading: true, error: '', clubs: [], invites: [] });
  const [creating, setCreating] = useState(false);
  const [busyInvite, setBusyInvite] = useState('');
  const [actionError, setActionError] = useState('');

  const uid = user?.uid || null;
  const email = useMemo(() => normalizeEmail(user?.email), [user]);

  const load = useCallback(async () => {
    if (!uid) return;
    setState((s) => ({ ...s, loading: true, error: '' }));
    try {
      // Two independent queries; a club with a stale invite should still list under
      // "your clubs" if one of them fails, so they are settled together but read apart.
      const [memberSnap, inviteSnap] = await Promise.all([
        getDocs(query(collectionGroup(db, 'members'), where('uid', '==', uid))),
        email
          ? getDocs(query(collectionGroup(db, 'invites'), where('email', '==', email)))
          : Promise.resolve({ docs: [] }),
      ]);

      // A member document knows its role but not its club's name or slug — the club id
      // is the grandparent of the row (clubs/{clubId}/members/{uid}), and the club doc
      // itself is publicly readable, so one get() per club fills in the rest.
      const memberRows = memberSnap.docs.map((d) => ({
        clubId: d.ref.parent.parent.id,
        role: d.data()?.role || null,
      }));
      const inviteRows = inviteSnap.docs.map((d) => ({
        clubId: d.ref.parent.parent.id,
        role: d.data()?.role || null,
      }));

      const ids = Array.from(new Set([...memberRows, ...inviteRows].map((r) => r.clubId)));
      const clubDocs = await Promise.all(ids.map((id) => getDoc(clubDoc(id))));
      const byId = new Map();
      clubDocs.forEach((snap) => {
        if (snap.exists()) byId.set(snap.id, snap.data());
      });

      const decorate = (row) => ({
        ...row,
        name: byId.get(row.clubId)?.name || row.clubId,
        slug: byId.get(row.clubId)?.slug || null,
        // A club that was deleted out from under a membership or invite is dead weight;
        // there is nowhere to navigate to, so it is dropped rather than shown broken.
        exists: byId.has(row.clubId),
      });

      const clubs = memberRows.map(decorate).filter((c) => c.exists);
      const memberIds = new Set(clubs.map((c) => c.clubId));
      const invites = inviteRows
        .map(decorate)
        .filter((i) => i.exists && !memberIds.has(i.clubId));

      clubs.sort((a, b) => a.name.localeCompare(b.name));
      invites.sort((a, b) => a.name.localeCompare(b.name));
      setState({ loading: false, error: '', clubs, invites });
    } catch (err) {
      setState({
        loading: false,
        error: isPermissionError(err)
          ? 'Firestore would not list your clubs. Sign out and back in, then try again.'
          : 'Could not load your clubs. Check your connection and reload.',
        clubs: [],
        invites: [],
      });
    }
  }, [uid, email]);

  useEffect(() => {
    if (!uid) {
      setState({ loading: false, error: '', clubs: [], invites: [] });
      return;
    }
    load();
  }, [uid, load]);

  useEffect(() => {
    let cancelled = false;
    getDocs(collection(db, 'clubs'))
      .then((snap) => {
        if (cancelled) return;
        const clubs = snap.docs
          .map((d) => ({ clubId: d.id, ...d.data() }))
          // A club with no slug has no reachable address; listing it would be a dead link.
          .filter((c) => c.slug)
          .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
        setDirectory({ loading: false, error: '', clubs });
      })
      .catch(() => {
        if (cancelled) return;
        setDirectory({ loading: false, error: 'Could not load the club list.', clubs: [] });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const acceptInvite = async (invite) => {
    setActionError('');
    if (!user?.emailVerified) {
      // The rules require a verified address to claim an invite. Google accounts always
      // are, so this is a guard against a confusing raw permission error, not a flow.
      setActionError('Your email address is not verified, so this invite cannot be accepted yet.');
      return;
    }
    setBusyInvite(invite.clubId);
    try {
      // One batch: the rules let the invitee create their member document only while the
      // invite still exists (get() sees pre-batch state), and let them delete their own
      // invite. Doing it in two writes would leave a claimed invite behind if the second
      // one never landed.
      const batch = writeBatch(db);
      batch.set(memberDoc(invite.clubId, user.uid), {
        uid: user.uid,
        email,
        displayName: user.displayName || null,
        role: invite.role,
        joinedAt: serverTimestamp(),
      });
      batch.delete(inviteDoc(invite.clubId, email));
      await batch.commit();
      await load();
    } catch (err) {
      setActionError(
        isPermissionError(err)
          ? 'That invite could not be accepted. It may have been revoked — ask the club admin to send it again.'
          : 'Could not accept the invite. Check your connection and try again.'
      );
    } finally {
      setBusyInvite('');
    }
  };

  const directorySection = (
    <section className={cardClass}>
      <h2 className="text-lg font-bold text-white mb-3">All clubs</h2>
      {directory.loading ? (
        <p className="text-sm text-slate-300">Loading clubs…</p>
      ) : directory.error ? (
        <p className="text-sm text-red-200">{directory.error}</p>
      ) : directory.clubs.length === 0 ? (
        <p className="text-sm text-slate-300">No clubs yet.</p>
      ) : (
        <ul className="grid gap-2">
          {directory.clubs.map((club) => (
            <li key={club.clubId}>
              <Link
                to={`/c/${club.slug}`}
                className="flex items-center justify-between gap-3 min-h-[48px] rounded-xl border border-slate-700 bg-slate-800/70 px-4 py-2 hover:bg-slate-700"
              >
                <span className="min-w-0">
                  <span className="block font-semibold text-white truncate">
                    {club.name || club.slug}
                  </span>
                  <span className="block text-xs text-slate-400 font-mono truncate">
                    /c/{club.slug}
                  </span>
                </span>
                <span className="shrink-0 text-slate-400" aria-hidden="true">
                  →
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );

  if (authLoading) {
    return <Shell title="Clubs">Loading…</Shell>;
  }

  // Signed out is a first-class state here, not a locked door: the directory is public,
  // so a visitor can pick a club and watch its scoreboard without an account.
  if (!user) {
    return (
      <div className="max-w-3xl mx-auto px-3 sm:px-4 py-6 sm:py-10 grid gap-6">
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-3xl font-black text-white">
            Volley<span className="text-amber-400">Score</span>
          </h1>
          {/* The header hides this line on a phone to protect its fixed height,
              so it lives here too — where there is room for it. */}
          <p className="text-sm text-slate-300 mt-1">
            Your one stop shop to manage clubs, schedule, scores
          </p>
        </div>
        {directorySection}
        <section className={cardClass}>
          <p className="text-sm text-slate-300">
            Sign in to score games, see clubs you belong to and any invites waiting for
            you, or start a club of your own.
          </p>
          <button type="button" onClick={signIn} className={`${primaryButtonClass} mt-4`}>
            Sign in / Sign up with Google
          </button>
        </section>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-3 sm:px-4 py-6 sm:py-10 grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-3xl font-black text-white">
            Volley<span className="text-amber-400">Score</span>
          </h1>
          {/* The header hides this line on a phone to protect its fixed height,
              so it lives here too — where there is room for it. */}
          <p className="text-sm text-slate-300 mt-1">
            Your one stop shop to manage clubs, schedule, scores
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreating((c) => !c)}
          className={creating ? secondaryButtonClass : primaryButtonClass}
        >
          {creating ? 'Cancel' : 'Create a club'}
        </button>
      </div>

      {creating && (
        <CreateClubForm
          user={user}
          onCancel={() => setCreating(false)}
          onCreated={(slug) => navigate(`/c/${slug}`)}
        />
      )}

      {actionError && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {actionError}
        </div>
      )}

      {state.error && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {state.error}
        </div>
      )}

      {state.loading ? (
        <p className="text-slate-300">Loading your clubs…</p>
      ) : (
        <>
          {state.invites.length > 0 && (
            <section className={cardClass}>
              <h2 className="text-lg font-bold text-white mb-3">Invites</h2>
              <ul className="grid gap-3">
                {state.invites.map((invite) => (
                  <li
                    key={invite.clubId}
                    className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="font-semibold text-white truncate">{invite.name}</div>
                      <div className="text-xs text-slate-400">
                        Invited as {roleLabels[invite.role] || invite.role}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => acceptInvite(invite)}
                      disabled={busyInvite === invite.clubId}
                      className={primaryButtonClass}
                    >
                      {busyInvite === invite.clubId ? 'Joining…' : 'Accept'}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className={cardClass}>
            <h2 className="text-lg font-bold text-white mb-3">Your clubs</h2>
            {state.clubs.length === 0 ? (
              <p className="text-sm text-slate-300">
                You are not in any club yet. Create one, or ask a club admin to invite{' '}
                <span className="font-mono text-amber-300">{email}</span>.
              </p>
            ) : (
              <ul className="grid gap-2">
                {state.clubs.map((club) => (
                  <li key={club.clubId}>
                    <Link
                      to={club.slug ? `/c/${club.slug}` : '#'}
                      className="flex items-center justify-between gap-3 min-h-[48px] rounded-xl border border-slate-700 bg-slate-800/70 px-4 py-2 hover:bg-slate-700"
                    >
                      <span className="min-w-0">
                        <span className="block font-semibold text-white truncate">{club.name}</span>
                        <span className="block text-xs text-slate-400 font-mono truncate">
                          /c/{club.slug}
                        </span>
                      </span>
                      <span className="shrink-0 text-xs font-bold uppercase tracking-wide text-amber-300">
                        {roleLabels[club.role] || club.role}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {directorySection}
        </>
      )}
    </div>
  );
}

function Shell({ title, children }) {
  return (
    <div className="max-w-3xl mx-auto px-4 py-16 text-center text-slate-300">
      <h1 className="text-2xl font-black text-white">{title}</h1>
      <div className="mt-3 text-sm">{children}</div>
    </div>
  );
}

function CreateClubForm({ user, onCancel, onCreated }) {
  const [name, setName] = useState('');
  // The slug follows the name until the user edits it, after which it is theirs — a
  // later name tweak must not silently move a club's address out from under them.
  const [slugTouched, setSlugTouched] = useState(false);
  const [slug, setSlug] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const effectiveSlug = slugTouched ? slug : slugify(name);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    const cleanName = name.trim();
    const cleanSlug = slugify(effectiveSlug);
    if (!cleanName) {
      setError('Give the club a name.');
      return;
    }
    if (cleanSlug.length < 3 || cleanSlug.length > 40) {
      setError('The address must be 3 to 40 characters of letters, numbers or hyphens.');
      return;
    }

    setSaving(true);
    try {
      // Mint the id client-side: the rules cross-check clubs/{id} against slugs/{slug}
      // with getAfter(), so both documents — and the founding admin row — have to be in
      // the same batch, which means knowing the id before anything is written.
      const clubId = doc(collection(db, 'clubs')).id;
      const batch = writeBatch(db);
      batch.set(clubDoc(clubId), {
        name: cleanName,
        slug: cleanSlug,
        createdBy: user.uid,
        createdAt: serverTimestamp(),
      });
      batch.set(slugDoc(cleanSlug), { clubId });
      batch.set(memberDoc(clubId, user.uid), {
        uid: user.uid,
        email: normalizeEmail(user.email),
        displayName: user.displayName || null,
        role: 'admin',
        joinedAt: serverTimestamp(),
      });
      await batch.commit();
      onCreated(cleanSlug);
    } catch (err) {
      // Slug uniqueness is enforced by the rules (slugs/{slug} is create-only), so a
      // taken address comes back as a flat permission denial with nothing to
      // distinguish it. Pre-checking with a read would race, so the friendlier of the
      // two readings is the one shown.
      setError(
        isPermissionError(err)
          ? 'That address is already taken, try another.'
          : 'Could not create the club. Check your connection and try again.'
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className={cardClass}>
      <h2 className="text-lg font-bold text-white mb-3">Create a club</h2>

      <label className="block text-sm font-medium text-slate-300 mb-1" htmlFor="club-name">
        Club name
      </label>
      <input
        id="club-name"
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="e.g. Greenville Volleyball League"
        className="w-full min-h-[48px] rounded-xl border border-slate-600 bg-slate-800 px-3 text-white placeholder-slate-500 mb-4"
      />

      <label className="block text-sm font-medium text-slate-300 mb-1" htmlFor="club-slug">
        Address
      </label>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-slate-400 font-mono text-sm shrink-0">/c/</span>
        <input
          id="club-slug"
          type="text"
          value={effectiveSlug}
          onChange={(e) => {
            setSlugTouched(true);
            setSlug(e.target.value);
          }}
          placeholder="gvbl"
          className="w-full min-h-[48px] rounded-xl border border-slate-600 bg-slate-800 px-3 font-mono text-white placeholder-slate-500"
        />
      </div>
      <p className="text-xs text-slate-400 mb-4">
        Lowercase letters, numbers and hyphens. This is the link players will use, so it cannot be
        changed later.
      </p>

      {error && <div className="text-sm text-red-300 mb-3">{error}</div>}

      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={saving} className={primaryButtonClass}>
          {saving ? 'Creating…' : 'Create club'}
        </button>
        <button type="button" onClick={onCancel} disabled={saving} className={secondaryButtonClass}>
          Cancel
        </button>
      </div>
    </form>
  );
}
