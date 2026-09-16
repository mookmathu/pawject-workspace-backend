const express = require("express");
const requireAuth = require("../middleware/requireAuth");
const {
  getMyWorkspaces,
  createWorkspace,
  addMember,
  removeMember,
  deleteWorkspace,
} = require("../controllers/workspace.controller");
const { getWorkspaceBoard } = require("../controllers/board.controller");

const router = express.Router();

router.get("/", requireAuth, getMyWorkspaces);
router.post("/", requireAuth, createWorkspace);
router.get("/:workspaceId/board", requireAuth, getWorkspaceBoard);
router.post("/:workspaceId/members", requireAuth, addMember);
router.delete("/:workspaceId/members/:userId", requireAuth, removeMember);
router.delete("/:workspaceId", requireAuth, deleteWorkspace);

module.exports = router;
