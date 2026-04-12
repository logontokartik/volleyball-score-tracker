
import React, { useState } from 'react';
import { signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { auth } from './firebase';

export default function Login({ user, setUser }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleLogin = async (e) => {
    e.preventDefault();
    try {
      const result = await signInWithEmailAndPassword(auth, email, password);
      setUser(result.user);
    } catch (err) {
      setError('Login failed. Check your credentials.');
    }
  };

  const handleLogout = () => {
    signOut(auth);
    setUser(null);
  };

  if (user) {
    return (
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 bg-gray-100 rounded-xl border border-gray-200 w-full sm:w-auto sm:max-w-md">
        <span className="text-xs sm:text-sm text-gray-700 truncate" title={user.email}>
          {user.email}
        </span>
        <button
          type="button"
          onClick={handleLogout}
          className="text-sm font-medium text-blue-700 min-h-[44px] px-3 py-2 rounded-lg hover:bg-gray-200/80 shrink-0"
        >
          Log out
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleLogin}
      className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center w-full sm:w-auto"
    >
      <input
        type="email"
        placeholder="Email"
        autoComplete="email"
        className="border border-gray-300 rounded-xl px-3 py-3 text-base min-h-[48px] w-full sm:w-44"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <input
        type="password"
        placeholder="Password"
        autoComplete="current-password"
        className="border border-gray-300 rounded-xl px-3 py-3 text-base min-h-[48px] w-full sm:w-36"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <button
        type="submit"
        className="bg-blue-600 text-white px-4 py-3 rounded-xl text-sm font-semibold min-h-[48px] sm:shrink-0"
      >
        Log in
      </button>
      {error && <span className="text-red-600 text-xs sm:col-span-full">{error}</span>}
    </form>
  );
}
