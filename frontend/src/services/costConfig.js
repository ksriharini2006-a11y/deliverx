/*
 * costConfig.js - the editable cost / EV rates. Stored in this browser's
 * localStorage (a per-user convenience) and sent to the backend with every
 * estimate. Defaults are placeholders, NOT live fuel or electricity prices.
 */

export const DEFAULT_COST_CONFIG = {
  standard: { ratePerKm: 10, baseFee: 0, extraCharges: 0 },
  ev: { kmPerKwh: 7, pricePerKwh: 12, chargingFee: 0, extraCharges: 0 },
};

const KEY = "deliverx.costConfig.v1";

export function loadCostConfig() {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULT_COST_CONFIG;
    const p = JSON.parse(raw);
    return {
      standard: { ...DEFAULT_COST_CONFIG.standard, ...(p.standard || {}) },
      ev: { ...DEFAULT_COST_CONFIG.ev, ...(p.ev || {}) },
    };
  } catch {
    return DEFAULT_COST_CONFIG;
  }
}

export function saveCostConfig(cfg) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(cfg));
  } catch {
    /* storage unavailable (private window): settings just last for this session */
  }
}
