
import React, { useState } from 'react';
import { doc, setDoc } from 'firebase/firestore';
import { db } from './firebase';

export default function CreateTournament({ onTournamentCreated }) {
  const [name, setName] = useState('');
  const [teams, setTeams] = useState(['', '', '', '', '', '']);
  const [error, setError] = useState('');

  const handleTeamChange = (index, value) => {
    const updatedTeams = [...teams];
    updatedTeams[index] = value;
    setTeams(updatedTeams);
  };

  const handleCreate = async () => {
    if (!name || teams.some(team => !team.trim())) {
      setError('Please enter a tournament name and all team names.');
      return;
    }

    const setsPerMatch = 3;
    const scheduledMatches = [];

    for (let i = 0; i < teams.length; i++) {
      for (let j = i + 1; j < teams.length; j++) {
        scheduledMatches.push({
          game: `G${scheduledMatches.length + 1}`,
          team1: teams[i],
          team2: teams[j]
        });
      }
    }

    const matches = scheduledMatches.map(match => ({
      ...match,
      sets: Array.from({ length: setsPerMatch }, () => ({ team1: 0, team2: 0 }))
    }));

    const newTournament = {
      name,
      teams,
      scores: matches,
      setsPerMatch
    };

    await setDoc(doc(db, 'tournaments', name), newTournament);
    onTournamentCreated(newTournament);
  };

  return (
    <div className="p-4 border rounded mb-6">
      <h2 className="text-xl font-bold mb-4">Create New Tournament</h2>
      <input
        type="text"
        placeholder="Tournament Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="border p-2 rounded w-full mb-4"
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4">
        {teams.map((team, i) => (
          <input
            key={i}
            type="text"
            placeholder={`Team ${i + 1}`}
            value={team}
            onChange={(e) => handleTeamChange(i, e.target.value)}
            className="border p-2 rounded"
          />
        ))}
      </div>
      {error && <div className="text-red-600 text-sm mb-2">{error}</div>}
      <button
        onClick={handleCreate}
        className="bg-blue-600 text-white px-4 py-2 rounded"
      >
        Create Tournament
      </button>
    </div>
  );
}
