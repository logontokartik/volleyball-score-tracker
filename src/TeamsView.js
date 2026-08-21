import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { deleteDoc, doc, onSnapshot, setDoc, writeBatch, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';
import { useClub } from './ClubContext';
import {
  playerContactDoc,
  playerContactsCol,
  playerDoc,
  playersCol,
  tournamentDoc,
} from './clubPaths';
import { Card, CardContent } from './components/ui/card';
import { ConsentBadge, ConsentControl, useClubConsents } from './PlayerConsent';
import {
  POSITIONS,
  normalizePlayerInput,
  rosterCaptainId,
  rosterForTeam,
  rosterPlayerIds,
  sortPlayers,
  validatePlayerInput,
  withCaptainForTeam,
  withRosterForTeam,
} from './playerUtils';

/**
 * The club's players, live.
 *
 * Two subscriptions rather than one because the two collections have two audiences:
 * `players` is public and everyone gets it, `playerContacts` is club-only and a
 * spectator's read of it is *supposed* to fail. Attempting it anyway and treating the
 * denial as "no contacts" would fill the console with permission errors on every public
 * page load, so the contacts listener is only opened for members.
 */
function useClubPlayers(clubId, isMember) {
  const [players, setPlayers] = useState([]);
  const [emails, setEmails] = useState(() => new Map());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!clubId) {
      setPlayers([]);
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    const unsub = onSnapshot(
      playersCol(clubId),
      (snap) => {
        setPlayers(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setLoading(false);
      },
      () => setLoading(false)
    );
    return () => unsub();
  }, [clubId]);

  useEffect(() => {
    if (!clubId || !isMember) {
      setEmails(new Map());
      return undefined;
    }
    const unsub = onSnapshot(
      playerContactsCol(clubId),
      (snap) => setEmails(new Map(snap.docs.map((d) => [d.id, d.data()?.email || '']))),
      // A member who somehow cannot read these still gets the roster; the addresses
      // simply do not appear. Nothing here is worth an error banner over.
      () => setEmails(new Map())
    );
    return () => unsub();
  }, [clubId, isMember]);

  return { players, emails, loading };
}

const EMPTY_FORM = { name: '', position: '', email: '' };

function PositionChip({ position }) {
  if (!position) return null;
  return (
    <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
      {position}
    </span>
  );
}

/** Name, position, and — for club members only — the email address. */
/**
 * The captain's marker.
 *
 * Bold alone carries the meaning only for someone who already knows the convention, and
 * on a roster of one it says nothing at all — there is no unbolded name to compare it
 * with. The letter is what makes it legible cold.
 */
function CaptainChip() {
  return (
    <span
      className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800"
      title="Team captain"
    >
      C
    </span>
  );
}

/**
 * One roster line: who they are on top, what an admin can do about it underneath.
 *
 * The actions are NOT on the identity row. That row already carries a name, a captain
 * mark, a consent badge and a position, and adding three buttons to it crushed the name
 * to an ellipsis at 390px — measured, not guessed. The name is the one thing on the line
 * that has to survive, so the buttons moved down instead.
 */
function PlayerRow({ player, email, isCaptain, badge, footer }) {
  return (
    <li className="py-2 border-b border-gray-100 last:border-0">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1">
          <span
            className={`block truncate text-sm text-gray-900 ${
              isCaptain ? 'font-bold' : 'font-medium'
            }`}
          >
            {player.name}
          </span>
          {email && <span className="block truncate text-xs text-gray-500">{email}</span>}
        </span>
        {isCaptain && <CaptainChip />}
        {badge}
        <PositionChip position={player.position} />
      </div>
      {footer}
    </li>
  );
}

/**
 * Add a player to one team, either as a new profile or by picking someone the club
 * already knows.
 *
 * Both paths exist on purpose. Typing a name is the fast path courtside; picking from
 * the club list is what stops the same person becoming four profiles across four
 * tournaments, which would defeat the point of storing players outside the tournament.
 */
