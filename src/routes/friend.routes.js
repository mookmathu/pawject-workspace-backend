const express = require("express");
const requireAuth = require("../middleware/requireAuth");
const {
  getFriends,
  addFriend,
  removeFriend,
  getFriendRequests,
  acceptFriendRequest,
  rejectFriendRequest,
} = require("../controllers/friend.controller");

const router = express.Router();

router.get("/", requireAuth, getFriends);
router.post("/", requireAuth, addFriend);
router.delete("/:userId", requireAuth, removeFriend);

router.get("/requests", requireAuth, getFriendRequests);
router.post("/requests/:requestId/accept", requireAuth, acceptFriendRequest);
router.post("/requests/:requestId/reject", requireAuth, rejectFriendRequest);

module.exports = router;
