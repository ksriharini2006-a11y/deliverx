/*
 * mockServers.js - TEST-ONLY stand-ins for the public OSRM and Nominatim
 * servers, so the automated tests run offline and deterministically.
 *
 * !! These return INVENTED but format-correct data. They exist only to test
 * !! our code's handling of the real services' response formats and failures.
 * !! The app itself never uses them (it talks to the real services).
 *
 * The mock road network is "straight-line x 1.2 (x 1.3 when going south)", so
 * it is deliberately ASYMMETRIC like one-way streets.
 */

const http = require("http");
// (own haversine on purpose: requiring app modules here would freeze their
// config before the tests point it at these mock servers)
const rad = (d) => (d * Math.PI) / 180;
function haversineM(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function roadM(a, b) {
  return haversineM(a, b) * (a.lat > b.lat ? 1.3 : 1.2);
}

function parseCoords(pathname) {
  const seg = pathname.split("/")[4];
  return decodeURIComponent(seg)
    .split(";")
    .map((s) => {
      const [lng, lat] = s.split(",").map(Number);
      return { lat, lng };
    });
}

function startMocks() {
  const state = { osrmMode: "ok", searchCalls: 0, osrmCalls: 0 };

  const osrm = http.createServer((req, res) => {
    state.osrmCalls++;
    const url = new URL(req.url, "http://x");
    if (state.osrmMode === "down") return req.socket.destroy();
    if (state.osrmMode === "429") {
      res.writeHead(429);
      return res.end("{}");
    }
    const pts = parseCoords(url.pathname);
    const send = (obj) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(obj));
    };
    // test flags: lng >= 179 -> unreachable island, lat <= -80 -> far from any road
    const unreachable = (p) => p.lng >= 179;
    const snap = (p) => (p.lat <= -80 ? 5000 : 12);
    if (url.pathname.startsWith("/table/")) {
      const distances = pts.map((a, i) => pts.map((b, j) => (i === j ? 0 : unreachable(a) || unreachable(b) ? null : roadM(a, b))));
      const durations = distances.map((r) => r.map((v) => (v === null ? null : v / 8.33)));
      const info = pts.map((p) => ({ location: [p.lng, p.lat], name: "", distance: snap(p) }));
      return send({ code: "Ok", distances, durations, sources: info, destinations: info });
    }
    if (url.pathname.startsWith("/route/")) {
      if (pts.some(unreachable)) return send({ code: "NoRoute", message: "Impossible route between points" });
      const legs = [];
      const coordinates = [[pts[0].lng, pts[0].lat]];
      for (let i = 0; i < pts.length - 1; i++) {
        const d = roadM(pts[i], pts[i + 1]);
        legs.push({ distance: d, duration: d / 8.33, steps: [], summary: "", weight: d });
        const mid = { lat: (pts[i].lat + pts[i + 1].lat) / 2 + 0.0002, lng: (pts[i].lng + pts[i + 1].lng) / 2 };
        coordinates.push([mid.lng, mid.lat], [pts[i + 1].lng, pts[i + 1].lat]);
      }
      return send({
        code: "Ok",
        routes: [
          {
            geometry: { type: "LineString", coordinates },
            legs,
            distance: legs.reduce((s, l) => s + l.distance, 0),
            duration: legs.reduce((s, l) => s + l.duration, 0),
          },
        ],
        waypoints: [],
      });
    }
    res.writeHead(404);
    res.end("{}");
  });

  const nominatim = http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    const json = (obj, code = 200) => {
      res.writeHead(code, { "Content-Type": "application/json" });
      res.end(JSON.stringify(obj));
    };
    if (url.pathname === "/status") {
      res.writeHead(200);
      return res.end("OK");
    }
    if (url.pathname === "/reverse") {
      if (Number(url.searchParams.get("lat")) < 0) return json({ error: "Unable to geocode" });
      return json({ display_name: "Test Lane, Testville, India", name: "", address: { road: "Test Lane", suburb: "Testville", city: "Testville" } });
    }
    if (url.pathname === "/search") {
      state.searchCalls++;
      const q = (url.searchParams.get("q") || "").toLowerCase();
      if (q.includes("ratelimit")) return json({}, 429);
      if (q.includes("garbage")) {
        res.writeHead(200);
        return res.end("<html>not json</html>");
      }
      if (q.includes("none")) return json([]);
      const base = { place_id: 1, osm_type: "node", osm_id: 1, lat: "12.8918", lon: "80.0815", category: "place" };
      if (q.includes("house"))
        return json([{ ...base, name: "", type: "house", place_rank: 30, display_name: "12, Test Street, Testville, India", address: { house_number: "12", road: "Test Street", suburb: "Testville" } }]);
      if (q.includes("street"))
        return json([{ ...base, name: "Test Street", type: "residential", category: "highway", place_rank: 26, display_name: "Test Street, Testville, India", address: { road: "Test Street", suburb: "Testville" } }]);
      if (q.includes("area"))
        return json([{ ...base, name: "Testville", type: "suburb", place_rank: 20, display_name: "Testville, India", address: { suburb: "Testville" } }]);
      return json([{ ...base, name: "Test Shop", type: "supermarket", category: "shop", place_rank: 30, display_name: "Test Shop, Test Street, Testville, India", address: { road: "Test Street", suburb: "Testville" } }]);
    }
    json({}, 404);
  });

  return new Promise((resolve) => {
    osrm.listen(0, "127.0.0.1", () => {
      nominatim.listen(0, "127.0.0.1", () => {
        resolve({
          state,
          osrmUrl: `http://127.0.0.1:${osrm.address().port}`,
          nominatimUrl: `http://127.0.0.1:${nominatim.address().port}`,
          close: () => {
            osrm.close();
            nominatim.close();
            osrm.closeAllConnections && osrm.closeAllConnections();
            nominatim.closeAllConnections && nominatim.closeAllConnections();
          },
        });
      });
    });
  });
}

module.exports = { startMocks, roadM };
