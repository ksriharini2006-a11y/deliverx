const express = require("express");
const router = express.Router();
const c = require("../controllers/geocodeController");
router.get("/search", c.search);
router.get("/reverse", c.reverse);
module.exports = router;
