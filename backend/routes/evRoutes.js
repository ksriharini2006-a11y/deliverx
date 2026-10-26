const express = require("express");
const router = express.Router();
const evController = require("../controllers/evController");

router.post("/calculate", evController.calculate);

module.exports = router;
