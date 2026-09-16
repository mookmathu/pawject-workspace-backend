const express = require("express");
const requireAuth = require("../middleware/requireAuth");
const { getMe, completeProfile } = require("../controllers/profile.controller");

const router = express.Router();

router.get("/me", requireAuth, getMe);
router.patch("/complete-profile", requireAuth, completeProfile);

module.exports = router;
