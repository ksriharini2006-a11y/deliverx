const express = require("express");
const router = express.Router();
const locationController = require("../controllers/locationController");

router.get("/", locationController.getAll);
router.post("/", locationController.create);
router.delete("/:id", locationController.remove);
router.post("/new-area", locationController.newArea); // start a custom area from any place

module.exports = router;
