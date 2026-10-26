/*
 * routingService.js - REAL ROAD distances and routes via OSRM.
 *
 *   getMatrix(points) -> n x n road DISTANCE (metres) and road TRAVEL TIME
 *                        (seconds) between every pair of points  (OSRM "table")
 *   getRoute(points)  -> the road-following polyline through the points in
 *                        the given order, with per-leg distance/time (OSRM "route")
 *
 * There is NO silent fallback to straight-line distance. If OSRM is down, a
 * point cannot be snapped to a road, or two points are not connected by a
 * drivable road, an ApiError explaining exactly what to fix is thrown.
 *
 * Road matrices can be ASYMMETRIC (one-way streets): going A -> B may differ
 * from B -> A. The C++ solvers use directed costs, so this is handled.
 *
 * OSRM coordinate order is "lng,lat" (the opposite of Leaflet's [lat,lng]).
 * Travel times are free-flow estimates from road speed limits - NOT live
 * traffic and NOT guaranteed arrival times.
 * -----------------------------------------------------------------------
 */

const config = require("./config");
const { ApiError } = require("./errors");
const { getJson, createThrottle } = require("./httpClient");

const throttle = createThrottle(config.OSRM_MIN_INTERVAL_MS);

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map();
function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return undefined;
  }
  return hit.value;
}
function cacheSet(key, value) {
  if (cache.size >= 100) cache.delete(cache.keys().next().value);
  cache.set(key, { at: Date.now(), value });
}

function coordString(points) {
  return points.map((p) => `${Number(p.lng).toFixed(6)},${Number(p.lat).toFixed(6)}`).join(";");
}

function label(p, i) {
  return p && p.name ? `"${p.name}"` : `point ${i + 1}`;
}

function checkOk(body, what) {
  if (!body || body.code === undefined) {
    throw new ApiError(502, "ROUTING_BAD_RESPONSE", `The routing service returned an unexpected response for the ${what}.`);
  }
  if (body.code === "Ok") return;
  if (body.code === "NoRoute" || body.code === "NoSegment") {
    throw new ApiError(
      422,
      "ROUTE_UNAVAILABLE",
      `No drivable road route could be found (${body.message || body.code}). Check that every pin is on or near a road.`
    );
  }
  throw new ApiError(502, "ROUTING_FAILED", `The routing service could not calculate the ${what}: ${body.message || body.code}.`);
}

/**
 * @param {Array<{lat:number,lng:number,name?:string}>} points
 * @returns {Promise<{distancesM:number[][], durationsS:number[][], snapM:number[], source:string}>}
 */
async function getMatrix(points) {
  if (!Array.isArray(points) || points.length < 2) {
    throw new ApiError(400, "NOT_ENOUGH_POINTS", "Need at least a start point and one destination.");
  }
  if (points.length > 100) {
    throw new ApiError(400, "TOO_MANY_POINTS", "At most 100 points can be routed at once.");
  }
  const coords = coordString(points);
  const key = `m|${coords}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  const url = `${config.OSRM_BASE_URL}/table/v1/driving/${coords}?annotations=distance,duration`;
  const { body } = await throttle(() => getJson(url, { service: "ROUTING" }));
  checkOk(body, "distance table");

  const n = points.length;
  const okShape = (m) => Array.isArray(m) && m.length === n && m.every((r) => Array.isArray(r) && r.length === n);
  if (!okShape(body.distances) || !okShape(body.durations)) {
    throw new ApiError(502, "ROUTING_BAD_RESPONSE", "The routing service returned a distance table of the wrong size.");
  }

  // Unreachable pairs come back as null.
  const unreachable = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i !== j && (body.distances[i][j] === null || body.durations[i][j] === null)) unreachable.push([i, j]);
    }
  }
  if (unreachable.length > 0) {
    const [i, j] = unreachable[0];
    throw new ApiError(
      422,
      "ROUTE_UNAVAILABLE",
      `No drivable road connects ${label(points[i], i)} to ${label(points[j], j)}. Move its pin onto a connected road, or remove that stop.`,
      { from: i, to: j, count: unreachable.length }
    );
  }

  // How far each pin had to be moved to reach the nearest road.
  const snapM = (body.sources || body.destinations || []).map((s) => (s && typeof s.distance === "number" ? s.distance : 0));
  for (let i = 0; i < snapM.length; i++) {
    if (snapM[i] > config.SNAP_ERROR_M) {
      throw new ApiError(
        422,
        "STOP_NOT_ON_ROAD",
        `${label(points[i], i)} is about ${(snapM[i] / 1000).toFixed(1)} km from the nearest road. Move its pin closer to a road.`,
        { index: i, snapM: snapM[i] }
      );
    }
  }

  const value = {
    distancesM: body.distances.map((r, i) => r.map((v, j) => (i === j ? 0 : v))),
    durationsS: body.durations.map((r, i) => r.map((v, j) => (i === j ? 0 : v))),
    snapM,
    source: "OSRM",
  };
  cacheSet(key, value);
  return value;
}

/**
 * Road-following route through the points IN THE GIVEN ORDER.
 * @returns {Promise<{geometry:number[][], legs:{distanceM:number,durationS:number}[], distanceM:number, durationS:number}>}
 *   geometry is [[lat,lng],...] ready for a Leaflet polyline
 */
async function getRoute(points) {
  if (!Array.isArray(points) || points.length < 2) {
    throw new ApiError(400, "NOT_ENOUGH_POINTS", "Need at least two points to draw a route.");
  }
  const coords = coordString(points);
  const key = `r|${coords}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  const url = `${config.OSRM_BASE_URL}/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=false`;
  const { body } = await throttle(() => getJson(url, { service: "ROUTING" }));
  checkOk(body, "route");

  const route = body.routes && body.routes[0];
  if (!route || !route.geometry || !Array.isArray(route.geometry.coordinates) || !Array.isArray(route.legs)) {
    throw new ApiError(502, "ROUTING_BAD_RESPONSE", "The routing service returned a route without geometry.");
  }
  if (route.legs.length !== points.length - 1) {
    throw new ApiError(502, "ROUTING_BAD_RESPONSE", "The routing service returned the wrong number of route legs.");
  }
  const value = {
    geometry: route.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
    legs: route.legs.map((l) => ({ distanceM: l.distance, durationS: l.duration })),
    distanceM: route.distance,
    durationS: route.duration,
  };
  cacheSet(key, value);
  return value;
}

module.exports = { getMatrix, getRoute, _clearCache: () => cache.clear() };
