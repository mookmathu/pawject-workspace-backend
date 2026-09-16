const prisma = require("../lib/prisma");

const SAFE_SELECT = {
  id: true,
  name: true,
  username: true,
  email: true,
  orgType: true,
  orgName: true,
  provider: true,
  emailVerified: true,
};

async function getMe(req, res) {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId }, select: SAFE_SELECT });
    if (!user) {
      return res.status(404).json({ error: "ไม่พบผู้ใช้นี้" });
    }
    return res.status(200).json({ user });
  } catch (err) {
    console.error("Get me error:", err);
    return res.status(500).json({ error: "เกิดข้อผิดพลาดในเซิร์ฟเวอร์" });
  }
}

// Used right after a first-time OAuth login — the account already exists
// (created from the Google/Facebook/GitHub profile) but is missing the
// fields local registration normally collects up front.
async function completeProfile(req, res) {
  try {
    const { username, orgType, orgName } = req.body;

    if (!username || !username.trim()) {
      return res.status(400).json({ error: "กรุณากรอก username" });
    }
    if (!orgType || !["university", "company"].includes(orgType)) {
      return res.status(400).json({ error: "กรุณาเลือกประเภทองค์กร" });
    }
    if (!orgName || !orgName.trim()) {
      return res.status(400).json({ error: "กรุณากรอกชื่อองค์กร" });
    }

    const existing = await prisma.user.findUnique({ where: { username: username.trim() } });
    if (existing && existing.id !== req.userId) {
      return res.status(409).json({ error: "username นี้ถูกใช้แล้ว" });
    }

    const user = await prisma.user.update({
      where: { id: req.userId },
      data: { username: username.trim(), orgType, orgName: orgName.trim() },
      select: SAFE_SELECT,
    });

    return res.status(200).json({ user });
  } catch (err) {
    console.error("Complete profile error:", err);
    return res.status(500).json({ error: "เกิดข้อผิดพลาดในเซิร์ฟเวอร์" });
  }
}

module.exports = { getMe, completeProfile };
