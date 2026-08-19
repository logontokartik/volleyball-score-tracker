import React, { useEffect, useState } from 'react';
import { deleteDoc, deleteField, doc, onSnapshot, setDoc, serverTimestamp } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { clubDoc, tournamentDoc, tournamentsCol } from './clubPaths';
import { useClub } from './ClubContext';
import {
  DEFAULT_COURT_COUNT,
  DEFAULT_SCHEDULE_FORMAT,
  MAX_COURT_COUNT,
  MAX_POOL_COUNT,
  MIN_POOL_COUNT,
  SCHEDULE_FORMATS,
  buildDefaultScheduleSlots,
  buildScheduleForFormat,
  evenSplitPoolIndexes,
  matchesWithEmptySets,
  poolLetter,
  poolsFromRows,
  previewGameCount,
  validatePoolAssignment,
} from './tournamentUtils';
import ScheduleEditor from './ScheduleEditor';
import AdminMatchLocks from './AdminMatchLocks';
import AdminTeamsEditor from './AdminTeamsEditor';
import ConfirmDialog from './components/ConfirmDialog';
import ClubMembersAdmin from './ClubMembersAdmin';

function firestoreRulesHint(err) {
  const code = err?.code;
  const message = typeof err?.message === 'string' ? err.message : '';
  if (
    code === 'permission-denied' ||
    message.toLowerCase().includes('permission') ||
    message.toLowerCase().includes('insufficient')
  ) {
    return 'Firestore blocked this request. Writing here needs an admin membership in this club (clubs/{clubId}/members/{uid} with role "admin"). If the rules themselves are out of date, publish firestore.rules from this project in Firebase Console → Firestore → Rules. Signing in does not bypass rules.';
  }
  return message || 'Request failed.';
}

// `pool` is the index of the pool this team is in, or null for "not assigned yet".
// It only means anything for the pools format, and is ignored by every other one.
function emptyTeamRow() {
  return { id: crypto.randomUUID(), name: '', pool: null };
}

// Rosters arrive either as a spreadsheet column (newlines) or pasted out of an email or
// chat message (commas), and often as a mix of both, so both separators are accepted at
// once. Every entry that is dropped is counted rather than discarded quietly: a 24-team
// paste that silently lands 22 teams is only noticed at the tournament.
export function parseBulkTeams(text, existingNames) {
  const taken = new Set(
    (existingNames || []).map((n) => (n || '').trim().toLowerCase()).filter(Boolean)
  );
  const added = [];
  let duplicates = 0;
  for (const raw of String(text || '').split(/[,\r\n]+/)) {
    const name = raw.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (taken.has(key)) {
      duplicates += 1;
      continue;
    }
    taken.add(key);
    added.push(name);
  }
  return { added, duplicates };
}

/** Text field -> a usable pool count. Unparseable or out of range falls back to the
 *  nearest allowed value, so the rest of the form always has a real number to render. */
function clampPoolCount(value) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return MIN_POOL_COUNT;
  return Math.min(MAX_POOL_COUNT, Math.max(MIN_POOL_COUNT, n));
}

