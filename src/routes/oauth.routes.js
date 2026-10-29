const express = require("express");
const jwt = require("jsonwebtoken");
const passport = require("../lib/passport");
const { issueAndSendOtp } = require("../controllers/auth.controller");

const router = express.Router();

// Trailing slash stripped so a FRONTEND_URL written as "https://x.tech/" doesn't produce "//" in redirects.
const FRONTEND_URL = (process.env.FRONTEND_URL || "http://localhost:3000").replace(/\/+$/, "");

// Social sign-ins don't get a token straight away: we email a 6-digit code and
// send the browser to the OTP page; the token is only issued by POST
// /api/auth/verify-otp once the code is right. The exception is an account
// with no real email (GitHub with a private email, Facebook without one) —
// there's nowhere to send a code, so those keep the old direct sign-in.
function hasRealEmail(user) {
  return !!user.email && !user.email.endsWith("@no-email.crewspace.local");
}

async function issueTokenAndRedirect(req, res) {
  const user = req.user;

  if (hasRealEmail(user)) {
    try {
      await issueAndSendOtp(user, "login");
      return res.redirect(`${FRONTEND_URL}/verify-otp?email=${encodeURIComponent(user.email)}&social=1`);
    } catch (err) {
      console.error("Failed to send social-login OTP:", err);
      return res.redirect(`${FRONTEND_URL}/?oauthError=1`);
    }
  }

  // requireAuth reads payload.sub (the standard JWT "subject" claim), not a
  // custom "userId" field — must match how the existing login flow signs
  // tokens, or req.userId ends up undefined on every OAuth-issued token.
  const token = jwt.sign({}, process.env.JWT_SECRET, { subject: user.id, expiresIn: "7d" });
  const needsProfile = !user.username;
  res.redirect(`${FRONTEND_URL}/oauth-callback?token=${token}&needsProfile=${needsProfile}`);
}

const failureRedirect = `${FRONTEND_URL}/?oauthError=1`;

// Facebook/GitHub only get registered with Passport once their .env
// credentials exist (see lib/passport.js) — this stops someone hitting
// /api/auth/facebook from getting a cryptic "unknown strategy" error before
// that provider has been set up.
function requireConfigured(provider) {
  return (req, res, next) => {
    if (!passport.configuredProviders.has(provider)) {
      return res
        .status(503)
        .send(`เข้าสู่ระบบด้วย ${provider} ยังไม่ได้ตั้งค่าใน .env ของ backend — ดู README สำหรับขั้นตอนตั้งค่า`);
    }
    next();
  };
}

router.get(
  "/google",
  requireConfigured("google"),
  passport.authenticate("google", { scope: ["profile", "email"], session: false })
);
router.get(
  "/google/callback",
  requireConfigured("google"),
  passport.authenticate("google", { session: false, failureRedirect }),
  issueTokenAndRedirect
);

router.get(
  "/facebook",
  requireConfigured("facebook"),
  passport.authenticate("facebook", { scope: ["email"], session: false })
);
router.get(
  "/facebook/callback",
  requireConfigured("facebook"),
  passport.authenticate("facebook", { session: false, failureRedirect }),
  issueTokenAndRedirect
);

router.get(
  "/github",
  requireConfigured("github"),
  passport.authenticate("github", { scope: ["user:email"], session: false })
);
router.get(
  "/github/callback",
  requireConfigured("github"),
  passport.authenticate("github", { session: false, failureRedirect }),
  issueTokenAndRedirect
);

module.exports = router;