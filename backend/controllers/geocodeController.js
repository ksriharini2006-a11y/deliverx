const geocode = require("../services/geocodeService");
const { sendError } = require("../services/errors");

// GET /api/geocode/search?q=...&lat=..&lng=..&limit=6
async function search(req, res) {
  try {
    const lat = req.query.lat !== undefined ? Number(req.query.lat) : undefined;
    const lng = req.query.lng !== undefined ? Number(req.query.lng) : undefined;
    res.json(await geocode.search(req.query.q, { lat, lng, limit: req.query.limit }));
  } catch (err) {
    sendError(res, err);
  }
}

// GET /api/geocode/reverse?lat=..&lng=..
async function reverse(req, res) {
  try {
    res.json(await geocode.reverse(Number(req.query.lat), Number(req.query.lng)));
  } catch (err) {
    sendError(res, err);
  }
}

module.exports = { search, reverse };
