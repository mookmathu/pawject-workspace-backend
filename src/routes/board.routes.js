const express = require("express");
const requireAuth = require("../middleware/requireAuth");
const { createTask } = require("../controllers/task.controller");
const { createColumn } = require("../controllers/column.controller");
const { createCategory } = require("../controllers/category.controller");
const { updateBoardNote } = require("../controllers/board.controller");

const router = express.Router();

// Board fetching is now workspace-scoped — see GET /api/workspaces/:workspaceId/board.
router.post("/:boardId/tasks", requireAuth, createTask);
router.post("/:boardId/columns", requireAuth, createColumn);
router.post("/:boardId/categories", requireAuth, createCategory);
router.patch("/:boardId/note", requireAuth, updateBoardNote);

module.exports = router;
