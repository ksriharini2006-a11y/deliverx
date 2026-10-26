/*
 * AppDataContext.jsx
 * -----------------------------------------------------------------------
 * Small shared state so that "locations" and "the last optimized route"
 * are available on every page (Dashboard, Plan Route, Live Tracking)
 * without prop-drilling or re-fetching constantly. This is intentionally
 * simple (React Context + useState) rather than pulling in Redux —
 * appropriate for a college project of this size.
 * -----------------------------------------------------------------------
 */

import React, { createContext, useContext, useState, useCallback } from "react";
import { api } from "../services/api";

const AppDataContext = createContext(null);

export function AppDataProvider({ children }) {
  const [locations, setLocations] = useState([]);
  const [routeResult, setRouteResult] = useState(null); // last /route/optimize result
  const [compareResult, setCompareResult] = useState(null); // last /route/compare result
  const [multiAgentResult, setMultiAgentResult] = useState(null); // last /route/multi-agent result
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const refreshLocations = useCallback(async () => {
    try {
      const locs = await api.getLocations();
      setLocations(locs);
      return locs;
    } catch (e) {
      setError("Could not reach backend. Is it running on port 5050?");
      return [];
    }
  }, []);

  // Starts a custom area from ANY place: that place becomes the hub and
  // everything else is cleared.
  const startNewArea = useCallback(async (place) => {
    setError(null);
    try {
      const locs = await api.startNewArea(place);
      setLocations(locs);
      setRouteResult(null);
      setCompareResult(null);
      setMultiAgentResult(null);
      return true;
    } catch (e) {
      setError(e.response?.data?.error || "Could not start a new area.");
      return false;
    }
  }, []);

  // Copies the Delivery Planner's pickup + stops into the classic (straight-line)
  // tools: Plan Route, Multi-Agent Routes, Live Tracking.
  const importFromPlan = useCallback(async (pickup, planStops) => {
    setError(null);
    try {
      await api.startNewArea({ name: pickup.name, address: pickup.address, lat: pickup.lat, lng: pickup.lng });
      for (const st of planStops) {
        await api.addLocation({ name: st.name, address: st.address, lat: st.lat, lng: st.lng });
      }
      const locs = await api.getLocations();
      setLocations(locs);
      setRouteResult(null);
      setCompareResult(null);
      setMultiAgentResult(null);
      return true;
    } catch (e) {
      setError(e.response?.data?.error || "Could not copy the stops to the classic tools. Is the backend running?");
      return false;
    }
  }, []);

  const optimize = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.optimizeRoute(locations);
      setRouteResult(result);
      return result;
    } catch (e) {
      setError(e.response?.data?.error || "Optimization failed. Add at least one delivery location first.");
      return null;
    } finally {
      setLoading(false);
    }
  }, [locations]);

  const compare = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.compareRoutes(locations);
      setCompareResult(result);
      return result;
    } catch (e) {
      setError(e.response?.data?.error || "Comparison failed. Add at least one delivery location first.");
      return null;
    } finally {
      setLoading(false);
    }
  }, [locations]);

  const allocateMultiAgent = useCallback(
    async (agentCount) => {
      setLoading(true);
      setError(null);
      try {
        const result = await api.multiAgentRoute(locations, agentCount);
        setMultiAgentResult(result);
        return result;
      } catch (e) {
        setError(e.response?.data?.error || "Multi-agent allocation failed. Add at least one delivery location first.");
        return null;
      } finally {
        setLoading(false);
      }
    },
    [locations]
  );

  const addLocation = useCallback(async (loc) => {
    setError(null);
    try {
      const created = await api.addLocation(loc);
      setLocations((prev) => [...prev, created]);
    } catch (e) {
      setError(e.response?.data?.error || "Could not add location.");
    }
  }, []);

  const removeLocation = useCallback(async (id) => {
    setError(null);
    try {
      await api.deleteLocation(id);
      setLocations((prev) => prev.filter((l) => l.id !== id));
    } catch (e) {
      setError(e.response?.data?.error || "Could not delete location.");
    }
  }, []);

  const value = {
    locations,
    routeResult,
    setRouteResult,
    compareResult,
    multiAgentResult,
    setMultiAgentResult,
    loading,
    error,
    setError,
    refreshLocations,
    importFromPlan,
    startNewArea,
    optimize,
    compare,
    allocateMultiAgent,
    addLocation,
    removeLocation,
  };

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
}

export function useAppData() {
  const ctx = useContext(AppDataContext);
  if (!ctx) throw new Error("useAppData must be used inside AppDataProvider");
  return ctx;
}
