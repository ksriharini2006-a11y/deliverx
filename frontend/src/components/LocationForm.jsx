import React, { useState } from "react";

export default function LocationForm({ onAdd }) {
  const [form, setForm] = useState({ name: "", address: "", lat: "", lng: "" });
  const [submitting, setSubmitting] = useState(false);

  const update = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name || form.lat === "" || form.lng === "") return;
    setSubmitting(true);
    await onAdd({
      name: form.name,
      address: form.address,
      lat: parseFloat(form.lat),
      lng: parseFloat(form.lng),
    });
    setForm({ name: "", address: "", lat: "", lng: "" });
    setSubmitting(false);
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="field">
        <label>Location Name</label>
        <input value={form.name} onChange={update("name")} placeholder="e.g. Shop or customer name" required />
      </div>
      <div className="field">
        <label>Address</label>
        <input value={form.address} onChange={update("address")} placeholder="Street, area, city" />
      </div>
      <div className="grid grid-2">
        <div className="field">
          <label>Latitude</label>
          <input value={form.lat} onChange={update("lat")} placeholder="Latitude, e.g. 12.9000" required />
        </div>
        <div className="field">
          <label>Longitude</label>
          <input value={form.lng} onChange={update("lng")} placeholder="Longitude, e.g. 80.1000" required />
        </div>
      </div>
      <button className="btn btn-primary" type="submit" disabled={submitting} style={{ width: "100%" }}>
        {submitting ? "Adding..." : "+ Add Location"}
      </button>
    </form>
  );
}
