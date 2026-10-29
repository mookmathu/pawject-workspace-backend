const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const prisma = require("../lib/prisma");
const { sendPasswordResetEmail } = require("../lib/resetEmail");
const { trimTrailingSlash } = require("../lib/url");

const FRONTEND_URL = trimTrailingSlash(process.env.FRONTEND_URL || "http://localhost:3000");
const RESET_TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minutes

async function forgotPassword(req, res) {
  try {
    const { email } = req.body;
    if (!email || !email.trim()) {
      return res.status(400).json({ error: "กรุณากรอกอีเมล" });
    }

    const user = await prisma.user.findUnique({ where: { email: email.trim() } });

    // Same response whether or not the account exists — otherwise this
    // endpoint could be used to check which emails are registered.
    if (user) {
      const rawToken = crypto.randomBytes(32).toString("hex");
      const tokenHash = await bcrypt.hash(rawToken, 10);

      await prisma.user.update({
        where: { id: user.id },
        data: {
          resetTokenHash: tokenHash,
          resetTokenExpiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
        },
      });

      const resetUrl = `${FRONTEND_URL}/reset-password?email=${encodeURIComponent(user.email)}&token=${rawToken}`;

      try {
        await sendPasswordResetEmail(user.email, resetUrl);
      } catch (emailErr) {
        // Log server-side only — the response to the client stays generic
        // either way, so a delivery failure isn't revealed to the caller.
        console.error("Failed to send password reset email:", emailErr);
      }
    }

    return res.status(200).json({
      message: "ถ้าอีเมลนี้มีอยู่ในระบบ เราได้ส่งลิงก์สำหรับตั้งรหัสผ่านใหม่ไปให้แล้ว",
    });
  } catch (err) {
    console.error("Forgot password error:", err);
    return res.status(500).json({ error: "เกิดข้อผิดพลาดในเซิร์ฟเวอร์" });
  }
}

async function resetPassword(req, res) {
  try {
    const { email, token, newPassword } = req.body;

    if (!email || !token || !newPassword) {
      return res.status(400).json({ error: "ข้อมูลไม่ครบถ้วน" });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: "รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร" });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.resetTokenHash || !user.resetTokenExpiresAt) {
      return res.status(400).json({ error: "ลิงก์ไม่ถูกต้องหรือหมดอายุแล้ว กรุณาขอลิงก์ใหม่" });
    }
    if (user.resetTokenExpiresAt < new Date()) {
      return res.status(400).json({ error: "ลิงก์หมดอายุแล้ว กรุณาขอลิงก์ใหม่" });
    }

    const matches = await bcrypt.compare(token, user.resetTokenHash);
    if (!matches) {
      return res.status(400).json({ error: "ลิงก์ไม่ถูกต้องหรือหมดอายุแล้ว กรุณาขอลิงก์ใหม่" });
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({
      where: { id: user.id },
      data: {
        password: passwordHash,
        resetTokenHash: null,
        resetTokenExpiresAt: null,
      },
    });

    return res.status(200).json({ message: "ตั้งรหัสผ่านใหม่สำเร็จแล้ว" });
  } catch (err) {
    console.error("Reset password error:", err);
    return res.status(500).json({ error: "เกิดข้อผิดพลาดในเซิร์ฟเวอร์" });
  }
}

module.exports = { forgotPassword, resetPassword };
