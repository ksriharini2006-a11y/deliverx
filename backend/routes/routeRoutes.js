const express = require("express");
const router = express.Router();
const routeController = require("../controllers/routeController");

router.post("/optimize", routeController.optimize); // DP + Bitmask (optimal)
router.post("/greedy", routeController.greedy); // Nearest Neighbor
router.post("/compare", routeController.compare); // both, side by side
router.post("/multi-agent", routeController.multiAgent); // mTSP: split across N agents
router.post("/distances", routeController.distances); // distance from a chosen start to every other place

module.exports = router;
