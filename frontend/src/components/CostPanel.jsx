/*
 * CostPanel.jsx - editable cost assumptions + the Standard / EV summary.
 * Every rate is a CONFIGURABLE ASSUMPTION; no live fuel or electricity prices
 * are looked up. Values are saved in this browser (see services/costConfig.js).
 */

import React, { useState } from "react";
import { DEFAULT_COST_CONFIG } from "../services/costConfig";

const inr = (n) => `₹${Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function NumberField({ label, value, onChange, step = "any", help }) {
  const bad = value === "" || Number(value) < 0 || Number.isNaN(Number(value));
  const id = `cost-${label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
  return (
    <div className="field" style={{ marginBottom: 0 }}>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="number"
        min="0"
        step={step}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={bad ? { borderColor: "var(--danger)" } : undefined}
      />
      {help && <span className="muted" style={{ fontSize: 12 }}>{help}</span>}
    </div>
  );
}

export function CostAssumptions({ costConfig, setCostConfig }) {
  const [open, setOpen] = useState(false);
  const set = (group, key) => (v) =>
    setCostConfig({ ...costConfig, [group]: { ...costConfig[group], [key]: v === "" ? "" : Number(v) } });

  return (
    <div>
      <button className="btn btn-outline" onClick={() => setOpen((o) => !o)}>
        {open ? "Hide cost assumptions" : "Edit cost assumptions"}
      </button>
      {open && (
        <div className="section-gap">
          <div className="card-title">Standard vehicle</div>
          <div className="grid grid-3">
            <NumberField label="Rate per km (₹)" value={costConfig.standard.ratePerKm} onChange={set("standard", "ratePerKm")} />
            <NumberField label="Base fee (₹)" value={costConfig.standard.baseFee} onChange={set("standard", "baseFee")} />
            <NumberField label="Extra charges (₹)" value={costConfig.standard.extraCharges} onChange={set("standard", "extraCharges")} />
          </div>
          <div className="card-title section-gap">Electric vehicle</div>
          <div className="grid grid-4">
            <NumberField label="Energy use: km per kWh" value={costConfig.ev.kmPerKwh} onChange={set("ev", "kmPerKwh")} help="Higher = more efficient" />
            <NumberField label="Electricity price (₹/kWh)" value={costConfig.ev.pricePerKwh} onChange={set("ev", "pricePerKwh")} />
            <NumberField label="Charging fee (₹)" value={costConfig.ev.chargingFee} onChange={set("ev", "chargingFee")} help="Optional, per trip" />
            <NumberField label="Extra charges (₹)" value={costConfig.ev.extraCharges} onChange={set("ev", "extraCharges")} />
          </div>
          <p className="muted" style={{ fontSize: 12 }}>
            These are your own assumptions, not live fuel or electricity prices.
          </p>
          <button className="btn btn-outline" onClick={() => setCostConfig(DEFAULT_COST_CONFIG)}>
            Reset to defaults
          </button>
        </div>
      )}
    </div>
  );
}

/** Standard vs EV for one distance. `cost` is the /api/cost/estimate response. */
export function CostSummary({ cost, mode, setMode, compareCost }) {
  if (!cost) return null;
  const isEv = mode === "ev";
  const saved = compareCost ? compareCost[mode].total - cost[mode].total : null;
  return (
    <div>
      <div className="flex-row" style={{ gap: 8, marginBottom: 12 }}>
        <button className={`btn ${!isEv ? "btn-primary" : "btn-outline"}`} onClick={() => setMode("standard")}>
          Standard vehicle
        </button>
        <button className={`btn ${isEv ? "btn-primary" : "btn-outline"}`} onClick={() => setMode("ev")}>
          EV
        </button>
      </div>

      <div className="grid grid-4">
        <div>
          <div className="muted">Road distance</div>
          <div style={{ fontWeight: 700, fontSize: 20 }}>{cost.distanceKm} km</div>
        </div>
        <div>
          <div className="muted">Estimated travel time</div>
          <div style={{ fontWeight: 700, fontSize: 20 }}>{cost.durationMin === null ? "—" : `${Math.round(cost.durationMin)} min`}</div>
        </div>
        {!isEv ? (
          <>
            <div>
              <div className="muted">Distance cost ({cost.standard.ratePerKm}/km)</div>
              <div style={{ fontWeight: 700, fontSize: 20 }}>{inr(cost.standard.distanceCost)}</div>
            </div>
            <div>
              <div className="muted">Standard total</div>
              <div style={{ fontWeight: 700, fontSize: 20, color: "var(--primary)" }}>{inr(cost.standard.total)}</div>
            </div>
          </>
        ) : (
          <>
            <div>
              <div className="muted">Energy ({cost.ev.kmPerKwh} km/kWh)</div>
              <div style={{ fontWeight: 700, fontSize: 20 }}>{cost.ev.energyKwh} kWh</div>
            </div>
            <div>
              <div className="muted">EV total (energy {inr(cost.ev.energyCost)})</div>
              <div style={{ fontWeight: 700, fontSize: 20, color: "var(--primary)" }}>{inr(cost.ev.total)}</div>
            </div>
          </>
        )}
      </div>

      <div className="muted" style={{ marginTop: 10 }}>
        Both modes for this route: Standard {inr(cost.standard.total)} · EV {inr(cost.ev.total)}
        {saved !== null && saved > 0 && <> · Optimized order saves {inr(saved)} compared with the entered order ({isEv ? "EV" : "Standard"}).</>}
      </div>
      <ul className="muted" style={{ fontSize: 12, marginTop: 8, paddingLeft: 18 }}>
        {cost.assumptions.map((a) => (
          <li key={a}>{a}</li>
        ))}
      </ul>
    </div>
  );
}
