// Geocoding, routing and cost services against test-only stand-in servers
// (see mockServers.js) plus ONE real OSRM response saved in test/fixtures.
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { startMocks } = require("./mockServers");

let mocks, geocode, routing, cost, realFixtureServer;

test.before(async () => {
  mocks = await startMocks();
  // a server that replays a REAL OSRM demo-server response (fetched 2026-10-23)
  const real = fs.readFileSync(path.join(__dirname, "fixtures", "osrm-table-vandalur-real.json"), "utf8");
  realFixtureServer = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(real);
  });
  await new Promise((r) => realFixtureServer.listen(0, "127.0.0.1", r));

  process.env.OSRM_BASE_URL = mocks.osrmUrl;
  process.env.NOMINATIM_BASE_URL = mocks.nominatimUrl;
  process.env.HTTP_TIMEOUT_MS = "3000";
  geocode = require("../services/geocodeService");
  routing = require("../services/routingService");
  cost = require("../services/costService");
});

test.after(() => {
  mocks.close();
  realFixtureServer.close();
  realFixtureServer.closeAllConnections && realFixtureServer.closeAllConnections();
});

// ---------------------------- geocoding ----------------------------
test("geocode: accuracy is classified honestly (address / street / area)", async () => {
  const house = (await geocode.search("12 house road")).results[0];
  assert.equal(house.accuracy.status, "geocoded-address");
  assert.equal(house.address.houseNumber, "12");
  assert.equal((await geocode.search("test street")).results[0].accuracy.status, "geocoded-street");
  assert.equal((await geocode.search("testville area")).results[0].accuracy.status, "geocoded-area");
  const shop = (await geocode.search("some shop")).results[0];
  assert.equal(shop.accuracy.status, "geocoded-address");
  assert.equal(typeof shop.lat, "number");
  assert.equal(typeof shop.lng, "number");
});

test("geocode: empty result, too-short query, caching", async () => {
  assert.deepEqual((await geocode.search("none here")).results, []);
  await assert.rejects(() => geocode.search("ab"), { code: "QUERY_TOO_SHORT" });
  geocode._clearCache();
  const before = mocks.state.searchCalls;
  await geocode.search("cache me");
  const second = await geocode.search("cache me");
  assert.equal(mocks.state.searchCalls, before + 1, "second identical search must come from cache");
  assert.equal(second.cached, true);
});

test("geocode: provider errors become clear API errors", async () => {
  await assert.rejects(() => geocode.search("ratelimit please"), { code: "GEOCODER_RATE_LIMITED" });
  await assert.rejects(() => geocode.search("garbage please"), { code: "GEOCODER_BAD_RESPONSE" });
});

test("geocode: reverse lookup found / not found", async () => {
  const ok = await geocode.reverse(12.89, 80.08);
  assert.equal(ok.found, true);
  const none = await geocode.reverse(-5, 80.08);
  assert.equal(none.found, false);
  await assert.rejects(() => geocode.reverse(999, 1), { code: "INVALID_COORDINATES" });
});

// ---------------------------- routing ----------------------------
test("routing: parses a REAL OSRM table response (asymmetric, with snap distances)", async () => {
  // Re-load the module pointed at the fixture server
  const savedUrl = process.env.OSRM_BASE_URL;
  process.env.OSRM_BASE_URL = `http://127.0.0.1:${realFixtureServer.address().port}`;
  for (const k of Object.keys(require.cache)) if (k.includes(`${path.sep}services${path.sep}`)) delete require.cache[k];
  const r2 = require("../services/routingService");
  const pts = [
    { name: "A", lat: 12.891801, lng: 80.08151 },
    { name: "B", lat: 12.87938, lng: 80.081941 },
    { name: "C", lat: 12.906038, lng: 80.089343 },
  ];
  const m = await r2.getMatrix(pts);
  assert.equal(m.distancesM[0][1], 2735.2);
  assert.equal(m.distancesM[1][0], 3558.5);
  assert.notEqual(m.distancesM[0][1], m.distancesM[1][0], "real road distances are asymmetric");
  assert.equal(m.durationsS[1][2], 497.5);
  assert.ok(Math.abs(m.snapM[1] - 44.0169671) < 1e-6);
  process.env.OSRM_BASE_URL = savedUrl;
  for (const k of Object.keys(require.cache)) if (k.includes(`${path.sep}services${path.sep}`)) delete require.cache[k];
  routing = require("../services/routingService");
});

test("routing: unreachable pair / pin far from road / service down => explicit errors, no straight-line fallback", async () => {
  routing._clearCache();
  const a = { name: "Depot", lat: 12.9, lng: 80.1 };
  const island = { name: "Island", lat: 12.95, lng: 179.5 };
  await assert.rejects(() => routing.getMatrix([a, island]), { code: "ROUTE_UNAVAILABLE" });
  const farFromRoad = { name: "Ocean", lat: -82, lng: 80.1 };
  await assert.rejects(() => routing.getMatrix([a, farFromRoad]), { code: "STOP_NOT_ON_ROAD" });
  await assert.rejects(() => routing.getRoute([a, island]), { code: "ROUTE_UNAVAILABLE" });

  mocks.state.osrmMode = "down";
  routing._clearCache();
  await assert.rejects(() => routing.getMatrix([a, { name: "B", lat: 12.91, lng: 80.11 }]), { code: "ROUTING_UNAVAILABLE" });
  mocks.state.osrmMode = "429";
  await assert.rejects(() => routing.getMatrix([a, { name: "B", lat: 12.92, lng: 80.12 }]), { code: "ROUTING_RATE_LIMITED" });
  mocks.state.osrmMode = "ok";
});

test("routing: route geometry is [lat,lng] and legs add up", async () => {
  routing._clearCache();
  const pts = [
    { name: "A", lat: 12.9, lng: 80.1 },
    { name: "B", lat: 12.91, lng: 80.11 },
    { name: "C", lat: 12.92, lng: 80.1 },
  ];
  const r = await routing.getRoute(pts);
  assert.equal(r.legs.length, 2);
  assert.deepEqual(r.geometry[0], [12.9, 80.1]);
  assert.ok(Math.abs(r.legs[0].distanceM + r.legs[1].distanceM - r.distanceM) < 1);
});

// ---------------------------- cost ----------------------------
test("cost: standard vs EV maths and validation", () => {
  const r = cost.estimate({ distanceKm: 42, config: { standard: { ratePerKm: 10, baseFee: 20, extraCharges: 5 }, ev: { kmPerKwh: 7, pricePerKwh: 12, chargingFee: 10, extraCharges: 0 } } });
  assert.equal(r.standard.total, 445); // 20 + 420 + 5
  assert.equal(r.ev.energyKwh, 6);
  assert.equal(r.ev.energyCost, 72);
  assert.equal(r.ev.total, 82); // 72 + 10 charging fee
  const d = cost.estimate({ distanceKm: 10 });
  assert.equal(d.standard.total, 100);
  assert.throws(() => cost.estimate({ distanceKm: -1 }), { code: "INVALID_DISTANCE" });
  assert.throws(() => cost.estimate({ distanceKm: 5, config: { ev: { kmPerKwh: 0 } } }), { code: "INVALID_COST_CONFIG" });
  assert.throws(() => cost.estimate({ distanceKm: 5, config: { standard: { ratePerKm: -3 } } }), { code: "INVALID_COST_CONFIG" });
});
