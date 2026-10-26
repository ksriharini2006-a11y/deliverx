import React, { useEffect, useState } from "react";
import { useAppData } from "../hooks/AppDataContext";
import StatCard from "../components/StatCard";
import DeliveryCard from "../components/DeliveryCard";
import { api } from "../services/api";

export default function Analytics() {
  const { locations, routeResult, refreshLocations } = useAppData();
  const [deliveries, setDeliveries] = useState([]);

  useEffect(() => {
    refreshLocations();
    api.getDeliveries().then(setDeliveries).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const completed = deliveries.filter((d) => d.status === "Delivered").length;

  return (
    <div>
      <div className="page-title">Analytics</div>
      <div className="page-subtitle">Delivery and route-optimization statistics</div>

      <div className="grid grid-3 section-gap">
        <StatCard label="Total Deliveries" value={deliveries.length} icon="📦" />
        <StatCard label="Completed Deliveries" value={completed} icon="✅" />
        <StatCard label="Delivery Locations" value={locations.length} icon="📍" />
        <StatCard label="Total Distance (last route)" value={routeResult ? `${routeResult.totalDistanceKm} km` : "—"} icon="🛣️" />
        <StatCard label="Avg. Delivery Time" value={routeResult ? `${Math.round(routeResult.estimatedTimeMinutes / Math.max(routeResult.stops, 1))} min/stop` : "—"} icon="⏱️" />
        <StatCard label="Routes Optimized" value={routeResult ? 1 : 0} icon="🧮" />
      </div>

      <div className="card section-gap">
        <div className="card-title">Delivery Status</div>
        {deliveries.length === 0 && <p className="muted">No deliveries yet. Add locations in the Delivery Planner or the Delivery Locations page.</p>}
        {deliveries.map((d) => (
          <DeliveryCard key={d.id} delivery={d} />
        ))}
      </div>
    </div>
  );
}
