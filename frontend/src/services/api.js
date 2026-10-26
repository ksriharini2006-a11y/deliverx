/*
 * api.js
 * -----------------------------------------------------------------------
 * The ONE place the React app talks to the backend. Every page/component
 * imports from here instead of calling axios/fetch directly, so if the
 * backend URL or a route path ever changes, you only edit this file.
 * -----------------------------------------------------------------------
 */

import axios from "axios";

// Change this if your backend runs on a different port
// (e.g. you used PORT=5050 because 5000 was taken by AirPlay on Mac)
export const API_BASE = "http://localhost:5050/api";

const client = axios.create({ baseURL: API_BASE });

export const api = {
  // ---- locations ----
  getLocations: () => client.get("/locations").then((r) => r.data.locations),
  addLocation: (loc) => client.post("/locations", loc).then((r) => r.data.location),
  deleteLocation: (id) => client.delete(`/locations/${id}`).then((r) => r.data),

  startNewArea: (place) => client.post("/locations/new-area", place).then((r) => r.data.locations),

  // ---- route optimization ----
  // startId is optional: when given, the route starts (and ends) at that
  // location instead of the hub.
  optimizeRoute: (locations, startId) =>
    client.post("/route/optimize", { locations, startId }).then((r) => r.data),
  greedyRoute: (locations, startId) =>
    client.post("/route/greedy", { locations, startId }).then((r) => r.data),
  compareRoutes: (locations, startId) =>
    client.post("/route/compare", { locations, startId }).then((r) => r.data),
  multiAgentRoute: (locations, agents, startId) =>
    client.post("/route/multi-agent", { locations, agents, startId }).then((r) => r.data),
  // Distance from the start (hub by default) to every other place + full matrix
  getDistances: (locations, startId) =>
    client.post("/route/distances", { locations, startId }).then((r) => r.data),

  // ---- EV (legacy straight-line pages) ----
  // overrides = { efficiencyKmPerKwh?, costPerKwh? } from Settings
  calculateEv: (distanceKm, overrides = {}) =>
    client.post("/ev/calculate", { distanceKm, ...overrides }).then((r) => r.data),

  // ---- real address search (Nominatim, via our backend) ----
  searchPlaces: (q, bias) =>
    client
      .get("/geocode/search", { params: { q, lat: bias?.lat, lng: bias?.lng } })
      .then((r) => r.data),
  reversePlace: (lat, lng) => client.get("/geocode/reverse", { params: { lat, lng } }).then((r) => r.data),

  // ---- hyperlocal planner (real road network, OSRM) ----
  planOptimize: (payload) => client.post("/plan/optimize", payload).then((r) => r.data),
  planRecalculate: (payload) => client.post("/plan/recalculate", payload).then((r) => r.data),
  estimateCost: (payload) => client.post("/cost/estimate", payload).then((r) => r.data),
  serviceStatus: () => client.get("/status/services").then((r) => r.data),
  publicConfig: () => client.get("/status/config").then((r) => r.data),

  // ---- deliveries ----
  getDeliveries: () => client.get("/deliveries").then((r) => r.data.deliveries),
  updateDeliveryStatus: (locationId, status) =>
    client.patch(`/deliveries/${locationId}`, { status }).then((r) => r.data),
};

// Turns any axios error into one readable sentence for the UI.
export function errorMessage(e, fallback = "Something went wrong.") {
  if (e && e.response && e.response.data && e.response.data.error) return e.response.data.error;
  if (e && e.code === "ERR_NETWORK") {
    return "Could not reach the backend. Is it running, and does API_BASE in src/services/api.js match its port (5050)?";
  }
  return (e && e.message) || fallback;
}
