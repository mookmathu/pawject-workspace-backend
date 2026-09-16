const express = require("express");
const requireAuth = require("../middleware/requireAuth");
const { getEvents, createEvent, updateEvent, deleteEvent } = require("../controllers/event.controller");

const router = express.Router();

router.get("/", requireAuth, getEvents);
router.post("/", requireAuth, createEvent);
router.patch("/:eventId", requireAuth, updateEvent);
router.delete("/:eventId", requireAuth, deleteEvent);

module.exports = router;
