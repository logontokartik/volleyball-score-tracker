
import React, { useState, useEffect } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, doc, getDoc, getDocs, onSnapshot, setDoc } from 'firebase/firestore';
import { auth, db } from './firebase';
import Login from './Login';
import CreateTournament from './CreateTournament';
import { Card, CardContent } from './components/ui/card';

export default function App() {
  const [user, setUser] = useState(null);
  const [tournaments, setTournaments] = useState([]);
  const [selectedTournament, setSelectedTournament] = useState(null);
  const [scores, setScores] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      setUser(user);
    });

    const fetchTournaments = async () => {
      const snapshot = await getDocs(collection(db, 'tournaments'));
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setTournaments(data);
      if (data.length > 0) {
        setSelectedTournament(data[0]);
      }
    };

    fetchTournaments();
    return () => unsubscribeAuth();
  }, []);

  useEffect(() => {
    if (!selectedTournament) return;

    const unsub = onSnapshot(doc(db, 'tournaments', selectedTournament.name), (docSnap) => {
      if (docSnap.exists()) {
        setScores(docSnap.data().scores);
      }
      setLoading(false);
    });

    return () => unsub();
  }, [selectedTournament]);

  useEffect(() => {
    if (user && selectedTournament && scores.length > 0) {
      const saveScores = async () => {
        await setDoc(doc(db, 'tournaments', selectedTournament.name), {
          ...selectedTournament,
          scores
        });
      };
      saveScores();
    }
  }, [scores, user, selectedTournament]);

  const updateScoreInput = (matchIndex, setIndex, teamKey, value) => {
    const numericValue = Math.max(0, Math.min(25, parseInt(value) || 0));
    setScores(prevScores => {
      const updatedScores = [...prevScores];
      updatedScores[matchIndex].sets[setIndex][teamKey] = numericValue;
      return updatedScores;
    });
  };

  const calculateLeaderboard = () => {
    if (!selectedTournament) return [];
    const leaderboard = {};
    selectedTournament.teams.forEach(team => {
      leaderboard[team] = { setsWon: 0, pointDiff: 0 };
    });

    scores.forEach(match => {
      match.sets.forEach(set => {
        const { team1, team2 } = set;
        if (team1 > team2) leaderboard[match.team1].setsWon += 1;
        else if (team2 > team1) leaderboard[match.team2].setsWon += 1;

        leaderboard[match.team1].pointDiff += (team1 - team2);
        leaderboard[match.team2].pointDiff += (team2 - team1);
      });
    });

    return Object.entries(leaderboard).sort((a, b) => {
      if (b[1].setsWon === a[1].setsWon) return b[1].pointDiff - a[1].pointDiff;
      return b[1].setsWon - a[1].setsWon;
    });
  };

  const leaderboard = calculateLeaderboard();

  const handleTournamentCreated = (tournament) => {
    setTournaments(prev => [...prev, tournament]);
    setSelectedTournament(tournament);
    setScores(tournament.scores);
  };

  if (loading) return <div className="p-4">Loading...</div>;

  return (
    <div className="p-4 max-w-4xl mx-auto">
      <Login user={user} setUser={setUser} />
      {user && <CreateTournament onTournamentCreated={handleTournamentCreated} />}

      <div className="mb-4">
        <label className="mr-2 font-medium">Select Tournament:</label>
        <select
          className="border p-2 rounded"
          value={selectedTournament?.name || ''}
          onChange={(e) => {
            const tournament = tournaments.find(t => t.name === e.target.value);
            setSelectedTournament(tournament);
          }}
        >
          {tournaments.map(t => (
            <option key={t.name} value={t.name}>{t.name}</option>
          ))}
        </select>
      </div>

      <Card>
        <CardContent className="p-4">
          <h2 className="text-2xl font-bold mb-4 text-center">Leaderboard</h2>
          <table className="w-full text-left text-sm md:text-base">
            <thead>
              <tr>
                <th className="p-2">Team</th>
                <th className="p-2">Sets Won</th>
                <th className="p-2">Point Diff</th>
              </tr>
            </thead>
            <tbody>
              {leaderboard.map(([team, data], index) => (
                <tr key={index} className="even:bg-gray-100">
                  <td className="p-2 font-medium">{team}</td>
                  <td className="p-2">{data.setsWon}</td>
                  <td className="p-2">{data.pointDiff}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {scores.map((match, matchIndex) => (
        <Card key={matchIndex}>
          <CardContent className="p-4">
            <h2 className="text-lg font-bold mb-2">{match.game}: {match.team1} vs {match.team2}</h2>
            {match.sets.map((set, setIndex) => (
              <div key={setIndex} className="mb-4">
                <h3 className="font-semibold">Set {setIndex + 1}</h3>
                <div className="flex flex-col sm:flex-row justify-between gap-4">
                  {['team1', 'team2'].map(teamKey => (
                    <div key={teamKey} className="flex items-center gap-2">
                      <label className="w-24 font-medium text-sm">{match[teamKey]}</label>
                      <input
                        type="number"
                        min="0"
                        max="25"
                        value={set[teamKey]}
                        onChange={(e) => updateScoreInput(matchIndex, setIndex, teamKey, e.target.value)}
                        disabled={!user}
                        className="border p-1 rounded w-20 text-center text-sm"
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
