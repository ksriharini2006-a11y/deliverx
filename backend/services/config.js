/*
 * config.js
 * -----------------------------------------------------------------------
 * ALL tunable settings for the real-world services live here, read from
 * environment variables with safe defaults. No API key is needed for the
 * default (free, public) services, so there is nothing secret to leak to the
 * browser. If you later switch to a keyed provider, put the key in an
 * environment variable READ ONLY HERE ON THE BACKEND - never in frontend code.
 *
 *   OSRM_BASE_URL         road routing engine (default: public OSRM demo)
 *   NOMINATIM_BASE_URL    address search (default: public OSM Nominatim)
 *   GEOCODER_CONTACT      your email, sent in the User-Agent (Nominatim's
 *                         usage policy asks apps to identify themselves)
 *   GEOCODER_COUNTRY_CODES restrict search to these countries (default "in")
 *   HTTP_TIMEOUT_MS       per-request timeout (default 15000)
 *   EXACT_MAX_NODES       use exact DP up to this many points incl. pickup
 *                         (default 16 = pickup + 15 stops)
 *
 * PUBLIC-SERVER ETIQUETTE: the free public servers are for light/demo use.
 * They have usage policies (about 1 request per second, no bulk traffic).
 * This backend throttles and caches requests to stay within them.
 * -----------------------------------------------------------------------
 */

const env = process.env;

const OSRM_BASE_URL = (env.OSRM_BASE_URL || "https://router.project-osrm.org").replace(/\/+$/, "");
const NOMINATIM_BASE_URL = (env.NOMINATIM_BASE_URL || "https://nominatim.openstreetmap.org").replace(/\/+$/, "");
const contact = env.GEOCODER_CONTACT || "";

const usingPublicOsrm = OSRM_BASE_URL.includes("router.project-osrm.org");
const usingPublicNominatim = NOMINATIM_BASE_URL.includes("nominatim.openstreetmap.org");

module.exports = {
  OSRM_BASE_URL,
  NOMINATIM_BASE_URL,
  USING_PUBLIC_OSRM: usingPublicOsrm,
  USING_PUBLIC_NOMINATIM: usingPublicNominatim,
  USER_AGENT: `DeliverX-DAA-College-Project/1.0 (${contact || "set GEOCODER_CONTACT to your email"})`,
  GEOCODER_COUNTRY_CODES: env.GEOCODER_COUNTRY_CODES || "in",
  HTTP_TIMEOUT_MS: Number(env.HTTP_TIMEOUT_MS) || 15000,
  // minimum gap between outgoing requests to the same public service
  NOMINATIM_MIN_INTERVAL_MS: Number(env.NOMINATIM_MIN_INTERVAL_MS) || (usingPublicNominatim ? 1100 : 0),
  OSRM_MIN_INTERVAL_MS: Number(env.OSRM_MIN_INTERVAL_MS) || (usingPublicOsrm ? 1000 : 0),
  EXACT_MAX_NODES: Number(env.EXACT_MAX_NODES) || 16,
  MAX_STOPS: 40, // keeps the OSRM table request small and the demo responsive
  SNAP_WARN_M: 150, // pin farther than this from a road gets a warning
  SNAP_ERROR_M: 1000, // pin farther than this from any road is rejected
  DUPLICATE_M: 20, // two stops closer than this are flagged as possible duplicates
  ROUTE_MISMATCH_WARN_PCT: 5, // matrix total vs route-leg total
  ATTRIBUTION: "Map data © OpenStreetMap contributors. Search: Nominatim. Routing: OSRM.",
  DEFAULT_COST: {
    standard: { ratePerKm: 10, baseFee: 0, extraCharges: 0 },
    ev: { kmPerKwh: 7, pricePerKwh: 12, chargingFee: 0, extraCharges: 0 },
  },
};
