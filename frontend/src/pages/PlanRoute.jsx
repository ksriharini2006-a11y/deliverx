import React, { useEffect, useState } from "react";
import { useAppData } from "../hooks/AppDataContext";
import MapView from "../components/MapView";
import RouteSummaryCard from "../components/RouteSummaryCard";
import { api } from "../services/api";
import { loadCostConfig } from "../services/costConfig";

export default function PlanRoute() {
  const { locations, routeResult, compareResult, loading, error, refreshLocations, optimize, compare } = useAppData();
  const [evResult, setEvResult] = useState(null);
  const [showEv, setShowEv] = useState(false);
  const [evError, setEvError] = useState(null);
  const [evLoading, setEvLoading] = useState(false);

  useEffect(() => {
    refreshLocations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleOptimize = async () => {
    const result = await optimize();
    setEvResult(null);
    setShowEv(false);
    return result;
  };

  const handleEvEstimate = async () => {
    if (!routeResult) return;
    setEvError(null);
    setEvLoading(true);
    try {
      const cfg = loadCostConfig();
      const ev = await api.calculateEv(routeResult.totalDistanceKm, {
        efficiencyKmPerKwh: cfg.ev.kmPerKwh,
        costPerKwh: cfg.ev.pricePerKwh,
      });
      setEvResult(ev);
      setShowEv(true);
    } catch (e) {
      // Surface the real reason instead of failing silently — most likely
      // causes: backend not running, or running on a different port than
      // the one set in src/services/api.js (API_BASE).
      setEvError(
        e.response?.data?.error ||
          "Could not reach the backend's /api/ev/calculate endpoint. Is the backend running, and does API_BASE in src/services/api.js match its port?"
      );
      setShowEv(false);
    } finally {
      setEvLoading(false);
    }
  };

  return (
    <div>
      <div className="page-title">Plan Route</div>
      <div className="page-subtitle">
        Run the exact Dynamic Programming (DP + Bitmask) TSP solver, or compare it against the Nearest Neighbor greedy heuristic.
      </div>

      {error && <div className="error-box">{error}</div>}

      <div className="flex-row section-gap">
        <button className="btn btn-primary" onClick={handleOptimize} disabled={loading || locations.length < 2}>
          {loading ? "Working..." : "Optimize Route (DP)"}
        </button>
        <button className="btn btn-accent" onClick={compare} disabled={loading || locations.length < 2}>
          Compare Algorithms
        </button>
        <button className="btn btn-outline" onClick={handleEvEstimate} disabled={!routeResult || evLoading}>
          {evLoading ? "Calculating..." : "Estimate EV Cost"}
        </button>
      </div>

      {evError && <div className="error-box section-gap">{evError}</div>}

      <div className="grid section-gap" style={{ gridTemplateColumns: "2fr 1fr" }}>
        <MapView locations={locations} routeOrder={routeResult ? routeResult.route : null} height={480} />
        <RouteSummaryCard result={routeResult} evResult={showEv ? evResult : null} />
      </div>

      {compareResult && (
        <div className="card section-gap">
          <div className="card-title">Algorithm Comparison</div>
          <div className="grid grid-2">
            <div>
              <div className="flex-row">
                <span className="badge badge-delivered">Dynamic Programming</span>
              </div>
              <p className="muted section-gap" style={{ marginTop: 8 }}>
                Route: {compareResult.dynamicProgramming.route.map((l) => l.name).join(" → ")}
              </p>
              <p><strong>{compareResult.dynamicProgramming.totalDistanceKm} km</strong> · {compareResult.dynamicProgramming.computeTimeMs} ms</p>
            </div>
            <div>
              <div className="flex-row">
                <span className="badge badge-ontheway">Nearest Neighbor (Greedy)</span>
              </div>
              <p className="muted section-gap" style={{ marginTop: 8 }}>
                Route: {compareResult.nearestNeighbor.route.map((l) => l.name).join(" → ")}
              </p>
              <p><strong>{compareResult.nearestNeighbor.totalDistanceKm} km</strong> · {compareResult.nearestNeighbor.computeTimeMs} ms</p>
            </div>
          </div>
          <div className="section-gap" style={{ borderTop: "1px dashed var(--border)", paddingTop: 12 }}>
            <p>
              <strong>Distance difference:</strong> {compareResult.distanceDifferenceKm} km
            </p>
            <p className="muted">{compareResult.note}</p>
          </div>
        </div>
      )}
    </div>
  );
}
