const prisma = require("../lib/prisma");
const { PUBLIC_USER_SELECT, toPublicUser } = require("../lib/serializeUser");
const { orderedPair } = require("../lib/pair");

const USER_PUBLIC_SELECT = PUBLIC_USER_SELECT;

async function getFriends(req, res) {
  try {
    const friendships = await prisma.friendship.findMany({
      where: { OR: [{ userAId: req.userId }, { userBId: req.userId }] },
      include: {
        userA: { select: USER_PUBLIC_SELECT },
        userB: { select: USER_PUBLIC_SELECT },
      },
      orderBy: { createdAt: "desc" },
    });

    // Flatten to "the other person" regardless of which side of the row I'm on.
    const friends = friendships.map((f) => toPublicUser(f.userAId === req.userId ? f.userB : f.userA));

    return res.status(200).json({ friends });
  } catch (err) {
    console.error("Get friends error:", err);
    return res.status(500).json({ error: "เกิดข้อผิดพลาดในเซิร์ฟเวอร์" });
  }
}

async function addFriend(req, res) {
  try {
    // Friends are added by the ID the other person created for that purpose
    // (see setFriendId) — not by username.
    const friendId = typeof req.body.friendId === "string" ? req.body.friendId.trim().toLowerCase().replace(/^@/, "") : "";
    if (!friendId) {
      return res.status(400).json({ error: "กรุณาระบุ ID เพื่อน" });
    }

    const me = await prisma.user.findUnique({ where: { id: req.userId } });
    const targetUser = await prisma.user.findUnique({ where: { friendId } });
    if (!targetUser) {
      return res.status(404).json({ error: `ไม่พบผู้ใช้ที่มี ID "${friendId}"` });
    }
    if (targetUser.id === req.userId) {
      return res.status(400).json({ error: "เพิ่มตัวเองเป็นเพื่อนไม่ได้" });
    }

    const [a, b] = orderedPair(req.userId, targetUser.id);
    const existingFriendship = await prisma.friendship.findUnique({
      where: { userAId_userBId: { userAId: a, userBId: b } },
    });
    if (existingFriendship) {
      return res.status(409).json({ error: "เป็นเพื่อนกันอยู่แล้ว" });
    }

    // Same university/organization: connect immediately, same as before.
    const sameOrg = me.orgType === targetUser.orgType && me.orgName === targetUser.orgName;
    if (sameOrg) {
      await prisma.friendship.create({ data: { userAId: a, userBId: b } });
      return res.status(201).json({ friend: toPublicUser(targetUser) });
    }

    // Different university/organization: needs the other person to accept.
    const existingRequest = await prisma.friendRequest.findFirst({
      where: {
        OR: [
          { senderId: req.userId, receiverId: targetUser.id },
          { senderId: targetUser.id, receiverId: req.userId },
        ],
        status: "pending",
      },
    });
    if (existingRequest) {
      return res.status(409).json({ error: "มีคำขอเป็นเพื่อนค้างอยู่แล้ว" });
    }

    await prisma.friendRequest.create({ data: { senderId: req.userId, receiverId: targetUser.id } });
    return res
      .status(202)
      .json({ request: toPublicUser(targetUser) });
  } catch (err) {
    console.error("Add friend error:", err);
    return res.status(500).json({ error: "เกิดข้อผิดพลาดในเซิร์ฟเวอร์" });
  }
}

async function removeFriend(req, res) {
  try {
    const { userId } = req.params;
    const [a, b] = orderedPair(req.userId, userId);

    await prisma.friendship.deleteMany({ where: { userAId: a, userBId: b } });
    return res.status(200).json({ message: "ลบเพื่อนแล้ว" });
  } catch (err) {
    console.error("Remove friend error:", err);
    return res.status(500).json({ error: "เกิดข้อผิดพลาดในเซิร์ฟเวอร์" });
  }
}

async function getFriendRequests(req, res) {
  try {
    const requests = await prisma.friendRequest.findMany({
      where: { receiverId: req.userId, status: "pending" },
      include: { sender: { select: USER_PUBLIC_SELECT } },
      orderBy: { createdAt: "desc" },
    });

    return res.status(200).json({
      requests: requests.map((r) => ({
        id: r.id,
        createdAt: r.createdAt,
        sender: toPublicUser(r.sender),
      })),
    });
  } catch (err) {
    console.error("Get friend requests error:", err);
    return res.status(500).json({ error: "เกิดข้อผิดพลาดในเซิร์ฟเวอร์" });
  }
}

async function acceptFriendRequest(req, res) {
  try {
    const { requestId } = req.params;
    const request = await prisma.friendRequest.findUnique({ where: { id: requestId } });
    if (!request || request.receiverId !== req.userId || request.status !== "pending") {
      return res.status(404).json({ error: "ไม่พบคำขอเป็นเพื่อนนี้" });
    }

    const [a, b] = orderedPair(request.senderId, request.receiverId);
    await prisma.$transaction([
      prisma.friendship.upsert({
        where: { userAId_userBId: { userAId: a, userBId: b } },
        create: { userAId: a, userBId: b },
        update: {},
      }),
      prisma.friendRequest.update({ where: { id: requestId }, data: { status: "accepted" } }),
    ]);

    return res.status(200).json({ message: "ยอมรับคำขอเป็นเพื่อนแล้ว" });
  } catch (err) {
    console.error("Accept friend request error:", err);
    return res.status(500).json({ error: "เกิดข้อผิดพลาดในเซิร์ฟเวอร์" });
  }
}

async function rejectFriendRequest(req, res) {
  try {
    const { requestId } = req.params;
    const request = await prisma.friendRequest.findUnique({ where: { id: requestId } });
    if (!request || request.receiverId !== req.userId || request.status !== "pending") {
      return res.status(404).json({ error: "ไม่พบคำขอเป็นเพื่อนนี้" });
    }

    await prisma.friendRequest.update({ where: { id: requestId }, data: { status: "rejected" } });
    return res.status(200).json({ message: "ปฏิเสธคำขอเป็นเพื่อนแล้ว" });
  } catch (err) {
    console.error("Reject friend request error:", err);
    return res.status(500).json({ error: "เกิดข้อผิดพลาดในเซิร์ฟเวอร์" });
  }
}

module.exports = {
  getFriends,
  addFriend,
  removeFriend,
  getFriendRequests,
  acceptFriendRequest,
  rejectFriendRequest,
};
