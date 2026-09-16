const express = require("express");
const { forgotPassword, resetPassword } = require("../controllers/password-reset.controller");

const router = express.Router();

router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);

module.exports = router;
