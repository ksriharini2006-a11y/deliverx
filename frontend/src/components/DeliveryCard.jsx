import React from "react";

const badgeClass = {
  Pending: "badge-pending",
  "On the way": "badge-ontheway",
  Delivered: "badge-delivered",
};

export default function DeliveryCard({ delivery }) {
  return (
    <div className="delivery-card">
      <div>
        <div style={{ fontWeight: 700 }}>Order #{delivery.id}</div>
        <div className="muted">Customer: {delivery.customer}</div>
      </div>
      <span className={`badge ${badgeClass[delivery.status] || "badge-pending"}`}>
        {delivery.status}
      </span>
    </div>
  );
}
