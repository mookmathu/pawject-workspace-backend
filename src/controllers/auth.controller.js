const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const prisma = require("../lib/prisma");
const { sendOtpEmail } = require("../lib/email");
// toSafeUser — shared with profile.controller.js (see lib/serializeUser.js).
// Login/verifyOtp used to build their own user object by hand and never
// computed avatarUrl, so a photo uploaded after email/password login never
// showed up in the header until the next full profile fetch. Google/Facebook/
// GitHub login never had this bug because it goes through GET /me instead,
// which already used toSafeUser.
const { toSafeUser } = require("../lib/serializeUser");

const JWT_SECRET = process.env.JWT_SECRET;
const TOKEN_EXPIRY = "7d";
const OTP_TTL_MINUTES = 10;
const OTP_RESEND_COOLDOWN_SECONDS = 30;
const MAX_OTP_ATTEMPTS = 5;

// Wrong-code counter per email. Without a cap, a 6-digit code could be
// brute-forced inside its 10-minute window. In-memory is enough here: a
// server restart just resets the counter, and the code still expires.
const otpAttempts = new Map();

function signToken(user) {
  return jwt.sign({ sub: user.id, email: user.email }, JWT_SECRET, {
    expiresIn: TOKEN_EXPIRY,
  });
}

function generateOtp() {
  // crypto.randomInt() instead of Math.random() — Math.random() isn't
  // cryptographically secure, so its output can be predicted, which matters
  // here since the OTP is a security code. randomInt gives a uniformly
  // distributed 6-digit number from a secure source instead.
  return String(crypto.randomInt(100000, 1000000)); // 6 digits
}

async function issueAndSendOtp(user, purpose = "verify") {
  otpAttempts.delete(user.email);
  const otpCode = generateOtp();
  const otpCodeHash = await bcrypt.hash(otpCode, 10);
  const otpExpiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);

  await prisma.user.update({
    where: { id: user.id },
    data: { otpCodeHash, otpExpiresAt },
  });

  await sendOtpEmail(user.email, otpCode, purpose);
}

async function register(req, res) {
  try {
    const { name, username, email, password, orgType, orgName } = req.body;

    if (!name || !username || !email || !password || !orgType || !orgName) {
      return res.status(400).json({ error: "ข้อมูลไม่ครบถ้วน" });
    }

    const [existingEmail, existingUsername] = await Promise.all([
      prisma.user.findUnique({ where: { email } }),
      prisma.user.findUnique({ where: { username } }),
    ]);

    if (existingEmail) {
      return res.status(409).json({ error: "อีเมลนี้ถูกใช้งานแล้ว" });
    }
    if (existingUsername) {
      return res.status(409).json({ error: "ชื่อผู้ใช้นี้ถูกใช้งานแล้ว" });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: { name, username, email, password: passwordHash, orgType, orgName },
    });

    try {
      await issueAndSendOtp(user);
    } catch (emailErr) {
      console.error("Failed to send OTP email:", emailErr);
      // The account was created — don't fail registration just because the
      // email didn't go out. The user can hit "resend code" on the OTP screen.
    }

    // No token yet — the account isn't usable until the OTP is verified.
    return res.status(201).json({ email: user.email, message: "ส่งรหัสยืนยันไปที่อีเมลแล้ว" });
  } catch (err) {
    console.error("Register error:", err);
    return res.status(500).json({ error: "เกิดข้อผิดพลาดในเซิร์ฟเวอร์" });
  }
}

