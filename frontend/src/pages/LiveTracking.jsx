import React, { useEffect, useRef, useState } from "react";
import { useAppData } from "../hooks/AppDataContext";
import MapView, { AGENT_COLORS } from "../components/MapView";
import DeliveryCard from "../components/DeliveryCard";
import { api } from "../services/api";

// How long (ms) the agent with the longest route takes to finish; every
// other agent's simulated speed is scaled so it finishes proportionally
// sooner — matching the real makespan concept from Multi-Agent Routes.
const SIMULATION_BASE_MS = 20000;

function lerp(a, b, t) {
  return a + (b - a) * t;
}

export default function LiveTracking() {
  const { locations, routeResult, multiAgentResult, refreshLocations } = useAppData();

  // If a multi-agent allocation exists, default to showing all vehicles at
  // once — that's almost always what the person wants to see here. They can
  // switch back to the single optimized route if both exist.
  const [mode, setMode] = useState(multiAgentResult ? "multi" : "single");

  useEffect(() => {
    if (multiAgentResult) setMode("multi");
    else setMode("single");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [multiAgentResult]);

  useEffect(() => {
    refreshLocations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <div className="flex-between">
        <div>
          <div className="page-title">Live Tracking</div>
          <div className="page-subtitle">
            Simulated delivery-agent movement (demo simulation, not real GPS)
          </div>
        </div>
        {routeResult && multiAgentResult && (
          <div className="flex-row">
            <button className={`btn ${mode === "single" ? "btn-primary" : "btn-outline"}`} onClick={() => setMode("single")}>
              Single Agent
            </button>
            <button className={`btn ${mode === "multi" ? "btn-primary" : "btn-outline"}`} onClick={() => setMode("multi")}>
              Multi-Agent
            </button>
          </div>
        )}
      </div>

      {mode === "multi" && multiAgentResult ? (
        <MultiAgentTracking locations={locations} result={multiAgentResult} />
      ) : (
        <SingleAgentTracking locations={locations} routeResult={routeResult} />
      )}
    </div>
  );
}

/* ======================================================================
 * SINGLE AGENT VIEW — one truck along the last /route/optimize result
 * ==================================================================== */
function SingleAgentTracking({ locations, routeResult }) {
  const route = routeResult ? routeResult.route : null;

  const [status, setStatus] = useState("idle"); // idle | running | paused | done
  const [progress, setProgress] = useState(0);
  const [agentPos, setAgentPos] = useState(null);
  const [deliveries, setDeliveries] = useState([]);

  const rafRef = useRef(null);
  const startTimeRef = useRef(null);
  const pausedAtRef = useRef(0);
  const lastArrivedRef = useRef(-1);

  const refreshDeliveries = () => {
    api.getDeliveries().then(setDeliveries).catch(() => {});
  };

  useEffect(() => {
    refreshDeliveries();
  }, []);

  // Safety-net polling: keeps the Order Status panel visibly live even
  // between stop-crossing events, so it never looks like it has stalled.
  useEffect(() => {
    if (status !== "running") return;
    const interval = setInterval(refreshDeliveries, 800);
    return () => clearInterval(interval);
  }, [status]);

  useEffect(() => {
    if (route && route.length > 0) setAgentPos({ lat: route[0].lat, lng: route[0].lng });
    lastArrivedRef.current = -1;
  }, [route]);

  useEffect(() => {
    if (status !== "running" || !route || route.length < 2) return;

    const step = (now) => {
      if (!startTimeRef.current) startTimeRef.current = now - pausedAtRef.current;
      const elapsed = now - startTimeRef.current;
      const t = Math.min(elapsed / SIMULATION_BASE_MS, 1);
      setProgress(t);

      const segmentCount = route.length - 1;
      const segFloat = t * segmentCount;
      const segIndex = Math.min(Math.floor(segFloat), segmentCount - 1);
      const segT = segFloat - segIndex;
      const from = route[segIndex];
      const to = route[segIndex + 1];
      setAgentPos({ lat: lerp(from.lat, to.lat, segT), lng: lerp(from.lng, to.lng, segT) });

      if (t >= 1) {
        setStatus("done");
        return;
      }
      rafRef.current = requestAnimationFrame(step);
    };

    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [status, route]);

  useEffect(() => {
    if (status !== "running" || !route || route.length < 2) return;
    const segmentCount = route.length - 1;
    const arrivedIndex = Math.min(Math.floor(progress * segmentCount), segmentCount);

    if (arrivedIndex > lastArrivedRef.current) {
      const calls = [];
      for (let i = lastArrivedRef.current + 1; i <= arrivedIndex; i++) {
        const arrivedLoc = route[i];
        if (arrivedLoc && !arrivedLoc.isHub) calls.push(api.updateDeliveryStatus(arrivedLoc.id, "Delivered"));
        const headingToLoc = route[i + 1];
        if (headingToLoc && !headingToLoc.isHub && i < segmentCount) {
          calls.push(api.updateDeliveryStatus(headingToLoc.id, "On the way"));
        }
      }
      lastArrivedRef.current = arrivedIndex;
      Promise.all(calls).catch(() => {}).finally(refreshDeliveries);
    }
  }, [progress, status, route]);

  const handleStart = () => {
    if (!route || route.length < 2) return;
    pausedAtRef.current = progress * SIMULATION_BASE_MS;
    startTimeRef.current = null;
    if (lastArrivedRef.current === -1 && route[1] && !route[1].isHub) {
      api.updateDeliveryStatus(route[1].id, "On the way").catch(() => {}).finally(refreshDeliveries);
    }
    setStatus("running");
  };

  const handlePause = () => {
    setStatus("paused");
    cancelAnimationFrame(rafRef.current);
  };

  const handleReset = () => {
    cancelAnimationFrame(rafRef.current);
    startTimeRef.current = null;
    pausedAtRef.current = 0;
    setProgress(0);
    setStatus("idle");
    lastArrivedRef.current = -1;
    if (route && route.length > 0) setAgentPos({ lat: route[0].lat, lng: route[0].lng });
    if (route) {
      const calls = route.filter((loc) => !loc.isHub).map((loc) => api.updateDeliveryStatus(loc.id, "Pending"));
      Promise.all(calls).catch(() => {}).finally(refreshDeliveries);
    }
  };

  const currentStopIndex = route ? Math.min(Math.floor(progress * (route.length - 1)), route.length - 1) : 0;
  const nextStop = route ? route[Math.min(currentStopIndex + 1, route.length - 1)] : null;
  const etaMinutes = routeResult ? Math.round(routeResult.estimatedTimeMinutes * (1 - progress)) : 0;

  const routeDeliveries = route
    ? route
        .filter((loc) => !loc.isHub)
        .map((loc) => deliveries.find((d) => d.locationId === loc.id))
        .filter(Boolean)
    : [];

  return (
    <div>
      {!route && (
        <div className="error-box">
          No optimized route yet. Go to <strong>Plan Route</strong> and click "Optimize Route" — or go to{" "}
          <strong>Multi-Agent Routes</strong> to track several vehicles at once here.
        </div>
      )}

      <div className="grid section-gap" style={{ gridTemplateColumns: "2fr 1fr" }}>
        <MapView locations={locations} routeOrder={route} agentPosition={agentPos} height={480} />

        <div className="card">
          <div className="card-title">Delivery Agent</div>
          <div className="muted">Status</div>
          <span className={`badge ${status === "done" ? "badge-delivered" : status === "running" ? "badge-ontheway" : "badge-pending"}`}>
            {status === "running" ? "On the way" : status === "done" ? "Delivered" : status === "paused" ? "Paused" : "Idle"}
          </span>

          <div className="section-gap">
            <div className="muted">Current Stop</div>
            <div style={{ fontWeight: 700 }}>{route ? route[currentStopIndex]?.name : "—"}</div>
          </div>
          <div className="section-gap">
            <div className="muted">Next Stop</div>
            <div style={{ fontWeight: 700 }}>{nextStop ? nextStop.name : "—"}</div>
          </div>
          <div className="section-gap">
            <div className="flex-between">
              <span className="muted">Route Progress</span>
              <span className="muted">{Math.round(progress * 100)}%</span>
            </div>
            <div className="progress-track" style={{ marginTop: 6 }}>
              <div className="progress-fill" style={{ width: `${progress * 100}%` }} />
            </div>
          </div>
          <div className="section-gap">
            <div className="muted">ETA</div>
            <div style={{ fontWeight: 700 }}>{route ? `${etaMinutes} min` : "—"}</div>
          </div>

          <div className="flex-row section-gap">
            <button className="btn btn-primary" onClick={handleStart} disabled={!route || status === "running"}>
              Start Delivery
            </button>
            <button className="btn btn-outline" onClick={handlePause} disabled={status !== "running"}>
              Pause
            </button>
            <button className="btn btn-outline" onClick={handleReset} disabled={status === "idle"}>
              Reset
            </button>
          </div>
        </div>
      </div>

      {route && (
        <div className="card section-gap">
          <div className="card-title">Order Status (live)</div>
          {routeDeliveries.length === 0 && <p className="muted">No delivery orders for this route yet.</p>}
          {routeDeliveries.map((d) => (
            <DeliveryCard key={d.id} delivery={d} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ======================================================================
 * MULTI-AGENT VIEW — several trucks moving simultaneously, each on its
 * own route from the last /route/multi-agent allocation.
 * ==================================================================== */
function MultiAgentTracking({ locations, result }) {
  const [simStatus, setSimStatus] = useState("idle"); // idle | running | paused | done
  const [simAgents, setSimAgents] = useState(null);
  const [deliveries, setDeliveries] = useState([]);
  const rafRef = useRef(null);
  const startTimeRef = useRef(null);
  const pausedElapsedRef = useRef(0);
  const lastArrivedRefs = useRef([]);

  const refreshDeliveries = () => {
    api.getDeliveries().then(setDeliveries).catch(() => {});
  };

  const resetSimState = () => {
    lastArrivedRefs.current = result.agents.map(() => -1);
    setSimAgents(
      result.agents.map((a) => ({
        progress: 0,
        status: "idle",
        position: { lat: a.route[0].lat, lng: a.route[0].lng },
      }))
    );
    setSimStatus("idle");
    pausedElapsedRef.current = 0;
    startTimeRef.current = null;
  };

  useEffect(() => {
    resetSimState();
    refreshDeliveries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  // Safety-net polling: with several trucks moving at once, waiting only
  // for individual stop-crossing events can make the status panel look
  // like it has paused. A steady background refresh keeps it visibly
  // live the whole time the simulation is running.
  useEffect(() => {
    if (simStatus !== "running") return;
    const interval = setInterval(refreshDeliveries, 800);
    return () => clearInterval(interval);
  }, [simStatus]);

  useEffect(() => {
    if (simStatus !== "running") return;
    const makespan = result.makespanKm || 1;

    const step = (now) => {
      if (!startTimeRef.current) startTimeRef.current = now - pausedElapsedRef.current;
      const elapsed = now - startTimeRef.current;

      let allDone = true;
      const updated = result.agents.map((a, i) => {
        const durationForAgent = SIMULATION_BASE_MS * (a.totalDistanceKm / makespan || 1);
        const t = Math.min(elapsed / durationForAgent, 1);
        if (t < 1) allDone = false;

        const route = a.route;
        const segmentCount = route.length - 1;
        const segFloat = t * segmentCount;
        const segIndex = Math.min(Math.floor(segFloat), segmentCount - 1);
        const segT = segFloat - segIndex;
        const from = route[segIndex];
        const to = route[segIndex + 1];

        const arrivedIndex = Math.min(Math.floor(t * segmentCount), segmentCount);
        if (arrivedIndex > lastArrivedRefs.current[i]) {
          for (let s = lastArrivedRefs.current[i] + 1; s <= arrivedIndex; s++) {
            const arrivedLoc = route[s];
            if (arrivedLoc && !arrivedLoc.isHub) api.updateDeliveryStatus(arrivedLoc.id, "Delivered").catch(() => {});
            const headingTo = route[s + 1];
            if (headingTo && !headingTo.isHub && s < segmentCount) {
              api.updateDeliveryStatus(headingTo.id, "On the way").catch(() => {});
            }
          }
          lastArrivedRefs.current[i] = arrivedIndex;
          refreshDeliveries();
        }

        return {
          progress: t,
          status: t >= 1 ? "done" : "running",
          position: { lat: lerp(from.lat, to.lat, segT), lng: lerp(from.lng, to.lng, segT) },
        };
      });

      setSimAgents(updated);
      if (allDone) {
        setSimStatus("done");
        return;
      }
      rafRef.current = requestAnimationFrame(step);
    };

    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simStatus, result]);

  const handleStartAll = () => {
    startTimeRef.current = null;
    setSimStatus("running");
  };

  const handlePauseAll = () => {
    if (simAgents && simAgents.length > 0) {
      const makespan = result.makespanKm || 1;
      const a0 = result.agents[0];
      const duration0 = SIMULATION_BASE_MS * (a0.totalDistanceKm / makespan || 1);
      pausedElapsedRef.current = (simAgents[0]?.progress || 0) * duration0;
    }
    startTimeRef.current = null;
    setSimStatus("paused");
    cancelAnimationFrame(rafRef.current);
  };

  const handleResetAll = () => {
    cancelAnimationFrame(rafRef.current);
    resetSimState();
    const calls = result.agents.flatMap((a) =>
      a.route.filter((loc) => !loc.isHub).map((loc) => api.updateDeliveryStatus(loc.id, "Pending"))
    );
    Promise.all(calls).catch(() => {}).finally(refreshDeliveries);
  };

  const multiRoutes = result.agents.map((a, i) => ({ route: a.route, color: AGENT_COLORS[i % AGENT_COLORS.length] }));
  const agentPositions = simAgents
    ? simAgents.map((sa, i) => ({
        lat: sa.position.lat,
        lng: sa.position.lng,
        color: AGENT_COLORS[i % AGENT_COLORS.length],
        label: result.agents[i].agentName,
      }))
    : null;

  return (
    <div>
      <div className="flex-row section-gap">
        <button className="btn btn-primary" onClick={handleStartAll} disabled={simStatus === "running"}>
          Start All Deliveries
        </button>
        <button className="btn btn-outline" onClick={handlePauseAll} disabled={simStatus !== "running"}>
          Pause All
        </button>
        <button className="btn btn-outline" onClick={handleResetAll} disabled={simStatus === "idle"}>
          Reset All
        </button>
        <span className="muted">{result.agentCount} vehicles · makespan {result.makespanKm} km</span>
      </div>

      <div className="grid section-gap" style={{ gridTemplateColumns: "2fr 1fr" }}>
        <MapView locations={locations} multiRoutes={multiRoutes} agentPositions={agentPositions} height={520} />

        <div className="card">
          <div className="card-title">Vehicles (live)</div>
          {result.agents.map((a, i) => {
            const sa = simAgents ? simAgents[i] : null;
            const progress = sa ? sa.progress : 0;
            const segmentCount = a.route.length - 1;
            const currentIdx = Math.min(Math.floor(progress * segmentCount), segmentCount);
            const nextIdx = Math.min(currentIdx + 1, segmentCount);
            const color = AGENT_COLORS[i % AGENT_COLORS.length];

            return (
              <div key={a.agentId} style={{ borderLeft: `4px solid ${color}`, paddingLeft: 12, marginBottom: 18 }}>
                <div className="flex-between">
                  <strong>{a.agentName}</strong>
                  <span
                    className={`badge ${
                      sa?.status === "done" ? "badge-delivered" : sa?.status === "running" ? "badge-ontheway" : "badge-pending"
                    }`}
                  >
                    {sa?.status === "done" ? "Delivered" : sa?.status === "running" ? "On the way" : "Idle"}
                  </span>
                </div>
                <div className="muted" style={{ fontSize: 12, margin: "6px 0" }}>
                  {a.route.map((l) => l.name).join(" → ")}
                </div>
                <div style={{ fontSize: 13, marginBottom: 6 }}>
                  <strong>{a.totalDistanceKm} km</strong> · {a.stops} stops
                </div>
                <div className="progress-track">
                  <div className="progress-fill" style={{ width: `${progress * 100}%`, background: color }} />
                </div>
                <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                  {sa?.status === "done" ? "Route complete" : `Heading to ${a.route[nextIdx]?.name || a.route[currentIdx]?.name}`}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="card section-gap">
        <div className="card-title">Order Status (live) — all vehicles</div>
        {result.agents.every((a) => a.stops === 0) && <p className="muted">No delivery orders for this allocation yet.</p>}
        {result.agents.map((a, i) => {
          const color = AGENT_COLORS[i % AGENT_COLORS.length];
          const agentDeliveries = a.route
            .filter((loc) => !loc.isHub)
            .map((loc) => deliveries.find((d) => d.locationId === loc.id))
            .filter(Boolean);
          if (agentDeliveries.length === 0) return null;
          return (
            <div key={a.agentId} style={{ marginBottom: 14 }}>
              <div className="flex-row" style={{ marginBottom: 6 }}>
                <span style={{ width: 10, height: 10, borderRadius: "50%", background: color, display: "inline-block" }} />
                <strong style={{ fontSize: 13 }}>{a.agentName}</strong>
              </div>
              {agentDeliveries.map((d) => (
                <DeliveryCard key={d.id} delivery={d} />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
