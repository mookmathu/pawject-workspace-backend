const bcrypt = require("bcryptjs");
const prisma = require("../lib/prisma");
// SAFE_SELECT/toSafeUser now live in lib/serializeUser.js and are shared with
// auth.controller.js — see that file for why (avatarUrl was previously only
// computed here, so logging in via email showed no avatar photo).
const { SAFE_SELECT, toSafeUser, PUBLIC_USER_SELECT, toPublicUser, HIDABLE_FIELDS } = require("../lib/serializeUser");

// The initial username (set at registration, or via completeProfile right
// after a first OAuth login) doesn't count — only edits made afterward
// through updateProfile do.
const MAX_USERNAME_CHANGES = 3;

const MAX_BIO_LENGTH = 280;

// Shared by the signed-in user's own heatmap and a friend's view of it.
// Returns { status, body } so each caller just forwards it.
async function buildActivity(userId, yearRaw) {
  const { dayKey } = require("../lib/activity");
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { createdAt: true } });
  if (!user) return { status: 404, body: { error: "ไม่พบผู้ใช้นี้" } };

  const thisYear = Number(dayKey().slice(0, 4));
  const joinYear = Number(dayKey(user.createdAt).slice(0, 4));
  const year = yearRaw ? Number(yearRaw) : null;
  if (year !== null && (!Number.isInteger(year) || year < joinYear || year > thisYear)) {
    return { status: 400, body: { error: "ปีไม่ถูกต้อง" } };
  }

  const today = dayKey();
  let from;
  let to;
  if (year === null) {
    const start = new Date(Date.now() - 364 * 24 * 60 * 60 * 1000);
    from = dayKey(start);
    to = today;
  } else {
    from = `${year}-01-01`;
    to = year === thisYear ? today : `${year}-12-31`;
  }

  const rows = await prisma.userActivityDay.findMany({
    where: { userId, day: { gte: from, lte: to } },
    orderBy: { day: "asc" },
    select: { day: true, count: true },
  });

  // Streaks are over consecutive calendar days with activity.
  const active = new Set(rows.map((r) => r.day));
  const step = (key, delta) => {
    const d = new Date(`${key}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + delta);
    return d.toISOString().slice(0, 10);
  };
  let longest = 0;
  let run = 0;
  let prev = null;
  rows.forEach((r) => {
    run = prev && step(prev, 1) === r.day ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = r.day;
  });
  // "current" counts back from today (or from yesterday if today has no activity yet)
  let current = 0;
  let cursor = active.has(today) ? today : step(today, -1);
  while (active.has(cursor)) {
    current += 1;
    cursor = step(cursor, -1);
  }

  const years = [];
  for (let y = thisYear; y >= joinYear; y--) years.push(y);

  return {
    status: 200,
    body: {
      from,
      to,
      days: rows,
      totalDays: rows.length,
      longestStreak: longest,
      currentStreak: year === null || year === thisYear ? current : 0,
      years,
      joinedAt: user.createdAt,
    },
  };
}

// Daily-activity heatmap data. No `year` = the rolling last 365 days (what
// the Profile page shows by default); `?year=2025` = that calendar year.
async function getMyActivity(req, res) {
  try {
    const { status, body } = await buildActivity(req.userId, req.query.year);
    return res.status(status).json(body);
  } catch (err) {
    console.error("Get activity error:", err);
    return res.status(500).json({ error: "เกิดข้อผิดพลาดในเซิร์ฟเวอร์" });
  }
}

// A friend's heatmap — only for people who are friends with the viewer, and
// only if the owner hasn't switched "activity" off in their privacy settings.
// A hidden heatmap answers 403 { hidden: true } so the modal can say so
// instead of showing a generic error.
async function getUserActivity(req, res) {
  try {
    const { userId } = req.params;
    if (userId !== req.userId) {
      const [x, y] = [req.userId, userId].sort();
      const friendship = await prisma.friendship.findUnique({ where: { userAId_userBId: { userAId: x, userBId: y } } });
      if (!friendship) return res.status(403).json({ error: "ดูกิจกรรมได้เฉพาะเพื่อนเท่านั้น", notFriend: true });
      const owner = await prisma.user.findUnique({ where: { id: userId }, select: { hiddenFields: true } });
      if (!owner) return res.status(404).json({ error: "ไม่พบผู้ใช้นี้" });
      const hidden = Array.isArray(owner.hiddenFields) ? owner.hiddenFields : [];
      if (hidden.includes("activity")) return res.status(403).json({ error: "เจ้าของโปรไฟล์ซ่อนกิจกรรมไว้", hidden: true });
    }
    const { status, body } = await buildActivity(userId, req.query.year);
    return res.status(status).json(body);
  } catch (err) {
    console.error("Get user activity error:", err);
    return res.status(500).json({ error: "เกิดข้อผิดพลาดในเซิร์ฟเวอร์" });
  }
}

const MAX_FRIEND_ID_CHANGES = 2;
const FRIEND_ID_RE = /^[a-z0-9_]{4,20}$/;

// Create / change the ID other people use to add this user as a friend.
// Creating the first one is free; after that it can be changed
// MAX_FRIEND_ID_CHANGES times in total per account.
async function setFriendId(req, res) {
  try {
    const raw = typeof req.body.friendId === "string" ? req.body.friendId.trim().toLowerCase() : "";
    if (!FRIEND_ID_RE.test(raw)) {
      return res.status(400).json({ error: "ID ต้องมี 4–20 ตัว ใช้ได้เฉพาะ a-z, 0-9 และ _" });
    }
    const me = await prisma.user.findUnique({ where: { id: req.userId }, select: { friendId: true, friendIdChangeCount: true } });
    if (!me) return res.status(404).json({ error: "ไม่พบผู้ใช้นี้" });
    if (me.friendId === raw) {
      return res.status(200).json({ friendId: me.friendId, changesLeft: Math.max(0, MAX_FRIEND_ID_CHANGES - me.friendIdChangeCount) });
    }
    const isChange = !!me.friendId;
    if (isChange && me.friendIdChangeCount >= MAX_FRIEND_ID_CHANGES) {
      return res.status(403).json({ error: `เปลี่ยน ID ได้สูงสุด ${MAX_FRIEND_ID_CHANGES} ครั้งต่อบัญชี และคุณใช้ครบแล้ว` });
    }
    try {
      const updated = await prisma.user.update({
        where: { id: req.userId },
        data: { friendId: raw, ...(isChange ? { friendIdChangeCount: { increment: 1 } } : {}) },
        select: { friendId: true, friendIdChangeCount: true },
      });
      return res.status(200).json({ friendId: updated.friendId, changesLeft: Math.max(0, MAX_FRIEND_ID_CHANGES - updated.friendIdChangeCount) });
    } catch (err) {
      if (err.code === "P2002") return res.status(409).json({ error: "ID นี้ถูกใช้แล้ว ลองชื่ออื่นดูนะ" });
      throw err;
    }
  } catch (err) {
    console.error("Set friend id error:", err);
    return res.status(500).json({ error: "เกิดข้อผิดพลาดในเซิร์ฟเวอร์" });
  }
}

async function getMe(req, res) {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId }, select: SAFE_SELECT });
    if (!user) {
      return res.status(404).json({ error: "ไม่พบผู้ใช้นี้" });
    }
    return res.status(200).json({ user: toSafeUser(user) });
  } catch (err) {
    console.error("Get me error:", err);
    return res.status(500).json({ error: "เกิดข้อผิดพลาดในเซิร์ฟเวอร์" });
  }
}

// Public profile card — shown when clicking someone's avatar/name anywhere
// in the app (friends list, group members, chat). Goes through
// toPublicUser() like every other "show me another user" response, so
// whatever that person has hidden (email/org/bio) is left out here too.
// Requires login (not a fully public endpoint like the avatar route) so it
// can't be used to scrape user info from outside the app.
async function getPublicProfile(req, res) {
  try {
    const { userId } = req.params;
    const user = await prisma.user.findUnique({ where: { id: userId }, select: PUBLIC_USER_SELECT });
    if (!user) {
      return res.status(404).json({ error: "ไม่พบผู้ใช้นี้" });
    }
    return res.status(200).json({ user: toPublicUser(user) });
  } catch (err) {
    console.error("Get public profile error:", err);
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

    return res.status(200).json({ user: toSafeUser(user) });
  } catch (err) {
    console.error("Complete profile error:", err);
    return res.status(500).json({ error: "เกิดข้อผิดพลาดในเซิร์ฟเวอร์" });
  }
}

// Editing an already-complete profile — every field is optional so the
// frontend can send just what changed.
async function updateProfile(req, res) {
  try {
    const { name, username, orgType, orgName, bio, hiddenFields } = req.body;
    const data = {};

    if (name !== undefined) {
      if (!name.trim()) {
        return res.status(400).json({ error: "กรุณากรอกชื่อ" });
      }
      data.name = name.trim();
    }

    if (username !== undefined) {
      const trimmed = username.trim();
      if (!trimmed) {
        return res.status(400).json({ error: "กรุณากรอก username" });
      }

      const current = await prisma.user.findUnique({
        where: { id: req.userId },
        select: { username: true, usernameChangeCount: true },
      });

      // Only an actual change counts against the limit — resubmitting the
      // same username (e.g. saving the form without touching it) is a no-op.
      if (trimmed !== current.username) {
        if (current.usernameChangeCount >= MAX_USERNAME_CHANGES) {
          return res.status(403).json({
            error: `เปลี่ยนชื่อผู้ใช้ได้สูงสุด ${MAX_USERNAME_CHANGES} ครั้ง คุณใช้สิทธิ์ครบแล้ว`,
          });
        }

        const existing = await prisma.user.findUnique({ where: { username: trimmed } });
        if (existing && existing.id !== req.userId) {
          return res.status(409).json({ error: "username นี้ถูกใช้แล้ว" });
        }

        data.username = trimmed;
        data.usernameChangeCount = current.usernameChangeCount + 1;
      }
    }

    if (orgType !== undefined) {
      if (!["university", "company"].includes(orgType)) {
        return res.status(400).json({ error: "กรุณาเลือกประเภทองค์กร" });
      }
      data.orgType = orgType;
    }

    if (orgName !== undefined) {
      if (!orgName.trim()) {
        return res.status(400).json({ error: "กรุณากรอกชื่อองค์กร" });
      }
      data.orgName = orgName.trim();
    }

    // Personal blurb — optional, and an empty string is a valid way to
    // clear it (so it's checked against undefined, not falsiness).
    if (bio !== undefined) {
      const trimmed = (bio || "").trim();
      if (trimmed.length > MAX_BIO_LENGTH) {
        return res.status(400).json({ error: `แนะนำตัวได้ไม่เกิน ${MAX_BIO_LENGTH} ตัวอักษร` });
      }
      data.bio = trimmed || null;
    }

    // Which fields to hide from other users — see toPublicUser() in
    // lib/serializeUser.js for where this is actually enforced.
    if (hiddenFields !== undefined) {
      if (!Array.isArray(hiddenFields)) {
        return res.status(400).json({ error: "รูปแบบการตั้งค่าความเป็นส่วนตัวไม่ถูกต้อง" });
      }
      // Silently drop anything outside HIDABLE_FIELDS instead of rejecting
      // the whole request — an account whose stored list still has an old
      // entry (e.g. "email", from before that stopped being togglable)
      // would otherwise fail to save any *other* toggle it flips, since the
      // frontend always resends the full array.
      data.hiddenFields = [...new Set(hiddenFields)].filter((f) => HIDABLE_FIELDS.includes(f));
    }

    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: "ไม่มีข้อมูลที่จะแก้ไข" });
    }

    const user = await prisma.user.update({
      where: { id: req.userId },
      data,
      select: SAFE_SELECT,
    });

    return res.status(200).json({ user: toSafeUser(user) });
  } catch (err) {
    console.error("Update profile error:", err);
    return res.status(500).json({ error: "เกิดข้อผิดพลาดในเซิร์ฟเวอร์" });
  }
}

// The website-wide accent color the user picked — stored per-account so it
// follows them across devices, not just localStorage on this browser.
async function updateTheme(req, res) {
  try {
    const { themeColor } = req.body;
    if (!themeColor || !/^#[0-9A-Fa-f]{6}$/.test(themeColor)) {
      return res.status(400).json({ error: "รูปแบบสีไม่ถูกต้อง" });
    }

    const user = await prisma.user.update({
      where: { id: req.userId },
      data: { themeColor },
      select: SAFE_SELECT,
    });

    return res.status(200).json({ user: toSafeUser(user) });
  } catch (err) {
    console.error("Update theme error:", err);
    return res.status(500).json({ error: "เกิดข้อผิดพลาดในเซิร์ฟเวอร์" });
  }
}

async function uploadAvatarHandler(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "กรุณาเลือกไฟล์รูปภาพ" });
    }

    const user = await prisma.user.update({
      where: { id: req.userId },
      data: {
        avatarData: req.file.buffer,
        avatarMimeType: req.file.mimetype,
        avatarUpdatedAt: new Date(),
      },
      select: SAFE_SELECT,
    });

    return res.status(200).json({ user: toSafeUser(user) });
  } catch (err) {
    console.error("Upload avatar error:", err);
    return res.status(500).json({ error: "อัปโหลดรูปไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" });
  }
}

// Serves the raw image bytes stored on the user row. Unauthenticated on
// purpose — a plain <img src="..."> can't attach an Authorization header,
// same as the old static /uploads/avatars/ file serving this replaces.
async function getAvatarHandler(req, res) {
  try {
    const { userId } = req.params;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { avatarData: true, avatarMimeType: true },
    });

    if (!user || !user.avatarData || !user.avatarMimeType) {
      return res.status(404).end();
    }

    // setHeader (not res.set/res.type) — Express's res.set auto-appends
    // "; charset=..." to Content-Type for some mime types, which is wrong
    // for a binary image response.
    res.setHeader("Content-Type", user.avatarMimeType);
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable"); // safe: URL is versioned via ?v=
    // Prisma's Bytes fields come back as a plain Uint8Array, not a real
    // Node Buffer — Buffer.isBuffer() on it is false, so res.send() would
    // otherwise fall through to res.json() and serialize it as
    // {"0":255,"1":216,...} instead of sending raw bytes. Buffer.from()
    // wraps the same underlying bytes as a real Buffer so res.send() sends
    // them as-is.
    return res.status(200).send(Buffer.from(user.avatarData));
  } catch (err) {
    console.error("Get avatar error:", err);
    return res.status(500).end();
  }
}

// Permanently deletes the account and everything that belongs only to it:
// owned workspaces (personal + any groups they own, board and all), group
// memberships elsewhere, friendships/requests, authored comments, owned
// calendar events, and the avatar file. Tasks they were merely assigned to
// are kept but unassigned, since the task itself belongs to the board.
async function deleteAccount(req, res) {
  try {
    const { password } = req.body;

    const user = await prisma.user.findUnique({ where: { id: req.userId } });
    if (!user) {
      return res.status(404).json({ error: "ไม่พบผู้ใช้นี้" });
    }

    // Only accounts that have a password (local, or OAuth accounts that
    // later set one) are asked to confirm it — OAuth-only accounts have
    // nothing to check against.
    if (user.password) {
      if (!password) {
        return res.status(400).json({ error: "กรุณากรอกรหัสผ่านเพื่อยืนยันการลบบัญชี" });
      }
      const matches = await bcrypt.compare(password, user.password);
      if (!matches) {
        return res.status(401).json({ error: "รหัสผ่านไม่ถูกต้อง" });
      }
    }

    const ownedWorkspaces = await prisma.workspace.findMany({
      where: { ownerId: req.userId },
      select: { id: true },
    });

    await prisma.$transaction(async (tx) => {
      for (const { id: workspaceId } of ownedWorkspaces) {
        const board = await tx.board.findUnique({ where: { workspaceId } });
        if (board) {
          const tasks = await tx.task.findMany({ where: { boardId: board.id }, select: { id: true } });
          const taskIds = tasks.map((t) => t.id);
          if (taskIds.length > 0) {
            await tx.taskComment.deleteMany({ where: { taskId: { in: taskIds } } });
            await tx.subtask.deleteMany({ where: { taskId: { in: taskIds } } });
            await tx.task.deleteMany({ where: { id: { in: taskIds } } });
          }
          await tx.boardCategory.deleteMany({ where: { boardId: board.id } });
          await tx.boardColumn.deleteMany({ where: { boardId: board.id } });
          await tx.board.delete({ where: { id: board.id } });
        }
        await tx.workspaceMember.deleteMany({ where: { workspaceId } });
        await tx.workspace.delete({ where: { id: workspaceId } });
      }

      // Leave any groups owned by someone else.
      await tx.workspaceMember.deleteMany({ where: { userId: req.userId } });

      // Comments this user wrote on tasks in boards they don't own.
      await tx.taskComment.deleteMany({ where: { authorId: req.userId } });

      // Unassign (not delete) tasks elsewhere that were assigned to them.
      await tx.task.updateMany({ where: { assigneeId: req.userId }, data: { assigneeId: null } });

      // Friends / friend requests, either direction.
      await tx.friendship.deleteMany({ where: { OR: [{ userAId: req.userId }, { userBId: req.userId }] } });
      await tx.friendRequest.deleteMany({
        where: { OR: [{ senderId: req.userId }, { receiverId: req.userId }] },
      });

      // Calendar events they own, and their attendee rows; plus their own
      // attendee rows on events owned by someone else.
      const ownedEvents = await tx.event.findMany({ where: { ownerId: req.userId }, select: { id: true } });
      const ownedEventIds = ownedEvents.map((e) => e.id);
      if (ownedEventIds.length > 0) {
        await tx.eventAttendee.deleteMany({ where: { eventId: { in: ownedEventIds } } });
        await tx.event.deleteMany({ where: { id: { in: ownedEventIds } } });
      }
      await tx.eventAttendee.deleteMany({ where: { userId: req.userId } });

      await tx.userActivityDay.deleteMany({ where: { userId: req.userId } });
      await tx.moodEntry.deleteMany({ where: { userId: req.userId } });
      await tx.notification.deleteMany({ where: { userId: req.userId } });

      await tx.user.delete({ where: { id: req.userId } });
    });
    // No file cleanup needed — the avatar was a column on the User row
    // (avatarData), so it's already gone with the row itself.

    return res.status(200).json({ message: "ลบบัญชีแล้ว" });
  } catch (err) {
    console.error("Delete account error:", err);
    return res.status(500).json({ error: "เกิดข้อผิดพลาดในเซิร์ฟเวอร์" });
  }
}

module.exports = {
  getMe,
  getMyActivity,
  getUserActivity,
  setFriendId,
  getPublicProfile,
  completeProfile,
  updateProfile,
  updateTheme,
  uploadAvatarHandler,
  getAvatarHandler,
  deleteAccount,
};
