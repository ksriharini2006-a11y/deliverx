/*
 * agentLogic.js - the delivery-agent state machine, as small pure functions
 * (no React, no network) so the rules are easy to read and to test.
 *
 * WHAT "POSITION" MEANS: the agent's position is the pickup point at the start
 * and the last stop marked delivered afterwards. The app does NOT read live
 * GPS, so it never claims to know where the vehicle really is.
 *
 * A "plan" is the current route for the REMAINING stops: the order of stop
 * ids, the road legs between them and the road geometry. It stays "valid"
 * while the agent follows it exactly (delivering the next stop each time).
 * Skipping a stop, delivering out of order or re-adding a stop makes it
 * invalid: remaining totals are then unknown until the route is recalculated,
 * and the UI says so instead of showing wrong numbers.
 *
 * Statuses are kept PER STOP ID, separate from the plan, so recalculating the
 * route can never turn a delivered stop back into a pending one.
 * -----------------------------------------------------------------------
 */

const sum = (arr, key) => arr.reduce((s, x) => s + (x[key] || 0), 0);

export function initAgent(result, pickup, stops, policy) {
  const opt = result.optimized;
  return {
    started: false,
    finished: false,
    policy,
    pickup: { id: "pickup", name: pickup.name, address: pickup.address || "", lat: pickup.lat, lng: pickup.lng },
    stops: stops.map((s) => ({ ...s })), // snapshot: later edits in the planner do not affect a running delivery
    statusById: Object.fromEntries(opt.order.map((id) => [id, "pending"])),
    deliveredIds: [],
    currentPoint: { name: pickup.name, lat: pickup.lat, lng: pickup.lng, isPickup: true },
    plan: {
      order: opt.order.slice(),
      legs: opt.legs.map((l) => ({ fromId: l.fromId, toId: l.toId, from: l.from, to: l.to, distanceM: l.distanceM, durationS: l.durationS })),
      geometry: opt.geometry,
      cursor: 0,
      valid: true,
    },
    recalculations: 0,
  };
}

export const stopById = (agent, id) => agent.stops.find((s) => s.id === id) || null;

export function pendingIds(agent) {
  const pend = Object.keys(agent.statusById).filter((id) => agent.statusById[id] === "pending");
  const rank = (id) => {
    const i = agent.plan.order.indexOf(id);
    return i === -1 ? 1e9 : i;
  };
  return pend.sort((a, b) => rank(a) - rank(b));
}

export function nextStopId(agent) {
  const p = pendingIds(agent);
  return p.length ? p[0] : null;
}

export function counts(agent) {
  const ids = Object.keys(agent.statusById);
  const c = { total: ids.length, delivered: 0, skipped: 0, pending: 0 };
  ids.forEach((id) => {
    c[agent.statusById[id]] += 1;
  });
  return c;
}

export function start(agent) {
  return { ...agent, started: true };
}

export function finish(agent) {
  return { ...agent, finished: true };
}

export function markDelivered(agent, id) {
  if (agent.statusById[id] !== "pending") return agent;
  const stop = stopById(agent, id);
  if (!stop) return agent;
  const wasNext = nextStopId(agent) === id;
  const keepsPlan = wasNext && agent.plan.valid;
  return {
    ...agent,
    statusById: { ...agent.statusById, [id]: "delivered" },
    deliveredIds: [...agent.deliveredIds, id],
    currentPoint: { name: stop.name, lat: stop.lat, lng: stop.lng, isPickup: false },
    plan: { ...agent.plan, cursor: keepsPlan ? agent.plan.cursor + 1 : agent.plan.cursor, valid: keepsPlan },
  };
}

export function skipStop(agent, id) {
  if (agent.statusById[id] !== "pending") return agent;
  return { ...agent, statusById: { ...agent.statusById, [id]: "skipped" }, plan: { ...agent.plan, valid: false } };
}

export function restoreStop(agent, id) {
  if (agent.statusById[id] !== "skipped") return agent;
  return { ...agent, statusById: { ...agent.statusById, [id]: "pending" }, plan: { ...agent.plan, valid: false } };
}

/** Remaining distance/time of the CURRENT plan, or null if it needs recalculating. */
export function remainingTotals(agent) {
  if (!agent.plan.valid) return null;
  const legs = agent.plan.legs.slice(agent.plan.cursor);
  return { distanceM: sum(legs, "distanceM"), durationS: sum(legs, "durationS"), legs: legs.length };
}

/** The road leg from the agent's position to the next stop (valid plan only). */
export function nextLeg(agent) {
  if (!agent.plan.valid) return null;
  return agent.plan.legs[agent.plan.cursor] || null;
}

/** Request body for POST /api/plan/recalculate (remaining = pending stops only). */
export function recalcPayload(agent, objective, costConfig) {
  const remaining = pendingIds(agent).map((id) => stopById(agent, id));
  return {
    currentPoint: { name: agent.currentPoint.name, lat: agent.currentPoint.lat, lng: agent.currentPoint.lng },
    depot: agent.policy === "return" ? agent.pickup : undefined,
    remainingStops: remaining,
    policy: agent.policy,
    objective,
    costConfig,
  };
}

export function applyRecalc(agent, res) {
  const opt = res.optimized;
  return {
    ...agent,
    recalculations: agent.recalculations + 1,
    plan: {
      order: opt.order.slice(),
      legs: opt.legs.map((l) => ({ fromId: l.fromId, toId: l.toId, from: l.from, to: l.to, distanceM: l.distanceM, durationS: l.durationS })),
      geometry: opt.geometry,
      cursor: 0,
      valid: true,
    },
  };
}

/** Links that open turn-by-turn navigation in an external app (the app itself does not navigate). */
export function navLinks(from, to) {
  const o = `${from.lat},${from.lng}`;
  const d = `${to.lat},${to.lng}`;
  return {
    google: `https://www.google.com/maps/dir/?api=1&origin=${o}&destination=${d}&travelmode=driving`,
    osm: `https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=${o}%3B${d}`,
  };
}
