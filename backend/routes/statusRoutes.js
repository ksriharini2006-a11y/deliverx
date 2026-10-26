const express = require("express");
const router = express.Router();
const c = require("../controllers/statusController");
router.get("/services", c.services);
router.get("/config", c.publicConfig);
module.exports = router;
