/*
 * DeliveryPlanner.jsx
 * -----------------------------------------------------------------------
 * Hyperlocal delivery planning on REAL data. Nothing here is pre-filled or
 * hard-coded: every place comes from address search (OpenStreetMap
 * Nominatim) or from a pin the user places, and every distance comes from the
 * road network (OSRM) - never a straight line.
 *
 *   1. Delivery area   state / city / locality -> search -> radius of the zone
 *   2. Pickup point    search an address (or drop a pin)
 *   3. Destinations    search addresses, shops, apartments, landmarks, PIN codes,
 *                      or click the map and drag the pin to the exact spot
 *   4. Optimize        open route or return-to-pickup; shortest distance or time
 *   5. Results         original vs optimized order, road route, leg table,
 *                      Standard vs EV cost, algorithm explanation
 * -----------------------------------------------------------------------
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { usePlan } from "../hooks/PlanContext";
import { useAppData } from "../hooks/AppDataContext";
import { api, errorMessage } from "../services/api";
import { initAgent } from "../services/agentLogic";
import PlanMap from "../components/PlanMap";
import PlaceSearch from "../components/PlaceSearch";
import VerificationBadge from "../components/VerificationBadge";
import { CostAssumptions, CostSummary } from "../components/CostPanel";

function haversineKm(a, b) {
  const R = 6371;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const fmtKm = (m) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(2)} km`);
const fmtMin = (s) => {
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
};

const SUSPICIOUS_FAR_KM = 25;
const MOVED_PIN_M = 3; // a pin dragged further than this is a "manual pin"

export default function DeliveryPlanner() {
  const navigate = useNavigate();
  const {
    pickup, setPickup, zoneCenter, setZoneCenter, zoneRadiusKm, setZoneRadiusKm,
    policy, setPolicy, objective, setObjective,
    stops, addStop, updateStop, removeStop, moveStop, clearStops,
    result, setResult, resultStale, setAgent, costConfig, setCostConfig, resetAll,
  } = usePlan();
  const { importFromPlan } = useAppData();

  // ---- delivery-area search (state / city / locality) ----
  const [stateName, setStateName] = useState("");
  const [cityName, setCityName] = useState("");
  const [locality, setLocality] = useState("");
  const [areaResults, setAreaResults] = useState([]);
  const [areaBusy, setAreaBusy] = useState(false);
  const [areaMsg, setAreaMsg] = useState(null);

  // ---- map interaction ----
  const [pin, setPin] = useState(null);
  const [preview, setPreview] = useState(null);
  const [focus, setFocus] = useState(null);
  const [fitKey, setFitKey] = useState(0);
  const pinTicket = useRef(0);

  // ---- optimization ----
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [showOriginal, setShowOriginal] = useState(false);
  const [costs, setCosts] = useState(null);
  const [costMode, setCostMode] = useState("standard");
  const [svc, setSvc] = useState(null);
  const [svcBusy, setSvcBusy] = useState(false);

  const bias = pickup || zoneCenter || null;

  // ---------- per-stop warnings (checked in the browser; the server re-checks) ----------
  const warningsById = useMemo(() => {
    const w = {};
    stops.forEach((s, i) => {
      const list = [];
      if (!Number.isFinite(s.lat) || !Number.isFinite(s.lng)) list.push({ code: "bad", text: "Invalid coordinates" });
      if (pickup) {
        const km = haversineKm(pickup, s);
        if (km > zoneRadiusKm) list.push({ code: "zone", text: `Outside zone (${km.toFixed(1)} km from pickup)` });
        if (km > SUSPICIOUS_FAR_KM) list.push({ code: "far", text: `Suspiciously far (${km.toFixed(0)} km)` });
        if (km * 1000 < 20) list.push({ code: "dup", text: `Same spot as the pickup (${Math.round(km * 1000)} m)` });
      }
      stops.forEach((o, j) => {
        if (j < i && haversineKm(o, s) * 1000 < 20) list.push({ code: "dup", text: `Possible duplicate of "${o.name}"` });
      });
      w[s.id] = list;
    });
    return w;
  }, [stops, pickup, zoneRadiusKm]);

  const outsideZone = stops.filter((s) => (warningsById[s.id] || []).some((x) => x.code === "zone"));

  // ---------- area search ----------
  const findArea = async (e) => {
    e.preventDefault();
    const q = [locality, cityName, stateName].map((x) => x.trim()).filter(Boolean).join(", ");
    if (q.length < 3) {
      setAreaMsg("Type a locality, city and/or state to search for.");
      return;
    }
    setAreaBusy(true);
    setAreaMsg(null);
    setAreaResults([]);
    try {
      const data = await api.searchPlaces(q);
      setAreaResults(data.results);
      if (data.results.length === 0) setAreaMsg("No such place found. Check the spelling or try fewer words.");
    } catch (err) {
      setAreaMsg(errorMessage(err, "Area search failed."));
    } finally {
      setAreaBusy(false);
    }
  };

  const useArea = (r) => {
    setZoneCenter({ lat: r.lat, lng: r.lng, label: r.displayName });
    setFocus({ lat: r.lat, lng: r.lng, zoom: 14, key: Date.now() });
    setAreaResults([]);
    setAreaMsg(`Delivery area centred on "${r.name}". Now choose a pickup point inside it.`);
  };

  // ---------- pin editor ----------
  const reverseLookup = async (lat, lng) => {
    const mine = ++pinTicket.current;
    try {
      const r = await api.reversePlace(lat, lng);
      if (mine !== pinTicket.current) return;
      setPin((p) => (p ? { ...p, suggestion: r.found ? { name: r.name, displayName: r.displayName } : null, suggestionNote: r.found ? null : r.message } : p));
    } catch {
      /* a failed suggestion is harmless: the user can still name the spot */
    }
  };

  const openPin = (lat, lng, extra = {}) => {
    setPin({
      lat, lng, origin: null, verification: "manual-pin", name: "", address: "", landmark: "",
      editingId: null, suggestion: null, suggestionNote: null, ...extra,
    });
    if (!extra.skipReverse) reverseLookup(lat, lng);
  };

  const onMapClick = ({ lat, lng }) => {
    if (pin && pin.editingId) {
      movePin(lat, lng);
      return;
    }
    openPin(lat, lng, pin ? { name: pin.name, address: pin.address, landmark: pin.landmark } : {});
  };

  const movePin = (lat, lng) => {
    setPin((p) => {
      if (!p) return p;
      const movedM = p.origin ? haversineKm(p.origin, { lat, lng }) * 1000 : Infinity;
      const keep = p.origin && movedM <= MOVED_PIN_M;
      return { ...p, lat, lng, verification: keep ? p.originVerification : "manual-pin" };
    });
    reverseLookup(lat, lng);
  };

  const adjustResultPin = (r) => {
    setFocus({ lat: r.lat, lng: r.lng, zoom: 18, key: Date.now() });
    openPin(r.lat, r.lng, {
      origin: { lat: r.lat, lng: r.lng },
      originVerification: r.accuracy.status,
      verification: r.accuracy.status,
      name: r.name,
      address: r.displayName,
      skipReverse: true,
    });
  };

  const editStopPin = (s) => {
    setFocus({ lat: s.lat, lng: s.lng, zoom: 18, key: Date.now() });
    openPin(s.lat, s.lng, {
      origin: { lat: s.lat, lng: s.lng },
      originVerification: s.verification,
      verification: s.verification,
      name: s.name,
      address: s.address,
      landmark: s.landmark || "",
      editingId: s.id,
      skipReverse: true,
    });
  };

  const pinPlace = () => ({
    name: pin.name.trim() || "Pinned place",
    address: pin.address.trim() || "Pinned on the map",
    lat: pin.lat,
    lng: pin.lng,
    verification: pin.verification,
    landmark: pin.landmark.trim(),
  });

  const savePinAsStop = () => {
    if (!pickup) return setError("Set the pickup point first, so the delivery zone is known.");
    const place = pinPlace();
    const km = haversineKm(pickup, place);
    if (!pin.editingId && km > zoneRadiusKm) {
      return setError(`That spot is ${km.toFixed(1)} km from the pickup, outside the ${zoneRadiusKm} km delivery zone. Move the pin or enlarge the zone.`);
    }
    setError(null);
    if (pin.editingId) updateStop(pin.editingId, place);
    else addStop(place);
    setPin(null);
  };

  const savePinAsPickup = () => {
    setError(null);
    setPickup(pinPlace());
    setZoneCenter({ lat: pin.lat, lng: pin.lng, label: pin.name });
    setPin(null);
    setFitKey((k) => k + 1);
  };

  // ---------- adding from search results ----------
  const toPlace = (r) => ({ name: r.name, address: r.displayName, lat: r.lat, lng: r.lng, verification: r.accuracy.status });

  const setResultAsPickup = (r) => {
    setError(null);
    setPickup(toPlace(r));
    setZoneCenter({ lat: r.lat, lng: r.lng, label: r.displayName });
    setFocus({ lat: r.lat, lng: r.lng, zoom: 15, key: Date.now() });
    setFitKey((k) => k + 1);
  };

  const addResultAsStop = (r) => {
    setError(null);
    if (stops.some((s) => haversineKm(s, r) * 1000 < 20)) {
      setNotice(`"${r.name}" is within 20 m of a stop you already added. It was added anyway; check the stop list for the duplicate warning.`);
    } else {
      setNotice(null);
    }
    addStop(toPlace(r));
    setFitKey((k) => k + 1);
  };

  // ---------- optimize ----------
  const canOptimize = !!pickup && stops.length >= 1 && outsideZone.length === 0 && !busy;

  const optimize = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api.planOptimize({
        pickup,
        stops,
        policy,
        objective,
        zoneRadiusKm,
        enforceZone: true,
        costConfig,
        includeOriginalRoute: true,
      });
      setResult(res);
      setShowOriginal(false);
      setFitKey((k) => k + 1);
    } catch (e) {
      setError(errorMessage(e, "Route calculation failed."));
    } finally {
      setBusy(false);
    }
  };

  // ---------- costs follow the result and the editable rates ----------
  useEffect(() => {
    if (!result) {
      setCosts(null);
      return undefined;
    }
    const valid = ["standard", "ev"].every((g) => Object.values(costConfig[g]).every((v) => v !== "" && Number(v) >= 0)) && Number(costConfig.ev.kmPerKwh) > 0;
    if (!valid) return undefined;
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const [opt, orig] = await Promise.all([
          api.estimateCost({ distanceKm: result.optimized.distanceM / 1000, durationMin: result.optimized.durationS / 60, config: costConfig }),
          api.estimateCost({ distanceKm: result.original.distanceM / 1000, durationMin: result.original.durationS / 60, config: costConfig }),
        ]);
        if (!cancelled) setCosts({ opt, orig });
      } catch (e) {
        if (!cancelled) setError(errorMessage(e, "Cost estimate failed."));
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [result, costConfig]);

  // ---------- hand-offs ----------
  const startDelivery = () => {
    if (!result) return;
    setAgent(initAgent(result, pickup, stops, result.policy));
    navigate("/delivery-agent");
  };

  const sendToClassic = async () => {
    setBusy(true);
    const ok = await importFromPlan(pickup, stops);
    setBusy(false);
    if (ok) navigate("/multi-agent");
    else setError("Could not copy the stops to the Multi-Agent tool. Is the backend running?");
  };

  const checkServices = async () => {
    setSvcBusy(true);
    try {
      setSvc(await api.serviceStatus());
    } catch (e) {
      setSvc({ error: errorMessage(e) });
    } finally {
      setSvcBusy(false);
    }
  };

  // ---------- map data ----------
  const fresh = result && !resultStale;
  const orderIndex = fresh ? Object.fromEntries(result.optimized.order.map((id, i) => [id, i + 1])) : null;
  const markers = stops.map((s, i) => ({
    id: s.id, lat: s.lat, lng: s.lng, name: s.name, address: s.address, state: "plain",
    label: String(orderIndex ? orderIndex[s.id] : i + 1),
  }));
  const routes = [];
  if (fresh && showOriginal && result.original.geometry) routes.push({ geometry: result.original.geometry, color: "#8b98b8", dashed: true, weight: 4, opacity: 0.8 });
  if (fresh) routes.push({ geometry: result.optimized.geometry, color: "#34d399", weight: 5 });

  const entryIndex = Object.fromEntries(stops.map((s, i) => [s.id, i + 1]));

  return (
    <div>
      <div className="flex-between" style={{ flexWrap: "wrap", gap: 10 }}>
        <div>
          <div className="page-title">Delivery Planner</div>
          <div className="page-subtitle">
            Real addresses, real road distances. Choose an area, a pickup point and your delivery addresses; the app finds the best order.
          </div>
        </div>
        <div className="flex-row" style={{ gap: 8 }}>
          <button className="btn btn-outline" onClick={checkServices} disabled={svcBusy}>
            {svcBusy ? "Checking…" : "Check search & routing services"}
          </button>
          <button
            className="btn btn-outline"
            onClick={() => {
              if (window.confirm("Clear the area, pickup, stops and route?")) {
                resetAll();
                setPin(null);
                setAreaResults([]);
                setAreaMsg(null);
              }
            }}
          >
            Start over
          </button>
        </div>
      </div>

      {svc && (
        <div className="card section-gap" style={{ fontSize: 14 }}>
          {svc.error ? (
            <span>{svc.error}</span>
          ) : (
            <div className="flex-row" style={{ gap: 18, flexWrap: "wrap" }}>
              <span>
                Address search: <strong style={{ color: svc.geocoder.ok ? "var(--primary)" : "var(--danger)" }}>{svc.geocoder.ok ? `OK (${svc.geocoder.ms} ms)` : `Not reachable: ${svc.geocoder.message}`}</strong>
              </span>
              <span>
                Road routing: <strong style={{ color: svc.routing.ok ? "var(--primary)" : "var(--danger)" }}>{svc.routing.ok ? `OK (${svc.routing.ms} ms)` : `Not reachable: ${svc.routing.message}`}</strong>
              </span>
            </div>
          )}
        </div>
      )}

      {error && <div className="error-box section-gap">{error}</div>}
      {notice && <div className="card section-gap" style={{ borderColor: "var(--warn)" }}>{notice}</div>}

      {/* ---------- 1. delivery area ---------- */}
      <div className="card section-gap">
        <div className="card-title">1 · Delivery area</div>
        <form onSubmit={findArea} className="flex-row" style={{ flexWrap: "wrap", gap: 10, alignItems: "flex-end" }}>
          <div className="field" style={{ marginBottom: 0, minWidth: 160 }}>
            <label>State</label>
            <input value={stateName} onChange={(e) => setStateName(e.target.value)} placeholder="your state" />
          </div>
          <div className="field" style={{ marginBottom: 0, minWidth: 160 }}>
            <label>City</label>
            <input value={cityName} onChange={(e) => setCityName(e.target.value)} placeholder="your city" />
          </div>
          <div className="field" style={{ marginBottom: 0, minWidth: 200 }}>
            <label>Locality / neighbourhood</label>
            <input value={locality} onChange={(e) => setLocality(e.target.value)} placeholder="your locality or neighbourhood" />
          </div>
          <button className="btn btn-primary" type="submit" disabled={areaBusy}>
            {areaBusy ? "Searching…" : "Find area"}
          </button>
        </form>
        {areaMsg && <div className="muted" style={{ marginTop: 10 }}>{areaMsg}</div>}
        {areaResults.length > 0 && (
          <div className="search-results">
            {areaResults.map((r) => (
              <div key={r.placeId} className="search-result" onMouseEnter={() => setPreview(r)} onMouseLeave={() => setPreview(null)}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{r.name}</div>
                  <div className="muted" style={{ fontSize: 12 }}>{r.displayName}</div>
                </div>
                <button className="btn btn-accent" onClick={() => useArea(r)}>Use this area</button>
              </div>
            ))}
          </div>
        )}
        <div className="field" style={{ marginTop: 16, marginBottom: 0, maxWidth: 520 }}>
          <label>Delivery zone radius: {zoneRadiusKm} km (measured around the pickup point)</label>
          <input type="range" min="0.5" max="10" step="0.5" value={zoneRadiusKm} onChange={(e) => setZoneRadiusKm(Number(e.target.value))} />
        </div>
      </div>

      {/* ---------- 2. pickup ---------- */}
      <div className="card section-gap">
        <div className="card-title">2 · Pickup point (warehouse, shop or pickup location)</div>
        {pickup ? (
          <div className="flex-between" style={{ flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
            <div>
              <div style={{ fontWeight: 700 }}>{pickup.name}</div>
              <div className="muted" style={{ fontSize: 13 }}>{pickup.address}</div>
              <div style={{ marginTop: 4, display: "flex", gap: 8, alignItems: "center" }}>
                <VerificationBadge status={pickup.verification} />
                <span className="muted" style={{ fontSize: 12 }}>{pickup.lat.toFixed(5)}, {pickup.lng.toFixed(5)}</span>
              </div>
            </div>
            <button className="btn btn-outline" onClick={() => setPickup(null)}>Change pickup</button>
          </div>
        ) : (
          <p className="muted" style={{ marginTop: 0 }}>
            Search the pickup address below, or click its spot on the map and choose “Set as pickup point”.
          </p>
        )}
        {!pickup && (
          <PlaceSearch
            bias={bias}
            onPreview={setPreview}
            actions={[
              { label: "Set as pickup", primary: true, onClick: setResultAsPickup },
              { label: "Adjust pin", onClick: adjustResultPin },
            ]}
          />
        )}
      </div>

      {/* ---------- 3. destinations ---------- */}
      <div className="card section-gap">
        <div className="card-title">3 · Delivery addresses</div>
        <p className="muted" style={{ marginTop: 0 }}>
          Search a house number + street, apartment, shop, landmark, road or PIN code. Only places inside the {zoneRadiusKm} km zone can be added.
          If an address is not found, click the exact spot on the map and drag the pin.
        </p>
        <PlaceSearch
          bias={bias}
          zoneRadiusKm={pickup ? zoneRadiusKm : undefined}
          onPreview={setPreview}
          actions={[
            {
              label: "Add as stop",
              primary: true,
              onClick: addResultAsStop,
              disabled: (r) => !pickup || haversineKm(pickup, r) > zoneRadiusKm,
            },
            { label: "Adjust pin", onClick: adjustResultPin },
          ]}
        />
        {!pickup && <div className="muted" style={{ marginTop: 8 }}>Set the pickup point first.</div>}
      </div>

      {/* ---------- map + pin editor ---------- */}
      <div className="grid section-gap" style={{ gridTemplateColumns: "2fr 1fr", alignItems: "start" }}>
        <PlanMap
          pickup={pickup}
          zone={pickup ? { lat: pickup.lat, lng: pickup.lng, radiusKm: zoneRadiusKm } : null}
          markers={markers}
          routes={routes}
          pin={pin}
          onPinMove={movePin}
          onMapClick={onMapClick}
          preview={preview}
          focus={focus}
          fitKey={fitKey}
          height={560}
        />

        <div className="card">
          <div className="card-title">{pin ? (pin.editingId ? "Move this stop’s pin" : "Place a destination") : "Map pin"}</div>
          {!pin && (
            <p className="muted" style={{ marginTop: 0 }}>
              Click anywhere on the map to drop a pin. Drag it to the exact doorway or gate, then name it and save it as the pickup or as a delivery stop.
            </p>
          )}
          {pin && (
            <>
              <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
                {pin.lat.toFixed(6)}, {pin.lng.toFixed(6)} · <VerificationBadge status={pin.verification} />
              </div>
              {pin.suggestion && (
                <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
                  OpenStreetMap says this spot is near: {pin.suggestion.displayName}{" "}
                  <button className="btn btn-outline" style={{ padding: "2px 8px" }} onClick={() => setPin((p) => ({ ...p, name: p.name || pin.suggestion.name, address: p.address || pin.suggestion.displayName }))}>
                    Use as address
                  </button>
                </div>
              )}
              {pin.suggestionNote && <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>{pin.suggestionNote}</div>}
              <div className="field">
                <label>Recipient or shop name</label>
                <input value={pin.name} onChange={(e) => setPin({ ...pin, name: e.target.value })} placeholder="e.g. Ravi, Flat 3B" />
              </div>
              <div className="field">
                <label>Address (type it if you know it)</label>
                <input value={pin.address} onChange={(e) => setPin({ ...pin, address: e.target.value })} placeholder="House no., street, apartment, PIN" />
              </div>
              <div className="field">
                <label>Landmark (optional)</label>
                <input value={pin.landmark} onChange={(e) => setPin({ ...pin, landmark: e.target.value })} placeholder="e.g. opposite the temple" />
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button className="btn btn-accent" onClick={savePinAsStop}>{pin.editingId ? "Save new position" : "Add as delivery stop"}</button>
                {!pin.editingId && <button className="btn btn-outline" onClick={savePinAsPickup}>Set as pickup point</button>}
                <button className="btn btn-outline" onClick={() => setPin(null)}>Cancel</button>
              </div>
            </>
          )}
          <p className="muted" style={{ fontSize: 11, marginTop: 14 }}>
            Map data © OpenStreetMap contributors. Search by Nominatim. Routes by OSRM.
          </p>
        </div>
      </div>

      {/* ---------- stop list ---------- */}
      <div className="card section-gap">
        <div className="flex-between" style={{ flexWrap: "wrap", gap: 10 }}>
          <div className="card-title" style={{ margin: 0 }}>Delivery stops ({stops.length})</div>
          {stops.length > 0 && (
            <button className="btn btn-outline" onClick={() => window.confirm("Remove all stops?") && clearStops()}>Remove all</button>
          )}
        </div>
        {stops.length === 0 && <p className="muted">No stops yet. Add addresses above, or click the map.</p>}
        {stops.map((s, i) => (
          <div key={s.id} className="stop-card">
            <div className="flex-between" style={{ gap: 10, flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <span className="stop-num">{i + 1}</span>
                <input className="inline-input" style={{ fontWeight: 700, minWidth: 200 }} value={s.name} onChange={(e) => updateStop(s.id, { name: e.target.value })} aria-label="Stop name" />
                <VerificationBadge status={s.verification} />
                {(warningsById[s.id] || []).map((w) => (
                  <span key={w.text} className="badge badge-danger">{w.text}</span>
                ))}
              </div>
              <div className="flex-row" style={{ gap: 6 }}>
                <button className="btn btn-outline" onClick={() => moveStop(s.id, -1)} disabled={i === 0} title="Move up">▲</button>
                <button className="btn btn-outline" onClick={() => moveStop(s.id, 1)} disabled={i === stops.length - 1} title="Move down">▼</button>
                <button className="btn btn-outline" onClick={() => editStopPin(s)}>Move pin</button>
                <button className="btn btn-danger" onClick={() => removeStop(s.id)}>Remove</button>
              </div>
            </div>
            <div className="grid grid-3" style={{ marginTop: 10, gap: 10 }}>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Address</label>
                <input value={s.address} onChange={(e) => updateStop(s.id, { address: e.target.value })} />
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Landmark</label>
                <input value={s.landmark || ""} onChange={(e) => updateStop(s.id, { landmark: e.target.value })} />
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Package details (optional)</label>
                <input value={s.package || ""} onChange={(e) => updateStop(s.id, { package: e.target.value })} placeholder="e.g. 2 boxes, fragile" />
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Priority</label>
                <select value={s.priority} onChange={(e) => updateStop(s.id, { priority: e.target.value })}>
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                </select>
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Deliver from (optional)</label>
                <input type="time" value={(s.timeWindow && s.timeWindow.from) || ""} onChange={(e) => updateStop(s.id, { timeWindow: { ...(s.timeWindow || {}), from: e.target.value } })} />
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Deliver until (optional)</label>
                <input type="time" value={(s.timeWindow && s.timeWindow.to) || ""} onChange={(e) => updateStop(s.id, { timeWindow: { ...(s.timeWindow || {}), to: e.target.value } })} />
              </div>
            </div>
            <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>{s.lat.toFixed(6)}, {s.lng.toFixed(6)}</div>
          </div>
        ))}
        {stops.length > 0 && (
          <p className="muted" style={{ fontSize: 12 }}>
            Priority, time windows and package details are saved with each stop and shown to the delivery agent. The optimizer currently minimises distance or time only; it does not enforce time windows or priorities.
          </p>
        )}
      </div>

      {/* ---------- 4. optimize ---------- */}
      <div className="card section-gap">
        <div className="card-title">4 · Route options</div>
        <div className="grid grid-2" style={{ gap: 20 }}>
          <div>
            <label className="muted" style={{ display: "block", marginBottom: 6 }}>Route policy</label>
            <label className="radio-row">
              <input type="radio" name="policy" checked={policy === "return"} onChange={() => setPolicy("return")} />
              <span><strong>Return to pickup</strong>: start at the pickup, visit every stop, drive back to the pickup.</span>
            </label>
            <label className="radio-row">
              <input type="radio" name="policy" checked={policy === "open"} onChange={() => setPolicy("open")} />
              <span><strong>Open route</strong>: start at the pickup and finish at the last delivery.</span>
            </label>
          </div>
          <div>
            <label className="muted" style={{ display: "block", marginBottom: 6 }}>Minimise</label>
            <label className="radio-row">
              <input type="radio" name="objective" checked={objective === "distance"} onChange={() => setObjective("distance")} />
              <span><strong>Road distance</strong></span>
            </label>
            <label className="radio-row">
              <input type="radio" name="objective" checked={objective === "duration"} onChange={() => setObjective("duration")} />
              <span><strong>Estimated travel time</strong></span>
            </label>
          </div>
        </div>

        <div className="flex-row" style={{ marginTop: 16, gap: 12, flexWrap: "wrap" }}>
          <button className="btn btn-primary" onClick={optimize} disabled={!canOptimize}>
            {busy ? "Calculating road routes…" : "Find best delivery order"}
          </button>
          {!pickup && <span className="muted">Set a pickup point.</span>}
          {pickup && stops.length === 0 && <span className="muted">Add at least one stop.</span>}
          {outsideZone.length > 0 && (
            <span style={{ color: "var(--danger)" }}>
              Remove or move the stops outside the zone: {outsideZone.map((s) => s.name).join(", ")}.
            </span>
          )}
        </div>
      </div>

      {/* ---------- 5. results ---------- */}
      {result && (
        <div className="card section-gap">
          <div className="flex-between" style={{ flexWrap: "wrap", gap: 10 }}>
            <div className="card-title" style={{ margin: 0 }}>
              Result · {result.policy === "open" ? "Open route (ends at the last stop)" : "Return-to-pickup route"} · minimising {result.objective === "duration" ? "travel time" : "road distance"}
            </div>
            {resultStale && <span className="badge badge-danger">Out of date: the pickup, stops or options changed. Calculate again.</span>}
          </div>

          <div className="grid grid-4 section-gap">
            <div>
              <div className="muted">Total road distance</div>
              <div style={{ fontWeight: 700, fontSize: 24 }}>{result.optimized.distanceKm} km</div>
            </div>
            <div>
              <div className="muted">Estimated travel time</div>
              <div style={{ fontWeight: 700, fontSize: 24 }}>{fmtMin(result.optimized.durationS)}</div>
              <div className="muted" style={{ fontSize: 11 }}>An estimate from road speeds, not a guaranteed arrival time</div>
            </div>
            <div>
              <div className="muted">Stops</div>
              <div style={{ fontWeight: 700, fontSize: 24 }}>{result.stops}</div>
            </div>
            <div>
              <div className="muted">Algorithm</div>
              <div style={{ marginTop: 4 }}>
                <span className={`badge ${result.algorithm.optimal ? "badge-delivered" : "badge-pending"}`}>
                  {result.algorithm.optimal ? "Exact · optimal" : "Heuristic · not guaranteed optimal"}
                </span>
              </div>
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{result.algorithm.name} · {Number(result.algorithm.computeTimeMs).toFixed(2)} ms</div>
            </div>
          </div>

          <p className="muted" style={{ marginBottom: 0 }}>{result.algorithm.explanation}</p>

          {result.warnings.length > 0 && (
            <div className="section-gap">
              {result.warnings.map((w, i) => (
                <div key={i} className="warn-line">⚠ {w.message}</div>
              ))}
            </div>
          )}

          {/* original vs optimized */}
          <div className="section-gap">
            <div className="flex-between" style={{ flexWrap: "wrap", gap: 10 }}>
              <div className="card-title" style={{ margin: 0 }}>Entered order vs optimized order (road distances)</div>
              <label className="radio-row" style={{ margin: 0 }}>
                <input type="checkbox" checked={showOriginal} onChange={(e) => setShowOriginal(e.target.checked)} />
                <span>Show the entered order on the map (dashed grey)</span>
              </label>
            </div>
            <div className="table-scroll">
              <table className="data-table" style={{ marginTop: 10 }}>
                <thead>
                  <tr><th>Order</th><th className="num">Road distance</th><th className="num">Est. time</th><th>Visits stops in this order</th></tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Entered order (your list)</td>
                    <td className="num">{(result.original.distanceM / 1000).toFixed(2)} km</td>
                    <td className="num">{fmtMin(result.original.durationS)}</td>
                    <td>{result.original.order.map((id) => entryIndex[id] || "?").join(" → ")}</td>
                  </tr>
                  <tr>
                    <td>Nearest Neighbor (greedy)</td>
                    <td className="num">{(result.comparison.nearestNeighbor.distanceM / 1000).toFixed(2)} km</td>
                    <td className="num">{fmtMin(result.comparison.nearestNeighbor.durationS)}</td>
                    <td>{result.comparison.nearestNeighbor.order.map((id) => entryIndex[id] || "?").join(" → ")}</td>
                  </tr>
                  <tr>
                    <td>Nearest Neighbor + 2-opt</td>
                    <td className="num">{(result.comparison.twoOpt.distanceM / 1000).toFixed(2)} km</td>
                    <td className="num">{fmtMin(result.comparison.twoOpt.durationS)}</td>
                    <td>{result.comparison.twoOpt.order.map((id) => entryIndex[id] || "?").join(" → ")}</td>
                  </tr>
                  <tr className="row-nearest">
                    <td><strong>Optimized ({result.algorithm.optimal ? "exact DP" : "heuristic"})</strong></td>
                    <td className="num"><strong>{result.optimized.distanceKm} km</strong></td>
                    <td className="num"><strong>{fmtMin(result.optimized.durationS)}</strong></td>
                    <td><strong>{result.optimized.order.map((id) => entryIndex[id] || "?").join(" → ")}</strong></td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="muted" style={{ marginBottom: 0 }}>
              {result.comparison.savedDistanceM > 0
                ? `The optimized order is ${(result.comparison.savedDistanceM / 1000).toFixed(2)} km (${result.comparison.savedDistancePct}%) shorter than the order you entered.`
                : "Your entered order was already as short as the optimized one."}{" "}
              Numbers in the last column are the stop numbers from your list.
            </p>
          </div>

          {/* leg table */}
          <div className="section-gap">
            <div className="card-title">Stop-by-stop route</div>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr><th>Leg</th><th>From</th><th>To</th><th>Your #</th><th>Location check</th><th className="num">Distance</th><th className="num">Time</th><th className="num">Total so far</th></tr>
                </thead>
                <tbody>
                  {result.optimized.legs.map((l, i) => {
                    const to = result.optimized.sequence[i + 1];
                    return (
                      <tr key={l.leg}>
                        <td>{l.leg}</td>
                        <td>{l.from}</td>
                        <td>
                          <strong>{to.kind === "stop" ? `${orderIndex ? orderIndex[to.id] : ""}. ` : ""}{l.to}</strong>
                          <div className="muted" style={{ fontSize: 12 }}>{to.address}</div>
                        </td>
                        <td>{to.kind === "stop" ? entryIndex[to.id] : "—"}</td>
                        <td>{to.verification ? <VerificationBadge status={to.verification} /> : "—"}</td>
                        <td className="num"><strong>{fmtKm(l.distanceM)}</strong></td>
                        <td className="num">{fmtMin(l.durationS)}</td>
                        <td className="num">{fmtKm(l.cumulativeM)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="muted" style={{ fontSize: 12 }}>
              Totals are the sum of these road legs. {result.distanceSource}. {result.durationNote}
            </p>
          </div>

          {/* cost */}
          <div className="section-gap">
            <div className="card-title">Delivery cost estimate</div>
            {costs ? (
              <CostSummary cost={costs.opt} compareCost={costs.orig} mode={costMode} setMode={setCostMode} />
            ) : (
              <p className="muted">Calculating cost…</p>
            )}
            <div style={{ marginTop: 12 }}>
              <CostAssumptions costConfig={costConfig} setCostConfig={setCostConfig} />
            </div>
          </div>

          <div className="flex-row section-gap" style={{ gap: 10, flexWrap: "wrap" }}>
            <button className="btn btn-primary" onClick={startDelivery} disabled={resultStale}>Start delivery (agent mode)</button>
            <button className="btn btn-outline" onClick={sendToClassic} disabled={busy}>Split between several agents (straight-line tool)</button>
          </div>
          <p className="muted" style={{ fontSize: 11 }}>{result.attribution}</p>
        </div>
      )}
    </div>
  );
}
