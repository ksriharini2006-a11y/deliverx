/*
 * PlaceSearch.jsx
 * -----------------------------------------------------------------------
 * Real address search (house number + street, shop name, apartment, landmark,
 * road, area or postal code) backed by Nominatim through our backend.
 *
 *  - searches when you press Search / Enter, or automatically after you stop
 *    typing for 1.2 s (debounce) once there are at least 4 characters. The
 *    public Nominatim server does not allow instant search-as-you-type, so we
 *    wait, and the backend also throttles and caches.
 *  - shows loading, empty-result and error states
 *  - ignores outdated responses if you keep typing
 *  - results come ONLY from the service; nothing is hard-coded
 * -----------------------------------------------------------------------
 */

import React, { useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../services/api";
import VerificationBadge from "./VerificationBadge";

const DEBOUNCE_MS = 1500;
const MIN_CHARS = 4;

function haversineKm(a, b) {
  const R = 6371;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * @param {{placeholder?:string, bias?:{lat:number,lng:number}|null, zoneRadiusKm?:number,
 *          actions:{label:string, onClick:(r:object)=>void, disabled?:(r:object)=>boolean, primary?:boolean}[],
 *          onPreview?:(r:object|null)=>void}} props
 */
export default function PlaceSearch({ placeholder, bias, zoneRadiusKm, actions, onPreview }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [searched, setSearched] = useState(false);
  const [auto, setAuto] = useState(false); // search-as-you-type is OFF by default (see below)
  const ticket = useRef(0);
  const timer = useRef(null);

  const run = async (q) => {
    const text = q.trim();
    if (text.length < 3) return;
    const mine = ++ticket.current;
    setLoading(true);
    setError(null);
    try {
      const data = await api.searchPlaces(text, bias || undefined);
      if (mine !== ticket.current) return; // a newer search replaced this one
      setResults(data.results);
      setSearched(true);
    } catch (e) {
      if (mine !== ticket.current) return;
      setResults([]);
      setSearched(false);
      setError(errorMessage(e, "Search failed."));
    } finally {
      if (mine === ticket.current) setLoading(false);
    }
  };

  // debounced automatic search
  useEffect(() => {
    clearTimeout(timer.current);
    if (auto && query.trim().length >= MIN_CHARS) {
      timer.current = setTimeout(() => run(query), DEBOUNCE_MS);
    }
    return () => clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, auto]);

  const submit = (e) => {
    e.preventDefault();
    clearTimeout(timer.current);
    run(query);
  };

  return (
    <div>
      <form onSubmit={submit} className="flex-row" style={{ flexWrap: "wrap", gap: 10 }}>
        <div className="field" style={{ marginBottom: 0, flex: 1, minWidth: 220 }}>
          <input
            type="text"
            value={query}
            placeholder={placeholder || "House no. + street, shop, apartment, landmark, area or PIN code"}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search address"
          />
        </div>
        <button className="btn btn-primary" type="submit" disabled={loading || query.trim().length < 3}>
          {loading ? "Searching..." : "Search"}
        </button>
      </form>
      <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>
        Searches OpenStreetMap (Nominatim) when you press Search or Enter.{" "}
        <label style={{ cursor: "pointer" }}>
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> also search {DEBOUNCE_MS / 1000}s after I stop typing
        </label>{" "}
        (off by default: the free public service asks apps not to use instant autocomplete).
      </div>

      {error && <div className="error-box" style={{ marginTop: 10 }}>{error}</div>}
      {loading && <div className="muted" style={{ marginTop: 10 }}>Looking up places…</div>}
      {!loading && searched && results.length === 0 && !error && (
        <div className="muted" style={{ marginTop: 10 }}>
          No matching place found. Try a landmark or street name, add the PIN code, or drop a pin on the map instead.
        </div>
      )}

      {results.length > 0 && (
        <div className="search-results">
          {results.map((r) => {
            const km = bias ? haversineKm(bias, r) : null;
            const outside = km !== null && zoneRadiusKm ? km > zoneRadiusKm : false;
            return (
              <div
                key={r.placeId}
                className="search-result"
                onMouseEnter={() => onPreview && onPreview(r)}
                onMouseLeave={() => onPreview && onPreview(null)}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{r.name}</div>
                  <div className="muted" style={{ fontSize: 12 }}>{r.displayName}</div>
                  <div style={{ marginTop: 4, display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <VerificationBadge status={r.accuracy.status} />
                    {km !== null && <span className="badge badge-muted">{km.toFixed(1)} km from pickup (straight line)</span>}
                    {outside && <span className="badge badge-danger">Outside delivery zone</span>}
                    <span className="muted" style={{ fontSize: 11 }}>{r.lat.toFixed(5)}, {r.lng.toFixed(5)}</span>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, flexDirection: "column" }}>
                  {actions.map((a) => (
                    <button
                      key={a.label}
                      className={`btn ${a.primary ? "btn-accent" : "btn-outline"}`}
                      disabled={a.disabled ? a.disabled(r) : false}
                      onClick={() => a.onClick(r)}
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
