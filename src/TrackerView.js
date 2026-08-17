import React, { useState, useEffect, useCallback } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { Link } from 'react-router-dom';
import { auth, db } from './firebase';
import Login from './Login';
import AdminPage from './AdminPage';
import ScheduleTable from './ScheduleTable';
import FinalsView from './FinalsView';
import MatchScoreDialog from './MatchScoreDialog';
import { Card, CardContent } from './components/ui/card';
import { isTournamentComplete } from './CompletedTournamentsView';
import { isAdmin } from './roles';
import {
  buildDefaultScheduleSlots,
  calculateLeaderboard,
  getSetCap,
  matchSetSummary,
  matchSlotInfo,
  orderScoresBySchedule,
} from './tournamentUtils';

const SETTINGS_REF = doc(db, 'settings', 'app');

export default function TrackerView() {
  const [user, setUser] = useState(null);
  const [page, setPage] = useState('scores');
  const [scoresTab, setScoresTab] = useState('schedule');
  const [activeTournamentId, setActiveTournamentId] = useState(null);
  const [tournament, setTournament] = useState(null);
  const [scores, setScores] = useState([]);
  const [teams, setTeams] = useState([]);
  const [finalsMatches, setFinalsMatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openGame, setOpenGame] = useState(null);

  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, (u) => {
      setUser(u);
    });

    const unsubSettings = onSnapshot(SETTINGS_REF, (snap) => {
      if (snap.exists()) {
        setActiveTournamentId(snap.data().activeTournamentId || null);
      } else {
        setActiveTournamentId(null);
      }
    });

    return () => {
      unsubscribeAuth();
      unsubSettings();
    };
  }, []);

  useEffect(() => {
    if (!activeTournamentId) {
      setTournament(null);
      setScores([]);
      setTeams([]);
      setFinalsMatches([]);
      setLoading(false);
      return undefined;
    }

    setLoading(true);
    const ref = doc(db, 'tournaments', activeTournamentId);
    const unsub = onSnapshot(ref, (snap) => {
      if (!snap.exists()) {
        setTournament(null);
        setScores([]);
        setTeams([]);
        setFinalsMatches([]);
        setLoading(false);
        return;
      }
      const data = snap.data();
      setTournament({ id: snap.id, ...data });
      setScores(data.scores || []);
      setTeams(data.teams || []);
      setFinalsMatches(data.finalsMatches || []);
      setLoading(false);
    }, () => {
      setLoading(false);
    });

    return () => unsub();
  }, [activeTournamentId]);

  // `scores` and `finalsMatches` are component state that outlives a tournament switch.
  // When activeTournamentId changes, these effects re-run before the new document's
  // snapshot has replaced that state — and `loading` is still false in this render, since
  // the subscribe effect's setLoading(true) only takes effect on the next one. Writing
  // here would copy the previous tournament's results into the newly activated one, so
  // hold off until the loaded document is actually the active tournament.
  const loadedTournamentIsActive =
    Boolean(activeTournamentId) && tournament?.id === activeTournamentId;

  useEffect(() => {
    if (!user || loading || !loadedTournamentIsActive) return undefined;
    const saveScores = async () => {
      await setDoc(
        doc(db, 'tournaments', activeTournamentId),
        { scores },
        { merge: true }
      );
    };
    saveScores();
  }, [scores, user, loading, activeTournamentId, loadedTournamentIsActive]);

  useEffect(() => {
    if (!user || loading || !loadedTournamentIsActive) return undefined;
    const saveFinalsMatches = async () => {
      await setDoc(
        doc(db, 'tournaments', activeTournamentId),
        { finalsMatches },
        { merge: true }
      );
    };
    saveFinalsMatches();
  }, [finalsMatches, user, loading, activeTournamentId, loadedTournamentIsActive]);

  const scheduleSlots =
    tournament?.scheduleSlots?.length > 0
      ? tournament.scheduleSlots
      : buildDefaultScheduleSlots(scores);

  const hasSavedSchedule = Boolean(tournament?.scheduleSlots?.length);

  const orderedScores = orderScoresBySchedule(scores, scheduleSlots);

  const updateScoreInput = useCallback((game, setIndex, teamKey, value) => {
    setScores((prevScores) => {
      const matchIndex = prevScores.findIndex((m) => m.game === game);
      if (matchIndex < 0) return prevScores;
      if (prevScores[matchIndex]?.completed) return prevScores;
      const cap = getSetCap(prevScores[matchIndex].phase || 'pool', setIndex);
      const numericValue = Math.max(0, Math.min(cap, parseInt(value, 10) || 0));
      const updatedScores = [...prevScores];
      if (!updatedScores[matchIndex]?.sets?.[setIndex]) return prevScores;
      updatedScores[matchIndex] = {
        ...updatedScores[matchIndex],
        sets: [...updatedScores[matchIndex].sets],
      };
      updatedScores[matchIndex].sets[setIndex] = {
        ...updatedScores[matchIndex].sets[setIndex],
        [teamKey]: numericValue,
      };
      return updatedScores;
    });
  }, []);

  const adjustScoreDelta = useCallback((game, setIndex, teamKey, delta) => {
    setScores((prevScores) => {
      const matchIndex = prevScores.findIndex((m) => m.game === game);
      if (matchIndex < 0) return prevScores;
      if (prevScores[matchIndex]?.completed) return prevScores;
      const cap = getSetCap(prevScores[matchIndex].phase || 'pool', setIndex);
      const updatedScores = [...prevScores];
      if (!updatedScores[matchIndex]?.sets?.[setIndex]) return prevScores;
      const cur = updatedScores[matchIndex].sets[setIndex][teamKey];
      const curN = Math.max(0, Math.min(cap, parseInt(cur, 10) || 0));
      const next = Math.max(0, Math.min(cap, curN + delta));
      if (next === curN) return prevScores;
      updatedScores[matchIndex] = {
        ...updatedScores[matchIndex],
        sets: [...updatedScores[matchIndex].sets],
      };
      updatedScores[matchIndex].sets[setIndex] = {
        ...updatedScores[matchIndex].sets[setIndex],
        [teamKey]: next,
      };
      return updatedScores;
    });
  }, []);

  // Returns whether the game was actually marked, so the scoring dialog knows
  // whether to close or to stay open on a dismissed confirm.
  const markMatchComplete = useCallback(
    (game) => {
      if (!user) return false;
      if (
        !window.confirm(
          'Mark this game complete? Scores will be locked until an admin unlocks them under Admin → Locks.'
        )
      ) {
        return false;
      }
      setScores((prev) =>
        prev.map((m) => (m.game === game ? { ...m, completed: true } : m))
      );
      return true;
    },
    [user]
  );

  const toggleMatchPhase = useCallback((game) => {
    if (!user) return;
    setScores((prev) =>
      prev.map((m) => {
        if (m.game !== game || m.completed) return m;
        return { ...m, phase: m.phase === 'finals' ? 'pool' : 'finals' };
      })
    );
  }, [user]);

  const leaderboard = calculateLeaderboard(
    scores,
    teams,
    tournament?.setsPerMatch ?? 3
  );

  const scheduleTitle =
    tournament?.scheduleTitle ||
    (teams.length ? `${teams.length} Teams Format` : 'Tournament schedule');
  const scheduleSubtitle = tournament?.scheduleSubtitle || tournament?.name || '';

  // Clicking a game anywhere — schedule row or score tile — goes straight to scoring it.
  const onScheduleMatchClick = useCallback((gameId) => {
    setScoresTab('scores');
    setOpenGame(gameId);
  }, []);

  // The open game can vanish under us: a tournament switch, or an admin rebuilding
  // the match list. Deriving it rather than storing the match keeps the dialog in
  // sync with live score edits, and drops it when the id no longer resolves.
  const openMatch = openGame ? scores.find((m) => m.game === openGame) : null;

  useEffect(() => {
    if (openGame && !openMatch) setOpenGame(null);
  }, [openGame, openMatch]);

  // Admin is for admin accounts only. Falling back to Scores when that stops being
  // true covers both logging out and signing back in as a scorer.
  const admin = isAdmin(user);
  useEffect(() => {
    if (!admin) setPage('scores');
  }, [admin]);

  return (
    <div className="min-h-screen bg-gray-50/80 pb-8 sm:pb-6">
      <div className="grid gap-4 p-3 sm:p-4 max-w-5xl mx-auto">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => setPage('scores')}
              className={`px-4 py-3 rounded-xl text-sm font-semibold min-h-[48px] ${
                page === 'scores' ? 'bg-blue-600 text-white shadow' : 'bg-white border border-gray-200 text-gray-800'
              }`}
            >
              Scores
            </button>
            {admin && (
              <button
                type="button"
                onClick={() => setPage('admin')}
                className={`px-4 py-3 rounded-xl text-sm font-semibold min-h-[48px] ${
                  page === 'admin' ? 'bg-blue-600 text-white shadow' : 'bg-white border border-gray-200 text-gray-800'
                }`}
              >
                Admin
              </button>
            )}
          </div>
          <Login user={user} setUser={setUser} />
        </header>

        {page === 'admin' && admin && (
          <AdminPage user={user} onNavigateScores={() => setPage('scores')} />
        )}

        {page === 'scores' && (
          <>
            {loading && (
              <div className="p-6 text-center text-gray-600">Loading tournament…</div>
            )}

            {!loading && !activeTournamentId && (
              <Card>
                <CardContent className="p-6 text-center text-gray-700">
                  <p className="mb-3">
                    {admin
                      ? 'No active tournament. Use Admin to create one and set it active.'
                      : 'No active tournament right now.'}
                  </p>
                  {admin && (
                    <button
                      type="button"
                      onClick={() => setPage('admin')}
                      className="bg-blue-600 text-white px-5 py-3 rounded-xl text-sm font-medium min-h-[48px]"
                    >
                      Open Admin
                    </button>
                  )}
                </CardContent>
              </Card>
            )}

            {!loading && activeTournamentId && !tournament && (
              <Card>
                <CardContent className="p-6 text-center text-amber-800">
                  Active tournament was removed. Choose another in Admin.
                </CardContent>
              </Card>
            )}

            {!loading && tournament && isTournamentComplete(tournament) && (
              <div className="grid gap-4">
                <div className="rounded-2xl border-2 border-gray-200 bg-white p-8 text-center shadow-sm">
                  <div className="text-5xl mb-4">🏐</div>
                  <h2 className="text-2xl font-bold text-gray-900 mb-2">No games live</h2>
                  <p className="text-gray-500 mb-6">
                    <span className="font-medium text-gray-700">{tournament.name}</span> has concluded.
                  </p>
                  <Link
                    to="/completed"
                    className="inline-flex items-center justify-center min-h-[48px] px-6 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-sm transition-colors"
                  >
                    View completed tournaments →
                  </Link>
                </div>
              </div>
            )}

            {!loading && tournament && !isTournamentComplete(tournament) && (
              <>
                <div className="text-center px-1">
                  <h1 className="text-xl sm:text-2xl font-bold text-gray-900">{tournament.name}</h1>
                  <p className="text-sm text-gray-600 mt-1">
                    {teams.length} teams · Pool: 21 pts (cap 25), 3rd set 15 (cap 18) · Finals: 25 pts (cap 28), 3rd set 15
                  </p>
                </div>

                <nav
                  className="sticky top-0 z-30 -mx-1 px-1 py-2 bg-gray-50/95 backdrop-blur-sm border-b border-gray-200/80 sm:border-0 sm:bg-transparent sm:static sm:backdrop-blur-none"
                  aria-label="Tournament sections"
                >
                  <div className="flex rounded-xl bg-white shadow-sm border border-gray-200 p-1 gap-1">
                    {[
                      { id: 'schedule', label: 'Schedule' },
                      { id: 'scores', label: 'Pool scores' },
                      { id: 'finals', label: '🏆 Finals' },
                      { id: 'table', label: 'Table' },
                    ].map((tab) => (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setScoresTab(tab.id)}
                        className={`flex-1 py-3 px-2 rounded-lg text-xs sm:text-sm font-semibold min-h-[48px] transition-colors ${
                          scoresTab === tab.id
                            ? 'bg-blue-600 text-white shadow-sm'
                            : 'text-gray-700 hover:bg-gray-100'
                        }`}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>
                </nav>

                {!hasSavedSchedule && admin && (
                  <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    Schedule is auto-paired from the match list. Open{' '}
                    <button
                      type="button"
                      className="underline font-medium"
                      onClick={() => setPage('admin')}
                    >
                      Admin → Schedule
                    </button>{' '}
                    to set times, umpires, breaks, and order.
                  </p>
                )}

                {scoresTab === 'schedule' && (
                  <Card>
                    <CardContent className="p-3 sm:p-4 overflow-x-auto">
                      <ScheduleTable
                        title={scheduleTitle}
                        subtitle={scheduleSubtitle}
                        scores={scores}
                        scheduleSlots={scheduleSlots}
                        onMatchClick={onScheduleMatchClick}
                      />
                    </CardContent>
                  </Card>
                )}

                {scoresTab === 'table' && (
                  <Card>
                    <CardContent className="p-3 sm:p-4">
                      <h2 className="text-xl font-bold mb-2 text-center">Leaderboard</h2>
                      <p className="text-xs text-gray-600 text-center mb-4 max-w-xl mx-auto">
                        Ranked by tournament points from <strong>completed</strong> games.
                        Win = 3 pts + 3 bonus (sweep 2-0) or + 2 bonus (win 2-1).
                        Losing team earns 1 pt if they won a set.
                        Max 6 pts / min 5 pts per match won.
                        Tiebreakers: point differential in sets of matches you won, then head-to-head.
                      </p>
                      <p className="md:hidden text-xs text-gray-500 text-center mb-2">
                        Swipe sideways on the table to see every column.
                      </p>
                      <div className="overflow-x-auto overscroll-x-contain rounded-lg border border-gray-200 -mx-1 px-1 sm:mx-0 sm:px-0">
                        <table className="w-full text-left text-sm min-w-[34rem] sm:min-w-0">
                          <thead className="bg-gray-100 text-gray-800">
                            <tr>
                              <th className="p-2 sm:p-3 font-semibold w-9 text-center whitespace-nowrap">
                                #
                              </th>
                              <th className="p-2 sm:p-3 font-semibold whitespace-nowrap min-w-[5rem]">
                                Team
                              </th>
                              <th
                                className="p-2 sm:p-3 font-semibold text-right whitespace-nowrap"
                                title="Tournament points (sets + win bonus)"
                              >
                                Pts
                              </th>
                              <th
                                className="p-2 sm:p-3 font-semibold text-right whitespace-nowrap"
                                title="Point differential in sets of matches this team won"
                              >
                                <span className="sm:hidden">PD</span>
                                <span className="hidden sm:inline">Won-match PD</span>
                              </th>
                              <th
                                className="p-2 sm:p-3 font-semibold text-right whitespace-nowrap"
                                title="Matches won (completed games only)"
                              >
                                W
                              </th>
                              <th
                                className="p-2 sm:p-3 font-semibold text-right whitespace-nowrap"
                                title="Total sets won in completed games"
                              >
                                Sets
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {leaderboard.map(([team, data], index) => (
                              <tr
                                key={team}
                                className={
                                  index === 0
                                    ? 'bg-amber-50 font-medium border-t-2 border-amber-200'
                                    : index % 2 === 1
                                      ? 'bg-gray-50'
                                      : 'bg-white'
                                }
                              >
                                <td className="p-2 sm:p-3 text-center text-gray-700 whitespace-nowrap">
                                  {index + 1}
                                </td>
                                <td className="p-2 sm:p-3 max-w-[9rem] sm:max-w-none truncate sm:whitespace-normal">
                                  {team}
                                </td>
                                <td className="p-2 sm:p-3 text-right tabular-nums whitespace-nowrap">
                                  {data.tournamentPoints}
                                </td>
                                <td className="p-2 sm:p-3 text-right tabular-nums whitespace-nowrap">
                                  {data.winMatchPointDiff > 0 ? '+' : ''}
                                  {data.winMatchPointDiff}
                                </td>
                                <td className="p-2 sm:p-3 text-right tabular-nums whitespace-nowrap">
                                  {data.matchesWon}
                                </td>
                                <td className="p-2 sm:p-3 text-right tabular-nums whitespace-nowrap">
                                  {data.setsWon}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {scoresTab === 'finals' && (
                  <FinalsView
                    teams={teams}
                    finalsMatches={finalsMatches}
                    setFinalsMatches={setFinalsMatches}
                    user={user}
                    setsPerMatch={tournament?.setsPerMatch ?? 3}
                  />
                )}

                {scoresTab === 'scores' && (
                  <div className="grid gap-4">
                    <p className="text-sm text-gray-600 bg-white border border-gray-200 rounded-xl px-4 py-3 text-center">
                      {user
                        ? 'Tap a game to open it and enter the score. It reopens wherever you left off, so you can close it mid-game.'
                        : 'Tap a game to see its score. Log in to enter or adjust scores.'}
                    </p>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {orderedScores.map((match) => {
                        const locked = Boolean(match.completed);
                        const slot = matchSlotInfo(match, scheduleSlots);
                        const { team1: sets1, team2: sets2, setsPlayed } = matchSetSummary(match);
                        const started = setsPlayed > 0;
                        // Unplayed sets are all 0-0; listing them would read as a real score.
                        const playedSets = match.sets.filter(
                          (s) => (Number(s.team1) || 0) !== 0 || (Number(s.team2) || 0) !== 0
                        );
                        return (
                          <button
                            key={match.game}
                            type="button"
                            onClick={() => setOpenGame(match.game)}
                            className={`text-left rounded-2xl border-2 p-4 shadow-sm transition-colors hover:border-blue-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                              locked
                                ? 'border-gray-200 bg-gray-50'
                                : started
                                  ? 'border-blue-300 bg-white'
                                  : 'border-gray-200 bg-white'
                            }`}
                          >
                            <div className="flex items-baseline justify-between gap-2 mb-2">
                              <span className="text-xs font-semibold uppercase tracking-wide text-gray-500 truncate">
                                {slot ? `${slot.when} · Court ${slot.court}` : match.game}
                              </span>
                              {match.phase === 'finals' && (
                                <span className="shrink-0 text-[0.65rem] font-bold uppercase tracking-wide text-amber-700 bg-amber-100 px-2 py-0.5 rounded">
                                  Finals
                                </span>
                              )}
                            </div>

                            {[
                              ['team1', sets1],
                              ['team2', sets2],
                            ].map(([teamKey, setsWon]) => (
                              <div
                                key={teamKey}
                                className="flex items-center justify-between gap-3 py-0.5"
                              >
                                <span className="font-semibold text-gray-900 truncate">
                                  {match[teamKey]}
                                </span>
                                <span className="shrink-0 flex items-baseline gap-2 tabular-nums">
                                  <span className="text-xs text-gray-500">
                                    {playedSets.length
                                      ? playedSets.map((s) => s[teamKey]).join(' · ')
                                      : '—'}
                                  </span>
                                  <span className="text-lg font-bold text-gray-900 w-4 text-right">
                                    {setsWon}
                                  </span>
                                </span>
                              </div>
                            ))}

                            <div className="mt-3">
                              <span
                                className={`inline-flex items-center text-xs font-semibold px-2.5 py-1 rounded-lg ${
                                  locked
                                    ? 'bg-gray-200/80 text-gray-700'
                                    : started
                                      ? 'bg-blue-100 text-blue-800'
                                      : 'bg-gray-100 text-gray-600'
                                }`}
                              >
                                {locked
                                  ? 'Complete · locked'
                                  : started
                                    ? 'In progress'
                                    : 'Not started'}
                              </span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>

      {openMatch && (
        <MatchScoreDialog
          match={openMatch}
          scheduleSlots={scheduleSlots}
          user={user}
          onClose={() => setOpenGame(null)}
          onAdjust={adjustScoreDelta}
          onInput={updateScoreInput}
          onTogglePhase={toggleMatchPhase}
          onMarkComplete={markMatchComplete}
        />
      )}
    </div>
  );
}
