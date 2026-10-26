import React from "react";
import { NavLink } from "react-router-dom";
import { useAuth } from "../hooks/AuthContext";

export default function Navbar() {
  const { user, logout } = useAuth();

  return (
    <div className="navbar">
      <div className="navbar-brand">
        <span className="dot" />
        DeliverX
      </div>
      <div className="navbar-links">
        <NavLink to="/" end className={({ isActive }) => (isActive ? "active" : "")}>
          Dashboard
        </NavLink>
        <NavLink to="/plan-route" className={({ isActive }) => (isActive ? "active" : "")}>
          Routes
        </NavLink>
        <NavLink to="/locations" className={({ isActive }) => (isActive ? "active" : "")}>
          Deliveries
        </NavLink>
        <NavLink to="/analytics" className={({ isActive }) => (isActive ? "active" : "")}>
          Analytics
        </NavLink>
      </div>
      <div className="navbar-right">
        <span className="muted">🔔</span>
        <div className="avatar">{(user?.username || "U").slice(0, 2).toUpperCase()}</div>
        <button className="logout-btn" onClick={logout}>
          Logout
        </button>
      </div>
    </div>
  );
}
