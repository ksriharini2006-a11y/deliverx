/*
 * planService.js - the hyperlocal planning pipeline (one function per API call):
 *
 *   optimize()   pickup + stops  -> best order, road geometry, costs
 *   recalculate() agent position + remaining stops -> new best order
 *
 * Pipeline, in order:
 *   1. validate input (coordinates, ids, duplicates, delivery zone)
 *   2. ask OSRM for the ROAD distance + travel-time matrix (directed)
 *   3. pick the objective (shortest distance or shortest time)
 *   4. run the DAA solver (exact DP for small plans, NN + 2-opt otherwise)
 *   5. verify the answer (every stop once, correct start/finish)
 *   6. ask OSRM for the road-following geometry of the final route
 *      (and of the user's original order, for the before/after comparison)
 *   7. total everything FROM THE ROUTE LEGS, so numbers shown add up
 *   8. attach standard / EV cost estimates
 *
 * ROUTE POLICIES
 *   "return"  pickup -> all stops -> back to the pickup
 *   "open"    pickup -> all stops, finishing at the last stop
 *   (When re-planning mid-delivery with policy "return" the route starts at
 *    the agent's current point and must still END at the pickup depot.)
 */

const config = require("./config");
const { ApiError } = require("./errors");
const routing = require("./routingService");
const tsp = require("./tspService");
const costService = require("./costService");
const { validateStops, validateRouteIntegrity } = require("./validationService");

const round1 = (n) => Math.round(n * 10) / 10;
const round2 = (n) => Math.round(n * 100) / 100;

const DURATION_NOTE =
  "Travel times are OSRM free-flow estimates from road speeds. They are not live traffic and not guaranteed arrival times.";

function pickPoint(p) {
  return {
    id: p.id,
    name: p.name || "",
    address: p.address || "",
    lat: p.lat,
    lng: p.lng,
    verification: p.verification || null,
    priority: p.priority || null,
    timeWindow: p.timeWindow || null,
    package: p.package || null,
    landmark: p.landmark || null,
  };
}

function sumRoute(seq, matrix) {
  let d = 0;
  for (let i = 0; i < seq.length - 1; i++) d += matrix[seq[i]][seq[i + 1]];
  return d;
}

function normalizePolicy(policy) {
  if (policy === undefined || policy === null || policy === "") return "return";
  if (policy !== "return" && policy !== "open") {
    throw new ApiError(400, "INVALID_POLICY", 'policy must be "return" (back to pickup) or "open" (finish at last stop).');
  }
  return policy;
}

function normalizeObjective(obj) {
  if (obj === undefined || obj === null || obj === "") return "distance";
  if (obj !== "distance" && obj !== "duration") {
    throw new ApiError(400, "INVALID_OBJECTIVE", 'objective must be "distance" or "duration".');
  }
  return obj;
}

/**
 * Core planner. nodes = [start, ...stops, (depot)].
 * @param {{start:object, stops:object[], depot?:object|null, policy:string, objective:string,
 *          costConfig?:object, includeOriginalRoute?:boolean, exactMaxNodes?:number}} args
 */
