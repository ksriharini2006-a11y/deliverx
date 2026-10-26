import { Link } from "react-router-dom";
import React, { useEffect, useRef, useState } from "react";
import { useAppData } from "../hooks/AppDataContext";
import MapView, { AGENT_COLORS } from "../components/MapView";
import StatCard from "../components/StatCard";
import { api } from "../services/api";

// The agent with the longest route (the makespan) takes this long to
// finish; every other agent's simulated speed is scaled so it finishes
// proportionally sooner — matching the real makespan concept.
const SIMULATION_BASE_MS = 20000;

function lerp(a, b, t) {
  return a + (b - a) * t;
}

export default function MultiAgent() {
  const { locations, refreshLocations, multiAgentResult, allocateMultiAgent } = useAppData();
  const [agentCount, setAgentCount] = useState(3);
  const result = multiAgentResult;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // ---- live simulation state (all agents move at once) ----
  const [simStatus, setSimStatus] = useState("idle"); // idle | running | paused | done
  const [simAgents, setSimAgents] = useState(null); // [{progress, position, status}]
  const rafRef = useRef(null);
  const startTimeRef = useRef(null);
  const pausedElapsedRef = useRef(0);
  const lastArrivedRefs = useRef([]); // one ref-value array per agent, tracks stops already reported

  useEffect(() => {
    refreshLocations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const deliveryStopCount = locations.filter((l) => !l.isHub).length;

  const resetSimState = (agentsResult) => {
    lastArrivedRefs.current = agentsResult.map(() => -1);
    setSimAgents(
      agentsResult.map((a) => ({
        progress: 0,
        status: "idle",
        position: { lat: a.route[0].lat, lng: a.route[0].lng },
      }))
    );
    setSimStatus("idle");
    pausedElapsedRef.current = 0;
    startTimeRef.current = null;
  };

  const handleAllocate = async () => {
    setError(null);
    setLoading(true);
    try {
      const data = await allocateMultiAgent(agentCount);
      if (data) resetSimState(data.agents);
      else setError("Could not reach /api/route/multi-agent. Is the backend running, and is multi_tsp compiled in the cpp/ folder?");
    } finally {
      setLoading(false);
    }
  };

  // ---- animation loop: advances every agent's truck simultaneously ----
  useEffect(() => {
    if (simStatus !== "running" || !result) return;

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

        // fire delivery-status updates as this agent passes each stop
        const arrivedIndex = Math.min(Math.floor(t * segmentCount), segmentCount);
        if (arrivedIndex > lastArrivedRefs.current[i]) {
          for (let s = lastArrivedRefs.current[i] + 1; s <= arrivedIndex; s++) {
            const arrivedLoc = route[s];
            if (arrivedLoc && !arrivedLoc.isHub) {
              api.updateDeliveryStatus(arrivedLoc.id, "Delivered").catch(() => {});
            }
            const headingTo = route[s + 1];
            if (headingTo && !headingTo.isHub && s < segmentCount) {
              api.updateDeliveryStatus(headingTo.id, "On the way").catch(() => {});
            }
          }
          lastArrivedRefs.current[i] = arrivedIndex;
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
    if (!result) return;
    startTimeRef.current = null;
    setSimStatus("running");
  };

  const handlePauseAll = () => {
    if (simAgents && simAgents.length > 0) {
      // approximate elapsed using the first agent's own duration/progress
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
    if (result) {
      resetSimState(result.agents);
      // put every stop on every route back to Pending
      const calls = result.agents.flatMap((a) =>
        a.route.filter((loc) => !loc.isHub).map((loc) => api.updateDeliveryStatus(loc.id, "Pending"))
      );
      Promise.all(calls).catch(() => {});
    }
  };

  const multiRoutes = result
    ? result.agents.map((a, i) => ({ route: a.route, color: AGENT_COLORS[i % AGENT_COLORS.length] }))
    : null;

  const agentPositions =
    result && simAgents
      ? simAgents.map((sa, i) => ({
          lat: sa.position.lat,
          lng: sa.position.lng,
          color: AGENT_COLORS[i % AGENT_COLORS.length],
          label: result.agents[i].agentName,
        }))
      : null;

  return (
    <div>
      <div className="flex-between">
        <div>
          <div className="page-title">Multi-Agent Routing</div>
          <div className="page-subtitle">
            Allocate stops across several agents (mTSP), then watch all of them deliver simultaneously.
          </div>
        </div>
        <Link className="btn btn-outline" to="/delivery-planner">
          Plan places in the Delivery Planner
        </Link>
      </div>

      {error && <div className="error-box">{error}</div>}

      <div className="card section-gap">
        <div className="flex-row" style={{ flexWrap: "wrap", gap: 16 }}>
          <div className="field" style={{ marginBottom: 0, minWidth: 200 }}>
            <label>Number of Delivery Agents</label>
            <select value={agentCount} onChange={(e) => setAgentCount(Number(e.target.value))}>
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <option key={n} value={n}>
                  {n} {n === 1 ? "agent" : "agents"}
                </option>
              ))}
            </select>
          </div>
          <button
            className="btn btn-primary"
            onClick={handleAllocate}
            disabled={loading || deliveryStopCount < 1}
            style={{ alignSelf: "flex-end" }}
          >
            {loading ? "Allocating..." : "Allocate Routes"}
          </button>

          {result && (
            <>
              <button
                className="btn btn-accent"
                onClick={handleStartAll}
                disabled={simStatus === "running"}
                style={{ alignSelf: "flex-end" }}
              >
                Start All Deliveries
              </button>
              <button className="btn btn-outline" onClick={handlePauseAll} disabled={simStatus !== "running"} style={{ alignSelf: "flex-end" }}>
                Pause All
              </button>
              <button className="btn btn-outline" onClick={handleResetAll} disabled={simStatus === "idle"} style={{ alignSelf: "flex-end" }}>
                Reset All
              </button>
            </>
          )}

          <div style={{ alignSelf: "flex-end" }} className="muted">
            {deliveryStopCount} delivery stops available
          </div>
        </div>
      </div>

      {result && (
        <div className="grid grid-4 section-gap">
          <StatCard label="Agents Used" value={result.agentCount} icon="🧑‍🚀" />
          <StatCard label="Total Distance" value={`${result.totalDistanceKm} km`} icon="🛣️" />
          <StatCard label="Longest Route" value={`${result.makespanKm} km`} icon="⏳" />
          <StatCard
            label="Simulation Status"
            value={simStatus === "running" ? "In progress" : simStatus === "done" ? "All delivered" : "Idle"}
            icon="🚦"
          />
        </div>
      )}

      <div className="grid section-gap" style={{ gridTemplateColumns: "2fr 1fr" }}>
        <MapView locations={locations} multiRoutes={multiRoutes} agentPositions={agentPositions} height={520} />

        <div className="card">
          <div className="card-title">Agents (live)</div>
          {!result && <p className="muted">Pick a number of agents and click "Allocate Routes".</p>}

          {result &&
            result.agents.map((a, i) => {
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
                    {sa?.status === "done"
                      ? "Route complete"
                      : `Heading to ${a.route[nextIdx]?.name || a.route[currentIdx]?.name}`}
                  </div>
                </div>
              );
            })}
        </div>
      </div>

      {result && (
        <div className="card section-gap">
          <div className="card-title">Why two phases?</div>
          <p className="muted" style={{ fontSize: 13, lineHeight: 1.6 }}>
            Splitting stops among agents (mTSP) is solved here as <strong>cluster-first, route-second</strong>.
            Phase 1 partitions the stops into balanced groups using a seed-based clustering heuristic. Phase 2 runs
            the exact <strong>DP + Bitmask (Held-Karp)</strong> solver separately on each group, so every individual
            agent's route is provably optimal for the stops it was given. The allocation itself is a heuristic —
            finding the globally optimal partition is harder still. All agents are simulated moving at once here;
            the agent with the longest route (the makespan) determines how long the whole delivery run takes.
          </p>
        </div>
      )}
    </div>
  );
}
