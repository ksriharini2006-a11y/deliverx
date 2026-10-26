/*
 * PlanContext.jsx
 * -----------------------------------------------------------------------
 * Shared state for the hyperlocal planner and the delivery-agent screen:
 * pickup point, delivery zone, route policy, the list of stops, the last
 * optimization result and the agent's progress.
 *
 * It is saved to this browser's localStorage (wrapped in try/catch because
 * storage can be unavailable) so a refresh does not lose the plan.
 *
 * "Stale" result: if the pickup, stops, policy, objective or zone change after
 * a route was optimized, the old route no longer matches the inputs, so the UI
 * labels it stale instead of showing it as current.
 * -----------------------------------------------------------------------
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { loadCostConfig, saveCostConfig } from "../services/costConfig";

const PlanContext = createContext(null);
const KEY = "deliverx.plan.v1";

function loadSaved() {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function planSignature({ pickup, stops, policy, objective, zoneRadiusKm }) {
  const r = (n) => Number(n).toFixed(6);
  return JSON.stringify([
    pickup ? [r(pickup.lat), r(pickup.lng)] : null,
    stops.map((s) => [s.id, r(s.lat), r(s.lng)]),
    policy,
    objective,
    zoneRadiusKm,
  ]);
}

export function PlanProvider({ children }) {
  const saved = useMemo(loadSaved, []);
  const [pickup, setPickup] = useState(saved.pickup || null);
  const [zoneCenter, setZoneCenter] = useState(saved.zoneCenter || null); // where the user searched, before a pickup exists
  const [zoneRadiusKm, setZoneRadiusKm] = useState(saved.zoneRadiusKm || 3);
  const [policy, setPolicy] = useState(saved.policy || "return");
  const [objective, setObjective] = useState(saved.objective || "distance");
  const [stops, setStops] = useState(saved.stops || []);
  const [result, setResultState] = useState(saved.result || null);
  const [resultSig, setResultSig] = useState(saved.resultSig || null);
  const [agent, setAgent] = useState(saved.agent || null);
  const [costConfig, setCostConfigState] = useState(loadCostConfig());

  const counter = useRef(
    (saved.stops || []).reduce((m, s) => Math.max(m, Number(String(s.id).replace(/\D/g, "")) || 0), 0)
  );

  useEffect(() => {
    try {
      window.localStorage.setItem(
        KEY,
        JSON.stringify({ pickup, zoneCenter, zoneRadiusKm, policy, objective, stops, result, resultSig, agent })
      );
    } catch {
      /* ignore: plan just won't survive a refresh */
    }
  }, [pickup, zoneCenter, zoneRadiusKm, policy, objective, stops, result, resultSig, agent]);

  const addStop = useCallback((place) => {
    counter.current += 1;
    const stop = {
      id: `s${counter.current}`,
      name: place.name || `Stop ${counter.current}`,
      address: place.address || place.displayName || "",
      lat: place.lat,
      lng: place.lng,
      verification: place.verification || "manual-pin",
      verificationLabel: place.verificationLabel || null,
      priority: place.priority || "normal",
      timeWindow: place.timeWindow || { from: "", to: "" },
      package: place.package || "",
      landmark: place.landmark || "",
    };
    setStops((prev) => [...prev, stop]);
    return stop;
  }, []);

  const updateStop = useCallback((id, patch) => {
    setStops((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }, []);

  const removeStop = useCallback((id) => setStops((prev) => prev.filter((s) => s.id !== id)), []);

  const moveStop = useCallback((id, dir) => {
    setStops((prev) => {
      const i = prev.findIndex((s) => s.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }, []);

  const clearStops = useCallback(() => setStops([]), []);

  const setResult = useCallback(
    (res, inputs) => {
      setResultState(res);
      setResultSig(res ? planSignature(inputs || { pickup, stops, policy, objective, zoneRadiusKm }) : null);
    },
    [pickup, stops, policy, objective, zoneRadiusKm]
  );

  const setCostConfig = useCallback((cfg) => {
    setCostConfigState(cfg);
    saveCostConfig(cfg);
  }, []);

  const resetAll = useCallback(() => {
    setPickup(null);
    setZoneCenter(null);
    setStops([]);
    setResultState(null);
    setResultSig(null);
    setAgent(null);
  }, []);

  const currentSig = planSignature({ pickup, stops, policy, objective, zoneRadiusKm });
  const resultStale = !!result && resultSig !== currentSig;

  const value = {
    pickup, setPickup,
    zoneCenter, setZoneCenter,
    zoneRadiusKm, setZoneRadiusKm,
    policy, setPolicy,
    objective, setObjective,
    stops, addStop, updateStop, removeStop, moveStop, clearStops,
    result, setResult, resultStale,
    agent, setAgent,
    costConfig, setCostConfig,
    resetAll,
  };
  return <PlanContext.Provider value={value}>{children}</PlanContext.Provider>;
}

export function usePlan() {
  const ctx = useContext(PlanContext);
  if (!ctx) throw new Error("usePlan must be used inside PlanProvider");
  return ctx;
}