async function planRoute({ start, stops, depot = null, policy, objective, costConfig, includeOriginalRoute, exactMaxNodes }) {
  const m = stops.length;
  const nodes = [start, ...stops, ...(depot ? [depot] : [])];
  const depotIndex = depot ? nodes.length - 1 : null;

  // 2. road matrices (directed)
  const matrix = await routing.getMatrix(nodes);

  // 3. cost unit handed to the solver
  const cost =
    objective === "duration"
      ? matrix.durationsS.map((r) => r.map((v) => v / 60)) // minutes
      : matrix.distancesM.map((r) => r.map((v) => v / 1000)); // km

  // route shape
  const open = policy === "open" && !depot;
  const fixedEnd = depot ? depotIndex : undefined;
  const mode = depot ? "fixedEnd" : open ? "open" : "closed";

  // original order = the order the user entered the stops
  const originalSeq = [0, ...stops.map((_, i) => i + 1)];
  if (depot) originalSeq.push(depotIndex);
  else if (!open) originalSeq.push(0);

  // 4. solve
  const solved = await tsp.solve(cost, { open, fixedEnd, exactMaxNodes });

  // 5. verify
  validateRouteIntegrity(solved.route, { stopCount: m, mode, fixedEnd });

  const seqPoints = (seq) => seq.map((idx) => nodes[idx]);

  // 6. road geometry
  const optRoute = await routing.getRoute(seqPoints(solved.route));
  const origRoute = includeOriginalRoute ? await routing.getRoute(seqPoints(originalSeq)) : null;

  // 7. consistent totals: sum of the route legs
  const legs = optRoute.legs.map((l, i) => {
    const a = nodes[solved.route[i]];
    const b = nodes[solved.route[i + 1]];
    return { leg: i + 1, fromId: a.id, toId: b.id, from: a.name, to: b.name, distanceM: Math.round(l.distanceM), durationS: Math.round(l.durationS) };
  });
  let cum = 0;
  legs.forEach((l) => {
    cum += l.distanceM;
    l.cumulativeM = cum;
  });
  const distanceM = legs.reduce((s, l) => s + l.distanceM, 0);
  const durationS = legs.reduce((s, l) => s + l.durationS, 0);

  const matrixDistanceM = sumRoute(solved.route, matrix.distancesM);
  const matrixDurationS = sumRoute(solved.route, matrix.durationsS);
  const warnings = [];
  const mismatchPct = matrixDistanceM > 0 ? (Math.abs(distanceM - matrixDistanceM) / matrixDistanceM) * 100 : 0;
  if (mismatchPct > config.ROUTE_MISMATCH_WARN_PCT) {
    warnings.push({
      code: "ROUTE_MATRIX_MISMATCH",
      message: `Route-leg total differs from the optimizer's distance table by ${mismatchPct.toFixed(1)}%. Displayed totals use the route legs.`,
    });
  }

  // snapped-pin warnings
  matrix.snapM.forEach((s, i) => {
    if (s > config.SNAP_WARN_M && nodes[i]) {
      warnings.push({
        code: "PIN_FAR_FROM_ROAD",
        stopId: nodes[i].id,
        message: `"${nodes[i].name}" is about ${Math.round(s)} m from the nearest road; routing used the closest road point. Consider moving the pin.`,
      });
    }
  });

  const seqFor = (seq) => seq.map((idx) => {
    const kind = idx === 0 ? "start" : depot && idx === depotIndex ? "depot" : "stop";
    return { ...pickPoint(nodes[idx]), kind };
  });

  const toStopOrder = (seq) => seq.filter((idx) => idx >= 1 && idx <= m).map((idx) => stops[idx - 1].id);

  // original order totals (matrix based, plus geometry when requested)
  const origMatrixDist = sumRoute(originalSeq, matrix.distancesM);
  const origMatrixDur = sumRoute(originalSeq, matrix.durationsS);
  const origDistanceM = origRoute ? Math.round(origRoute.legs.reduce((s, l) => s + l.distanceM, 0)) : Math.round(origMatrixDist);
  const origDurationS = origRoute ? Math.round(origRoute.legs.reduce((s, l) => s + l.durationS, 0)) : Math.round(origMatrixDur);

  const nnSeq = solved.nearestNeighbor.route;
  const nnDistanceM = Math.round(sumRoute(nnSeq, matrix.distancesM));
  const nnDurationS = Math.round(sumRoute(nnSeq, matrix.durationsS));
  const twoSeq = solved.twoOpt.route;
  const twoDistanceM = Math.round(sumRoute(twoSeq, matrix.distancesM));
  const twoDurationS = Math.round(sumRoute(twoSeq, matrix.durationsS));

  const savedDistM = origDistanceM - distanceM;
  const savedDurS = origDurationS - durationS;

  // 8. cost
  const costOpt = costService.estimate({ distanceKm: distanceM / 1000, durationMin: durationS / 60, config: costConfig });
  const costOrig = costService.estimate({ distanceKm: origDistanceM / 1000, durationMin: origDurationS / 60, config: costConfig });

  return {
    policy,
    objective,
    mode,
    algorithm: {
      name: solved.algorithm,
      optimal: solved.optimal,
      usedExact: solved.usedExact,
      exactMaxStops: solved.exactMaxNodes - 1,
      explanation: tsp.explain(solved, m),
      computeTimeMs: solved.computeTimeMs,
      objectiveNote:
        objective === "duration"
          ? "Goal: minimise estimated road travel TIME."
          : "Goal: minimise ROAD DISTANCE.",
    },
    original: {
      order: toStopOrder(originalSeq),
      sequence: seqFor(originalSeq),
      distanceM: origDistanceM,
      durationS: origDurationS,
      geometry: origRoute ? origRoute.geometry : null,
      cost: costOrig,
    },
    optimized: {
      order: toStopOrder(solved.route),
      sequence: seqFor(solved.route),
      legs,
      distanceM,
      durationS,
      distanceKm: round2(distanceM / 1000),
      durationMin: round1(durationS / 60),
      geometry: optRoute.geometry,
      cost: costOpt,
      matrixDistanceM: Math.round(matrixDistanceM),
      matrixDurationS: Math.round(matrixDurationS),
    },
    comparison: {
      savedDistanceM: savedDistM,
      savedDistancePct: origDistanceM > 0 ? round1((savedDistM / origDistanceM) * 100) : 0,
      savedDurationS: savedDurS,
      savedDurationPct: origDurationS > 0 ? round1((savedDurS / origDurationS) * 100) : 0,
      nearestNeighbor: { order: toStopOrder(nnSeq), distanceM: nnDistanceM, durationS: nnDurationS },
      twoOpt: { order: toStopOrder(twoSeq), distanceM: twoDistanceM, durationS: twoDurationS, moves: solved.twoOpt.moves },
    },
    warnings,
    stops: m,
    distanceSource: "Road network distances from OSRM (not straight-line)",
    durationNote: DURATION_NOTE,
    attribution: config.ATTRIBUTION,
  };
}

