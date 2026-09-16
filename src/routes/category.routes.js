const express = require("express");
const requireAuth = require("../middleware/requireAuth");
const { updateCategory, deleteCategory } = require("../controllers/category.controller");

const router = express.Router();

router.patch("/:categoryId", requireAuth, updateCategory);
router.delete("/:categoryId", requireAuth, deleteCategory);

module.exports = router;
