const express = require("express");
const requireAuth = require("../middleware/requireAuth");
const { updateColumn, deleteColumn } = require("../controllers/column.controller");

const router = express.Router();

router.patch("/:columnId", requireAuth, updateColumn);
router.delete("/:columnId", requireAuth, deleteColumn);

module.exports = router;
