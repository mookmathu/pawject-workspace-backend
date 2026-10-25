const prisma = require("../lib/prisma");
const { getMembership } = require("../lib/permissions");
const { emitToRoom, emitToUser } = require("../lib/socket");
const { PUBLIC_USER_SELECT, toPublicUser } = require("../lib/serializeUser");
const { createNotification } = require("../lib/notify");

const SENDER_SELECT = PUBLIC_USER_SELECT;
// Deliberately excludes attachmentData (the raw bytes) — history fetches
// would otherwise drag every attachment's full contents along with them.
// The bytes are served separately by getAttachment, one message at a time.
const MESSAGE_SELECT = {
  id: true,
  conversationId: true,
  senderId: true,
  content: true,
  attachmentMimeType: true,
  attachmentName: true,
  createdAt: true,
  sender: { select: SENDER_SELECT },
};
const MESSAGE_HISTORY_LIMIT = 200;

// Attaches the URL the frontend fetches the attachment bytes from (same
// "computed on the way out" pattern as User.avatarUrl in serializeUser.js) —
// null when the message has no attachment.
function serializeMessage(message) {
  return {
    ...message,
    sender: toPublicUser(message.sender),
    attachmentUrl: message.attachmentMimeType ? `/api/chat/messages/${message.id}/attachment` : null,
  };
}

// Room names the frontend joins over the socket connection to receive
// message:new events live. Deterministic (no DB id needed) so the client can
// join a DM room the moment it knows who it's chatting with — before the
// Conversation row for that pair necessarily exists yet.
function dmRoomName(userIdA, userIdB) {
  const [a, b] = [userIdA, userIdB].sort();
  return `dm:${a}:${b}`;
}

function workspaceRoomName(workspaceId) {
  return `workspace:${workspaceId}`;
}

// The key the frontend's unread-badge map is keyed by — same shape either
// way so the UI doesn't need to know if a conversation is a workspace or a
// DM to look its count up.
function workspaceUnreadKey(workspaceId) {
  return `workspace:${workspaceId}`;
}

function dmUnreadKey(otherUserId) {
  return `dm:${otherUserId}`;
}

// Group chat lives 1:1 with a Workspace, same lazy-create pattern the board
// itself uses — nothing to set up when a workspace is created, a
// Conversation row just appears the first time anyone opens its chat tab.
async function getOrCreateWorkspaceConversation(workspaceId) {
  const existing = await prisma.conversation.findUnique({ where: { workspaceId } });
  if (existing) return existing;
  return prisma.conversation.create({ data: { workspaceId } });
}

async function getOrCreateDmConversation(userIdA, userIdB) {
  const [a, b] = [userIdA, userIdB].sort();
  const existing = await prisma.conversation.findUnique({
    where: { userAId_userBId: { userAId: a, userBId: b } },
  });
  if (existing) return existing;
  return prisma.conversation.create({ data: { userAId: a, userBId: b } });
}

// A DM only ever opens between two friends — reuses the exact same
// Friendship row the friends list itself is built from, so there's no way to
// message someone who was never added as a friend (or who was removed).
async function assertFriends(userIdA, userIdB) {
  const [a, b] = [userIdA, userIdB].sort();
  return prisma.friendship.findUnique({ where: { userAId_userBId: { userAId: a, userBId: b } } });
}

// Marks the conversation as read up to now for this user — called whenever
// they open it. Upsert because the first visit to a conversation has no
// ConversationRead row yet. Fire-and-forget from the caller's point of view;
// errors are logged but never fail the message-list response, since a
// missed read-mark just means the badge stays a little stale, not broken.
async function markRead(conversationId, userId) {
  try {
    await prisma.conversationRead.upsert({
      where: { conversationId_userId: { conversationId, userId } },
      update: { lastReadAt: new Date() },
      create: { conversationId, userId, lastReadAt: new Date() },
    });
  } catch (err) {
    console.error("Mark conversation read error:", err);
  }
}

// Stickers are sent as the text "[[sticker:<id>]]" — show a readable preview
// in notifications instead of the raw token.
function previewOf(content, file) {
  if (content && /^\[\[sticker:[a-z]+\]\]$/.test(content)) return "ส่งสติกเกอร์";
  return content ? content.slice(0, 140) : file ? "📎 ไฟล์แนบ" : "";
}

