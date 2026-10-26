const config = require("../services/config");
const { getJson } = require("../services/httpClient");

async function timed(fn) {
  const t0 = Date.now();
  try {
    await fn();
    return { ok: true, ms: Date.now() - t0 };
  } catch (err) {
    return { ok: false, ms: Date.now() - t0, message: err.message, code: err.code };
  }
}

// GET /api/status/services - "is search / routing reachable right now?"
// (The two coordinates and the word below are only a connectivity probe; no user data.)
async function services(req, res) {
  const [routing, geocoder] = await Promise.all([
    timed(async () => {
      const url = `${config.OSRM_BASE_URL}/route/v1/driving/80.2707,13.0827;80.2341,13.0418?overview=false`;
      const { body } = await getJson(url, { service: "ROUTING", timeoutMs: 8000, retries: 0 });
      if (!body || body.code !== "Ok") throw new Error(`routing answered "${body && body.code}"`);
    }),
    timed(async () => {
      const url = `${config.NOMINATIM_BASE_URL}/search?q=Chennai&format=jsonv2&limit=1`;
      const { body } = await getJson(url, { service: "GEOCODER", timeoutMs: 8000, retries: 0 });
      if (!Array.isArray(body)) throw new Error("search answered with an unexpected body");
    }),
  ]);
  res.json({
    routing: { ...routing, provider: "OSRM", baseUrl: config.OSRM_BASE_URL },
    geocoder: { ...geocoder, provider: "Nominatim", baseUrl: config.NOMINATIM_BASE_URL },
  });
}

// GET /api/status/config - non-secret settings the UI shows / uses
function publicConfig(req, res) {
  res.json({
    exactMaxStops: config.EXACT_MAX_NODES - 1,
    maxStops: config.MAX_STOPS,
    defaultCost: config.DEFAULT_COST,
    attribution: config.ATTRIBUTION,
    publicRoutingServer: config.USING_PUBLIC_OSRM,
    publicGeocoder: config.USING_PUBLIC_NOMINATIM,
    snapWarnM: config.SNAP_WARN_M,
    duplicateM: config.DUPLICATE_M,
  });
}

module.exports = { services, publicConfig };
