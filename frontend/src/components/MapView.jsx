/*
 * MapView.jsx
 * -----------------------------------------------------------------------
 * The interactive map. Renders:
 *   - a hub marker (green)
 *   - customer/delivery markers (blue, numbered by stop order if a route
 *     is provided)
 *   - an optional agent marker (for Live Tracking simulation)
 *   - an optional polyline connecting the route in order
 *
 * Uses react-leaflet + OpenStreetMap tiles (free, no API key needed —
 * matches project requirement #4/#9).
 * -----------------------------------------------------------------------
 */

import React from "react";
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";

// Leaflet's default marker icons don't load correctly with bundlers unless
// we point them at CDN URLs explicitly.
const hubIcon = new L.Icon({
  iconUrl: "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [28, 46],
  iconAnchor: [14, 46],
  className: "hub-marker-icon",
});

const stopIcon = new L.Icon({
  iconUrl: "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [22, 36],
  iconAnchor: [11, 36],
});

const agentIcon = new L.DivIcon({
  html: '<div style="font-size:24px;line-height:24px;">🚚</div>',
  className: "",
  iconSize: [24, 24],
  iconAnchor: [12, 12],
});

// Builds a colored, glowing truck marker for a specific agent — used on the
// Multi-Agent Live Tracking view so each agent is visually distinct.
function createAgentColorIcon(color) {
  return new L.DivIcon({
    html: `<div style="
        background:${color};
        width:30px;height:30px;border-radius:50%;
        display:flex;align-items:center;justify-content:center;
        font-size:15px;border:2px solid #fff;
        box-shadow:0 0 10px 2px ${color}99;
      ">🚚</div>`,
    className: "",
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
}

function FitBounds({ points }) {
  const map = useMap();
  React.useEffect(() => {
    if (points && points.length === 1) {
      map.setView([points[0].lat, points[0].lng], 14);
    } else if (points && points.length > 1) {
      const bounds = L.latLngBounds(points.map((p) => [p.lat, p.lng]));
      map.fitBounds(bounds, { padding: [40, 40] });
    }
  }, [points, map]);
  return null;
}

// Reports map clicks to the parent (used by Area Planner to drop a new place).
function ClickCatcher({ onMapClick }) {
  useMapEvents({
    click(e) {
      if (onMapClick) onMapClick({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
  });
  return null;
}

// Distinct colors for each delivery agent's route on the multi-agent map.
export const AGENT_COLORS = [
  "#2f6b52", // teal-green
  "#3457d5", // indigo
  "#c98a1f", // amber
  "#8e44ad", // purple
  "#c0392b", // red
  "#16a085", // sea green
];

export default function MapView({
  locations = [],
  routeOrder = null,
  agentPosition = null,
  multiRoutes = null, // [{ route: [locationObjects], color }] for mTSP view
  agentPositions = null, // [{ lat, lng, color, label }] for multi-agent live tracking
  height = 480,
  onMapClick = null, // optional: ({lat, lng}) => void
  pendingPoint = null, // optional: {lat, lng} marker for a not-yet-added click
}) {
  const center = locations.length > 0 ? [locations[0].lat, locations[0].lng] : [20.5937, 78.9629];

  // routeOrder is a list of location objects already sorted in visit order
  const polylinePoints = routeOrder ? routeOrder.map((loc) => [loc.lat, loc.lng]) : null;

  return (
    <div className="map-container" style={{ height }}>
      <MapContainer center={center} zoom={locations.length > 0 ? 12 : 5} style={{ height: "100%", width: "100%" }} scrollWheelZoom={true}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {locations.map((loc) => (
          <Marker key={loc.id} position={[loc.lat, loc.lng]} icon={loc.isHub ? hubIcon : stopIcon}>
            <Popup>
              <strong>{loc.name}</strong>
              <br />
              {loc.isHub ? "Delivery Hub" : loc.address}
            </Popup>
          </Marker>
        ))}

        {polylinePoints && polylinePoints.length > 1 && (
          <Polyline positions={polylinePoints} pathOptions={{ color: "#2f6b52", weight: 4, opacity: 0.85 }} />
        )}

        {/* One polyline per delivery agent, each in its own colour */}
        {multiRoutes &&
          multiRoutes.map((ar, i) =>
            ar.route && ar.route.length > 1 ? (
              <Polyline
                key={`agent-${i}`}
                positions={ar.route.map((loc) => [loc.lat, loc.lng])}
                pathOptions={{
                  color: ar.color || AGENT_COLORS[i % AGENT_COLORS.length],
                  weight: 4,
                  opacity: 0.85,
                }}
              />
            ) : null
          )}

        {agentPosition && (
          <Marker position={[agentPosition.lat, agentPosition.lng]} icon={agentIcon}>
            <Popup>Delivery agent (live)</Popup>
          </Marker>
        )}

        {/* Multiple simultaneous agent trucks, each color-matched to its route */}
        {agentPositions &&
          agentPositions.map((ap, i) => (
            <Marker key={`agent-pos-${i}`} position={[ap.lat, ap.lng]} icon={createAgentColorIcon(ap.color)}>
              <Popup>{ap.label || `Agent ${i + 1}`}</Popup>
            </Marker>
          ))}

        {onMapClick && <ClickCatcher onMapClick={onMapClick} />}
        {pendingPoint && (
          <Marker position={[pendingPoint.lat, pendingPoint.lng]} icon={stopIcon}>
            <Popup>New place (not added yet)</Popup>
          </Marker>
        )}

        <FitBounds points={locations} />
      </MapContainer>
    </div>
  );
}