// After a message is saved, nudges everyone who can see this conversation
// but isn't the sender — so their unread badge updates live even if they
// don't currently have this chat open (and so aren't in its room) — and
// also leaves them a notification-center entry, so a message sent while
// they're on Home/Task/Calendar (not just "away from Chat") still reaches
// them.
async function bumpUnread(workspaceId, dmParticipantIds, senderId, senderName, preview) {
  if (workspaceId) {
    const [members, workspace] = await Promise.all([
      prisma.workspaceMember.findMany({
        where: { workspaceId, userId: { not: senderId } },
        select: { userId: true },
      }),
      prisma.workspace.findUnique({ where: { id: workspaceId }, select: { name: true, isPersonal: true } }),
    ]);
    const key = workspaceUnreadKey(workspaceId);
    const workspaceName = workspace?.isPersonal ? "ของฉัน" : workspace?.name || "กลุ่ม";
    members.forEach((m) => {
      emitToUser(m.userId, "unread:bump", { key });
      createNotification({
        userId: m.userId,
        type: "message",
        title: `${senderName} ส่งข้อความในกลุ่ม ${workspaceName}`,
        body: preview,
        link: { type: "workspace_chat", workspaceId, workspaceName },
      });
    });
  } else {
    const [a, b] = dmParticipantIds;
    const recipientId = a === senderId ? b : a;
    emitToUser(recipientId, "unread:bump", { key: dmUnreadKey(senderId) });
    createNotification({
      userId: recipientId,
      type: "message",
      title: `ข้อความใหม่จาก ${senderName}`,
      body: preview,
      link: { type: "dm", userId: senderId, name: senderName },
    });
  }
}

async function getWorkspaceMessages(req, res) {
  try {
    const { workspaceId } = req.params;
    const member = await getMembership(workspaceId, req.userId);
    if (!member) {
      return res.status(403).json({ error: "คุณไม่ได้เป็นสมาชิกของ workspace นี้" });
    }

    const conversation = await getOrCreateWorkspaceConversation(workspaceId);
    const messages = await prisma.message.findMany({
      where: { conversationId: conversation.id },
      select: MESSAGE_SELECT,
      orderBy: { createdAt: "asc" },
      take: MESSAGE_HISTORY_LIMIT,
    });
    await markRead(conversation.id, req.userId);

    return res.status(200).json({ messages: messages.map(serializeMessage), room: workspaceRoomName(workspaceId) });
  } catch (err) {
    console.error("Get workspace messages error:", err);
    return res.status(500).json({ error: "เกิดข้อผิดพลาดในเซิร์ฟเวอร์" });
  }
}

async function sendWorkspaceMessage(req, res) {
  try {
    const { workspaceId } = req.params;
    const content = (req.body.content || "").trim();
    const file = req.file;
    if (!content && !file) {
      return res.status(400).json({ error: "กรุณากรอกข้อความหรือแนบไฟล์" });
    }

    const member = await getMembership(workspaceId, req.userId);
    if (!member) {
      return res.status(403).json({ error: "คุณไม่ได้เป็นสมาชิกของ workspace นี้" });
    }

    const conversation = await getOrCreateWorkspaceConversation(workspaceId);
    const message = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        senderId: req.userId,
        content: content || null,
        attachmentData: file ? file.buffer : undefined,
        attachmentMimeType: file ? file.mimetype : undefined,
        attachmentName: file ? file.originalname : undefined,
      },
      select: MESSAGE_SELECT,
    });
    const serialized = serializeMessage(message);

    emitToRoom(workspaceRoomName(workspaceId), "message:new", serialized);
    const preview = previewOf(content, file);
    bumpUnread(workspaceId, null, req.userId, serialized.sender.name, preview).catch((err) =>
      console.error("Bump unread error:", err)
    );
    return res.status(201).json({ message: serialized });
  } catch (err) {
    console.error("Send workspace message error:", err);
    return res.status(500).json({ error: "เกิดข้อผิดพลาดในเซิร์ฟเวอร์" });
  }
}

async function getDmMessages(req, res) {
  try {
    const { userId: otherUserId } = req.params;
    const friendship = await assertFriends(req.userId, otherUserId);
    if (!friendship) {
      return res.status(403).json({ error: "คุณกับผู้ใช้นี้ยังไม่ได้เป็นเพื่อนกัน" });
    }

    const conversation = await getOrCreateDmConversation(req.userId, otherUserId);
    const messages = await prisma.message.findMany({
      where: { conversationId: conversation.id },
      select: MESSAGE_SELECT,
      orderBy: { createdAt: "asc" },
      take: MESSAGE_HISTORY_LIMIT,
    });
    await markRead(conversation.id, req.userId);

    return res.status(200).json({ messages: messages.map(serializeMessage), room: dmRoomName(req.userId, otherUserId) });
  } catch (err) {
    console.error("Get DM messages error:", err);
    return res.status(500).json({ error: "เกิดข้อผิดพลาดในเซิร์ฟเวอร์" });
  }
}

