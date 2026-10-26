/*
 * routeController.js
 * -----------------------------------------------------------------------
 * Handles /api/route/*. This is where the "React -> Node -> C++" flow
 * described in the architecture actually happens:
 *
 *   1. Get the list of locations (from the request body, or fall back
 *      to whatever is currently stored in-memory).
 *   2. If a "startId" was given, move that location to the front. The C++
 *      programs always treat index 0 as the starting point/depot, so this
 *      is how "plan the route starting from THIS place" works — the C++
 *      algorithm itself did not need to change at all.
 *   3. Build a Haversine distance matrix from their lat/lng.
 *   4. Spawn the C++ binary (tsp / greedy / multi_tsp) with that matrix.
 *   5. Translate the C++ output (city INDEXES) back into full location
 *      objects + leg-by-leg distances, so the frontend can draw markers,
 *      polylines and tables directly.
 *
 * DISTANCE USED: straight-line (Haversine) distance between coordinates.
 * It is an approximation of real road distance — roads wind, so real
 * driving distance is usually somewhat longer. See utils/distance.js.
 * -----------------------------------------------------------------------
 */

const store = require("../data/store");
const { buildDistanceMatrix } = require("../utils/distance");
const { runTsp, runGreedy, runMultiTsp } = require("../utils/runCpp");

const AVG_SPEED_KMPH = 30; // assumed average delivery-vehicle speed for ETA estimate

const round2 = (n) => Number(n.toFixed(2));
const minutesFor = (km) => Math.round((km / AVG_SPEED_KMPH) * 60);

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

function sendError(res, err) {
  res.status(err.status || 500).json({ error: err.message });
}

function resolveLocations(req) {
  if (Array.isArray(req.body.locations) && req.body.locations.length > 0) {
    return req.body.locations;
  }
  return store.getLocations();
}

// Moves the chosen start location to index 0 (everything else keeps its
// relative order). With no startId the list is returned unchanged, so the
// hub (already at index 0) stays the start.
function orderWithStart(locations, startId) {
  if (startId === undefined || startId === null || startId === "") return locations;
  const idx = locations.findIndex((l) => l.id === Number(startId));
  if (idx === -1) throw httpError(400, "The chosen start location was not found in the location list.");
  if (idx === 0) return locations;
  return [locations[idx], ...locations.slice(0, idx), ...locations.slice(idx + 1)];
}

// Common setup for every route endpoint: locations (start first) + matrix.
function prepare(req) {
  const locations = orderWithStart(resolveLocations(req), req.body.startId);
  if (locations.length < 2) {
    throw httpError(400, "Need at least a start/hub + 1 delivery location");
  }
  return { locations, matrix: buildDistanceMatrix(locations) };
}

// Builds the "Hub -> A: 3.2 km, A -> B: 1.1 km ..." table for one route.
function buildLegs(routeIndexes, matrix, locations) {
  let cumulative = 0;
  const legs = [];
  for (let i = 0; i < routeIndexes.length - 1; i++) {
    const a = routeIndexes[i];
    const b = routeIndexes[i + 1];
    const km = matrix[a][b];
    cumulative += km;
    legs.push({
      leg: i + 1,
      from: locations[a].name,
      to: locations[b].name,
      distanceKm: round2(km),
      cumulativeKm: round2(cumulative),
      etaMinutes: minutesFor(km),
    });
  }
  return legs;
}

// The first and last point of a tour are the start point. We mark those two
// entries isHub:true in the RESPONSE (not in the stored data) so the live
// tracking page never treats the start location as a customer delivery.
function orderedRoute(routeIndexes, locations) {
  const last = routeIndexes.length - 1;
  return routeIndexes.map((idx, pos) =>
    pos === 0 || pos === last ? { ...locations[idx], isHub: true } : locations[idx]
  );
}

function toRouteResponse(cppResult, locations, matrix) {
  return {
    startName: locations[0].name,
    routeIndexes: cppResult.route,
    route: orderedRoute(cppResult.route, locations),
    legs: buildLegs(cppResult.route, matrix, locations),
    totalDistanceKm: round2(cppResult.distance),
    estimatedTimeMinutes: minutesFor(cppResult.distance),
    stops: locations.length - 1, // everything except the start point
    algorithm: cppResult.algorithm,
    optimal: cppResult.optimal,
    computeTimeMs: cppResult.timeMs,
    distanceType: "Straight-line (Haversine) distance",
  };
}

