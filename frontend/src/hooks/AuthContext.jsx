/*
 * AuthContext.jsx
 * -----------------------------------------------------------------------
 * A DEMO login gate — frontend-only, no real backend authentication.
 * This is intentional for a college project demo: it's enough to show a
 * login screen and protect routes, without the complexity of password
 * hashing, sessions, or a users database (which the project brief never
 * asked for). If you later want real auth, this is the one file to swap
 * out — nothing else in the app needs to change.
 *
 * Rule enforced here: any non-empty username + a password of at least
 * 4 characters logs you in. The session is remembered in localStorage so
 * refreshing the page doesn't log you out.
 * -----------------------------------------------------------------------
 */

import React, { createContext, useContext, useState } from "react";

const AuthContext = createContext(null);
const STORAGE_KEY = "deliverx_auth_user";

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  const login = (username, password) => {
    if (!username.trim()) return { ok: false, error: "Enter a username." };
    if (!password || password.length < 4) return { ok: false, error: "Password must be at least 4 characters." };

    const loggedInUser = { username: username.trim() };
    setUser(loggedInUser);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(loggedInUser));
    return { ok: true };
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem(STORAGE_KEY);
  };

  return (
    <AuthContext.Provider value={{ user, isAuthenticated: !!user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
