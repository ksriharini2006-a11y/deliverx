/*
 * costService.js - distance-based delivery cost estimate, Standard vs EV.
 *
 * Every rate is CONFIGURABLE and the defaults are placeholders - this service
 * never looks up live fuel or electricity prices. The UI shows the assumptions
 * next to every estimate.
 *
 *   Standard total = baseFee + ratePerKm x km + extraCharges
 *   EV energy      = km / kmPerKwh                       (kWh)
 *   EV total       = energy x pricePerKwh + chargingFee + extraCharges
 *
 * This is purely a reporting layer: it never influences which route the TSP
 * solver picks.
 */

const config = require("./config");
const { ApiError } = require("./errors");

const round2 = (n) => Math.round(n * 100) / 100;

function num(value, fallback, name, { min = 0, exclusiveMin = false } = {}) {
  const v = value === undefined || value === null || value === "" ? fallback : Number(value);
  if (!Number.isFinite(v) || (exclusiveMin ? v <= min : v < min)) {
    throw new ApiError(
      400,
      "INVALID_COST_CONFIG",
      `${name} must be a number ${exclusiveMin ? "greater than" : "of at least"} ${min}.`
    );
  }
  return v;
}

function normalizeConfig(cfg = {}) {
  const d = config.DEFAULT_COST;
  const s = cfg.standard || {};
  const e = cfg.ev || {};
  return {
    standard: {
      ratePerKm: num(s.ratePerKm, d.standard.ratePerKm, "Standard rate per km"),
      baseFee: num(s.baseFee, d.standard.baseFee, "Standard base fee"),
      extraCharges: num(s.extraCharges, d.standard.extraCharges, "Standard extra charges"),
    },
    ev: {
      kmPerKwh: num(e.kmPerKwh, d.ev.kmPerKwh, "EV efficiency (km per kWh)", { min: 0, exclusiveMin: true }),
      pricePerKwh: num(e.pricePerKwh, d.ev.pricePerKwh, "Electricity price per kWh"),
      chargingFee: num(e.chargingFee, d.ev.chargingFee, "EV charging session fee"),
      extraCharges: num(e.extraCharges, d.ev.extraCharges, "EV extra charges"),
    },
  };
}

/**
 * @param {{distanceKm:number, durationMin?:number, config?:object}} input
 */
function estimate({ distanceKm, durationMin, config: cfg }) {
  const km = Number(distanceKm);
  if (!Number.isFinite(km) || km < 0) {
    throw new ApiError(400, "INVALID_DISTANCE", "distanceKm must be a number of at least 0.");
  }
  const c = normalizeConfig(cfg);

  const distanceCost = c.standard.ratePerKm * km;
  const standardTotal = c.standard.baseFee + distanceCost + c.standard.extraCharges;

  const energyKwh = km / c.ev.kmPerKwh;
  const energyCost = energyKwh * c.ev.pricePerKwh;
  const evTotal = energyCost + c.ev.chargingFee + c.ev.extraCharges;

  return {
    currency: "INR",
    distanceKm: round2(km),
    durationMin: durationMin === undefined ? null : round2(Number(durationMin)),
    standard: {
      ratePerKm: c.standard.ratePerKm,
      distanceCost: round2(distanceCost),
      baseFee: c.standard.baseFee,
      extraCharges: c.standard.extraCharges,
      total: round2(standardTotal),
    },
    ev: {
      kmPerKwh: c.ev.kmPerKwh,
      energyKwh: round2(energyKwh),
      pricePerKwh: c.ev.pricePerKwh,
      energyCost: round2(energyCost),
      chargingFee: c.ev.chargingFee,
      extraCharges: c.ev.extraCharges,
      total: round2(evTotal),
    },
    assumptions: [
      `Standard: base fee + ₹${c.standard.ratePerKm}/km x distance + extra charges.`,
      `EV: distance / ${c.ev.kmPerKwh} km per kWh, priced at ₹${c.ev.pricePerKwh}/kWh, plus charging fee and extra charges.`,
      "Rates are editable assumptions, not live fuel or electricity prices.",
      "Cost is based on the road distance of the planned route.",
    ],
  };
}

module.exports = { estimate, normalizeConfig };
