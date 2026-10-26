/*
 * PlanMap.jsx
 * -----------------------------------------------------------------------
 * The map used by the Delivery Planner and the Delivery Agent screens.
 * Leaflet + OpenStreetMap tiles (no API key). It draws:
 *   - the pickup point (green "P")
 *   - numbered delivery stops, coloured by state:
 *       pending (blue), next (amber, bigger), done (grey tick), skipped (red dash)
 *   - the delivery zone (a circle around the pickup)
 *   - ROAD-FOLLOWING route lines (geometry returned by the routing service),
 *     optionally a dashed second line for the original order
 *   - one draggable pin for placing / correcting a destination by hand
 *   - a preview marker while hovering a search result
 *
 * The map does not re-fit while you pan or zoom; it only re-fits when the
 * `fitKey` prop changes (e.g. after a new route is calculated).
 * -----------------------------------------------------------------------
 */

import React, { useEffect } from "react";
import { MapContainer, TileLayer, Marker, Polyline, Circle, Popup, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";

const STATE_STYLE = {
  plain: { bg: "#6c8cff", fg: "#ffffff", size: 30 },
  pending: { bg: "#6c8cff", fg: "#ffffff", size: 30 },
  next: { bg: "#f5b942", fg: "#1b1b1b", size: 40 },
  done: { bg: "#5b6577", fg: "#e8edf5", size: 28 },
  skipped: { bg: "#ff6b6b", fg: "#1b1b1b", size: 28 },
};

function divIcon(text, { bg, fg, size, ring }) {
  return new L.DivIcon({
    html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${bg};color:${fg};
      display:flex;align-items:center;justify-content:center;font:700 ${Math.round(size * 0.45)}px 'Segoe UI',Arial,sans-serif;
      border:2px solid ${ring || "#ffffff"};box-shadow:0 0 8px rgba(0,0,0,.55)">${text}</div>`,
    className: "",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

const pickupIcon = divIcon("P", { bg: "#34d399", fg: "#0a0f1c", size: 38, ring: "#ffffff" });
const agentIcon = new L.DivIcon({
  html: '<div style="font-size:26px;line-height:26px;filter:drop-shadow(0 0 4px #000)">🚚</div>',
  className: "",
  iconSize: [26, 26],
  iconAnchor: [13, 13],
});
const pinIcon = new L.Icon({
  iconUrl: "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

function markerIcon(m) {
  const s = STATE_STYLE[m.state] || STATE_STYLE.plain;
  const text = m.state === "done" ? "✓" : m.state === "skipped" ? "–" : m.label;
  return divIcon(text, s);
}


function FitOnKey({ fitKey, points, zone }) {
  const map = useMap();

  useEffect(() => {
    const all = [...points];
    let bounds = null;

    if (zone && zone.radiusKm > 0) {
      const center = L.latLng(zone.lat, zone.lng);
      const radius = zone.radiusKm * 1000;

      const southWest = map.options.crs
        ? map.options.crs
        : L.CRS.EPSG3857;

      const circleBounds = L.latLngBounds(
        center.toBounds(radius).getSouthWest(),
        center.toBounds(radius).getNorthEast()
      );

      bounds = circleBounds;
    }

    if (all.length > 0) {
      const pointBounds = L.latLngBounds(all);
      bounds = bounds ? bounds.extend(pointBounds) : pointBounds;
    }

    if (!bounds || !bounds.isValid()) return;

    if (bounds.getNorthEast().equals(bounds.getSouthWest())) {
      map.setView(bounds.getCenter(), 16);
    } else {
      map.fitBounds(bounds, {
        padding: [40, 40],
        maxZoom: 17,
      });
    }
  }, [map, fitKey, points, zone]);

  return null;
}


function Focus({ focus }) {
  const map = useMap();
  useEffect(() => {
    if (focus) map.setView([focus.lat, focus.lng], focus.zoom || 15);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus && focus.key]);
  return null;
}

function Clicks({ onMapClick }) {
  useMapEvents({
    click(e) {
      if (onMapClick) onMapClick({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
  });
  return null;
}

export default function PlanMap({
  pickup = null,
  zone = null, // { lat, lng, radiusKm }
  markers = [], // [{ id, lat, lng, label, state, name, address }]
  routes = [], // [{ geometry: [[lat,lng],...], color, dashed, weight, opacity }]
  pin = null, // { lat, lng }
  onPinMove = null,
  onMapClick = null,
  preview = null, // { lat, lng, name }
  agentPos = null,
  focus = null, // { lat, lng, zoom, key }
  fitKey = 0,
  height = 520,
}) {
  const fitPoints = [];
  if (pickup) fitPoints.push([pickup.lat, pickup.lng]);
  markers.forEach((m) => fitPoints.push([m.lat, m.lng]));
  routes.forEach((r) => r.geometry && r.geometry.forEach((p) => fitPoints.push(p)));

  return (
    <div className="map-container" style={{ height }}>
      <MapContainer center={[20.5937, 78.9629]} zoom={5} style={{ height: "100%", width: "100%" }} scrollWheelZoom maxZoom={19}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxZoom={19}
        />
        <Clicks onMapClick={onMapClick} />
        <FitOnKey fitKey={fitKey} points={fitPoints} zone={zone} />
        <Focus focus={focus} />

        {zone && zone.radiusKm > 0 && (
          <Circle
            center={[zone.lat, zone.lng]}
            radius={zone.radiusKm * 1000}
            pathOptions={{ color: "#34d399", weight: 2, dashArray: "6 8", fillColor: "#34d399", fillOpacity: 0.05 }}
            interactive={false}
          />
        )}

        {routes.map((r, i) =>
          r.geometry && r.geometry.length > 1 ? (
            <Polyline
              key={`route-${i}`}
              positions={r.geometry}
              pathOptions={{
                color: r.color || "#34d399",
                weight: r.weight || 5,
                opacity: r.opacity || 0.9,
                dashArray: r.dashed ? "8 10" : undefined,
              }}
              interactive={false}
            />
          ) : null
        )}

        {pickup && (
          <Marker position={[pickup.lat, pickup.lng]} icon={pickupIcon}>
            <Popup>
              <strong>Pickup point</strong>
              <br />
              {pickup.name}
              <br />
              {pickup.address}
            </Popup>
          </Marker>
        )}

        {markers.map((m) => (
          <Marker key={m.id} position={[m.lat, m.lng]} icon={markerIcon(m)} zIndexOffset={m.state === "next" ? 500 : 0}>
            <Popup>
              <strong>
                {m.label}. {m.name}
              </strong>
              <br />
              {m.address}
            </Popup>
          </Marker>
        ))}

        {agentPos && <Marker position={[agentPos.lat, agentPos.lng]} icon={agentIcon} zIndexOffset={900} />}

        {preview && (
          <Marker position={[preview.lat, preview.lng]} icon={divIcon("?", { bg: "#ffffff", fg: "#0a0f1c", size: 30, ring: "#6c8cff" })} />
        )}

        {pin && (
          <Marker
            position={[pin.lat, pin.lng]}
            icon={pinIcon}
            draggable={!!onPinMove}
            zIndexOffset={1000}
            eventHandlers={{
              dragend: (e) => {
                const p = e.target.getLatLng();
                if (onPinMove) onPinMove(p.lat, p.lng);
              },
            }}
          />
        )}
      </MapContainer>
    </div>
  );
}
