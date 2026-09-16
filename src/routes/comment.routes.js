const express = require("express");
const requireAuth = require("../middleware/requireAuth");
const { deleteComment } = require("../controllers/task.controller");

const router = express.Router();

router.delete("/:commentId", requireAuth, deleteComment);

module.exports = router;
