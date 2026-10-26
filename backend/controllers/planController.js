const plan = require("../services/planService");
const { sendError } = require("../services/errors");

// POST /api/plan/optimize
// body: { pickup, stops[], policy: "return"|"open", objective: "distance"|"duration",
//         zoneRadiusKm?, enforceZone?, costConfig?, includeOriginalRoute? }
async function optimize(req, res) {
  try {
    res.json(await plan.optimize(req.body || {}));
  } catch (err) {
    sendError(res, err);
  }
}

// POST /api/plan/recalculate
// body: { currentPoint, depot?, remainingStops[], policy, objective, costConfig? }
async function recalculate(req, res) {
  try {
    res.json(await plan.recalculate(req.body || {}));
  } catch (err) {
    sendError(res, err);
  }
}

module.exports = { optimize, recalculate };
