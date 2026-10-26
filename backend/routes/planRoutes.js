const express = require("express");
const router = express.Router();
const c = require("../controllers/planController");
router.post("/optimize", c.optimize);
router.post("/recalculate", c.recalculate);
module.exports = router;
