import React, { useEffect } from "react";
import { Link } from "react-router-dom";
import { useAppData } from "../hooks/AppDataContext";
import MapView from "../components/MapView";
import LocationForm from "../components/LocationForm";

export default function Locations() {
  const { locations, loading, error, refreshLocations, addLocation, removeLocation } = useAppData();

  useEffect(() => {
    refreshLocations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <div className="flex-between">
        <div>
          <div className="page-title">Delivery Locations</div>
          <div className="page-subtitle">Add or remove stops by typing coordinates. The first place you add becomes the hub.</div>
        </div>
        <Link className="btn btn-outline" to="/delivery-planner">
          Search addresses in the Delivery Planner
        </Link>
      </div>

      {error && <div className="error-box">{error}</div>}

      <div className="grid section-gap" style={{ gridTemplateColumns: "1fr 1.4fr" }}>
        <div className="card">
          <div className="card-title">Add Location</div>
          <LocationForm onAdd={addLocation} />
        </div>

        <div className="card">
          <div className="card-title">All Locations ({locations.length})</div>
          {locations.length === 0 && <p className="muted">No locations yet. Add one here, or use the Delivery Planner to search real addresses.</p>}
          {locations.map((loc) => (
            <div key={loc.id} className="delivery-card">
              <div>
                <div style={{ fontWeight: 700 }}>
                  {loc.name} {loc.isHub && <span className="badge badge-delivered" style={{ marginLeft: 6 }}>Hub</span>}
                </div>
                <div className="muted">{loc.address || `${loc.lat}, ${loc.lng}`}</div>
              </div>
              {!loc.isHub && (
                <button className="btn btn-danger" onClick={() => removeLocation(loc.id)}>
                  Delete
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="section-gap">
        <MapView locations={locations} height={420} />
      </div>
    </div>
  );
}
