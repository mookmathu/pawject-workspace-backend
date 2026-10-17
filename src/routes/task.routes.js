const express = require("express");
const requireAuth = require("../middleware/requireAuth");
const { updateTask, deleteTask, addSubtask, addComment, getMyTasks } = require("../controllers/task.controller");

const router = express.Router();

// Static path — registered before "/:taskId" below so "mine" is never
// swallowed as a :taskId value.
router.get("/mine", requireAuth, getMyTasks);
router.patch("/:taskId", requireAuth, updateTask);
router.delete("/:taskId", requireAuth, deleteTask);
router.post("/:taskId/subtasks", requireAuth, addSubtask);
router.post("/:taskId/comments", requireAuth, addComment);

module.exports = router;
