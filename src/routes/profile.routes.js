const express = require("express");
const requireAuth = require("../middleware/requireAuth");
const {
  getMe,
  getMyActivity,
  getPublicProfile,
  completeProfile,
  updateProfile,
  updateTheme,
  uploadAvatarHandler,
  getAvatarHandler,
  deleteAccount,
} = require("../controllers/profile.controller");
const { uploadAvatar } = require("../lib/upload");

const router = express.Router();

router.get("/me", requireAuth, getMe);
router.get("/me/activity", requireAuth, getMyActivity);
router.patch("/complete-profile", requireAuth, completeProfile);
router.patch("/me", requireAuth, updateProfile);
router.patch("/me/theme", requireAuth, updateTheme);
router.post("/me/avatar", requireAuth, uploadAvatar.single("avatar"), uploadAvatarHandler);
router.delete("/me", requireAuth, deleteAccount);

// Another user's public profile card — requires login (unlike the avatar
// route below) so it can't be scraped from outside the app.
router.get("/:userId/profile", requireAuth, getPublicProfile);

// Public (no auth) — serves the raw image bytes so a plain <img src> can
// load it directly, same as the old static-file URL did.
router.get("/:userId/avatar", getAvatarHandler);

module.exports = router;
