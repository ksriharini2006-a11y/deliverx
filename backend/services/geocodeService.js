/*
 * geocodeService.js - address search + reverse lookup using Nominatim
 * (OpenStreetMap's geocoder). Everything returned comes from the real
 * service; nothing is invented or hard-coded.
 *
 * Nominatim usage policy (summary - check the current policy before heavy use):
 *   - max 1 request per second, identify the app with a User-Agent
 *   - cache results; do not hammer the server
 *   - the public server does NOT want "search-as-you-type" autocomplete.
 *     The UI therefore searches on a button press / Enter / after a long
 *     typing pause, and this service throttles + caches. For real autocomplete
 *     in production, run your own Nominatim or use a provider that allows it
 *     (set NOMINATIM_BASE_URL, and keep any API key on the backend only).
 *
 * ACCURACY LABELS (shown in the UI so a rough match is never passed off as
 * an exact address):
 *   geocoded-address  building / house / shop-level result (place_rank >= 30
 *                     or the result has a house number)
 *   geocoded-street   matched a road: position is somewhere along the street
 *   geocoded-area     matched a locality / suburb / city: only approximate
 * (A pin the user drags is labelled "manual-pin" by the frontend.)
 * -----------------------------------------------------------------------
 */

const config = require("./config");
const { ApiError } = require("./errors");
const { getJson, createThrottle } = require("./httpClient");

const throttle = createThrottle(config.NOMINATIM_MIN_INTERVAL_MS);

const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX = 300;
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
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, { at: Date.now(), value });
}

function classify(r) {
  const a = r.address || {};
  const rank = Number(r.place_rank);
  if (a.house_number || a.house_name || rank >= 30) {
    return {
      status: "geocoded-address",
      level: "address",
      label: "Verified address (building / shop / house level)",
    };
  }
  if (rank >= 26) {
    return {
      status: "geocoded-street",
      level: "street",
      label: "Street-level match - exact door is not known",
    };
  }
  return {
    status: "geocoded-area",
    level: "area",
    label: "Area-level match - approximate, drop a pin for the exact spot",
  };
}

function shortAddress(a = {}) {
  return {
    houseNumber: a.house_number || null,
    road: a.road || null,
    suburb: a.suburb || a.neighbourhood || a.city_district || null,
    city: a.city || a.town || a.village || a.county || null,
    state: a.state || null,
    postcode: a.postcode || null,
  };
}

function mapResult(r) {
  const lat = Number(r.lat);
  const lng = Number(r.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const displayName = r.display_name || "";
  return {
    placeId: r.place_id,
    name: r.name || displayName.split(",")[0].trim() || "Place",
    displayName,
    lat,
    lng,
    category: r.category || r.class || null,
    type: r.type || null,
    placeRank: Number(r.place_rank) || null,
    accuracy: classify(r),
    address: shortAddress(r.address),
    source: "nominatim",
  };
}

/**
 * @param {string} q free text: house number + street, shop name, apartment,
 *                   landmark, road, area or postal code
 * @param {{lat?:number,lng?:number,limit?:number}} [opts] lat/lng bias results
 *                   toward the pickup area (a preference, not a hard filter)
 */
async function search(q, opts = {}) {
  const query = String(q || "").trim();
  if (query.length < 3) {
    throw new ApiError(400, "QUERY_TOO_SHORT", "Type at least 3 characters to search.");
  }
  const limit = Math.min(Math.max(parseInt(opts.limit, 10) || 6, 1), 10);
  const hasBias = Number.isFinite(opts.lat) && Number.isFinite(opts.lng);

  const params = new URLSearchParams({
    q: query,
    format: "jsonv2",
    addressdetails: "1",
    limit: String(limit),
    "accept-language": "en",
  });
  if (config.GEOCODER_COUNTRY_CODES) params.set("countrycodes", config.GEOCODER_COUNTRY_CODES);
  if (hasBias) {
    const d = 0.3; // roughly 33 km box around the pickup - a hint, not a limit
    params.set("viewbox", `${opts.lng - d},${opts.lat + d},${opts.lng + d},${opts.lat - d}`);
  }

  const key = `s|${params.toString()}`;
  const cached = cacheGet(key);
  if (cached) return { ...cached, cached: true };

  const { body } = await throttle(() =>
    getJson(`${config.NOMINATIM_BASE_URL}/search?${params.toString()}`, { service: "GEOCODER" })
  );
  if (!Array.isArray(body)) {
    throw new ApiError(502, "GEOCODER_BAD_RESPONSE", "The search service returned an unexpected response.");
  }
  const results = body.map(mapResult).filter(Boolean);
  const value = { query, results, attribution: "© OpenStreetMap contributors (Nominatim)" };
  cacheSet(key, value);
  return { ...value, cached: false };
}

/** Name the spot under a map pin (used after the user drags/clicks a pin). */
async function reverse(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    throw new ApiError(400, "INVALID_COORDINATES", "lat and lng must be valid coordinates.");
  }
  const params = new URLSearchParams({
    format: "jsonv2",
    lat: String(lat),
    lon: String(lng),
    zoom: "18",
    addressdetails: "1",
    "accept-language": "en",
  });
  const key = `r|${lat.toFixed(5)}|${lng.toFixed(5)}`;
  const cached = cacheGet(key);
  if (cached) return { ...cached, cached: true };

  const { body } = await throttle(() =>
    getJson(`${config.NOMINATIM_BASE_URL}/reverse?${params.toString()}`, { service: "GEOCODER" })
  );
  let value;
  if (!body || body.error) {
    value = { found: false, message: "No address is known at that exact spot (that is normal for plots and lanes)." };
  } else {
    value = {
      found: true,
      displayName: body.display_name || "",
      name: body.name || (body.display_name || "").split(",")[0].trim(),
      address: shortAddress(body.address),
      lat,
      lng,
      source: "nominatim",
    };
  }
  cacheSet(key, value);
  return { ...value, cached: false };
}

module.exports = { search, reverse, _classify: classify, _clearCache: () => cache.clear() };
