const cost = require("../services/costService");
const { sendError } = require("../services/errors");

// POST /api/cost/estimate   body: { distanceKm, durationMin?, config? }
function estimate(req, res) {
  try {
    res.json(cost.estimate(req.body || {}));
  } catch (err) {
    sendError(res, err);
  }
}

module.exports = { estimate };
