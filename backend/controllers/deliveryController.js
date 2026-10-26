const store = require("../data/store");

// GET /api/deliveries
function getAll(req, res) {
  res.json({ deliveries: store.getDeliveries() });
}

// PATCH /api/deliveries/:locationId  body: { status }
function updateStatus(req, res) {
  const { status } = req.body;
  const allowed = ["Pending", "On the way", "Delivered"];
  if (!allowed.includes(status)) {
    return res.status(400).json({ error: `status must be one of ${allowed.join(", ")}` });
  }
  store.updateDeliveryStatus(req.params.locationId, status);
  res.json({ deliveries: store.getDeliveries() });
}

module.exports = { getAll, updateStatus };
