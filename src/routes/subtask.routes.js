const express = require("express");
const requireAuth = require("../middleware/requireAuth");
const { updateSubtask, deleteSubtask } = require("../controllers/task.controller");

const router = express.Router();

router.patch("/:subtaskId", requireAuth, updateSubtask);
router.delete("/:subtaskId", requireAuth, deleteSubtask);

module.exports = router;