/** POST /api/plan/optimize */
async function optimize(body) {
  const policy = normalizePolicy(body.policy);
  const objective = normalizeObjective(body.objective);
  const pickup = body.pickup;
  const stops = body.stops;

  const { warnings: inputWarnings } = validateStops({
    pickup,
    stops,
    zoneRadiusKm: body.zoneRadiusKm === undefined ? undefined : Number(body.zoneRadiusKm),
    enforceZone: body.enforceZone !== false,
  });

  const plan = await planRoute({
    start: pickPoint({ ...pickup, id: "pickup" }),
    stops: stops.map(pickPoint),
    depot: null,
    policy,
    objective,
    costConfig: body.costConfig,
    includeOriginalRoute: body.includeOriginalRoute !== false,
    exactMaxNodes: body.exactMaxNodes,
  });
  plan.warnings = [...inputWarnings, ...plan.warnings];
  return plan;
}

/**
 * POST /api/plan/recalculate
 * body: { currentPoint, depot?, remainingStops, policy, objective, costConfig }
 * currentPoint = where the agent is "now" (the last completed stop, or the
 * pickup) - supplied by the app, NOT a live GPS reading.
 */
async function recalculate(body) {
  const policy = normalizePolicy(body.policy);
  const objective = normalizeObjective(body.objective);
  const remaining = body.remainingStops;
  if (!Array.isArray(remaining) || remaining.length === 0) {
    throw new ApiError(400, "NOTHING_TO_ROUTE", "There are no remaining stops to plan.");
  }
  validateStops({ pickup: body.currentPoint, stops: remaining, enforceZone: false });

  const depot = policy === "return" && body.depot ? pickPoint({ ...body.depot, id: "depot" }) : null;
  if (policy === "return" && !depot) {
    throw new ApiError(400, "DEPOT_REQUIRED", 'policy "return" needs the pickup/depot point to return to.');
  }
  return planRoute({
    start: pickPoint({ ...body.currentPoint, id: "current" }),
    stops: remaining.map(pickPoint),
    depot,
    policy,
    objective,
    costConfig: body.costConfig,
    includeOriginalRoute: false,
    exactMaxNodes: body.exactMaxNodes,
  });
}

module.exports = { optimize, recalculate, planRoute };
