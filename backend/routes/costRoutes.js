const express = require("express");
const router = express.Router();
const c = require("../controllers/costController");
router.post("/estimate", c.estimate);
module.exports = router;
