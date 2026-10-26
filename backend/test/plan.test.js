// End-to-end API tests: HTTP -> Express -> OSRM (test stand-in) -> C++ solver.
const test = require("node:test");
const assert = require("node:assert/strict");
const { startMocks, roadM } = require("./mockServers");

let mocks, server, base;

test.before(async () => {
  mocks = await startMocks();
  process.env.OSRM_BASE_URL = mocks.osrmUrl;
  process.env.NOMINATIM_BASE_URL = mocks.nominatimUrl;
  process.env.HTTP_TIMEOUT_MS = "3000";
  const app = require("../server");
  server = await new Promise((r) => {
    const s = app.listen(0, "127.0.0.1", () => r(s));
  });
  base = `http://127.0.0.1:${server.address().port}/api`;
});

test.after(() => {
  server.close();
  server.closeAllConnections && server.closeAllConnections();
  mocks.close();
});

const post = async (p, body) => {
  const r = await fetch(base + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};
const get = async (p) => {
  const r = await fetch(base + p);
  return { status: r.status, body: await r.json() };
};

// invented TEST coordinates (not real addresses)
const pickup = { name: "Test Depot", address: "test", lat: 12.8918, lng: 80.0815 };
const mk = (id, name, lat, lng) => ({ id, name, address: name, lat, lng, verification: "geocoded-address" });
const stops = [
  mk("s1", "Stop 1", 12.8797, 80.0817),
  mk("s2", "Stop 2", 12.906, 80.0895),
  mk("s3", "Stop 3", 12.8696, 80.0586),
  mk("s4", "Stop 4", 12.9035, 80.07),
  mk("s5", "Stop 5", 12.8588, 80.0835),
  mk("s6", "Stop 6", 12.9093, 80.0967),
];

function permutations(arr) {
  if (arr.length <= 1) return [arr];
  return arr.flatMap((x, i) => permutations([...arr.slice(0, i), ...arr.slice(i + 1)]).map((p) => [x, ...p]));
}
function bestByBruteForce(open) {
  const pts = [pickup, ...stops];
  let best = Infinity;
  for (const p of permutations([1, 2, 3, 4, 5, 6])) {
    const seq = open ? [0, ...p] : [0, ...p, 0];
    let d = 0;
    for (let i = 0; i < seq.length - 1; i++) d += roadM(pts[seq[i]], pts[seq[i + 1]]);
    best = Math.min(best, d);
  }
  return best;
}

test("optimize (return policy): valid, optimal vs brute force, consistent totals", async () => {
  const { status, body } = await post("/plan/optimize", { pickup, stops, policy: "return", objective: "distance", zoneRadiusKm: 5 });
  assert.equal(status, 200, JSON.stringify(body));
  const seq = body.optimized.sequence;
  assert.equal(seq[0].kind, "start");
  assert.equal(seq[seq.length - 1].id, "pickup", "return policy ends at the pickup");
  const ids = body.optimized.order;
  assert.equal(ids.length, 6);
  assert.equal(new Set(ids).size, 6, "every stop exactly once");
  // totals come from the route legs
  const legSum = body.optimized.legs.reduce((s, l) => s + l.distanceM, 0);
  assert.equal(body.optimized.distanceM, legSum);
  assert.equal(body.optimized.legs.length, 7);
  assert.ok(Math.abs(body.optimized.distanceM - bestByBruteForce(false)) < 10, "DP must equal the brute-force optimum");
  assert.ok(body.optimized.distanceM <= body.original.distanceM, "optimized is never longer than the entered order");
  assert.equal(body.algorithm.usedExact, true);
  assert.equal(body.algorithm.optimal, true);
  assert.ok(body.optimized.geometry.length > 7);
  assert.ok(body.original.geometry.length > 7);
  assert.equal(body.comparison.savedDistanceM, body.original.distanceM - body.optimized.distanceM);
  assert.ok(body.optimized.cost.standard.total > 0 && body.optimized.cost.ev.total > 0);
  assert.match(body.durationNote, /not guaranteed/i);
  assert.match(body.distanceSource, /road/i);
});

test("optimize (open policy): finishes at a stop and is not longer than the return route", async () => {
  const ret = await post("/plan/optimize", { pickup, stops, policy: "return" });
  const open = await post("/plan/optimize", { pickup, stops, policy: "open" });
  assert.equal(open.status, 200);
  const seq = open.body.optimized.sequence;
  assert.notEqual(seq[seq.length - 1].id, "pickup");
  assert.equal(seq[seq.length - 1].kind, "stop");
  assert.equal(open.body.optimized.legs.length, 6);
  assert.ok(open.body.optimized.distanceM <= ret.body.optimized.distanceM);
  assert.ok(Math.abs(open.body.optimized.distanceM - bestByBruteForce(true)) < 10);
});

test("optimize by travel time works and reports the goal", async () => {
  const { status, body } = await post("/plan/optimize", { pickup, stops, policy: "return", objective: "duration" });
  assert.equal(status, 200);
  assert.match(body.algorithm.objectiveNote, /TIME/);
  const dist = await post("/plan/optimize", { pickup, stops, policy: "return", objective: "distance" });
  assert.ok(body.optimized.durationS <= dist.body.optimized.durationS + 2);
});

test("large plans switch to the heuristic and say it is not guaranteed optimal", async () => {
  const many = Array.from({ length: 18 }, (_, i) => mk(`m${i}`, `M${i}`, 12.87 + (i % 6) * 0.006, 80.06 + Math.floor(i / 6) * 0.01));
  const { status, body } = await post("/plan/optimize", { pickup, stops: many, policy: "return" });
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.algorithm.usedExact, false);
  assert.equal(body.algorithm.optimal, false);
  assert.match(body.algorithm.explanation, /NOT guaranteed/);
  assert.equal(new Set(body.optimized.order).size, 18);
});

