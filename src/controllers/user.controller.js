const prisma = require("../lib/prisma");

async function searchUsers(req, res) {
  try {
    const { q } = req.query;
    if (!q || !q.trim()) {
      return res.status(200).json({ users: [] });
    }

    const users = await prisma.user.findMany({
      where: {
        username: { contains: q.trim(), mode: "insensitive" },
        NOT: { id: req.userId },
      },
      select: { id: true, username: true, name: true },
      take: 5,
    });

    return res.status(200).json({ users });
  } catch (err) {
    console.error("Search users error:", err);
    return res.status(500).json({ error: "เกิดข้อผิดพลาดในเซิร์ฟเวอร์" });
  }
}

module.exports = { searchUsers };
