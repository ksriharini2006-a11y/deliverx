import React, { useState } from "react";
import { API_BASE } from "../services/api";

export default function Settings() {
  const [name, setName] = useState("DeliverX");

  return (
    <div>
      <div className="page-title">Settings</div>
      <div className="page-subtitle">Application preferences for this demo</div>

      <div className="card" style={{ maxWidth: 480 }}>
        <div className="card-title">General</div>
        <div className="field">
          <label>Application Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label>Backend API URL</label>
          <input value={API_BASE} disabled />
          <span className="muted">Set in src/services/api.js — change it there if your backend runs on a different port.</span>
        </div>
        <div className="field">
          <label>EV Efficiency (fixed)</label>
          <input value="7 km/kWh" disabled />
        </div>
        <div className="field">
          <label>Charging Cost (fixed)</label>
          <input value="₹12 / kWh" disabled />
        </div>
      </div>
    </div>
  );
}
