import React, { useEffect } from "react";
import { Link } from "react-router-dom";
import { useAppData } from "../hooks/AppDataContext";
import MapView from "../components/MapView";
import RouteSummaryCard from "../components/RouteSummaryCard";
import StatCard from "../components/StatCard";

export default function Dashboard() {
  const { locations, routeResult, loading, error, refreshLocations, optimize } = useAppData();

  useEffect(() => {
    refreshLocations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <div className="flex-between">
        <div>
          <div className="page-title">Dashboard</div>
          <div className="page-subtitle">Overview of your delivery network and last optimized route</div>
        </div>
        <div className="flex-row">
          <Link className="btn btn-outline" to="/delivery-planner">
            Open Delivery Planner
          </Link>
          <button className="btn btn-primary" onClick={optimize} disabled={loading || locations.length < 2}>
            {loading ? "Optimizing..." : "Optimize Route"}
          </button>
        </div>
      </div>

      {error && <div className="error-box">{error}</div>}

      {locations.length === 0 && (
        <div className="card section-gap">
          <p style={{ margin: 0 }}>
            Nothing is pre-loaded. Start in the <Link to="/delivery-planner">Delivery Planner</Link>: choose your area, search a pickup point and your
            delivery addresses, and get a road-based route. (This dashboard summarises the classic straight-line tools, which use the same places once you copy them over.)
          </p>
        </div>
      )}

      <div className="grid grid-4 section-gap">
        <StatCard label="Delivery Locations" value={locations.length} icon="📍" />
        <StatCard label="Total Distance" value={routeResult ? `${routeResult.totalDistanceKm} km` : "—"} icon="🛣️" />
        <StatCard label="Estimated Time" value={routeResult ? `${routeResult.estimatedTimeMinutes} min` : "—"} icon="⏱️" />
        <StatCard label="Algorithm" value={routeResult ? "DP + Bitmask" : "—"} icon="🧮" />
      </div>

      <div className="grid section-gap" style={{ gridTemplateColumns: "2fr 1fr" }}>
        <MapView
          locations={locations}
          routeOrder={routeResult ? routeResult.route : null}
          height={500}
        />
        <RouteSummaryCard result={routeResult} />
      </div>
    </div>
  );
}