export default function AdminPage() {
  // The club doc is already subscribed live by ClubContext, so the active pointer is read
  // from there rather than opening a second listener on the same document.
  const { clubId, slug, club, isClubAdmin } = useClub();
  const navigate = useNavigate();
  const activeTournamentId = club?.activeTournamentId || null;

  const [tournaments, setTournaments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [listenError, setListenError] = useState('');

  const [formName, setFormName] = useState('');
  const [teamRows, setTeamRows] = useState(() => [
    emptyTeamRow(),
    emptyTeamRow(),
    emptyTeamRow(),
    emptyTeamRow(),
  ]);
  const [setsPerMatch, setSetsPerMatch] = useState(3);
  const [meetingsPerPair, setMeetingsPerPair] = useState(1);
  const [pointsToWin, setPointsToWin] = useState(25);
  const [courtCount, setCourtCount] = useState(DEFAULT_COURT_COUNT);
  const [scheduleFormat, setScheduleFormat] = useState(DEFAULT_SCHEDULE_FORMAT);
  // The field holds raw text; the clamped number is derived. Clamping on every
  // keystroke is what made this unusable: clearing it parsed as NaN and snapped to the
  // minimum, so typing "5" landed on "25" and clamped to the maximum. The other numeric
  // inputs on this form already keep their text and clamp at submit; this one has to
  // derive a number too, because the pool selects below render from it live.
  const [poolCountText, setPoolCountText] = useState(String(MIN_POOL_COUNT));
  const poolCount = clampPoolCount(poolCountText);
  const [editingScheduleForId, setEditingScheduleForId] = useState(null);
  const [editingLocksForId, setEditingLocksForId] = useState(null);
  const [editingTeamsForId, setEditingTeamsForId] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [bulkTeams, setBulkTeams] = useState('');
  const [bulkNotice, setBulkNotice] = useState('');
  const [showMembers, setShowMembers] = useState(false);

  useEffect(() => {
    if (!clubId) return undefined;

    const unsubList = onSnapshot(
      tournamentsCol(clubId),
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        list.sort((a, b) => {
          const ta = a.createdAt?.toMillis?.() ?? a.createdAt?.seconds * 1000 ?? 0;
          const tb = b.createdAt?.toMillis?.() ?? b.createdAt?.seconds * 1000 ?? 0;
          if (tb !== ta) return tb - ta;
          return (a.name || '').localeCompare(b.name || '');
        });
        setTournaments(list);
        setLoading(false);
        setListenError('');
      },
      (err) => {
        setListenError(firestoreRulesHint(err));
        setLoading(false);
      }
    );

    return unsubList;
  }, [clubId]);

  const addTeamRow = () => setTeamRows((rows) => [...rows, emptyTeamRow()]);
  const removeTeamRow = (id) =>
    setTeamRows((rows) => (rows.length <= 2 ? rows : rows.filter((r) => r.id !== id)));
  const updateTeamRow = (id, name) =>
    setTeamRows((rows) => rows.map((r) => (r.id === id ? { ...r, name } : r)));
  const updateTeamPool = (id, pool) =>
    setTeamRows((rows) => rows.map((r) => (r.id === id ? { ...r, pool } : r)));

  // Assignment is manual by design, but 30 selects one at a time with no starting point
  // is not control, it is tedium. This fills the pools in listed order; every row can
  // still be moved afterwards.
  const handleEvenSplit = () => {
    setTeamRows((rows) => {
      const named = rows.filter((r) => r.name.trim());
      const indexes = evenSplitPoolIndexes(named.length, poolCount);
      let next = 0;
      return rows.map((r) => (r.name.trim() ? { ...r, pool: indexes[next++] ?? null } : r));
    });
  };

  const usePools = scheduleFormat === 'pools';
  const pools = poolsFromRows(teamRows, poolCount);

  const handleAddBulkTeams = () => {
    const { added, duplicates } = parseBulkTeams(
      bulkTeams,
      teamRows.map((r) => r.name)
    );
    if (!added.length && !duplicates) {
      setBulkNotice('Nothing to add — paste names separated by commas or new lines.');
      return;
    }
    if (added.length) {
      setTeamRows((rows) => {
        // The form starts with four blank rows; appending past them would leave holes in
        // the list that has to be read and reordered by hand. Blanks are filled in place
        // first, then the rest are appended — existing names are never overwritten.
        const queue = [...added];
        const filled = rows.map((r) =>
          !r.name.trim() && queue.length ? { ...r, name: queue.shift() } : r
        );
        return [...filled, ...queue.map((name) => ({ id: crypto.randomUUID(), name }))];
      });
    }
    setBulkTeams('');
    const parts = [`Added ${added.length} team${added.length === 1 ? '' : 's'}`];
    if (duplicates) parts.push(`skipped ${duplicates} duplicate${duplicates === 1 ? '' : 's'}`);
    setBulkNotice(`${parts.join(', ')}.`);
  };

  const handleToggleHidden = async (t) => {
    if (!isClubAdmin) {
      setError('Only a club admin can hide or show a tournament.');
      return;
    }
    setError('');
    setSaving(true);
    try {
      await setDoc(tournamentDoc(clubId, t.id), { hidden: !t.hidden }, { merge: true });
    } catch (e) {
      setError(firestoreRulesHint(e));
    } finally {
      setSaving(false);
    }
  };

  const handleCreateTournament = async () => {
    setError('');
    const teamNames = teamRows.map((r) => r.name.trim()).filter(Boolean);
    const unique = new Set(teamNames.map((t) => t.toLowerCase()));
    if (!formName.trim()) {
      setError('Enter a tournament name.');
      return;
    }
    if (teamNames.length < 2) {
      setError('Add at least two teams with names.');
      return;
    }
    if (unique.size !== teamNames.length) {
      setError('Team names must be unique.');
      return;
    }
    const spm = Math.min(5, Math.max(1, parseInt(setsPerMatch, 10) || 1));
    const mpp = Math.min(10, Math.max(1, parseInt(meetingsPerPair, 10) || 1));
    const ptw = Math.min(50, Math.max(1, parseInt(pointsToWin, 10) || 25));
    const courts = Math.min(
      MAX_COURT_COUNT,
      Math.max(1, parseInt(courtCount, 10) || DEFAULT_COURT_COUNT)
    );

    const format = SCHEDULE_FORMATS[scheduleFormat] || SCHEDULE_FORMATS[DEFAULT_SCHEDULE_FORMAT];
    if (teamNames.length < format.minTeams) {
      setError(`"${format.label}" needs at least ${format.minTeams} teams.`);
      return;
    }

    if (usePools) {
      const problems = validatePoolAssignment(pools, teamNames);
      if (problems.length) {
        setError(problems.join(' '));
        return;
      }
    }

    const scheduled = buildScheduleForFormat(scheduleFormat, teamNames, mpp, { pools });
    const scores = matchesWithEmptySets(scheduled, spm);
    const scheduleSlots = buildDefaultScheduleSlots(scores, courts);

    const id = doc(tournamentsCol(clubId)).id;
    const payload = {
      name: formName.trim(),
      teams: teamNames,
      scheduleFormat,
      pools: usePools ? pools : [],
      setsPerMatch: spm,
      meetingsPerPair: mpp,
      pointsToWin: ptw,
      courtCount: courts,
      scores,
      scheduleSlots,
      scheduleTitle: `${teamNames.length} Teams Format`,
      scheduleSubtitle: formName.trim(),
      hidden: false,
      createdAt: serverTimestamp(),
    };

    if (!isClubAdmin) {
      setError('Only a club admin can create a tournament.');
      return;
    }

    setSaving(true);
    try {
      // Creating is not going live: tournaments are usually set up days ahead, and
      // switching the club's active pointer here would swap the scoreboard out from
      // under whatever is being played right now. "Set active" is the explicit step.
      await setDoc(tournamentDoc(clubId, id), payload);
      setFormName('');
      setTeamRows([emptyTeamRow(), emptyTeamRow(), emptyTeamRow(), emptyTeamRow()]);
      setSetsPerMatch(3);
      setMeetingsPerPair(1);
      setPointsToWin(25);
      setCourtCount(DEFAULT_COURT_COUNT);
      setScheduleFormat(DEFAULT_SCHEDULE_FORMAT);
      setPoolCountText(String(MIN_POOL_COUNT));
      setBulkTeams('');
      setBulkNotice('');
    } catch (e) {
      setError(firestoreRulesHint(e));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!pendingDelete || !isClubAdmin) return;
    setError('');
    setDeleting(true);
    try {
      // Clear the active pointer first, so nothing re-reads a document that is about
      // to disappear. deleteField() rather than null — TrackerView treats a missing
      // id as "no tournament", but would try to load the literal string "null".
      if (pendingDelete.id === activeTournamentId) {
        await setDoc(clubDoc(clubId), { activeTournamentId: deleteField() }, { merge: true });
      }
      await deleteDoc(tournamentDoc(clubId, pendingDelete.id));
      setEditingScheduleForId((cur) => (cur === pendingDelete.id ? null : cur));
      setEditingLocksForId((cur) => (cur === pendingDelete.id ? null : cur));
      setEditingTeamsForId((cur) => (cur === pendingDelete.id ? null : cur));
      setPendingDelete(null);
    } catch (e) {
      setError(firestoreRulesHint(e));
    } finally {
      setDeleting(false);
    }
  };

  const handleActivate = async (id) => {
    if (!isClubAdmin) {
      setError('Only a club admin can switch the active tournament.');
      return;
    }
    setError('');
    setSaving(true);
    try {
      await setDoc(clubDoc(clubId), { activeTournamentId: id }, { merge: true });
      navigate(`/c/${slug}`);
    } catch (e) {
      setError(firestoreRulesHint(e));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="p-4 text-center text-gray-600">Loading admin…</div>;
  }

  return (
    <div className="grid gap-6 max-w-3xl mx-auto">
      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Delete this tournament?"
        confirmLabel="Delete tournament"
        busy={deleting}
        onCancel={() => (deleting ? null : setPendingDelete(null))}
        onConfirm={handleDelete}
      >
        <p>
          <span className="font-semibold text-gray-900">{pendingDelete?.name}</span> and everything
          in it — {(pendingDelete?.teams || []).length} teams, {(pendingDelete?.scores || []).length}{' '}
          games, all scores, the schedule and any finals — will be permanently deleted.
        </p>
        {pendingDelete?.id === activeTournamentId && (
          <p className="text-amber-700 font-medium">
            This is the active tournament. The scores page will show no live games until you set
            another one active.
          </p>
        )}
        <p className="font-medium text-gray-900">This cannot be undone.</p>
      </ConfirmDialog>

      {listenError && (
        <div className="p-4 border border-red-200 bg-red-50 text-red-800 text-sm rounded-lg">
          {listenError}
        </div>
      )}
      <div className="p-4 border rounded-lg bg-white shadow-sm">
        <h2 className="text-xl font-bold mb-1">Create tournament</h2>
        <p className="text-sm text-gray-600 mb-4">
          Choose teams, how many sets decide each match, and how many times each pair of teams
          meets (e.g. 2 = double round robin).
        </p>

        <label className="block text-sm font-medium text-gray-700 mb-1">Tournament name</label>
        <input
          type="text"
          value={formName}
          onChange={(e) => setFormName(e.target.value)}
          className="border p-2 rounded w-full mb-4"
          placeholder="e.g. Spring league"
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Sets per match</label>
            <input
              type="number"
              min={1}
              max={5}
              value={setsPerMatch}
              onChange={(e) => setSetsPerMatch(e.target.value)}
              className="border p-2 rounded w-full"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Games vs each team
            </label>
            <input
              type="number"
              min={1}
              max={10}
              value={meetingsPerPair}
              onChange={(e) => setMeetingsPerPair(e.target.value)}
              className="border p-2 rounded w-full"
              title="How many times each pair plays each other"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Max points per set (cap)
            </label>
            <input
              type="number"
              min={1}
              max={50}
              value={pointsToWin}
              onChange={(e) => setPointsToWin(e.target.value)}
              className="border p-2 rounded w-full"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Courts</label>
            <input
              type="number"
              min={1}
              max={MAX_COURT_COUNT}
              value={courtCount}
              onChange={(e) => setCourtCount(e.target.value)}
              className="border p-2 rounded w-full"
              title="How many courts run at once. Can be changed later in Schedule."
            />
          </div>
        </div>

        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">Schedule format</label>
          <select
            value={scheduleFormat}
            onChange={(e) => setScheduleFormat(e.target.value)}
            className="border p-2 rounded w-full bg-white"
          >
            {Object.values(SCHEDULE_FORMATS).map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
          <p className="text-xs text-gray-600 mt-1">
            {(SCHEDULE_FORMATS[scheduleFormat] || SCHEDULE_FORMATS[DEFAULT_SCHEDULE_FORMAT])
              .description}
          </p>
        </div>

        {usePools && (
          <div className="mb-4 rounded-lg border border-indigo-200 bg-indigo-50/60 p-3">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="pool-count">
                  Number of pools
                </label>
                <input
                  id="pool-count"
                  type="number"
                  min={MIN_POOL_COUNT}
                  max={MAX_POOL_COUNT}
                  value={poolCountText}
                  onChange={(e) => setPoolCountText(e.target.value)}
                  // Snap to the allowed range only once editing stops, so an empty field
                  // or a half-typed number is never rewritten under the cursor.
                  onBlur={() => setPoolCountText(String(clampPoolCount(poolCountText)))}
                  className="border p-2 rounded w-24 min-h-[44px] bg-white"
                />
              </div>
              <button
                type="button"
                onClick={handleEvenSplit}
                className="text-sm bg-white border px-3 py-2 rounded-lg min-h-[44px] hover:bg-gray-100"
              >
                Even split
              </button>
            </div>
            <p className="text-xs text-gray-600 mt-2">
              Even split fills pools A–{poolLetter(poolCount - 1)} in the order below; change any
              team afterwards. Every team needs a pool, and no pool can have fewer than 2 teams.
            </p>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-700">
              {pools.map((pool) => (
                <span key={pool.name} className={pool.teams.length < 2 ? 'text-red-700' : ''}>
                  <span className="font-semibold">Pool {pool.name}</span>: {pool.teams.length}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-gray-700">
            Teams{' '}
            {scheduleFormat === 'skipAdjacent' && (
              <span className="font-normal text-gray-500">— order = seating around the circle</span>
            )}
          </span>
          <button
            type="button"
            onClick={addTeamRow}
            className="text-sm text-blue-600 underline"
          >
            Add team
          </button>
        </div>
        <div className="space-y-2 mb-4">
          {teamRows.map((row) => (
            <div key={row.id} className="flex gap-2 items-center">
              <input
                type="text"
                value={row.name}
                onChange={(e) => updateTeamRow(row.id, e.target.value)}
                className="border p-2 rounded flex-1 min-w-0"
                placeholder="Team name"
              />
              {usePools && (
                <select
                  aria-label={`Pool for ${row.name || 'this team'}`}
                  value={row.pool != null && row.pool < poolCount ? row.pool : ''}
                  onChange={(e) =>
                    updateTeamPool(row.id, e.target.value === '' ? null : Number(e.target.value))
                  }
                  className="border p-2 rounded bg-white min-h-[44px] shrink-0"
                >
                  <option value="">Pool…</option>
                  {Array.from({ length: poolCount }, (_, i) => (
                    <option key={i} value={i}>
                      {poolLetter(i)}
                    </option>
                  ))}
                </select>
              )}
              <button
                type="button"
                onClick={() => removeTeamRow(row.id)}
                className="text-sm text-red-600 px-2 shrink-0"
                disabled={teamRows.length <= 2}
              >
                Remove
              </button>
            </div>
          ))}
        </div>

        <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50 p-3">
          <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="bulk-teams">
            Paste a team list
          </label>
          <p className="text-xs text-gray-600 mb-2">
            Separated by commas, new lines, or both. Names already in the list above are
            skipped, and the rest are added to the end — reorder them there.
          </p>
          <textarea
            id="bulk-teams"
            value={bulkTeams}
            onChange={(e) => setBulkTeams(e.target.value)}
            rows={4}
            className="border p-2 rounded w-full font-mono text-sm"
            placeholder={'Red, Blue, Yellow\nGreen\nBlack'}
          />
          <div className="flex flex-wrap items-center gap-3 mt-2">
            <button
              type="button"
              onClick={handleAddBulkTeams}
              className="text-sm bg-white border px-3 py-2 rounded-lg min-h-[44px] hover:bg-gray-100"
            >
              Add to team list
            </button>
            {bulkNotice && <span className="text-sm text-gray-700">{bulkNotice}</span>}
          </div>
        </div>

        {(() => {
          const named = teamRows.map((r) => r.name.trim()).filter(Boolean);
          const games = previewGameCount(scheduleFormat, named.length, meetingsPerPair, {
            pools,
            teams: named,
          });
          if (!games) return null;
          return (
            <p className="text-sm text-gray-700 mb-3">
              <span className="font-semibold">{games}</span> league game{games === 1 ? '' : 's'} will
              be generated for {named.length} teams
              {usePools && <> across {poolCount} pools</>}.
            </p>
          );
        })()}

        {error && <div className="text-red-600 text-sm mb-2">{error}</div>}

        <button
          type="button"
          onClick={handleCreateTournament}
          disabled={saving || !isClubAdmin}
          className="bg-blue-600 text-white px-4 py-2 rounded min-h-[44px] disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Create'}
        </button>
        <p className="text-sm text-gray-600 mt-2">
          The new tournament appears in the list below. Nothing changes on the scores page
          until you choose <span className="font-medium">Set active</span> for it.
        </p>
        {!isClubAdmin && (
          <p className="text-sm text-amber-700 mt-2">
            Only a club admin can create or switch tournaments.
          </p>
        )}
      </div>

      <div className="p-4 border rounded-lg bg-white shadow-sm">
        <h3 className="text-lg font-bold mb-1">Tournaments</h3>
        <p className="text-sm text-gray-600 mb-3">
          <span className="font-medium">Hide</span> keeps a tournament off the public scores
          and completed pages. It is a display choice, not access control — the data stays
          readable to anyone who knows its address.
        </p>
        {tournaments.length === 0 ? (
          <p className="text-sm text-gray-600">No tournaments yet.</p>
        ) : (
          <ul className="divide-y">
            {tournaments.map((t) => (
              <li key={t.id} className="py-3 border-b border-gray-100 last:border-0">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <div>
                    <div className="font-medium">{t.name}</div>
                    <div className="text-xs text-gray-500">
                      {t.teams?.length ?? 0} teams · {t.setsPerMatch ?? '?'} sets/match ·{' '}
                      {t.meetingsPerPair ?? 1}× round robin
                      {t.id === activeTournamentId && (
                        <span className="ml-2 text-green-700 font-medium">Active</span>
                      )}
                      {t.hidden && (
                        <span className="ml-2 text-gray-700 font-medium">
                          Hidden from public pages
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setEditingTeamsForId((cur) => (cur === t.id ? null : t.id))}
                      className="text-sm bg-white border px-3 py-2 rounded-lg min-h-[44px] hover:bg-gray-50"
                    >
                      {editingTeamsForId === t.id ? 'Close teams' : 'Teams'}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setEditingScheduleForId((cur) => (cur === t.id ? null : t.id))
                      }
                      className="text-sm bg-white border px-3 py-2 rounded-lg min-h-[44px] hover:bg-gray-50"
                    >
                      {editingScheduleForId === t.id ? 'Close schedule' : 'Schedule'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingLocksForId((cur) => (cur === t.id ? null : t.id))}
                      className="text-sm bg-white border px-3 py-2 rounded-lg min-h-[44px] hover:bg-gray-50"
                    >
                      {editingLocksForId === t.id ? 'Close locks' : 'Locks'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleToggleHidden(t)}
                      disabled={saving || !isClubAdmin}
                      className="text-sm bg-white border px-3 py-2 rounded-lg min-h-[44px] hover:bg-gray-50 disabled:opacity-50"
                      title="Show or hide this tournament on the public scores and completed pages"
                    >
                      {t.hidden ? 'Show' : 'Hide'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleActivate(t.id)}
                      disabled={saving || !isClubAdmin || t.id === activeTournamentId}
                      className="text-sm bg-gray-100 border px-3 py-2 rounded-lg min-h-[44px] hover:bg-gray-200 disabled:opacity-50"
                    >
                      Set active
                    </button>
                    <button
                      type="button"
                      onClick={() => setPendingDelete(t)}
                      disabled={saving || !isClubAdmin}
                      className="text-sm bg-white border border-red-300 text-red-700 px-3 py-2 rounded-lg min-h-[44px] hover:bg-red-50 disabled:opacity-50"
                    >
                      Delete
                    </button>
                  </div>
                </div>
                {editingTeamsForId === t.id && (
                  <AdminTeamsEditor
                    key={`teams-${t.id}`}
                    tournament={t}
                    onClose={() => setEditingTeamsForId(null)}
                  />
                )}
                {editingScheduleForId === t.id && (
                  <ScheduleEditor
                    key={t.id}
                    tournament={t}
                    onClose={() => setEditingScheduleForId(null)}
                    onSaved={() => {}}
                  />
                )}
                {editingLocksForId === t.id && (
                  <AdminMatchLocks
                    tournament={t}
                    onClose={() => setEditingLocksForId(null)}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Membership is club-wide rather than per-tournament, so it sits alongside the
          tournament list rather than inside it. Collapsed by default — it is the one
          screen here an admin only visits when someone joins or leaves. */}
      {showMembers ? (
        <ClubMembersAdmin onClose={() => setShowMembers(false)} />
      ) : (
        <div className="p-4 border rounded-lg bg-white shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <h3 className="text-lg font-bold">Members</h3>
            <p className="text-sm text-gray-600">Invite scorers and admins, or change roles.</p>
          </div>
          <button
            type="button"
            onClick={() => setShowMembers(true)}
            className="text-sm bg-white border px-3 py-2 rounded-lg min-h-[44px] hover:bg-gray-50"
          >
            Manage members
          </button>
        </div>
      )}
    </div>
  );
}
