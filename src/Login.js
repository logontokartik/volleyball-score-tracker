
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
      <div className="flex justify-between items-center p-4 bg-gray-100 mb-4 rounded">
        <span className="text-sm">Logged in as {user.email}</span>
        <button onClick={handleLogout} className="text-sm text-blue-600 underline">Logout</button>
      </div>
    );
  }

  return (
    <form onSubmit={handleLogin} className="flex flex-col sm:flex-row gap-2 items-center mb-4">
      <input
        type="email"
        placeholder="Email"
        className="border p-2 rounded text-sm"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <input
        type="password"
        placeholder="Password"
        className="border p-2 rounded text-sm"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded text-sm">Login</button>
      {error && <span className="text-red-600 text-xs">{error}</span>}
    </form>
  );
}
