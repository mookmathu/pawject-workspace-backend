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

async function issueAndSendOtp(user) {
  const otpCode = generateOtp();
  const otpCodeHash = await bcrypt.hash(otpCode, 10);
  const otpExpiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);

  await prisma.user.update({
    where: { id: user.id },
    data: { otpCodeHash, otpExpiresAt },
  });

  await sendOtpEmail(user.email, otpCode);
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

    if (user.emailVerified) {
      const token = signToken(user);
      return res.status(200).json({ token, user: toSafeUser(user) });
    }

    if (!user.otpCodeHash || !user.otpExpiresAt) {
      return res.status(400).json({ error: "กรุณาขอรหัสยืนยันใหม่" });
    }

    if (new Date() > user.otpExpiresAt) {
      return res.status(400).json({ error: "รหัสยืนยันหมดอายุแล้ว กรุณาขอรหัสใหม่" });
    }

    const otpMatches = await bcrypt.compare(otp, user.otpCodeHash);
    if (!otpMatches) {
      return res.status(400).json({ error: "รหัสยืนยันไม่ถูกต้อง" });
    }

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

    if (user.emailVerified) {
      return res.status(400).json({ error: "อีเมลนี้ยืนยันแล้ว" });
    }

    await issueAndSendOtp(user);
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

module.exports = { register, login, checkUsername, verifyOtp, resendOtp };
