/*
 * VerificationBadge.jsx - says HOW a location was obtained, so a rough match
 * is never shown as if it were an exact address.
 */
import React from "react";

export const VERIFICATION = {
  "geocoded-address": { text: "Verified address", cls: "badge-delivered", help: "Matched to a building, shop or house in OpenStreetMap" },
  "geocoded-street": { text: "Street-level", cls: "badge-pending", help: "Matched a road; the exact door is not known" },
  "geocoded-area": { text: "Area-level (approx.)", cls: "badge-danger", help: "Only a locality was matched; drop a pin for the exact spot" },
  "manual-pin": { text: "Manual pin", cls: "badge-ontheway", help: "Position chosen by you on the map" },
};

export default function VerificationBadge({ status }) {
  const v = VERIFICATION[status] || { text: "Unverified", cls: "badge-muted", help: "No verification information" };
  return (
    <span className={`badge ${v.cls}`} title={v.help}>
      {v.text}
    </span>
  );
}
