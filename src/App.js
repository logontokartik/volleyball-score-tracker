
import React, { useState, useEffect } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db } from './firebase';
import Login from './Login';
import { Card, CardContent } from './components/ui/card';

const teams = ["Blue", "White", "Red", "Black", "Yellow", "Green"];
const totalSets = 2;
const pointsToWin = 18;

const scheduledMatches = [
  { game: 'G1', team1: 'White', team2: 'Black' },
  { game: 'G2', team1: 'Red', team2: 'Yellow' },
  { game: 'G3', team1: 'White', team2: 'Green' },
  { game: 'G4', team1: 'Blue', team2: 'Yellow' },
  { game: 'G5', team1: 'Black', team2: 'Green' },
  { game: 'G6', team1: 'White', team2: 'Red' },
  { game: 'G7', team1: 'Red', team2: 'Green' },
  { game: 'G8', team1: 'Blue', team2: 'Black' },
  { game: 'G9', team1: 'White', team2: 'Yellow' },
  { game: 'G10', team1: 'Blue', team2: 'Green' },
  { game: 'G11', team1: 'Black', team2: 'Yellow' },
  { game: 'G12', team1: 'Blue', team2: 'Red' }
];

const calculateLeaderboard = (scores) => {
  const leaderboard = {};
  teams.forEach(team => {
    leaderboard[team] = { setsWon: 0, pointDiff: 0 };
  });

  scores.forEach(match => {
    match.sets.forEach(set => {
      const { team1, team2 } = set;
      if (team1 > team2) {
        leaderboard[match.team1].setsWon += 1;
      } else if (team2 > team1) {
        leaderboard[match.team2].setsWon += 1;
      }
      leaderboard[match.team1].pointDiff += (team1 - team2);
      leaderboard[match.team2].pointDiff += (team2 - team1);
    });
  });

  return Object.entries(leaderboard).sort((a, b) => {
    if (b[1].setsWon === a[1].setsWon) {
      return b[1].pointDiff - a[1].pointDiff;
    }
    return b[1].setsWon - a[1].setsWon;
  });
};

const defaultScores = scheduledMatches.map(match => ({
  ...match,
  sets: Array.from({ length: totalSets }, () => ({ team1: 0, team2: 0 }))
}));

export default function App() {
  const [user, setUser] = useState(null);
  const [scores, setScores] = useState(defaultScores);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setUser(user);
      if (user) {
        const docRef = doc(db, 'scores', 'tournament');
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          setScores(docSnap.data().scores);
        }
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (user && !loading) {
      const saveScores = async () => {
        await setDoc(doc(db, 'scores', 'tournament'), { scores });
      };
      saveScores();
    }
  }, [scores, user, loading]);

  const updateScoreInput = (matchIndex, setIndex, teamKey, value) => {
    const numericValue = Math.max(0, Math.min(pointsToWin, parseInt(value) || 0));
    setScores(prevScores => {
      const updatedScores = [...prevScores];
      updatedScores[matchIndex].sets[setIndex][teamKey] = numericValue;
      return updatedScores;
    });
  };

  const leaderboard = calculateLeaderboard(scores);

  if (loading) return <div className="p-4">Loading...</div>;

  return (
    <div className="grid gap-6 p-4 max-w-3xl mx-auto">
      <Login user={user} setUser={setUser} />
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
                        max={pointsToWin}
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
