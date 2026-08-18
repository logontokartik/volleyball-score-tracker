// src/firebase.js
import { initializeApp } from 'firebase/app';
import { GoogleAuthProvider, getAuth, signInWithPopup, signOut } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyBxshNFXvWi5tOkfnh7ZHdKZoXK8dakIFo",
  authDomain: "volleyball-score-tracker.firebaseapp.com",
  projectId: "volleyball-score-tracker",
  storageBucket: "volleyball-score-tracker.firebasestorage.app",
  messagingSenderId: "619319905918",
  appId: "1:619319905918:web:dfbf957fd15d6fdae2522f",
  measurementId: "G-Z3XZPJ961T"
};

const app = initializeApp(firebaseConfig);

// ✅ Correctly export initialized services
const auth = getAuth(app);
const db = getFirestore(app);

// Google is the only sign-in method: club volunteers already have a Google account
// for the shared spreadsheet, and it saves us managing passwords.
const googleProvider = new GoogleAuthProvider();

export function signInWithGoogle() {
  return signInWithPopup(auth, googleProvider);
}

export function signOutUser() {
  return signOut(auth);
}

export { auth, db, googleProvider };
