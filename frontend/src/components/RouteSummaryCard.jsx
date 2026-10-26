import React from "react";

export default function RouteSummaryCard({ result, evResult }) {
  if (!result) {
    return (
      <div className="card">
        <div className="card-title">Route Summary</div>
        <p className="muted">Run "Optimize Route" to see the route summary here.</p>
      </div>
    );
  }

  const hours = Math.floor(result.estimatedTimeMinutes / 60);
  const mins = result.estimatedTimeMinutes % 60;
  const timeLabel = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;

  return (
    <div className="card">
      <div className="card-title">Optimized Delivery Route</div>

      <ol className="route-list">
        {result.route.map((loc, idx) => (
          <li key={`${loc.id}-${idx}`}>
            <span className="route-badge">{idx === 0 ? "H" : idx}</span>
            <span>{loc.name}</span>
          </li>
        ))}
      </ol>

      <div className="grid grid-2 section-gap">
        <div>
          <div className="muted">Total Distance</div>
          <div style={{ fontWeight: 700, fontSize: 18 }}>{result.totalDistanceKm} km</div>
        </div>
        <div>
          <div className="muted">Estimated Time</div>
          <div style={{ fontWeight: 700, fontSize: 18 }}>{timeLabel}</div>
        </div>
        <div>
          <div className="muted">Delivery Stops</div>
          <div style={{ fontWeight: 700, fontSize: 18 }}>{result.stops}</div>
        </div>
        <div>
          <div className="muted">Algorithm</div>
          <div style={{ fontWeight: 700, fontSize: 14 }}>{result.algorithm}</div>
        </div>
      </div>

      {evResult && (
        <div className="section-gap" style={{ borderTop: "1px dashed var(--border)", paddingTop: 12 }}>
          <div className="flex-between">
            <span className="muted">Estimated EV Energy</span>
            <strong>{evResult.energyConsumedKwh} kWh</strong>
          </div>
          <div className="flex-between" style={{ marginTop: 6 }}>
            <span className="muted">Estimated EV Charging Cost</span>
            <strong>₹{evResult.estimatedChargingCostInr}</strong>
          </div>
        </div>
      )}

      <div className="section-gap">
        <span className={`badge ${result.optimal ? "badge-delivered" : "badge-ontheway"}`}>
          {result.optimal ? "Optimal Route: YES" : "Optimal Route: NO (heuristic)"}
        </span>
      </div>
    </div>
  );
}
