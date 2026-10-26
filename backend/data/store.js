/*
 * store.js
 * -----------------------------------------------------------------------
 * A tiny in-memory "database" - plain JavaScript arrays living in server
 * memory. This is intentional: the DAA demo must run without setting up a
 * database. Everything here resets when the server restarts.
 *
 * NOTHING IS PRE-LOADED. There is no built-in city, area, hub or sample
 * delivery list: every location comes from the user (address search, a map
 * pin, or the Delivery Locations form). The first location added becomes the
 * hub/depot (index 0 for the C++ solvers).
 * -----------------------------------------------------------------------
 */

let nextLocationId = 1;
let nextDeliveryId = 1024; // matches the "Order #1024" style from the spec

function makeHub(h) {
  return { id: nextLocationId++, name: h.name, address: h.address, lat: h.lat, lng: h.lng, isHub: true, priority: null };
}

// Index 0 is ALWAYS the depot/hub - see cpp/tsp.cpp comments. Starts empty.
let locations = [];

let deliveries = [];

function getLocations() {
  return locations;
}

function addLocation({ name, address, lat, lng, priority }) {
  const loc = {
    id: nextLocationId++,
    name,
    address: address || "",
    lat,
    lng,
    isHub: locations.length === 0, // the first place added is the hub
    priority: priority || null,
  };
  locations.push(loc);

  // Every non-hub location gets a matching "Pending" delivery order.
  if (!loc.isHub) deliveries.push({
    id: nextDeliveryId++,
    locationId: loc.id,
    customer: loc.name,
    status: "Pending",
  });

  return loc;
}

function deleteLocation(id) {
  const idNum = Number(id);
  const before = locations.length;
  locations = locations.filter((l) => l.id !== idNum || l.isHub); // never delete the hub
  deliveries = deliveries.filter((d) => d.locationId !== idNum);
  return locations.length < before;
}

// Starts a brand-new custom area: wipes everything and makes the given place
// the hub (index 0). Used by "search any place" / "click on the map".
function startNewArea({ name, address, lat, lng }) {
  nextLocationId = 1;
  nextDeliveryId = 1024;
  locations = [makeHub({ name, address: address || "", lat, lng })];
  deliveries = [];
  return locations;
}

function getDeliveries() {
  return deliveries;
}

function updateDeliveryStatus(locationId, status) {
  deliveries.forEach((d) => {
    if (d.locationId === Number(locationId)) d.status = status;
  });
}

module.exports = {
  getLocations,
  addLocation,
  deleteLocation,
  startNewArea,
  getDeliveries,
  updateDeliveryStatus,
};