test("input validation: zone, coordinates, empty stops, duplicates, policy", async () => {
  const far = [...stops, mk("far", "Far Away", 13.2, 80.4)];
  const z = await post("/plan/optimize", { pickup, stops: far, zoneRadiusKm: 5 });
  assert.equal(z.status, 422);
  assert.equal(z.body.code, "ZONE_VIOLATION");
  assert.deepEqual(z.body.details.stopIds, ["far"]);

  const bad = await post("/plan/optimize", { pickup, stops: [mk("x", "Bad", 123, 80)] });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.code, "INVALID_INPUT");

  const none = await post("/plan/optimize", { pickup, stops: [] });
  assert.equal(none.status, 400);

  const dup = await post("/plan/optimize", { pickup, stops: [stops[0], { ...stops[0], id: "s1b", name: "Same place" }] });
  assert.equal(dup.status, 200);
  assert.ok(dup.body.warnings.some((w) => w.code === "POSSIBLE_DUPLICATE"));

  const pol = await post("/plan/optimize", { pickup, stops, policy: "sideways" });
  assert.equal(pol.status, 400);
  assert.equal(pol.body.code, "INVALID_POLICY");
});

test("routing problems are reported, never replaced by straight-line distance", async () => {
  const island = await post("/plan/optimize", { pickup, stops: [...stops, mk("isle", "Island", 12.9, 179.5)] });
  assert.equal(island.status, 422);
  assert.equal(island.body.code, "ROUTE_UNAVAILABLE");

  const ocean = await post("/plan/optimize", { pickup, stops: [mk("o", "Ocean", -82, 80)] });
  assert.equal(ocean.status, 422);
  assert.equal(ocean.body.code, "STOP_NOT_ON_ROAD");

  mocks.state.osrmMode = "down";
  const down = await post("/plan/optimize", { pickup, stops: [mk("d1", "Fresh A", 12.95, 80.2), mk("d2", "Fresh B", 12.96, 80.21)] });
  mocks.state.osrmMode = "ok";
  assert.equal(down.status, 503);
  assert.equal(down.body.code, "ROUTING_UNAVAILABLE");
  assert.ok(!down.body.optimized, "no plan may be returned when routing is down");
});

