import React, { useState, useEffect } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from './firebase';
import { calculateLeaderboard, setsNeededToWin } from './tournamentUtils';
import { Card, CardContent } from './components/ui/card';

const ROUND_OPTIONS = [
  { value: 'quarter-finals', label: 'Quarter Finals' },
  { value: 'semi-finals',    label: 'Semi Finals'   },
  { value: 'finals',         label: 'Finals'        },
];

function getMatchWinner(match) {
  const need = setsNeededToWin(match.sets?.length || 3);
  let s1 = 0, s2 = 0;
  for (const set of match.sets || []) {
    const a = Number(set.team1) || 0;
    const b = Number(set.team2) || 0;
    if (a === 0 && b === 0) continue;
    if (a > b) s1++;
    else if (b > a) s2++;
  }
  if (s1 >= need && s1 > s2) return match.team1;
  if (s2 >= need && s2 > s1) return match.team2;
  return null;
}

function getFinalsWinner(finalsMatches) {
  const finalMatch = (finalsMatches || []).find(
    (m) => m.round === 'finals' && m.completed
  );
  return finalMatch ? getMatchWinner(finalMatch) : null;
}

export function isTournamentComplete(tournament) {
  return (tournament?.finalsMatches || []).some(
    (m) => m.round === 'finals' && m.completed
  );
}

