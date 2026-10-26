const express = require("express");
const router = express.Router();
const deliveryController = require("../controllers/deliveryController");

router.get("/", deliveryController.getAll);
router.patch("/:locationId", deliveryController.updateStatus);

module.exports = router;