function AddPlayerForm({ available, onAddNew, onAddExisting, busy }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    const problem = validatePlayerInput(form);
    if (problem) {
      setError(problem);
      return;
    }
    setError('');
    const ok = await onAddNew(form);
    if (ok) setForm(EMPTY_FORM);
  };

  return (
    <div className="space-y-3">
      <form onSubmit={submit} className="space-y-2">
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="block">
            <span className="block text-xs font-medium text-gray-700 mb-1">
              Name <span className="text-red-600">*</span>
            </span>
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Player name"
              className="w-full min-h-[44px] rounded-lg border border-gray-300 px-3 text-sm"
            />
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-gray-700 mb-1">Position</span>
            <select
              value={form.position}
              onChange={(e) => setForm((f) => ({ ...f, position: e.target.value }))}
              className="w-full min-h-[44px] rounded-lg border border-gray-300 px-3 text-sm bg-white"
            >
              <option value="">—</option>
              {POSITIONS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="block">
          <span className="block text-xs font-medium text-gray-700 mb-1">
            Email <span className="font-normal text-gray-500">· optional, club only</span>
          </span>
          <input
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            placeholder="player@example.com"
            inputMode="email"
            className="w-full min-h-[44px] rounded-lg border border-gray-300 px-3 text-sm"
          />
        </label>
        {error && <p className="text-xs text-red-700">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="min-h-[44px] w-full rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Add player'}
        </button>
      </form>

      {available.length > 0 && (
        <label className="block border-t border-gray-200 pt-3">
          <span className="block text-xs font-medium text-gray-700 mb-1">
            …or add someone already in the club
          </span>
          <select
            value=""
            disabled={busy}
            onChange={(e) => {
              if (e.target.value) onAddExisting(e.target.value);
            }}
            className="w-full min-h-[44px] rounded-lg border border-gray-300 px-3 text-sm bg-white"
          >
            <option value="">Pick a player…</option>
            {available.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.position ? ` · ${p.position}` : ''}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}

/**
 * Correct a profile that already exists.
 *
 * Without this the only way to fix a misspelled name is to remove the player and add
 * them again, which leaves the original profile behind in the club database — the exact
 * duplication the shared player list is there to prevent.
 */
function EditPlayerForm({ player, email, onSave, onCancel, busy }) {
  const [form, setForm] = useState({
    name: player.name || '',
    position: player.position || '',
    email: email || '',
  });
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    const problem = validatePlayerInput(form);
    if (problem) {
      setError(problem);
      return;
    }
    setError('');
    await onSave(form);
  };

  return (
    <form onSubmit={submit} className="space-y-2 rounded-lg border border-blue-200 bg-blue-50/40 p-3">
      <input
        value={form.name}
        onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
        className="w-full min-h-[44px] rounded-lg border border-gray-300 px-3 text-sm"
        aria-label="Name"
      />
      <select
        value={form.position}
        onChange={(e) => setForm((f) => ({ ...f, position: e.target.value }))}
        className="w-full min-h-[44px] rounded-lg border border-gray-300 px-3 text-sm bg-white"
        aria-label="Position"
      >
        <option value="">—</option>
        {POSITIONS.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </select>
      <input
        value={form.email}
        onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
        placeholder="player@example.com — optional"
        inputMode="email"
        className="w-full min-h-[44px] rounded-lg border border-gray-300 px-3 text-sm"
        aria-label="Email"
      />
      {error && <p className="text-xs text-red-700">{error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy}
          className="min-h-[44px] flex-1 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          Save
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="min-h-[44px] flex-1 rounded-lg border border-gray-300 bg-white px-4 text-sm font-semibold text-gray-700"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

export default function TeamsView({ tournament, teams, pools }) {
  const { clubId, isClubAdmin, canScore } = useClub();
  const { players, emails, loading } = useClubPlayers(clubId, canScore);
  // Waiver state is club business, not scoreboard content: members only, same as the
  // email addresses above.
  const consentByPlayer = useClubConsents(clubId, canScore);

  const [managing, setManaging] = useState(null);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const rosters = useMemo(() => tournament?.rosters || [], [tournament?.rosters]);
  const playersById = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const sorted = useMemo(() => sortPlayers(players), [players]);

  // Which pool each team is in, so the tab reads as the draw and not just a list.
  const poolByTeam = useMemo(() => {
    const map = new Map();
    (pools || []).forEach((pool) => {
      (pool?.teams || []).forEach((t) => map.set(String(t).trim().toLowerCase(), pool.name));
    });
    return map;
  }, [pools]);

  /** Every roster write goes through here, so there is one place that can fail. */
  const saveRosters = useCallback(
    async (next) => {
      await setDoc(tournamentDoc(clubId, tournament.id), { rosters: next }, { merge: true });
    },
    [clubId, tournament?.id]
  );

  const addExisting = useCallback(
    async (team, playerId) => {
      setBusy(true);
      setError('');
      try {
        const ids = [...rosterPlayerIds(rosters, team), playerId];
        await saveRosters(withRosterForTeam(rosters, team, ids));
      } catch (e) {
        setError(e?.message || 'Could not update the roster.');
      } finally {
        setBusy(false);
      }
    },
    [rosters, saveRosters]
  );

  /**
   * A new profile and its place on a team, in one batch.
   *
   * Batched because the two halves are meaningless apart: a player document nobody is
   * rostered to is invisible clutter, and a roster id with no document renders as
   * nothing at all. Either both land or neither does.
   */
  const addNew = useCallback(
    async (team, form) => {
      setBusy(true);
      setError('');
      try {
        const clean = normalizePlayerInput(form);
        const ref = doc(playersCol(clubId));
        const batch = writeBatch(db);
        batch.set(ref, {
          name: clean.name,
          nameLower: clean.nameLower,
          position: clean.position,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        // The address lives in the club-private collection, never on the public
        // document — see firestore.rules. No email, no document at all.
        if (clean.email) {
          batch.set(playerContactDoc(clubId, ref.id), {
            email: clean.email,
            updatedAt: serverTimestamp(),
          });
        }
        batch.set(
          tournamentDoc(clubId, tournament.id),
          { rosters: withRosterForTeam(rosters, team, [...rosterPlayerIds(rosters, team), ref.id]) },
          { merge: true }
        );
        await batch.commit();
        return true;
      } catch (e) {
        setError(e?.message || 'Could not add that player.');
        return false;
      } finally {
        setBusy(false);
      }
    },
    [clubId, rosters, tournament?.id]
  );

  /**
   * Edit a profile in place.
   *
   * The address is set or *deleted* rather than written as an empty string: an empty
   * contact document is a row that says nothing, and clearing an email should leave no
   * trace of it behind.
   */
  const savePlayer = useCallback(
    async (playerId, form) => {
      setBusy(true);
      setError('');
      try {
        const clean = normalizePlayerInput(form);
        await setDoc(
          playerDoc(clubId, playerId),
          {
            name: clean.name,
            nameLower: clean.nameLower,
            position: clean.position,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
        if (clean.email) {
          await setDoc(playerContactDoc(clubId, playerId), {
            email: clean.email,
            updatedAt: serverTimestamp(),
          });
        } else {
          await deleteDoc(playerContactDoc(clubId, playerId));
        }
        setEditing(null);
      } catch (e) {
        setError(e?.message || 'Could not save that player.');
      } finally {
        setBusy(false);
      }
    },
    [clubId]
  );

  /**
   * Name or unname the team's captain. Tapping the current captain clears the role, which
   * is the only way to have a team with none once one has been set.
   */
  const setCaptain = useCallback(
    async (team, playerId) => {
      setBusy(true);
      setError('');
      try {
        await saveRosters(withCaptainForTeam(rosters, team, playerId));
      } catch (e) {
        setError(e?.message || 'Could not change the captain.');
      } finally {
        setBusy(false);
      }
    },
    [rosters, saveRosters]
  );

  /**
   * Off this team, still in the club.
   *
   * Deliberately not a delete: the profile is the club's, not this tournament's, and
   * dropping someone from Saturday's roster should not erase them from next month's.
   * Removing a player from the club entirely is a different action and does not belong
   * on a tournament page.
   */
  const removeFromTeam = useCallback(
    async (team, playerId) => {
      setBusy(true);
      setError('');
      try {
        const ids = rosterPlayerIds(rosters, team).filter((id) => id !== playerId);
        await saveRosters(withRosterForTeam(rosters, team, ids));
      } catch (e) {
        setError(e?.message || 'Could not update the roster.');
      } finally {
        setBusy(false);
      }
    },
    [rosters, saveRosters]
  );

  const teamList = useMemo(
    () => (teams || []).map((t) => String(t).trim()).filter(Boolean),
    [teams]
  );

  if (!teamList.length) {
    return (
      <Card>
        <CardContent className="p-6 text-center text-gray-600">
          No teams on this tournament yet.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-3">
      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}

      {loading && <p className="text-center text-sm text-gray-500">Loading players…</p>}

      {teamList.map((team) => {
        const roster = rosterForTeam(rosters, team, playersById);
        const captainId = rosterCaptainId(rosters, team);
        const open = managing === team;
        const onTeam = new Set(rosterPlayerIds(rosters, team));
        const available = sorted.filter((p) => !onTeam.has(p.id));

        return (
          <Card key={team}>
            <CardContent className="p-3 sm:p-4">
              <div className="flex items-center gap-2">
                <h3 className="min-w-0 flex-1 truncate text-base font-bold text-gray-900">{team}</h3>
                {poolByTeam.has(team.toLowerCase()) && (
                  <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                    {poolByTeam.get(team.toLowerCase())}
                  </span>
                )}
                <span className="shrink-0 text-xs text-gray-500">
                  {roster.length} {roster.length === 1 ? 'player' : 'players'}
                </span>
              </div>

              {roster.length > 0 ? (
                <ul className="mt-2">
                  {roster.map((p) =>
                    editing === p.id ? (
                      <li key={p.id} className="py-2">
                        <EditPlayerForm
                          player={p}
                          email={emails.get(p.id)}
                          busy={busy}
                          onSave={(form) => savePlayer(p.id, form)}
                          onCancel={() => setEditing(null)}
                        />
                      </li>
                    ) : (
                      <PlayerRow
                        key={p.id}
                        player={p}
                        email={emails.get(p.id)}
                        isCaptain={p.id === captainId}
                        // Hidden while managing: the consent panel below the row states
                        // the same thing in full, and three chips beside the name left
                        // it truncated to "Priya Rama…" at 390px. The name wins.
                        badge={
                          canScore && !open ? <ConsentBadge entry={consentByPlayer.get(p.id)} /> : null
                        }
                        footer={
                          open ? (
                            <>
                              <div className="mt-1 flex flex-wrap items-center gap-1">
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => setCaptain(team, p.id)}
                                  aria-pressed={p.id === captainId}
                                  title={
                                    p.id === captainId
                                      ? 'Remove as captain'
                                      : 'Make this player the captain'
                                  }
                                  className={`min-h-[44px] px-2 text-xs font-medium disabled:opacity-50 ${
                                    p.id === captainId
                                      ? 'text-amber-700 hover:underline'
                                      : 'text-gray-500 hover:underline'
                                  }`}
                                >
                                  {p.id === captainId ? 'Captain ✓' : 'Captain'}
                                </button>
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => setEditing(p.id)}
                                  className="min-h-[44px] px-2 text-xs font-medium text-blue-700 hover:underline disabled:opacity-50"
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => removeFromTeam(team, p.id)}
                                  className="min-h-[44px] px-2 text-xs font-medium text-red-700 hover:underline disabled:opacity-50"
                                >
                                  Remove
                                </button>
                              </div>
                              <ConsentControl player={p} entry={consentByPlayer.get(p.id)} />
                            </>
                          ) : null
                        }
                      />
                    )
                  )}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-gray-500">No players added yet.</p>
              )}

              {isClubAdmin && (
                <div className="mt-3">
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(null);
                      setManaging(open ? null : team);
                    }}
                    className="min-h-[44px] w-full rounded-lg border border-gray-300 bg-white px-4 text-sm font-semibold text-gray-800 hover:bg-gray-50"
                  >
                    {open ? 'Done' : 'Manage players'}
                  </button>
                  {open && (
                    <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50/60 p-3">
                      <AddPlayerForm
                        available={available}
                        busy={busy}
                        onAddNew={(form) => addNew(team, form)}
                        onAddExisting={(id) => addExisting(team, id)}
                      />
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}

      {!isClubAdmin && (
        <p className="px-1 text-center text-xs text-gray-500">
          Rosters are maintained by the club&apos;s admins.
        </p>
      )}
    </div>
  );
}