async function verifyOtp(req, res) {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ error: "กรุณากรอกอีเมลและรหัสยืนยัน" });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(404).json({ error: "ไม่พบบัญชีนี้" });
    }

    // A token is only ever handed out against a real, unexpired code — also
    // for accounts that are already verified (social login asks for a code on
    // every sign-in). There is deliberately no "already verified, here's a
    // token" shortcut: that would let anyone who knows an email sign in as it.
    if (!user.otpCodeHash || !user.otpExpiresAt) {
      return res.status(400).json({ error: "กรุณาขอรหัสยืนยันใหม่" });
    }

    if (new Date() > user.otpExpiresAt) {
      return res.status(400).json({ error: "รหัสยืนยันหมดอายุแล้ว กรุณาขอรหัสใหม่" });
    }

    const otpMatches = await bcrypt.compare(String(otp), user.otpCodeHash);
    if (!otpMatches) {
      const tries = (otpAttempts.get(email) || 0) + 1;
      if (tries >= MAX_OTP_ATTEMPTS) {
        otpAttempts.delete(email);
        await prisma.user.update({ where: { id: user.id }, data: { otpCodeHash: null, otpExpiresAt: null } });
        return res.status(400).json({ error: "กรอกรหัสผิดหลายครั้งเกินไป กรุณาขอรหัสใหม่" });
      }
      otpAttempts.set(email, tries);
      return res.status(400).json({ error: "รหัสยืนยันไม่ถูกต้อง" });
    }

    otpAttempts.delete(email);
    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: { emailVerified: true, otpCodeHash: null, otpExpiresAt: null },
    });

    const token = signToken(updatedUser);
    return res.status(200).json({ token, user: toSafeUser(updatedUser) });
  } catch (err) {
    console.error("Verify OTP error:", err);
    return res.status(500).json({ error: "เกิดข้อผิดพลาดในเซิร์ฟเวอร์" });
  }
}

async function resendOtp(req, res) {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: "กรุณาระบุอีเมล" });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(404).json({ error: "ไม่พบบัญชีนี้" });
    }

    // An already-verified account only gets a new code while a sign-in is in
    // progress (it has a pending code) — otherwise anyone could make us email
    // a stranger's inbox just by typing their address.
    if (user.emailVerified && !user.otpCodeHash) {
      return res.status(400).json({ error: "อีเมลนี้ยืนยันแล้ว" });
    }

    // Server-side cooldown (the 30s timer on the page is only cosmetic).
    if (user.otpExpiresAt) {
      const issuedAt = user.otpExpiresAt.getTime() - OTP_TTL_MINUTES * 60 * 1000;
      if (Date.now() - issuedAt < OTP_RESEND_COOLDOWN_SECONDS * 1000) {
        return res.status(429).json({ error: "กรุณารอสักครู่ก่อนขอรหัสใหม่" });
      }
    }

    await issueAndSendOtp(user, user.emailVerified ? "login" : "verify");
    return res.status(200).json({ message: "ส่งรหัสยืนยันใหม่แล้ว" });
  } catch (err) {
    console.error("Resend OTP error:", err);
    return res.status(500).json({ error: "ส่งรหัสไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" });
  }
}

async function login(req, res) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "กรุณากรอกอีเมลและรหัสผ่าน" });
    }

        const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(401).json({ error: "อีเมลหรือรหัสผ่านไม่ถูกต้อง" });
    }

    if (!user.password) {
      return res.status(401).json({
        error: `บัญชีนี้สมัครผ่าน ${user.provider} — กรุณาเข้าสู่ระบบด้วยวิธีเดิม หรือกด "ลืมรหัสผ่าน" เพื่อตั้งรหัสผ่านก่อน`,
      });
    }

    const passwordMatches = await bcrypt.compare(password, user.password);
    if (!passwordMatches) {
      return res.status(401).json({ error: "อีเมลหรือรหัสผ่านไม่ถูกต้อง" });
    }
    if (!user.emailVerified) {
      // Send a fresh code so they land on the OTP screen ready to verify.
      try {
        await issueAndSendOtp(user);
      } catch (emailErr) {
        console.error("Failed to send OTP email on login:", emailErr);
      }
      return res.status(403).json({
        error: "กรุณายืนยันอีเมลก่อนเข้าสู่ระบบ",
        code: "EMAIL_NOT_VERIFIED",
        email: user.email,
      });
    }

    const token = signToken(user);
    return res.status(200).json({ token, user: toSafeUser(user) });
  } catch (err) {
    console.error("Login error:", err);
    return res.status(500).json({ error: "เกิดข้อผิดพลาดในเซิร์ฟเวอร์" });
  }
}

async function checkUsername(req, res) {
  try {
    const { username } = req.query;
    if (!username) {
      return res.status(400).json({ error: "กรุณาระบุ username" });
    }

    const existing = await prisma.user.findUnique({ where: { username } });
    return res.status(200).json({ available: !existing });
  } catch (err) {
    console.error("Check username error:", err);
    return res.status(500).json({ error: "เกิดข้อผิดพลาดในเซิร์ฟเวอร์" });
  }
}

module.exports = { register, login, checkUsername, verifyOtp, resendOtp, issueAndSendOtp };
