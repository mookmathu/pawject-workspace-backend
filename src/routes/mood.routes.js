const express = require("express");
const requireAuth = require("../middleware/requireAuth");
const { listMood, saveMood, deleteMood, getMoodImage } = require("../controllers/mood.controller");
const { uploadAvatar } = require("../lib/upload");

const router = express.Router();

// Everything here is private to the signed-in user — there is deliberately
// no way to read someone else's mood.
router.get("/", requireAuth, listMood);
router.get("/:day/image", requireAuth, getMoodImage);
router.put("/:day", requireAuth, uploadAvatar.single("image"), saveMood);
router.delete("/:day", requireAuth, deleteMood);

module.exports = router;
