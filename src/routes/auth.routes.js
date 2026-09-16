const express = require("express");
const { register, login, checkUsername, verifyOtp, resendOtp } = require("../controllers/auth.controller");

const router = express.Router();

router.post("/register", register);
router.post("/login", login);
router.post("/verify-otp", verifyOtp);
router.post("/resend-otp", resendOtp);
router.get("/check-username", checkUsername);

module.exports = router;
