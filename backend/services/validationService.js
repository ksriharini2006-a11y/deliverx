/*
 * validationService.js - checks that run BEFORE we spend a routing request
 * (bad coordinates, duplicates, stops outside the delivery zone) and AFTER
 * the optimizer runs (does the route really visit every stop exactly once
 * and respect the chosen route policy?).
 */

const config = require("./config");
const { ApiError } = require("./errors");

const R_M = 6371000;
const rad = (d) => (d * Math.PI) / 180;

function haversineM(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R_M * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function validCoord(p) {
  return (
    p &&
    typeof p.lat === "number" &&
    typeof p.lng === "number" &&
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lng) &&
    Math.abs(p.lat) <= 90 &&
    Math.abs(p.lng) <= 180 &&
    !(p.lat === 0 && p.lng === 0)
  );
}

/**
 * Hard errors -> ApiError. Soft problems -> returned as warnings.
 * @param {{pickup:object, stops:object[], zoneRadiusKm?:number, enforceZone?:boolean}} input
 */
function validateStops({ pickup, stops, zoneRadiusKm, enforceZone = true }) {
  const problems = [];
  if (!validCoord(pickup)) problems.push("The pickup point has no valid coordinates.");
  if (!Array.isArray(stops) || stops.length === 0) problems.push("Add at least one delivery stop.");
  if (Array.isArray(stops) && stops.length > config.MAX_STOPS) {
    problems.push(`At most ${config.MAX_STOPS} stops are supported in one plan.`);
  }
  const ids = new Set();
  (stops || []).forEach((s, i) => {
    const name = s && s.name ? `"${s.name}"` : `stop ${i + 1}`;
    if (!validCoord(s)) problems.push(`${name} has no valid coordinates.`);
    if (s && (s.id === undefined || s.id === null || s.id === "")) problems.push(`${name} is missing an id.`);
    else if (s) {
      if (ids.has(String(s.id))) problems.push(`${name} has a duplicate id (${s.id}).`);
      ids.add(String(s.id));
    }
  });
  if (problems.length > 0) {
    throw new ApiError(400, "INVALID_INPUT", problems[0], { problems });
  }

  const warnings = [];

  // possible duplicates (same spot twice)
  for (let i = 0; i < stops.length; i++) {
    for (let j = i + 1; j < stops.length; j++) {
      if (haversineM(stops[i], stops[j]) < config.DUPLICATE_M) {
        warnings.push({
          code: "POSSIBLE_DUPLICATE",
          stopId: stops[j].id,
          message: `"${stops[j].name}" is within ${config.DUPLICATE_M} m of "${stops[i].name}" - possible duplicate.`,
        });
      }
    }
  }

  // delivery zone (circle around the pickup)
  if (Number.isFinite(zoneRadiusKm) && zoneRadiusKm > 0) {
    const outside = stops
      .map((s) => ({ s, km: haversineM(pickup, s) / 1000 }))
      .filter((x) => x.km > zoneRadiusKm);
    if (outside.length > 0 && enforceZone) {
      const names = outside.map((x) => `"${x.s.name}" (${x.km.toFixed(1)} km)`).join(", ");
      throw new ApiError(
        422,
        "ZONE_VIOLATION",
        `Outside the ${zoneRadiusKm} km delivery zone: ${names}. Remove them, move their pins, or enlarge the zone.`,
        { stopIds: outside.map((x) => x.s.id) }
      );
    }
    outside.forEach((x) =>
      warnings.push({
        code: "OUTSIDE_ZONE",
        stopId: x.s.id,
        message: `"${x.s.name}" is ${x.km.toFixed(1)} km from the pickup, outside the ${zoneRadiusKm} km zone.`,
      })
    );
  }
  return { warnings };
}

/**
 * Integrity check on the optimizer's answer. A failure here is a bug, not a
 * user error, so it is reported as a 500 instead of returning a wrong plan.
 * @param {number[]} route node indexes returned by the solver
 * @param {{stopCount:number, mode:"closed"|"open"|"fixedEnd", fixedEnd?:number}} opts
 *        nodes are: 0 = start, 1..stopCount = stops, (fixedEnd = depot index)
 */
function validateRouteIntegrity(route, { stopCount, mode, fixedEnd }) {
  const fail = (msg) => {
    throw new ApiError(500, "ROUTE_INTEGRITY", `Internal check failed: ${msg}`);
  };
  if (!Array.isArray(route) || route.length === 0) fail("the optimizer returned no route");
  if (route[0] !== 0) fail("the route does not start at the start point");

  const body = mode === "closed" ? route.slice(1, -1) : route.slice(1);
  if (mode === "closed" && route[route.length - 1] !== 0) fail("the closed route does not return to the start");
  if (mode === "fixedEnd") {
    if (route[route.length - 1] !== fixedEnd) fail("the route does not finish at the depot");
  }
  const expected = stopCount;
  const visited = mode === "fixedEnd" ? body.slice(0, -1) : body;
  if (visited.length !== expected) fail(`expected ${expected} stops but the route visits ${visited.length}`);
  const seen = new Set(visited);
  if (seen.size !== visited.length) fail("a stop is visited more than once");
  for (let k = 1; k <= stopCount; k++) if (!seen.has(k)) fail(`stop #${k} is missing from the route`);
}

module.exports = { validateStops, validateRouteIntegrity, haversineM, validCoord };
