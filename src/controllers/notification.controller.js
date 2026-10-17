const prisma = require("../lib/prisma");

const LIST_LIMIT = 30;

// The bell dropdown's contents — most recent first, plus how many are
// unread (shown as the badge count, combined on the frontend with the
// friend-request count that already lived in that same bell).
async function getNotifications(req, res) {
  try {
    const [notifications, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where: { userId: req.userId },
        orderBy: { createdAt: "desc" },
        take: LIST_LIMIT,
      }),
      prisma.notification.count({ where: { userId: req.userId, readAt: null } }),
    ]);
    return res.status(200).json({ notifications, unreadCount });
  } catch (err) {
    console.error("Get notifications error:", err);
    return res.status(500).json({ error: "เกิดข้อผิดพลาดในเซิร์ฟเวอร์" });
  }
}

async function markNotificationRead(req, res) {
  try {
    const { notificationId } = req.params;
    const notification = await prisma.notification.findUnique({ where: { id: notificationId } });
    if (!notification || notification.userId !== req.userId) {
      return res.status(404).json({ error: "ไม่พบการแจ้งเตือนนี้" });
    }

    const updated = await prisma.notification.update({
      where: { id: notificationId },
      data: { readAt: new Date() },
    });
    return res.status(200).json({ notification: updated });
  } catch (err) {
    console.error("Mark notification read error:", err);
    return res.status(500).json({ error: "เกิดข้อผิดพลาดในเซิร์ฟเวอร์" });
  }
}

async function markAllNotificationsRead(req, res) {
  try {
    await prisma.notification.updateMany({
      where: { userId: req.userId, readAt: null },
      data: { readAt: new Date() },
    });
    return res.status(200).json({ message: "อ่านทั้งหมดแล้ว" });
  } catch (err) {
    console.error("Mark all notifications read error:", err);
    return res.status(500).json({ error: "เกิดข้อผิดพลาดในเซิร์ฟเวอร์" });
  }
}

module.exports = { getNotifications, markNotificationRead, markAllNotificationsRead };
