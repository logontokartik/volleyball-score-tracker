import React, { useEffect, useState } from 'react';
import {
  collection,
  doc,
  onSnapshot,
  setDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from './firebase';
import {
  buildDefaultScheduleSlots,
  buildRoundRobinSchedule,
  matchesWithEmptySets,
} from './tournamentUtils';
import ScheduleEditor from './ScheduleEditor';
import AdminMatchLocks from './AdminMatchLocks';

const SETTINGS_REF = doc(db, 'settings', 'app');

function firestoreRulesHint(err) {
  const code = err?.code;
  const message = typeof err?.message === 'string' ? err.message : '';
  if (
    code === 'permission-denied' ||
    message.toLowerCase().includes('permission') ||
    message.toLowerCase().includes('insufficient')
  ) {
    return 'Firestore blocked this request. In Firebase Console → Firestore → Rules, allow access to settings and tournaments (copy from firestore.rules in this project), then click Publish. Signing in does not bypass rules.';
  }
  return message || 'Request failed.';
}

function emptyTeamRow() {
  return { id: crypto.randomUUID(), name: '' };
}

export default function AdminPage({ user, onNavigateScores }) {
  const [tournaments, setTournaments] = useState([]);
  const [activeTournamentId, setActiveTournamentId] = useState(null);
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
  const [editingScheduleForId, setEditingScheduleForId] = useState(null);
  const [editingLocksForId, setEditingLocksForId] = useState(null);

  useEffect(() => {
    let settingsReady = false;
    let listReady = false;
    const tryClearListenError = () => {
      if (settingsReady && listReady) setListenError('');
    };

    const unsubSettings = onSnapshot(
      SETTINGS_REF,
      (snap) => {
        if (snap.exists()) {
          setActiveTournamentId(snap.data().activeTournamentId || null);
        } else {
          setActiveTournamentId(null);
        }
        settingsReady = true;
        tryClearListenError();
      },
      (err) => {
        setListenError(firestoreRulesHint(err));
        setLoading(false);
      }
    );

    const unsubList = onSnapshot(
      collection(db, 'tournaments'),
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
        listReady = true;
        tryClearListenError();
      },
      (err) => {
        setListenError(firestoreRulesHint(err));
        setLoading(false);
      }
    );

    return () => {
      unsubSettings();
      unsubList();
    };
  }, []);

  const addTeamRow = () => setTeamRows((rows) => [...rows, emptyTeamRow()]);
  const removeTeamRow = (id) =>
    setTeamRows((rows) => (rows.length <= 2 ? rows : rows.filter((r) => r.id !== id)));
  const updateTeamRow = (id, name) =>
    setTeamRows((rows) => rows.map((r) => (r.id === id ? { ...r, name } : r)));

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

    const scheduled = buildRoundRobinSchedule(teamNames, mpp);
    const scores = matchesWithEmptySets(scheduled, spm);
    const scheduleSlots = buildDefaultScheduleSlots(scores);

    const id = doc(collection(db, 'tournaments')).id;
    const payload = {
      name: formName.trim(),
      teams: teamNames,
      setsPerMatch: spm,
      meetingsPerPair: mpp,
      pointsToWin: ptw,
      scores,
      scheduleSlots,
      scheduleTitle: `${teamNames.length} Teams Format`,
      scheduleSubtitle: formName.trim(),
      createdAt: serverTimestamp(),
    };

    if (!user) {
      setError('Log in to create a tournament.');
      return;
    }

    setSaving(true);
    try {
      await setDoc(doc(db, 'tournaments', id), payload);
      await setDoc(SETTINGS_REF, { activeTournamentId: id }, { merge: true });
      setFormName('');
      setTeamRows([emptyTeamRow(), emptyTeamRow(), emptyTeamRow(), emptyTeamRow()]);
      setSetsPerMatch(3);
      setMeetingsPerPair(1);
      setPointsToWin(25);
      if (onNavigateScores) onNavigateScores();
    } catch (e) {
      setError(firestoreRulesHint(e));
    } finally {
      setSaving(false);
    }
  };

  const handleActivate = async (id) => {
    if (!user) {
      setError('Log in to switch the active tournament.');
      return;
    }
    setError('');
    setSaving(true);
    try {
      await setDoc(SETTINGS_REF, { activeTournamentId: id }, { merge: true });
      if (onNavigateScores) onNavigateScores();
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

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
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
        </div>

        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-gray-700">Teams</span>
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
                className="border p-2 rounded flex-1"
                placeholder="Team name"
              />
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

        {error && <div className="text-red-600 text-sm mb-2">{error}</div>}

        <button
          type="button"
          onClick={handleCreateTournament}
          disabled={saving || !user}
          className="bg-blue-600 text-white px-4 py-2 rounded disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Create and set active'}
        </button>
        {!user && (
          <p className="text-sm text-amber-700 mt-2">Log in to create or switch tournaments.</p>
        )}
      </div>

      <div className="p-4 border rounded-lg bg-white shadow-sm">
        <h3 className="text-lg font-bold mb-3">Tournaments</h3>
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
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
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
                      onClick={() => handleActivate(t.id)}
                      disabled={saving || !user || t.id === activeTournamentId}
                      className="text-sm bg-gray-100 border px-3 py-2 rounded-lg min-h-[44px] hover:bg-gray-200 disabled:opacity-50"
                    >
                      Set active
                    </button>
                  </div>
                </div>
                {editingScheduleForId === t.id && (
                  <ScheduleEditor
                    key={t.id}
                    tournament={t}
                    user={user}
                    onClose={() => setEditingScheduleForId(null)}
                    onSaved={() => {}}
                  />
                )}
                {editingLocksForId === t.id && (
                  <AdminMatchLocks
                    tournament={t}
                    user={user}
                    onClose={() => setEditingLocksForId(null)}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