// POST /api/route/optimize  (DP + Bitmask, exact/optimal)
// body: { locations?, startId? }
async function optimize(req, res) {
  try {
    const { locations, matrix } = prepare(req);
    const result = await runTsp(matrix);
    res.json(toRouteResponse(result, locations, matrix));
  } catch (err) {
    sendError(res, err);
  }
}

// POST /api/route/greedy  (Nearest Neighbor, comparison only)
async function greedy(req, res) {
  try {
    const { locations, matrix } = prepare(req);
    const result = await runGreedy(matrix);
    res.json(toRouteResponse(result, locations, matrix));
  } catch (err) {
    sendError(res, err);
  }
}

// POST /api/route/compare  (runs BOTH and returns them side by side)
async function compare(req, res) {
  try {
    const { locations, matrix } = prepare(req);

    const [dpResult, greedyResult] = await Promise.all([runTsp(matrix), runGreedy(matrix)]);

    const dp = toRouteResponse(dpResult, locations, matrix);
    const nn = toRouteResponse(greedyResult, locations, matrix);

    res.json({
      dynamicProgramming: dp,
      nearestNeighbor: nn,
      distanceDifferenceKm: round2(nn.totalDistanceKm - dp.totalDistanceKm),
      dpIsFaster: dp.computeTimeMs < nn.computeTimeMs,
      note:
        "Dynamic Programming gives the optimal TSP solution. Nearest Neighbor is faster but does not guarantee an optimal solution.",
    });
  } catch (err) {
    sendError(res, err);
  }
}

// POST /api/route/distances
// body: { locations?, startId? }
// "From this place, how far is every other place?" — sorted nearest first —
// plus the full distance matrix between all places.
function distances(req, res) {
  try {
    const { locations, matrix } = prepare(req);
    const origin = locations[0];

    const destinations = locations
      .slice(1)
      .map((loc, i) => {
        const km = matrix[0][i + 1];
        return {
          id: loc.id,
          name: loc.name,
          address: loc.address,
          lat: loc.lat,
          lng: loc.lng,
          isHub: !!loc.isHub,
          distanceKm: round2(km),
          etaMinutes: minutesFor(km),
        };
      })
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .map((d, i) => ({ ...d, rank: i + 1 }));

    res.json({
      origin: { id: origin.id, name: origin.name, address: origin.address },
      destinations,
      nearest: destinations[0],
      farthest: destinations[destinations.length - 1],
      distanceType: "Straight-line (Haversine) distance",
      matrix: {
        labels: locations.map((l) => l.name),
        km: matrix.map((row) => row.map(round2)),
      },
    });
  } catch (err) {
    sendError(res, err);
  }
}

// POST /api/route/multi-agent
// body: { locations?: [...], agents: number, startId? }
// Allocates stops among N delivery agents, each route solved exactly by DP.
async function multiAgent(req, res) {
  try {
    const agentCount = Math.max(1, parseInt(req.body.agents, 10) || 1);
    const { locations, matrix } = prepare(req);
    const result = await runMultiTsp(matrix, agentCount);

    // Translate each agent's index-based route into full location objects
    const agents = result.agents.map((a) => ({
      agentId: a.agentId,
      agentName: `Agent ${a.agentId + 1}`,
      routeIndexes: a.route,
      route: orderedRoute(a.route, locations),
      legs: buildLegs(a.route, matrix, locations),
      stops: a.stopCount,
      totalDistanceKm: round2(a.distance),
      estimatedTimeMinutes: minutesFor(a.distance),
    }));

    res.json({
      startName: locations[0].name,
      agents,
      agentCount: result.agentCount,
      totalDistanceKm: round2(result.totalDistance),
      makespanKm: round2(result.makespan),
      makespanTimeMinutes: minutesFor(result.makespan),
      algorithm: result.algorithm,
      perAgentOptimal: result.perAgentOptimal,
      computeTimeMs: result.timeMs,
      note:
        "Stops are allocated to agents by a balanced clustering heuristic; each agent's own route is then solved exactly using DP + Bitmasking.",
    });
  } catch (err) {
    sendError(res, err);
  }
}

module.exports = { optimize, greedy, compare, multiAgent, distances };
