// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyBxshNFXvWi5tOkfnh7ZHdKZoXK8dakIFo",
  authDomain: "volleyball-score-tracker.firebaseapp.com",
  projectId: "volleyball-score-tracker",
  storageBucket: "volleyball-score-tracker.firebasestorage.app",
  messagingSenderId: "619319905918",
  appId: "1:619319905918:web:dfbf957fd15d6fdae2522f",
  measurementId: "G-Z3XZPJ961T"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);