async function sendDmMessage(req, res) {
  try {
    const { userId: otherUserId } = req.params;
    const content = (req.body.content || "").trim();
    const file = req.file;
    if (!content && !file) {
      return res.status(400).json({ error: "กรุณากรอกข้อความหรือแนบไฟล์" });
    }

    const friendship = await assertFriends(req.userId, otherUserId);
    if (!friendship) {
      return res.status(403).json({ error: "คุณกับผู้ใช้นี้ยังไม่ได้เป็นเพื่อนกัน" });
    }

    const conversation = await getOrCreateDmConversation(req.userId, otherUserId);
    const message = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        senderId: req.userId,
        content: content || null,
        attachmentData: file ? file.buffer : undefined,
        attachmentMimeType: file ? file.mimetype : undefined,
        attachmentName: file ? file.originalname : undefined,
      },
      select: MESSAGE_SELECT,
    });
    const serialized = serializeMessage(message);

    emitToRoom(dmRoomName(req.userId, otherUserId), "message:new", serialized);
    const preview = previewOf(content, file);
    bumpUnread(null, [req.userId, otherUserId], req.userId, serialized.sender.name, preview).catch((err) =>
      console.error("Bump unread error:", err)
    );
    return res.status(201).json({ message: serialized });
  } catch (err) {
    console.error("Send DM message error:", err);
    return res.status(500).json({ error: "เกิดข้อผิดพลาดในเซิร์ฟเวอร์" });
  }
}

// Serves a single message's attachment bytes. Unauthenticated on purpose —
// same reasoning as profile.controller.js's getAvatarHandler: an <img src>
// or a plain link click can't attach an Authorization header, and the
// message id itself (a random UUID) is what stands in for access control
// here, the same convention the avatar URL already uses.
async function getAttachment(req, res) {
  try {
    const { messageId } = req.params;
    const message = await prisma.message.findUnique({
      where: { id: messageId },
      select: { attachmentData: true, attachmentMimeType: true, attachmentName: true },
    });

    if (!message || !message.attachmentData || !message.attachmentMimeType) {
      return res.status(404).end();
    }

    res.setHeader("Content-Type", message.attachmentMimeType);
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable"); // safe: a message's attachment never changes
    if (message.attachmentName) {
      res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(message.attachmentName)}"`);
    }
    // Same Buffer.from() wrap as getAvatarHandler — Prisma's Bytes fields
    // come back as a plain Uint8Array, and res.send() on a Uint8Array falls
    // through to JSON serialization instead of sending raw bytes.
    return res.status(200).send(Buffer.from(message.attachmentData));
  } catch (err) {
    console.error("Get attachment error:", err);
    return res.status(500).json({ error: "เกิดข้อผิดพลาดในเซิร์ฟเวอร์" });
  }
}

// One combined unread count per conversation the user can see — a workspace
// chat for every workspace they're in, plus a DM for every friend they
// already have a Conversation row with. Keyed the same way the frontend
// identifies a conversation (workspace:<id> / dm:<otherUserId>) so the UI
// can look a badge up directly from `selected`.
async function getUnreadCounts(req, res) {
  try {
    const userId = req.userId;

    const memberships = await prisma.workspaceMember.findMany({
      where: { userId },
      select: { workspaceId: true },
    });
    const workspaceIds = memberships.map((m) => m.workspaceId);

    const [workspaceConvos, dmConvos] = await Promise.all([
      workspaceIds.length
        ? prisma.conversation.findMany({
            where: { workspaceId: { in: workspaceIds } },
            select: { id: true, workspaceId: true },
          })
        : Promise.resolve([]),
      prisma.conversation.findMany({
        where: { OR: [{ userAId: userId }, { userBId: userId }] },
        select: { id: true, userAId: true, userBId: true },
      }),
    ]);

    const allConvos = [...workspaceConvos, ...dmConvos];
    if (allConvos.length === 0) {
      return res.status(200).json({ unread: {} });
    }

    const reads = await prisma.conversationRead.findMany({
      where: { userId, conversationId: { in: allConvos.map((c) => c.id) } },
    });
    const readMap = new Map(reads.map((r) => [r.conversationId, r.lastReadAt]));

    const counts = await Promise.all(
      allConvos.map((c) =>
        prisma.message.count({
          where: {
            conversationId: c.id,
            senderId: { not: userId },
            createdAt: { gt: readMap.get(c.id) || new Date(0) },
          },
        })
      )
    );

    const unread = {};
    allConvos.forEach((c, i) => {
      if (counts[i] <= 0) return;
      const key = c.workspaceId ? workspaceUnreadKey(c.workspaceId) : dmUnreadKey(c.userAId === userId ? c.userBId : c.userAId);
      unread[key] = counts[i];
    });

    return res.status(200).json({ unread });
  } catch (err) {
    console.error("Get unread counts error:", err);
    return res.status(500).json({ error: "เกิดข้อผิดพลาดในเซิร์ฟเวอร์" });
  }
}

module.exports = {
  getWorkspaceMessages,
  sendWorkspaceMessage,
  getDmMessages,
  sendDmMessage,
  getAttachment,
  getUnreadCounts,
};
