/*
 * DeliveryAgent.jsx
 * -----------------------------------------------------------------------
 * The delivery agent's screen. Works from the route calculated in the
 * Delivery Planner and walks through it stop by stop:
 *
 *   Start Delivery -> Navigate to Next Stop (opens Google Maps / OSM)
 *   -> Mark as Delivered / Skip Stop -> Recalculate Remaining Route -> Finish
 *
 * HONESTY NOTES
 *  - There is NO live GPS here. The agent's position is the pickup point,
 *    then the last stop marked delivered.
 *  - Turn-by-turn navigation is done by an external app opened from a link.
 *  - Times are estimates from road speeds, not guaranteed arrival times.
 *  - Delivered stops stay delivered when the route is recalculated.
 * -----------------------------------------------------------------------
 */

import React, { useState } from "react";
import { Link } from "react-router-dom";
import { usePlan } from "../hooks/PlanContext";
import { api, errorMessage } from "../services/api";
import * as A from "../services/agentLogic";
import PlanMap from "../components/PlanMap";
import VerificationBadge from "../components/VerificationBadge";

const fmtKm = (m) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(2)} km`);
const fmtMin = (s) => {
  const m = Math.max(1, Math.round(s / 60));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
};

export default function DeliveryAgent() {
  const { agent, setAgent, objective, costConfig } = usePlan();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);
  const [fitKey, setFitKey] = useState(1);

  if (!agent) {
    return (
      <div>
        <div className="page-title">Delivery Agent</div>
        <div className="card section-gap">
          <p className="muted" style={{ marginTop: 0 }}>
            No delivery is in progress. Plan a route in the Delivery Planner, then press “Start delivery (agent mode)”.
          </p>
          <Link className="btn btn-primary" to="/delivery-planner">Go to Delivery Planner</Link>
        </div>
      </div>
    );
  }

  const update = (next) => {
    setAgent(next);
    setError(null);
  };

  const c = A.counts(agent);
  const nextId = A.nextStopId(agent);
  const next = nextId ? A.stopById(agent, nextId) : null;
  const leg = A.nextLeg(agent);
  const remaining = A.remainingTotals(agent);
  const pending = A.pendingIds(agent);
  const skipped = Object.keys(agent.statusById).filter((id) => agent.statusById[id] === "skipped");
  const allDone = c.pending === 0;
  const inProgress = agent.started && !agent.finished;

  const labelOf = (id) => {
    const i = pending.indexOf(id);
    return i === -1 ? "" : String(i + 1);
  };

  const markers = agent.stops.map((s) => {
    const st = agent.statusById[s.id];
    const state = st === "delivered" ? "done" : st === "skipped" ? "skipped" : s.id === nextId ? "next" : "pending";
    return { id: s.id, lat: s.lat, lng: s.lng, name: s.name, address: s.address, label: labelOf(s.id) || "•", state };
  });

  const routes = agent.plan.valid || agent.recalculations > 0 || agent.plan.geometry ? [{ geometry: agent.plan.geometry, color: agent.plan.valid ? "#34d399" : "#8b98b8", dashed: !agent.plan.valid, weight: 5 }] : [];

  const recalc = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      if (pending.length === 0) throw new Error("There are no pending stops left to plan.");
      const res = await api.planRecalculate(A.recalcPayload(agent, objective, costConfig));
      setAgent(A.applyRecalc(agent, res));
      setFitKey((k) => k + 1);
      setMessage(
        `Route recalculated from ${agent.currentPoint.name}: ${res.optimized.distanceKm} km, about ${fmtMin(res.optimized.durationS)} for the remaining stops` +
          (res.policy === "return" ? " (including the return to the pickup)." : ".")
      );
    } catch (e) {
      setError(errorMessage(e, "Could not recalculate the route."));
    } finally {
      setBusy(false);
    }
  };

  const links = next ? A.navLinks(agent.currentPoint, next) : null;

  return (
    <div>
      <div className="flex-between" style={{ flexWrap: "wrap", gap: 10 }}>
        <div>
          <div className="page-title">Delivery Agent</div>
          <div className="page-subtitle">
            Starting point: <strong>{agent.pickup.name}</strong> · {agent.policy === "return" ? "returns to the pickup at the end" : "open route, finishes at the last stop"}
          </div>
        </div>
        <div className="flex-row" style={{ gap: 8 }}>
          {!agent.started && <button className="btn btn-primary" onClick={() => update(A.start(agent))}>Start delivery</button>}
          {inProgress && (
            <button
              className="btn btn-outline"
              onClick={() => (allDone || window.confirm(`${c.pending} stop(s) are still pending. Finish anyway?`)) && update(A.finish(agent))}
            >
              Finish delivery
            </button>
          )}
        </div>
      </div>

      {error && <div className="error-box section-gap">{error}</div>}
      {message && <div className="card section-gap" style={{ borderColor: "var(--primary)" }}>{message}</div>}

      {agent.finished && (
        <div className="card section-gap">
          <div className="card-title">Delivery finished</div>
          <p style={{ margin: 0 }}>
            Delivered {c.delivered} of {c.total} stops{c.skipped > 0 ? `, skipped ${c.skipped}` : ""}{c.pending > 0 ? `, ${c.pending} left pending` : ""}.
          </p>
          <div style={{ marginTop: 12 }}>
            <Link className="btn btn-outline" to="/delivery-planner">Back to Delivery Planner</Link>
          </div>
        </div>
      )}

      <div className="grid grid-4 section-gap">
        <div className="card"><div className="muted">Delivered</div><div className="big-num" style={{ color: "var(--primary)" }}>{c.delivered}</div></div>
        <div className="card"><div className="muted">Pending</div><div className="big-num">{c.pending}</div></div>
        <div className="card"><div className="muted">Skipped</div><div className="big-num" style={{ color: c.skipped ? "var(--danger)" : undefined }}>{c.skipped}</div></div>
        <div className="card">
          <div className="muted">Remaining route</div>
          {remaining ? (
            <>
              <div className="big-num">{fmtKm(remaining.distanceM)}</div>
              <div className="muted" style={{ fontSize: 12 }}>about {fmtMin(remaining.durationS)} (estimate)</div>
            </>
          ) : (
            <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
              The plan changed (a stop was skipped, re-added or delivered out of order). Press “Recalculate remaining route”.
            </div>
          )}
        </div>
      </div>

      <div className="grid section-gap" style={{ gridTemplateColumns: "2fr 1fr", alignItems: "start" }}>
        <PlanMap
          pickup={agent.pickup}
          markers={markers}
          routes={routes}
          agentPos={agent.currentPoint.isPickup ? null : agent.currentPoint}
          fitKey={fitKey}
          height={560}
        />

        <div className="card">
          <div className="card-title">{next ? "Next destination" : allDone ? "All stops handled" : "Next destination"}</div>
          {!next && (
            <p className="muted" style={{ marginTop: 0 }}>
              {c.skipped > 0 ? "Only skipped stops remain. Re-add one below, or finish the delivery." : "Every stop is delivered."}
              {agent.policy === "return" && c.skipped === 0 && " Drive back to the pickup point to finish."}
            </p>
          )}
          {next && (
            <>
              <div style={{ fontWeight: 700, fontSize: 18 }}>{next.name}</div>
              <div className="muted" style={{ marginBottom: 6 }}>{next.address}</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                <VerificationBadge status={next.verification} />
                {next.priority && next.priority !== "normal" && <span className="badge badge-pending">{next.priority} priority</span>}
              </div>
              {next.landmark && <div style={{ fontSize: 14 }}>Landmark: {next.landmark}</div>}
              {next.package && <div style={{ fontSize: 14 }}>Package: {next.package}</div>}
              {next.timeWindow && (next.timeWindow.from || next.timeWindow.to) && (
                <div style={{ fontSize: 14 }}>Requested window: {next.timeWindow.from || "any"} – {next.timeWindow.to || "any"}</div>
              )}
              <div style={{ marginTop: 10, fontSize: 14 }}>
                From {agent.currentPoint.name}:{" "}
                {leg ? <strong>{fmtKm(leg.distanceM)} · about {fmtMin(leg.durationS)}</strong> : <span className="muted">recalculate the route to see this</span>}
              </div>
              {inProgress && (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
                  <a className="btn btn-primary" href={links.google} target="_blank" rel="noreferrer">Navigate to next stop</a>
                  <a className="btn btn-outline" href={links.osm} target="_blank" rel="noreferrer">Open in OSM</a>
                  <button className="btn btn-accent" onClick={() => update(A.markDelivered(agent, next.id))}>Mark as delivered</button>
                  <button className="btn btn-outline" onClick={() => update(A.skipStop(agent, next.id))}>Skip stop</button>
                </div>
              )}
              {!agent.started && <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>Press “Start delivery” to begin.</p>}
            </>
          )}

          {inProgress && (
            <div style={{ marginTop: 16 }}>
              <button className="btn btn-primary" onClick={recalc} disabled={busy || pending.length === 0}>
                {busy ? "Recalculating…" : "Recalculate remaining route"}
              </button>
              <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
                Re-optimizes the pending stops from {agent.currentPoint.name}. Delivered stops stay delivered.
              </p>
            </div>
          )}

          <p className="muted" style={{ fontSize: 11, marginTop: 16, marginBottom: 0 }}>
            Position = pickup point, then the last stop marked delivered. This app does not read live GPS. Navigation opens in an external map app.
          </p>
        </div>
      </div>

      <div className="card section-gap">
        <div className="card-title">Stops</div>
        {agent.stops.length === 0 && <p className="muted">No stops.</p>}
        {[...pending, ...agent.deliveredIds, ...skipped].map((id) => {
          const s = A.stopById(agent, id);
          const st = agent.statusById[id];
          return (
            <div key={id} className="delivery-card" style={{ opacity: st === "delivered" ? 0.65 : 1 }}>
              <div>
                <div style={{ fontWeight: 700 }}>
                  {st === "pending" ? `${labelOf(id)}. ` : ""}{s.name}{" "}
                  <span className={`badge ${st === "delivered" ? "badge-delivered" : st === "skipped" ? "badge-danger" : id === nextId ? "badge-ontheway" : "badge-pending"}`}>
                    {st === "pending" ? (id === nextId ? "Next" : "Pending") : st === "delivered" ? "Delivered" : "Skipped"}
                  </span>
                </div>
                <div className="muted" style={{ fontSize: 13 }}>{s.address}</div>
              </div>
              {inProgress && st === "pending" && (
                <div className="flex-row" style={{ gap: 6 }}>
                  <button className="btn btn-outline" onClick={() => update(A.markDelivered(agent, id))}>Delivered</button>
                  <button className="btn btn-outline" onClick={() => update(A.skipStop(agent, id))}>Skip</button>
                </div>
              )}
              {inProgress && st === "skipped" && (
                <button className="btn btn-outline" onClick={() => update(A.restoreStop(agent, id))}>Re-add</button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
