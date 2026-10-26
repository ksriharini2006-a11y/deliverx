/*
 * server.js
 * -----------------------------------------------------------------------
 * Entry point for the backend. Wires up:
 *   /api/locations  -> locationRoutes.js
 *   /api/route      -> routeRoutes.js   (this is where C++ gets called)
 *   /api/ev         -> evRoutes.js
 *   /api/deliveries -> deliveryRoutes.js
 *   /api/geocode    -> geocodeRoutes.js  (real address search, Nominatim)
 *   /api/plan       -> planRoutes.js     (road-network optimization, OSRM + C++)
 *   /api/cost       -> costRoutes.js     (standard vs EV, configurable rates)
 *   /api/status     -> statusRoutes.js   (service health + public config)
 *
 * Run with:  npm install   (first time only)
 *            npm start
 * -----------------------------------------------------------------------
 */

// Real-service features use Node's built-in fetch (Node 18 or newer).
if (typeof fetch !== "function") {
  console.error("This project needs Node.js 18 or newer (for fetch). Your version: " + process.version);
  process.exit(1);
}

const express = require("express");
const cors = require("cors");

const locationRoutes = require("./routes/locationRoutes");
const routeRoutes = require("./routes/routeRoutes");
const evRoutes = require("./routes/evRoutes");
const deliveryRoutes = require("./routes/deliveryRoutes");
const geocodeRoutes = require("./routes/geocodeRoutes");
const planRoutes = require("./routes/planRoutes");
const costRoutes = require("./routes/costRoutes");
const statusRoutes = require("./routes/statusRoutes");

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json({ limit: "1mb" }));

// simple request log — helpful while demoing/debugging
app.use((req, res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", message: "Smart Delivery Optimizer API is running" });
});

app.use("/api/locations", locationRoutes);
app.use("/api/route", routeRoutes);
app.use("/api/ev", evRoutes);
app.use("/api/deliveries", deliveryRoutes);
app.use("/api/geocode", geocodeRoutes);
app.use("/api/plan", planRoutes);
app.use("/api/cost", costRoutes);
app.use("/api/status", statusRoutes);

app.use((req, res) => {
  res.status(404).json({ error: `No route for ${req.method} ${req.url}` });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Smart Delivery Optimizer API listening on http://localhost:${PORT}`);
  });
}

module.exports = app; // exported so the automated tests can start it on a free port
