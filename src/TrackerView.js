import React, { useState, useEffect, useCallback } from 'react';
import { onSnapshot, setDoc } from 'firebase/firestore';
import { Link } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { useClub } from './ClubContext';
import { tournamentDoc } from './clubPaths';
import ScheduleTable from './ScheduleTable';
import FinalsView from './FinalsView';
import MatchScoreDialog from './MatchScoreDialog';
import RequestScoringAccess from './RequestScoringAccess';
import TeamsView from './TeamsView';
import { Card, CardContent } from './components/ui/card';
import { isTournamentComplete } from './CompletedTournamentsView';
import {
  buildDefaultScheduleSlots,
  calculateLeaderboard,
  getSetCap,
  matchSetSummary,
  matchSlotInfo,
  orderScoresBySchedule,
} from './tournamentUtils';

export default function TrackerView() {
  // Three different questions, three different answers: `user` is "is anyone signed in",
  // `canScore` is "may this account enter scores in THIS club", `isClubAdmin` is
  // "may it administer this club". They used to be the same thing.
  const { user, loading: authLoading } = useAuth();
  const { clubId, slug, club, canScore, isClubAdmin } = useClub();
  const activeTournamentId = club?.activeTournamentId || null;

  const [scoresTab, setScoresTab] = useState('schedule');
  const [tournament, setTournament] = useState(null);
  const [scores, setScores] = useState([]);
  const [teams, setTeams] = useState([]);
  const [finalsMatches, setFinalsMatches] = useState([]);
  // Only the tournament document's own load state. Auth readiness (authLoading) and
  // club readiness (ClubLayout's gate) are separate signals; keeping the names distinct
  // is what stops them being conflated again.
  const [tournamentLoading, setTournamentLoading] = useState(true);
  const [openGame, setOpenGame] = useState(null);
  // Which (club, tournament) the data currently in `scores`/`finalsMatches` came from.
  // Set in the same snapshot callback that sets them, so the three can never disagree.
  const [loadedFrom, setLoadedFrom] = useState({ clubId: null, tournamentId: null });

  useEffect(() => {
    if (!clubId || !activeTournamentId) {
      setTournament(null);
      setScores([]);
      setTeams([]);
      setFinalsMatches([]);
      setLoadedFrom({ clubId: null, tournamentId: null });
      setTournamentLoading(false);
      return undefined;
    }

    setTournamentLoading(true);
    const unsub = onSnapshot(tournamentDoc(clubId, activeTournamentId), (snap) => {
      if (!snap.exists()) {
        setTournament(null);
        setScores([]);
        setTeams([]);
        setFinalsMatches([]);
        setLoadedFrom({ clubId: null, tournamentId: null });
        setTournamentLoading(false);
        return;
      }
      const data = snap.data();
      setTournament({ id: snap.id, ...data });
      setScores(data.scores || []);
      setTeams(data.teams || []);
      setFinalsMatches(data.finalsMatches || []);
      setLoadedFrom({ clubId, tournamentId: snap.id });
      setTournamentLoading(false);
    }, () => {
      setTournamentLoading(false);
    });

    return () => unsub();
  }, [clubId, activeTournamentId]);

  // `scores` and `finalsMatches` are component state that outlives both a tournament
  // switch and a club switch. When activeTournamentId or clubId changes, these effects
  // re-run before the new document's snapshot has replaced that state — and
  // `tournamentLoading` is still false in this render, since the subscribe effect's
  // setTournamentLoading(true) only takes effect on the next one. Writing here would
  // copy one tournament's results into another — across clubs, one club's results into
  // a different club's tournament — so hold off until the data in state provably came
  // from the club and tournament we are about to write to.
  const loadedTournamentIsActive =
    Boolean(clubId) &&
    Boolean(activeTournamentId) &&
    loadedFrom.clubId === clubId &&
    loadedFrom.tournamentId === activeTournamentId &&
    tournament?.id === activeTournamentId;

  useEffect(() => {
    if (!canScore || tournamentLoading || !loadedTournamentIsActive) return undefined;
    const saveScores = async () => {
      await setDoc(tournamentDoc(clubId, activeTournamentId), { scores }, { merge: true });
    };
    saveScores();
  }, [scores, canScore, tournamentLoading, clubId, activeTournamentId, loadedTournamentIsActive]);

  useEffect(() => {
    if (!canScore || tournamentLoading || !loadedTournamentIsActive) return undefined;
    const saveFinalsMatches = async () => {
      await setDoc(tournamentDoc(clubId, activeTournamentId), { finalsMatches }, { merge: true });
    };
    saveFinalsMatches();
  }, [finalsMatches, canScore, tournamentLoading, clubId, activeTournamentId, loadedTournamentIsActive]);

  const scheduleSlots =
    tournament?.scheduleSlots?.length > 0
      ? tournament.scheduleSlots
      : buildDefaultScheduleSlots(scores, tournament?.courtCount);

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
      if (!canScore) return false;
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
    [canScore]
  );

  const toggleMatchPhase = useCallback((game) => {
    if (!canScore) return;
    setScores((prev) =>
      prev.map((m) => {
        if (m.game !== game || m.completed) return m;
        return { ...m, phase: m.phase === 'finals' ? 'pool' : 'finals' };
      })
    );
  }, [canScore]);

  // One standings table per pool, or a single unnamed one for every other format.
  //
  // calculateLeaderboard is deliberately pool-agnostic and stays that way: its
  // tiebreakers — head-to-head above all — are only correct over one closed group of
  // teams that all played each other. So it is called once per pool with that pool's
  // teams and that pool's matches, rather than taught about pools.
  const pools = tournament?.scheduleFormat === 'pools' ? tournament?.pools || [] : [];
  const standings = pools.length
    ? pools.map((pool) => ({
        name: pool.name,
        rows: calculateLeaderboard(
          scores.filter((m) => m.pool === pool.name),
          pool.teams || [],
          tournament?.setsPerMatch ?? 3
        ),
      }))
    : [{ name: null, rows: calculateLeaderboard(scores, teams, tournament?.setsPerMatch ?? 3) }];

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

  // Admin is for admins of THIS club only; it lives at /c/:slug/admin, which gates itself.
  const admin = isClubAdmin;

  // An admin can hide a tournament while it is still the active one — during setup, say.
  // Nothing about it renders here then; the document itself is still world-readable, so
  // this is presentation only and never a substitute for firestore.rules.
  const hiddenActive = Boolean(tournament?.hidden);

  // Until Firebase has replied once, `user` is null and so is every role derived from
  // it. Rendering the signed-out view here would show an admin "log in to score" and
  // no Admin tab for a few hundred milliseconds, then flip. (Club readiness needs no
  // check: ClubLayout's gate withholds this route until the club has resolved.)
  if (authLoading) {
    return (
      <div className="min-h-screen bg-gray-50/80 p-6 text-center text-gray-600">Loading…</div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50/80 pb-8 sm:pb-6">
      <div className="grid gap-4 p-3 sm:p-4 max-w-5xl mx-auto">
        {tournamentLoading && (
          <div className="p-6 text-center text-gray-600">Loading tournament…</div>
        )}

        {!tournamentLoading && !activeTournamentId && (
          <Card>
            <CardContent className="p-6 text-center text-gray-700">
              <p className="mb-3">
                {admin
                  ? 'No active tournament. Use Admin to create one and set it active.'
                  : 'No active tournament right now.'}
              </p>
              {admin && (
                <Link
                  to={`/c/${slug}/admin`}
                  className="inline-flex items-center justify-center min-h-[48px] px-5 rounded-xl border border-gray-300 bg-white text-sm font-semibold text-gray-800 hover:bg-gray-50"
                >
                  Open Admin
                </Link>
              )}
            </CardContent>
          </Card>
        )}

        {!tournamentLoading && activeTournamentId && !tournament && (
          <Card>
            <CardContent className="p-6 text-center text-amber-800">
              Active tournament was removed. Choose another in Admin.
            </CardContent>
          </Card>
        )}

        {!tournamentLoading && hiddenActive && (
          <Card>
            <CardContent className="p-6 text-center text-gray-700">
              <div className="text-5xl mb-4">🏐</div>
              <h2 className="text-2xl font-bold text-gray-900 mb-2">No games live</h2>
              <p className="mb-3">
                {admin
                  ? 'The active tournament is hidden from the public pages. Show it in Admin when you are ready.'
                  : 'Nothing is being scored right now.'}
              </p>
              {admin && (
                <Link
                  to={`/c/${slug}/admin`}
                  className="inline-flex items-center justify-center min-h-[48px] px-5 rounded-xl border border-gray-300 bg-white text-sm font-semibold text-gray-800 hover:bg-gray-50"
                >
                  Open Admin
                </Link>
              )}
            </CardContent>
          </Card>
        )}

        {!tournamentLoading && tournament && !hiddenActive && isTournamentComplete(tournament) && (
          <div className="grid gap-4">
            <div className="rounded-2xl border-2 border-gray-200 bg-white p-8 text-center shadow-sm">
              <div className="text-5xl mb-4">🏐</div>
              <h2 className="text-2xl font-bold text-gray-900 mb-2">No games live</h2>
              <p className="text-gray-500 mb-6">
                <span className="font-medium text-gray-700">{tournament.name}</span> has concluded.
              </p>
              <Link
                to={`/c/${slug}/completed`}
                className="inline-flex items-center justify-center min-h-[48px] px-6 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-sm transition-colors"
              >
                View completed tournaments →
              </Link>
            </div>
          </div>
        )}

        {!tournamentLoading && tournament && !hiddenActive && !isTournamentComplete(tournament) && (
          <>
            <div className="text-center px-1">
              <h1 className="text-xl sm:text-2xl font-bold text-gray-900">{tournament.name}</h1>
              <p className="text-sm text-gray-600 mt-1">
                {teams.length} teams · Pool: 21 pts (cap 25), 3rd set 15 (cap 18) · Finals: 25 pts (cap 28), 3rd set 15
              </p>
            </div>

            {/* Pinned BELOW the site header, not at the same offset: both sticking to
                top-0 made this row slide under the header and disappear on scroll. The
                offset is the header's own height, declared once as --site-header-h on
                the app shell (App.js), so this cannot drift out of step with it. */}
            <div
              className="sticky top-[var(--site-header-h)] z-30 -mx-1 px-1 py-2 bg-gray-50/95 backdrop-blur-sm border-b border-gray-200/80 sm:border-0 sm:bg-transparent sm:static sm:backdrop-blur-none"
            >
              {/* A segmented control, not a nav bar: one bordered track with a single
                  filled segment, so it reads as subordinate to the section nav and does
                  not compete with the blue action buttons inside each panel. */}
              <div
                role="tablist"
                aria-label="Tournament sections"
                className="flex rounded-xl border border-gray-300 bg-white p-0.5 gap-0.5"
              >
                {[
                  { id: 'schedule', label: 'Schedule' },
                  { id: 'scores', label: 'Scores' },
                  { id: 'teams', label: 'Teams' },
                  { id: 'finals', label: 'Knockout' },
                  { id: 'table', label: 'Table' },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={scoresTab === tab.id}
                    onClick={() => setScoresTab(tab.id)}
                    // A fifth tab is what forced the responsive type and padding here.
                    // At 11px with 4px of padding the longest label ('Schedule') needs
                    // ~54px and the narrowest phone in the browserslist gives each tab
                    // 58px, so the row still fits on one line rather than wrapping or
                    // hiding a tab behind a horizontal scroll nobody discovers.
                    className={`flex-1 min-w-0 py-2 px-1 sm:px-2 rounded-[0.6rem] text-[11px] sm:text-sm min-h-[44px] whitespace-nowrap transition-colors ${
                      scoresTab === tab.id
                        ? 'bg-slate-800 text-white font-semibold'
                        : 'text-gray-600 font-medium hover:bg-gray-100'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {!hasSavedSchedule && admin && (
              <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                Schedule is auto-paired from the match list. Open{' '}
                <Link to={`/c/${slug}/admin`} className="underline font-medium">
                  Admin → Schedule
                </Link>{' '}
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
                    courtCount={tournament?.courtCount}
                    onMatchClick={onScheduleMatchClick}
                  />
                </CardContent>
              </Card>
            )}

            {scoresTab === 'teams' && (
              <TeamsView tournament={tournament} teams={teams} pools={pools} />
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
                  {/* Two presentations of one list, repeated per pool. A six-column table
                      cannot be made to fit 390px, and the horizontal-scroll version cut
                      the last three columns off screen behind a "swipe sideways" hint most
                      people never act on. Below sm: the same rows are stacked instead. */}
                  <div className="grid gap-5">
                    {standings.map((group) => (
                      <section key={group.name ?? 'all'}>
                        {/* Sticky under the tab bar so the pool a row belongs to is still
                            on screen while scrolling six of these on a phone. */}
                        {group.name && (
                          <h3 className="sm:static sticky top-[calc(var(--site-header-h)+3.75rem)] z-10 bg-white/95 backdrop-blur-sm text-sm font-bold uppercase tracking-wide text-gray-700 border-b border-gray-200 pb-1 mb-2">
                            Pool {group.name}
                          </h3>
                        )}
                          <ul className="sm:hidden grid gap-2">
                            {group.rows.map(([team, data], index) => (
                              <li
                                key={team}
                                className={`rounded-xl border px-3 py-2.5 ${
                                  index === 0
                                    ? 'border-amber-300 bg-amber-50'
                                    : 'border-gray-200 bg-white'
                                }`}
                              >
                                <div className="flex items-baseline justify-between gap-3">
                                  <span className="flex items-baseline gap-2 min-w-0">
                                    <span className="text-xs font-bold text-gray-500 tabular-nums w-4 shrink-0">
                                      {index + 1}
                                    </span>
                                    <span className="font-semibold text-gray-900 truncate">{team}</span>
                                  </span>
                                  <span className="shrink-0 tabular-nums">
                                    <span className="text-lg font-bold text-gray-900">
                                      {data.tournamentPoints}
                                    </span>
                                    <span className="text-xs text-gray-500 ml-1">pts</span>
                                  </span>
                                </div>
                                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-600 tabular-nums">
                                  <span>Won {data.matchesWon}</span>
                                  <span>Sets {data.setsWon}</span>
                                  <span>
                                    PD {data.winMatchPointDiff > 0 ? '+' : ''}
                                    {data.winMatchPointDiff}
                                  </span>
                                </div>
                              </li>
                            ))}
                          </ul>

                          <div className="hidden sm:block overscroll-x-contain rounded-lg border border-gray-200">
                            <table className="w-full text-left text-sm">
                              <thead className="bg-gray-100 text-gray-800">
                                <tr>
                                  <th className="p-3 font-semibold w-9 text-center whitespace-nowrap">#</th>
                                  <th className="p-3 font-semibold whitespace-nowrap min-w-[5rem]">Team</th>
                                  <th
                                    className="p-3 font-semibold text-right whitespace-nowrap"
                                    title="Tournament points (sets + win bonus)"
                                  >
                                    Pts
                                  </th>
                                  <th
                                    className="p-3 font-semibold text-right whitespace-nowrap"
                                    title="Point differential in sets of matches this team won"
                                  >
                                    Won-match PD
                                  </th>
                                  <th
                                    className="p-3 font-semibold text-right whitespace-nowrap"
                                    title="Matches won (completed games only)"
                                  >
                                    W
                                  </th>
                                  <th
                                    className="p-3 font-semibold text-right whitespace-nowrap"
                                    title="Total sets won in completed games"
                                  >
                                    Sets
                                  </th>
                                </tr>
                              </thead>
                              <tbody>
                                {group.rows.map(([team, data], index) => (
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
                                    <td className="p-3 text-center text-gray-700 whitespace-nowrap">
                                      {index + 1}
                                    </td>
                                    <td className="p-3">{team}</td>
                                    <td className="p-3 text-right tabular-nums whitespace-nowrap">
                                      {data.tournamentPoints}
                                    </td>
                                    <td className="p-3 text-right tabular-nums whitespace-nowrap">
                                      {data.winMatchPointDiff > 0 ? '+' : ''}
                                      {data.winMatchPointDiff}
                                    </td>
                                    <td className="p-3 text-right tabular-nums whitespace-nowrap">
                                      {data.matchesWon}
                                    </td>
                                    <td className="p-3 text-right tabular-nums whitespace-nowrap">
                                      {data.setsWon}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                      </section>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* FinalsView's `user` prop is only ever read as "may edit scores",
                which is now membership in this club rather than being signed in. */}
            {scoresTab === 'finals' && (
              <FinalsView
                teams={teams}
                finalsMatches={finalsMatches}
                setFinalsMatches={setFinalsMatches}
                user={canScore}
                setsPerMatch={tournament?.setsPerMatch ?? 3}
              />
            )}

            {scoresTab === 'scores' && (
              <div className="grid gap-4">
                <div className="text-sm text-gray-600 bg-white border border-gray-200 rounded-xl px-4 py-3 flex flex-col items-center gap-3 text-center">
                  <p>
                    {canScore
                      ? 'Tap a game to open it and enter the score. It reopens wherever you left off, so you can close it mid-game.'
                      : user
                        ? 'Tap a game to see its score. Your account has no scoring access to this club — ask a club admin for it.'
                        : 'Tap a game to see its score. Log in to enter or adjust scores.'}
                  </p>
                  {/* Renders nothing unless the visitor is signed in and cannot score,
                      so the two branches above stay the only copy that decides. */}
                  <RequestScoringAccess />
                </div>
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
      </div>

      {openMatch && (
        <MatchScoreDialog
          match={openMatch}
          scheduleSlots={scheduleSlots}
          canScore={canScore}
          signedIn={Boolean(user)}
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