function TournamentDetail({ tournament, onBack }) {
  const winner = getFinalsWinner(tournament.finalsMatches);
  const leaderboard = calculateLeaderboard(
    tournament.scores || [],
    tournament.teams || [],
    tournament.setsPerMatch ?? 3
  );

  const byRound = ROUND_OPTIONS.map((r) => ({
    ...r,
    matches: (tournament.finalsMatches || []).filter((m) => m.round === r.value),
  })).filter((r) => r.matches.length > 0);

  return (
    <div className="grid gap-4">
      <button
        type="button"
        onClick={onBack}
        className="self-start text-sm font-medium text-blue-600 hover:text-blue-800 flex items-center gap-1"
      >
        ← Back to completed tournaments
      </button>

      {winner && (
        <div className="rounded-2xl bg-gradient-to-br from-amber-50 to-yellow-100 border-2 border-amber-300 p-6 text-center">
          <img
            src="/images/winnertrophy.jpg"
            alt="Winner trophy"
            className="h-24 w-auto object-contain mx-auto drop-shadow-md mb-4"
          />
          <p className="text-xs font-bold uppercase tracking-widest text-amber-600 mb-1">
            Tournament Champions 🏆
          </p>
          <p className="text-3xl font-black text-amber-800">{winner}</p>
          <p className="text-sm text-amber-700 mt-1">{tournament.name}</p>
        </div>
      )}

      {byRound.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <h2 className="text-lg font-bold text-gray-900 mb-4">Finals bracket</h2>
            {byRound.map(({ value: roundValue, label: roundLabel, matches }) => (
              <div key={roundValue} className="mb-5 last:mb-0">
                <h3
                  className={`text-xs font-bold uppercase tracking-wider mb-3 ${
                    roundValue === 'finals'
                      ? 'text-amber-700'
                      : roundValue === 'semi-finals'
                      ? 'text-violet-700'
                      : 'text-sky-700'
                  }`}
                >
                  {roundLabel}
                </h3>
                <div className="grid gap-3">
                  {matches.map((match) => {
                    const mWinner = getMatchWinner(match);
                    return (
                      <div
                        key={match.id}
                        className="rounded-xl border border-gray-200 bg-gray-50 p-3"
                      >
                        <div className="flex items-center justify-between gap-3 flex-wrap">
                          <div className="space-y-1">
                            {['team1', 'team2'].map((key) => (
                              <p
                                key={key}
                                className={`text-sm font-semibold ${
                                  mWinner === match[key]
                                    ? 'text-gray-900'
                                    : 'text-gray-400'
                                }`}
                              >
                                {mWinner === match[key] ? '✓ ' : ''}
                                {match[key]}
                              </p>
                            ))}
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-xs text-gray-500 tabular-nums">
                              {(match.sets || [])
                                .map((s) => `${s.team1}–${s.team2}`)
                                .join(', ')}
                            </p>
                            {mWinner && (
                              <p className="text-xs font-semibold text-green-700 mt-0.5">
                                {mWinner} wins
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {leaderboard.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <h2 className="text-lg font-bold text-gray-900 mb-4">Pool play standings</h2>
            <div className="overflow-x-auto rounded-lg border border-gray-200">
              <table className="w-full text-sm min-w-[28rem]">
                <thead className="bg-gray-100 text-gray-800">
                  <tr>
                    <th className="p-2 sm:p-3 font-semibold text-center w-9">#</th>
                    <th className="p-2 sm:p-3 font-semibold">Team</th>
                    <th className="p-2 sm:p-3 font-semibold text-right" title="Tournament points">Pts</th>
                    <th className="p-2 sm:p-3 font-semibold text-right" title="Matches won">W</th>
                    <th className="p-2 sm:p-3 font-semibold text-right" title="Sets won">Sets</th>
                  </tr>
                </thead>
                <tbody>
                  {leaderboard.map(([team, data], index) => (
                    <tr
                      key={team}
                      className={
                        index === 0
                          ? 'bg-amber-50 font-medium'
                          : index % 2 === 1
                          ? 'bg-gray-50'
                          : 'bg-white'
                      }
                    >
                      <td className="p-2 sm:p-3 text-center text-gray-600">{index + 1}</td>
                      <td className="p-2 sm:p-3">{team}</td>
                      <td className="p-2 sm:p-3 text-right tabular-nums">{data.tournamentPoints}</td>
                      <td className="p-2 sm:p-3 text-right tabular-nums">{data.matchesWon}</td>
                      <td className="p-2 sm:p-3 text-right tabular-nums">{data.setsWon}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function TournamentCard({ tournament, onClick }) {
  const winner = getFinalsWinner(tournament.finalsMatches);
  const date = tournament.createdAt?.seconds
    ? new Date(tournament.createdAt.seconds * 1000).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : null;

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left rounded-2xl border border-gray-200 bg-white shadow-sm hover:shadow-md hover:border-amber-300 transition-all p-4 sm:p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-bold text-gray-900 truncate">{tournament.name}</h2>
          {date && <p className="text-xs text-gray-400 mt-0.5">{date}</p>}
          {winner ? (
            <p className="text-sm text-amber-700 font-semibold mt-2">🏆 {winner}</p>
          ) : (
            <p className="text-sm text-gray-400 mt-2">Winner TBD</p>
          )}
          <p className="text-xs text-gray-400 mt-1">{(tournament.teams || []).length} teams</p>
        </div>
        <span className="text-gray-300 text-xl shrink-0 mt-1">›</span>
      </div>
    </button>
  );
}

export default function CompletedTournamentsView() {
  const [tournaments, setTournaments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'tournaments'),
      (snap) => {
        const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        const completed = all
          .filter(isTournamentComplete)
          .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
        setTournaments(completed);
        setLoading(false);
      },
      () => setLoading(false)
    );
    return unsub;
  }, []);

  return (
    <div className="min-h-screen bg-gray-50/80 pb-8">
      <div className="max-w-5xl mx-auto p-3 sm:p-4 grid gap-4">
        {loading && (
          <p className="text-gray-500 text-center py-10">Loading…</p>
        )}

        {!loading && selected && (
          <TournamentDetail
            tournament={selected}
            onBack={() => setSelected(null)}
          />
        )}

        {!loading && !selected && (
          <>
            <header className="pt-2">
              <h1 className="text-2xl font-bold text-gray-900">Completed tournaments</h1>
              <p className="text-sm text-gray-500 mt-1">
                Click a tournament to see results, bracket, and pool play standings.
              </p>
            </header>

            {tournaments.length === 0 ? (
              <Card>
                <CardContent className="p-8 text-center text-gray-500">
                  No completed tournaments yet.
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-3">
                {tournaments.map((t) => (
                  <TournamentCard
                    key={t.id}
                    tournament={t}
                    onClick={() => setSelected(t)}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