test("recalculate: return policy ends at the depot, open policy does not", async () => {
  const current = stops[0];
  const remaining = stops.slice(1);
  const ret = await post("/plan/recalculate", { currentPoint: current, depot: pickup, remainingStops: remaining, policy: "return" });
  assert.equal(ret.status, 200, JSON.stringify(ret.body));
  const seq = ret.body.optimized.sequence;
  assert.equal(seq[0].kind, "start");
  assert.equal(seq[0].lat, current.lat);
  assert.equal(seq[seq.length - 1].kind, "depot");
  assert.equal(seq[seq.length - 1].lat, pickup.lat);
  assert.equal(ret.body.optimized.order.length, 5);
  assert.equal(new Set(ret.body.optimized.order).size, 5);

  const open = await post("/plan/recalculate", { currentPoint: current, remainingStops: remaining, policy: "open" });
  assert.equal(open.status, 200);
  assert.equal(open.body.optimized.sequence[open.body.optimized.sequence.length - 1].kind, "stop");

  const missingDepot = await post("/plan/recalculate", { currentPoint: current, remainingStops: remaining, policy: "return" });
  assert.equal(missingDepot.status, 400);
  const empty = await post("/plan/recalculate", { currentPoint: current, depot: pickup, remainingStops: [], policy: "return" });
  assert.equal(empty.status, 400);
});

test("cost endpoint, config endpoint, geocode endpoint, status endpoint", async () => {
  const c = await post("/cost/estimate", { distanceKm: 42, config: { ev: { kmPerKwh: 7, pricePerKwh: 12 } } });
  assert.equal(c.status, 200);
  assert.equal(c.body.ev.total, 72);
  const bad = await post("/cost/estimate", { distanceKm: "abc" });
  assert.equal(bad.status, 400);

  const cfg = await get("/status/config");
  assert.equal(cfg.body.exactMaxStops, 15);

  const g = await get("/geocode/search?q=some%20shop&lat=12.89&lng=80.08");
  assert.equal(g.status, 200);
  assert.equal(g.body.results[0].accuracy.status, "geocoded-address");
  const g2 = await get("/geocode/search?q=ab");
  assert.equal(g2.status, 400);
  const rv = await get("/geocode/reverse?lat=12.89&lng=80.08");
  assert.equal(rv.body.found, true);

  const st = await get("/status/services");
  assert.equal(st.body.routing.ok, true);
  assert.equal(st.body.geocoder.ok, true);
});

test("no built-in demo data: store starts empty, first place added becomes the hub", async () => {
  const health = await get("/health");
  assert.equal(health.body.status, "ok");
  assert.equal((await post("/locations/demo", {})).status, 404, "the old demo endpoint is gone");
  assert.equal((await get("/areas")).status, 404, "the old hard-coded areas endpoint is gone");
  const empty = await get("/locations");
  assert.deepEqual(empty.body.locations, [], "nothing is pre-loaded");

  // first place added = hub; later ones are delivery stops (invented TEST coordinates)
  const first = await post("/locations", { name: "T Hub", lat: 12.8918, lng: 80.0815 });
  assert.equal(first.body.location.isHub, true);
  for (const [n, la, ln] of [["T1", 12.8797, 80.0817], ["T2", 12.906, 80.0895], ["T3", 12.8696, 80.0586]]) {
    const r = await post("/locations", { name: n, lat: la, lng: ln });
    assert.equal(r.body.location.isHub, false);
  }
  const cmp = await post("/route/compare", {});
  assert.equal(cmp.status, 200);
  assert.ok(cmp.body.dynamicProgramming.totalDistanceKm > 0);

  // custom area wipes and re-seeds from the user's own place
  const na = await post("/locations/new-area", { name: "Mine", lat: 12.9, lng: 80.1 });
  assert.equal(na.status, 201);
  assert.equal(na.body.locations.length, 1);
  assert.equal(na.body.locations[0].isHub, true);

  const ev = await post("/ev/calculate", { distanceKm: 42 });
  assert.equal(ev.body.estimatedChargingCostInr, 72);
});
