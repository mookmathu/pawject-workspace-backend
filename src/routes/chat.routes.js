const express = require("express");
const requireAuth = require("../middleware/requireAuth");
const { uploadChatAttachment } = require("../lib/upload");
const {
  getWorkspaceMessages,
  sendWorkspaceMessage,
  getDmMessages,
  sendDmMessage,
  getAttachment,
  getUnreadCounts,
} = require("../controllers/chat.controller");

const router = express.Router();

router.get("/unread", requireAuth, getUnreadCounts);

router.get("/workspace/:workspaceId/messages", requireAuth, getWorkspaceMessages);
router.post("/workspace/:workspaceId/messages", requireAuth, uploadChatAttachment.single("attachment"), sendWorkspaceMessage);
router.get("/dm/:userId/messages", requireAuth, getDmMessages);
router.post("/dm/:userId/messages", requireAuth, uploadChatAttachment.single("attachment"), sendDmMessage);

// Unauthenticated, like the avatar route — see getAttachment's comment.
router.get("/messages/:messageId/attachment", getAttachment);

module.exports = router;
