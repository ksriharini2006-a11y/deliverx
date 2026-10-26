/*
 * distance.js
 * -----------------------------------------------------------------------
 * Builds an n x n distance matrix (in kilometres) from a list of
 * { lat, lng } locations using the Haversine formula — the standard way
 * to calculate straight-line ("as the crow flies") distance between two
 * points on Earth's surface given their latitude/longitude.
 *
 * This is deliberately simple and dependency-free (see project
 * requirement #9: prefer Haversine, and structure things so a real
 * routing API like OSRM could be swapped in later without touching the
 * C++ algorithm or the rest of the backend).
 * -----------------------------------------------------------------------
 */

const EARTH_RADIUS_KM = 6371;

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

function haversineKm(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return EARTH_RADIUS_KM * c;
}

/**
 * @param {Array<{lat:number, lng:number}>} locations - index 0 MUST be the depot/hub
 * @returns {number[][]} symmetric n x n matrix, dist[i][j] in km
 */
function buildDistanceMatrix(locations) {
  const n = locations.length;
  const matrix = Array.from({ length: n }, () => new Array(n).fill(0));

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = haversineKm(locations[i], locations[j]);
      matrix[i][j] = d;
      matrix[j][i] = d; // symmetric: distance i->j == distance j->i
    }
  }
  return matrix;
}

module.exports = { buildDistanceMatrix, haversineKm };
