const express = require("express");
const requireAuth = require("../middleware/requireAuth");
const { uploadAvatar } = require("../lib/upload");
const {
  getMyWorkspaces,
  createWorkspace,
  addMember,
  removeMember,
  deleteWorkspace,
  uploadWorkspaceImage,
  getWorkspaceImage,
  regenerateJoinCode,
  joinWorkspaceByCode,
  transferOwnership,
} = require("../controllers/workspace.controller");
const { getWorkspaceBoard } = require("../controllers/board.controller");

const router = express.Router();

router.get("/", requireAuth, getMyWorkspaces);
router.post("/", requireAuth, createWorkspace);
// Static path — registered before the "/:workspaceId/..." routes below so
// "join" is never swallowed as a :workspaceId value.
router.post("/join", requireAuth, joinWorkspaceByCode);
router.get("/:workspaceId/board", requireAuth, getWorkspaceBoard);
router.post("/:workspaceId/members", requireAuth, addMember);
router.delete("/:workspaceId/members/:userId", requireAuth, removeMember);
router.delete("/:workspaceId", requireAuth, deleteWorkspace);
router.post("/:workspaceId/image", requireAuth, uploadAvatar.single("image"), uploadWorkspaceImage);
// Unauthenticated, like the avatar route — see getWorkspaceImage's comment.
router.get("/:workspaceId/image", getWorkspaceImage);
router.post("/:workspaceId/join-code/regenerate", requireAuth, regenerateJoinCode);
router.post("/:workspaceId/owner", requireAuth, transferOwnership);

module.exports = router;
