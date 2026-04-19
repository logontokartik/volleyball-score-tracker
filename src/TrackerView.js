import React, { useState, useEffect, useCallback, useRef } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { Link } from 'react-router-dom';
import { auth, db } from './firebase';
import Login from './Login';
import AdminPage from './AdminPage';
import ScheduleTable from './ScheduleTable';
import FinalsView from './FinalsView';
import { Card, CardContent } from './components/ui/card';
import { isTournamentComplete } from './CompletedTournamentsView';
import {
  buildDefaultScheduleSlots,
  calculateLeaderboard,
  formatMatchHeadingForScores,
  getSetCap,
  getSetTarget,
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
      setFinalsMatches(data.finalsMatches || []);
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

  useEffect(() => {
    if (!user || loading || !activeTournamentId || !tournament) return undefined;
    const saveFinalsMatches = async () => {
      await setDoc(
        doc(db, 'tournaments', activeTournamentId),
        { finalsMatches },
        { merge: true }
      );
    };
    saveFinalsMatches();
  }, [finalsMatches, user, loading, activeTournamentId, tournament]);

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
                    {user && (
                      <p className="text-sm text-gray-600 bg-white border border-gray-200 rounded-xl px-4 py-3 text-center">
                        Tap <span className="font-bold text-gray-900">−</span> /{' '}
                        <span className="font-bold text-gray-900">+</span> to change points, or type a
                        number. Caps vary by game phase (pool / finals) and set.
                      </p>
                    )}
                    {!user && (
                      <p className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-center">
                        Log in to enter or adjust scores.
                      </p>
                    )}
                    {orderedScores.map((match) => {
                      const locked = Boolean(match.completed);
                      const heading = formatMatchHeadingForScores(match, scheduleSlots);
                      const phase = match.phase || 'pool';
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
                            <div>
                              <h2 className="text-lg font-bold text-gray-900 leading-snug pr-2">
                                {heading}
                              </h2>
                              <p className="text-xs text-gray-500 mt-1">
                                {phase === 'finals'
                                  ? 'Finals: 25 pts (cap 28), 3rd set 15'
                                  : 'Pool: 21 pts (cap 25), 3rd set 15 (cap 18)'}
                                {' · win by 2'}
                              </p>
                            </div>
                            <div className="flex flex-col sm:items-end gap-2 shrink-0">
                              {/* Phase selector — always visible, toggle only for logged-in users */}
                              <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden text-xs font-semibold">
                                <button
                                  type="button"
                                  disabled={!user || locked}
                                  onClick={() => phase !== 'pool' && toggleMatchPhase(match.game)}
                                  className={`px-3 py-1.5 transition-colors ${
                                    phase === 'pool'
                                      ? 'bg-blue-600 text-white'
                                      : 'bg-white text-gray-500 hover:bg-gray-50 disabled:hover:bg-white'
                                  }`}
                                >
                                  Pool play
                                </button>
                                <button
                                  type="button"
                                  disabled={!user || locked}
                                  onClick={() => phase !== 'finals' && toggleMatchPhase(match.game)}
                                  className={`px-3 py-1.5 border-l border-gray-200 transition-colors ${
                                    phase === 'finals'
                                      ? 'bg-amber-500 text-white'
                                      : 'bg-white text-gray-500 hover:bg-gray-50 disabled:hover:bg-white'
                                  }`}
                                >
                                  Finals
                                </button>
                              </div>
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
                          {match.sets.map((set, setIndex) => {
                            const setCap = getSetCap(phase, setIndex);
                            const setTarget = getSetTarget(phase, setIndex);
                            return (
                            <div key={setIndex} className="mb-4 last:mb-0">
                              <h3 className="font-semibold text-sm text-gray-600 mb-2">
                                Set {setIndex + 1}
                                <span className="font-normal text-xs text-gray-400 ml-2">
                                  (to {setTarget}, cap {setCap})
                                </span>
                              </h3>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                {['team1', 'team2'].map((teamKey) => (
                                  <div
                                    key={teamKey}
                                    className="flex flex-col gap-2 bg-gray-50 rounded-xl px-3 py-3"
                                  >
                                    <label className="font-medium text-sm text-gray-800">
                                      {match[teamKey]}
                                    </label>
                                    <div className="flex items-center justify-center gap-2 sm:gap-3">
                                      <button
                                        type="button"
                                        aria-label={`Subtract one point for ${match[teamKey]}`}
                                        disabled={!user || locked || set[teamKey] <= 0}
                                        onClick={() =>
                                          adjustScoreDelta(match.game, setIndex, teamKey, -1)
                                        }
                                        className="flex items-center justify-center min-w-[52px] min-h-[52px] rounded-xl border-2 border-gray-300 bg-white text-2xl font-bold text-gray-800 shadow-sm active:bg-gray-100 disabled:opacity-40 disabled:active:bg-white"
                                      >
                                        −
                                      </button>
                                      <input
                                        type="number"
                                        inputMode="numeric"
                                        min={0}
                                        max={setCap}
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
                                        className="border border-gray-300 rounded-xl w-[4.5rem] sm:w-24 text-center text-xl font-semibold py-3 min-h-[52px] bg-white disabled:bg-gray-100 disabled:text-gray-700"
                                      />
                                      <button
                                        type="button"
                                        aria-label={`Add one point for ${match[teamKey]}`}
                                        disabled={!user || locked || set[teamKey] >= setCap}
                                        onClick={() =>
                                          adjustScoreDelta(match.game, setIndex, teamKey, 1)
                                        }
                                        className="flex items-center justify-center min-w-[52px] min-h-[52px] rounded-xl border-2 border-gray-300 bg-white text-2xl font-bold text-gray-800 shadow-sm active:bg-gray-100 disabled:opacity-40 disabled:active:bg-white"
                                      >
                                        +
                                      </button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                          })}
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
