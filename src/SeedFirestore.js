
import { doc, setDoc } from 'firebase/firestore';
import { db } from './firebase';

export async function seedTournament() {
  const data = {
    name: "Demo Tournament",
    teams: ["Red", "Blue", "Green", "Yellow", "Black", "White"],
    setsPerMatch: 3,
    scores: [
      {
        game: "G1",
        team1: "Red",
        team2: "Blue",
        sets: [
          { team1: 18, team2: 25 },
          { team1: 25, team2: 22 },
          { team1: 20, team2: 25 }
        ]
      },
      {
        game: "G2",
        team1: "Green",
        team2: "Yellow",
        sets: [
          { team1: 25, team2: 21 },
          { team1: 23, team2: 25 },
          { team1: 25, team2: 20 }
        ]
      }
    ]
  };

  try {
    await setDoc(doc(db, 'tournaments', data.name), data);
    console.log('✅ Demo Tournament seeded successfully');
    alert('Demo Tournament seeded!');
  } catch (err) {
    console.error('❌ Error seeding tournament:', err);
    alert('Failed to seed tournament. Check console for errors.');
  }
}
