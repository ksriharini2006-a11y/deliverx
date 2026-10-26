const store = require("../data/store");

const MAX_PLACES = 18; // hub + 17 stops

// GET /api/locations
function getAll(req, res) {
  res.json({ locations: store.getLocations() });
}

// POST /api/locations
// body: { name, address, lat, lng, priority? }
function create(req, res) {
  const { name, address, lat, lng, priority } = req.body;

  if (!name || lat === undefined || lng === undefined) {
    return res.status(400).json({ error: "name, lat, and lng are required" });
  }

  if (store.getLocations().length >= MAX_PLACES) {
    return res.status(400).json({
      error: `Maximum ${MAX_PLACES - 1} stops plus the hub. The exact DP+Bitmask solver grows as 2^n, so it is capped here to stay fast.`,
    });
  }
  if (Number.isNaN(Number(lat)) || Number.isNaN(Number(lng)) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return res.status(400).json({ error: "lat/lng are not valid coordinates" });
  }

  const loc = store.addLocation({
    name,
    address,
    lat: Number(lat),
    lng: Number(lng),
    priority,
  });
  res.status(201).json({ location: loc });
}

// DELETE /api/locations/:id
function remove(req, res) {
  const deleted = store.deleteLocation(req.params.id);
  if (!deleted) {
    return res.status(404).json({ error: "Location not found (or is the hub, which cannot be deleted)" });
  }
  res.json({ success: true });
}

// POST /api/locations/new-area
// body: { name, address, lat, lng } -> wipes everything, makes this place the hub.
// This is what lets the app work for ANY place (no hard-coded areas needed).
function newArea(req, res) {
  const { name, address, lat, lng } = req.body;
  if (!name || lat === undefined || lng === undefined || Number.isNaN(Number(lat)) || Number.isNaN(Number(lng))) {
    return res.status(400).json({ error: "name, lat, and lng are required" });
  }
  const locations = store.startNewArea({ name, address, lat: Number(lat), lng: Number(lng) });
  res.status(201).json({ locations });
}

module.exports = { getAll, create, remove, newArea };
