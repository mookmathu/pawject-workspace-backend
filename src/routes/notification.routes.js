const express = require("express");
const requireAuth = require("../middleware/requireAuth");
const {
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} = require("../controllers/notification.controller");

const router = express.Router();

router.get("/", requireAuth, getNotifications);
router.post("/read-all", requireAuth, markAllNotificationsRead);
router.post("/:notificationId/read", requireAuth, markNotificationRead);

module.exports = router;
