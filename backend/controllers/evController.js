/*
 * evController.js
 * -----------------------------------------------------------------------
 * EV charging-cost estimate — ADDITIONAL feature only (project requirement
 * #13). This never influences the TSP route itself; it just takes a
 * distance that was already computed and converts it to an estimated
 * energy/cost figure.
 *
 *   Energy Consumed (kWh) = Total Distance (km) / EV Efficiency (km/kWh)
 *   Charging Cost (₹)     = Energy Consumed (kWh) x ₹12/kWh
 * -----------------------------------------------------------------------
 */

const EV_EFFICIENCY_KM_PER_KWH = 7;
const CHARGING_COST_PER_KWH = 12; // ₹

// POST /api/ev/calculate
// body: { distanceKm: number }
function calculate(req, res) {
  const { distanceKm } = req.body;

  if (distanceKm === undefined || isNaN(Number(distanceKm))) {
    return res.status(400).json({ error: "distanceKm (number) is required" });
  }

  // Optional overrides (set in Settings); defaults stay 7 km/kWh and ₹12/kWh.
  const eff = Number(req.body.efficiencyKmPerKwh) > 0 ? Number(req.body.efficiencyKmPerKwh) : EV_EFFICIENCY_KM_PER_KWH;
  const price = Number(req.body.costPerKwh) >= 0 && req.body.costPerKwh !== undefined && req.body.costPerKwh !== ""
    ? Number(req.body.costPerKwh)
    : CHARGING_COST_PER_KWH;

  const distance = Number(distanceKm);
  const energyConsumedKwh = distance / eff;
  const chargingCostInr = energyConsumedKwh * price;

  res.json({
    distanceKm: distance,
    efficiencyKmPerKwh: eff,
    costPerKwh: price,
    energyConsumedKwh: Number(energyConsumedKwh.toFixed(2)),
    estimatedChargingCostInr: Number(chargingCostInr.toFixed(2)),
  });
}

module.exports = { calculate };
