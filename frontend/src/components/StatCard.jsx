import React from "react";

export default function StatCard({ label, value, icon }) {
  return (
    <div className="stat-card">
      <div className="flex-between">
        <div>
          <div className="label">{label}</div>
          <div className="value">{value}</div>
        </div>
        {icon && <div style={{ fontSize: 22 }}>{icon}</div>}
      </div>
    </div>
  );
}
