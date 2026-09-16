const express = require("express");
const requireAuth = require("../middleware/requireAuth");
const { updateTask, deleteTask, addSubtask, addComment } = require("../controllers/task.controller");

const router = express.Router();

router.patch("/:taskId", requireAuth, updateTask);
router.delete("/:taskId", requireAuth, deleteTask);
router.post("/:taskId/subtasks", requireAuth, addSubtask);
router.post("/:taskId/comments", requireAuth, addComment);

module.exports = router;
