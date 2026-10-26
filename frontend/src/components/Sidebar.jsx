import React from "react";
import { NavLink } from "react-router-dom";

const items = [
  { to: "/", label: "Dashboard", icon: "🏠", end: true },
  { to: "/delivery-planner", label: "Delivery Planner", icon: "🗺️" },
  { to: "/delivery-agent", label: "Delivery Agent", icon: "🛵" },
  { to: "/plan-route", label: "Plan Route", icon: "🧭" },
  { to: "/locations", label: "Delivery Locations", icon: "📍" },
  { to: "/multi-agent", label: "Multi-Agent Routes", icon: "🧑‍🚀" },
  { to: "/live-tracking", label: "Live Tracking", icon: "🚚" },
  { to: "/analytics", label: "Analytics", icon: "📊" },
  { to: "/settings", label: "Settings", icon: "⚙️" },
];

export default function Sidebar() {
  return (
    <div className="sidebar">
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={({ isActive }) => (isActive ? "active" : "")}
        >
          <span>{item.icon}</span>
          <span>{item.label}</span>
        </NavLink>
      ))}
    </div>
  );
}
