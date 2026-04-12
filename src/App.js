import React, { useState, useEffect, useCallback, useRef } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { auth, db } from './firebase';
import Login from './Login';
import AdminPage from './AdminPage';
import ScheduleTable from './ScheduleTable';
import { Card, CardContent } from './components/ui/card';
import {
  buildDefaultScheduleSlots,
  calculateLeaderboard,
  formatMatchHeadingForScores,
  orderScoresBySchedule,
} from './tournamentUtils';

const SETTINGS_REF = doc(db, 'settings', 'app');

export default function App() {
  const [user, setUser] = useState(null);
  const [page, setPage] = useState('scores');
  const [scoresTab, setScoresTab] = useState('schedule');
  const [activeTournamentId, setActiveTournamentId] = useState(null);
  const [tournament, setTournament] = useState(null);
  const [scores, setScores] = useState([]);
  const [teams, setTeams] = useState([]);
  const [pointsToWin, setPointsToWin] = useState(25);
  const [loading, setLoading] = useState(true);
  const [jumpToGame, setJumpToGame] = useState(null);
  const matchCardRefs = useRef({});

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
        setLoading(false);
        return;
      }
      const data = snap.data();
      setTournament({ id: snap.id, ...data });
      setScores(data.scores || []);
      setTeams(data.teams || []);
      setPointsToWin(
        typeof data.pointsToWin === 'number' && data.pointsToWin > 0 ? data.pointsToWin : 25
      );
      setLoading(false);
    }, () => {
      setLoading(false);
    });

    return () => unsub();
  }, [activeTournamentId]);

  useEffect(() => {
    if (!user || loading || !activeTournamentId || !tournament) return undefined;
    const saveScores = async () => {
      await setDoc(
        doc(db, 'tournaments', activeTournamentId),
        { scores },
        { merge: true }
      );
    };
    saveScores();
  }, [scores, user, loading, activeTournamentId, tournament]);

  const scheduleSlots =
    tournament?.scheduleSlots?.length > 0
      ? tournament.scheduleSlots
      : buildDefaultScheduleSlots(scores);

  const hasSavedSchedule = Boolean(tournament?.scheduleSlots?.length);

  const orderedScores = orderScoresBySchedule(scores, scheduleSlots);

  const updateScoreInput = useCallback((game, setIndex, teamKey, value) => {
    const cap = pointsToWin;
    const numericValue = Math.max(0, Math.min(cap, parseInt(value, 10) || 0));
    setScores((prevScores) => {
      const matchIndex = prevScores.findIndex((m) => m.game === game);
      if (matchIndex < 0) return prevScores;
      if (prevScores[matchIndex]?.completed) return prevScores;
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
  }, [pointsToWin]);

  const markMatchComplete = useCallback(
    (game) => {
      if (!user) return;
      if (
        !window.confirm(
          'Mark this game complete? Scores will be locked until an admin unlocks them under Admin → Locks.'
        )
      ) {
        return;
      }
      setScores((prev) =>
        prev.map((m) => (m.game === game ? { ...m, completed: true } : m))
      );
    },
    [user]
  );

  const leaderboard = calculateLeaderboard(
    scores,
    teams,
    tournament?.setsPerMatch ?? 3
  );

  const scheduleTitle =
    tournament?.scheduleTitle ||
    (teams.length ? `${teams.length} Teams Format` : 'Tournament schedule');
  const scheduleSubtitle = tournament?.scheduleSubtitle || tournament?.name || '';

  const onScheduleMatchClick = useCallback((gameId) => {
    setScoresTab('scores');
    setJumpToGame(gameId);
    window.requestAnimationFrame(() => {
      const el = matchCardRefs.current[gameId];
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, []);

  useEffect(() => {
    if (!jumpToGame) return undefined;
    const t = window.setTimeout(() => setJumpToGame(null), 2500);
    return () => window.clearTimeout(t);
  }, [jumpToGame]);

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
            <button
              type="button"
              onClick={() => setPage('admin')}
              className={`px-4 py-3 rounded-xl text-sm font-semibold min-h-[48px] ${
                page === 'admin' ? 'bg-blue-600 text-white shadow' : 'bg-white border border-gray-200 text-gray-800'
              }`}
            >
              Admin
            </button>
          </div>
          <Login user={user} setUser={setUser} />
        </header>

        {page === 'admin' && (
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
                  <p className="mb-3">No active tournament. Use Admin to create one and set it active.</p>
                  <button
                    type="button"
                    onClick={() => setPage('admin')}
                    className="bg-blue-600 text-white px-5 py-3 rounded-xl text-sm font-medium min-h-[48px]"
                  >
                    Open Admin
                  </button>
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

            {!loading && tournament && (
              <>
                <div className="text-center px-1">
                  <h1 className="text-xl sm:text-2xl font-bold text-gray-900">{tournament.name}</h1>
                  <p className="text-sm text-gray-600 mt-1">
                    {teams.length} teams · cap {pointsToWin} pts per set
                  </p>
                </div>

                <nav
                  className="sticky top-0 z-30 -mx-1 px-1 py-2 bg-gray-50/95 backdrop-blur-sm border-b border-gray-200/80 sm:border-0 sm:bg-transparent sm:static sm:backdrop-blur-none"
                  aria-label="Tournament sections"
                >
                  <div className="flex rounded-xl bg-white shadow-sm border border-gray-200 p-1 gap-1">
                    {[
                      { id: 'schedule', label: 'Schedule' },
                      { id: 'scores', label: 'Enter scores' },
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

                {!hasSavedSchedule && (
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
                        Ranked by tournament points from <strong>completed</strong> games: 2 pts per set
                        won, +2 bonus for a sweep, +1 bonus if the loser won a set. Tiebreakers: point
                        differential in sets from matches you won, then head-to-head.
                      </p>
                      <div className="overflow-x-auto rounded-lg border border-gray-200">
                        <table className="w-full text-left text-sm min-w-[320px]">
                          <thead className="bg-gray-100 text-gray-800">
                            <tr>
                              <th className="p-2 sm:p-3 font-semibold w-10 text-center">#</th>
                              <th className="p-2 sm:p-3 font-semibold">Team</th>
                              <th
                                className="p-2 sm:p-3 font-semibold text-right"
                                title="Tournament points (sets + win bonus)"
                              >
                                Pts
                              </th>
                              <th
                                className="p-2 sm:p-3 font-semibold text-right hidden sm:table-cell"
                                title="Point differential in sets of matches this team won"
                              >
                                Won-match PD
                              </th>
                              <th
                                className="p-2 sm:p-3 font-semibold text-right hidden md:table-cell"
                                title="Matches won (completed games only)"
                              >
                                W
                              </th>
                              <th
                                className="p-2 sm:p-3 font-semibold text-right hidden md:table-cell"
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
                                <td className="p-2 sm:p-3 text-center text-gray-700">{index + 1}</td>
                                <td className="p-2 sm:p-3">{team}</td>
                                <td className="p-2 sm:p-3 text-right tabular-nums">
                                  {data.tournamentPoints}
                                </td>
                                <td className="p-2 sm:p-3 text-right tabular-nums hidden sm:table-cell">
                                  {data.winMatchPointDiff > 0 ? '+' : ''}
                                  {data.winMatchPointDiff}
                                </td>
                                <td className="p-2 sm:p-3 text-right tabular-nums hidden md:table-cell">
                                  {data.matchesWon}
                                </td>
                                <td className="p-2 sm:p-3 text-right tabular-nums hidden md:table-cell">
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

                {scoresTab === 'scores' && (
                  <div className="grid gap-4">
                    {orderedScores.map((match) => {
                      const locked = Boolean(match.completed);
                      const heading = formatMatchHeadingForScores(match, scheduleSlots);
                      return (
                      <div
                        key={match.game}
                        ref={(el) => {
                          if (el) matchCardRefs.current[match.game] = el;
                          else delete matchCardRefs.current[match.game];
                        }}
                        className={`scroll-mt-28 transition-shadow rounded-2xl ${
                          jumpToGame === match.game ? 'ring-2 ring-blue-500 shadow-lg' : ''
                        } ${locked ? 'opacity-95' : ''}`}
                      >
                        <Card>
                        <CardContent className="p-4">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-3">
                            <h2 className="text-lg font-bold text-gray-900 leading-snug pr-2">
                              {heading}
                            </h2>
                            <div className="flex flex-col sm:items-end gap-2 shrink-0">
                              {locked ? (
                                <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-600 bg-gray-200/80 px-3 py-1.5 rounded-lg">
                                  Complete · locked
                                </span>
                              ) : (
                                user && (
                                  <button
                                    type="button"
                                    onClick={() => markMatchComplete(match.game)}
                                    className="text-sm font-semibold bg-green-700 text-white px-4 py-3 rounded-xl min-h-[48px] hover:bg-green-800 active:bg-green-900"
                                  >
                                    Mark game complete
                                  </button>
                                )
                              )}
                            </div>
                          </div>
                          {locked && (
                            <p className="text-xs text-gray-600 mb-3">
                              Scores are read-only. An admin can unlock this game under Admin → Locks.
                            </p>
                          )}
                          {match.sets.map((set, setIndex) => (
                            <div key={setIndex} className="mb-4 last:mb-0">
                              <h3 className="font-semibold text-sm text-gray-600 mb-2">
                                Set {setIndex + 1}
                              </h3>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                {['team1', 'team2'].map((teamKey) => (
                                  <div
                                    key={teamKey}
                                    className="flex items-center justify-between gap-3 bg-gray-50 rounded-xl px-3 py-2"
                                  >
                                    <label className="font-medium text-sm flex-1 min-w-0 truncate">
                                      {match[teamKey]}
                                    </label>
                                    <input
                                      type="number"
                                      inputMode="numeric"
                                      min={0}
                                      max={pointsToWin}
                                      value={set[teamKey]}
                                      onChange={(e) =>
                                        updateScoreInput(
                                          match.game,
                                          setIndex,
                                          teamKey,
                                          e.target.value
                                        )
                                      }
                                      disabled={!user || locked}
                                      className="border border-gray-300 rounded-xl w-24 text-center text-lg py-3 min-h-[48px] bg-white disabled:bg-gray-100 disabled:text-gray-700"
                                    />
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </CardContent>
                        </Card>
                      </div>
                    );
                    })}
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
