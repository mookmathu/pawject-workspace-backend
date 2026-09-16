const express = require("express");
const requireAuth = require("../middleware/requireAuth");
const { searchUsers } = require("../controllers/user.controller");

const router = express.Router();

router.get("/search", requireAuth, searchUsers);

module.exports = router;
