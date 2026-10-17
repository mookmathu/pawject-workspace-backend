const crypto = require("crypto");
const prisma = require("../lib/prisma");
const { PUBLIC_USER_SELECT, toPublicUser } = require("../lib/serializeUser");

// Explicit select (not the default-fields `include`) so imageData — the
// group photo's raw bytes — never comes along for the ride on an ordinary
// workspace list/create call. Same reasoning as Message/User: the bytes are
// only ever fetched by their own dedicated "serve the image" handler.
const WORKSPACE_SELECT = {
  id: true,
  name: true,
  isPersonal: true,
  ownerId: true,
  imageMimeType: true,
  imageUpdatedAt: true,
  joinCode: true,
  createdAt: true,
  members: {
    include: { user: { select: PUBLIC_USER_SELECT } },
  },
};

// Excludes 0/O and 1/I/L — easy to mix up when someone reads the code out
// loud or copies it by hand. 6 characters from this 32-symbol alphabet is
// ~3x10^8 possibilities, plenty to make collisions a non-issue in practice;
// the retry loop below handles the rare one anyway.
const JOIN_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function generateJoinCode() {
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += JOIN_CODE_ALPHABET[crypto.randomInt(JOIN_CODE_ALPHABET.length)];
  }
  return code;
}

// Prisma throws P2002 on a unique-constraint collision — vanishingly rare
// for a 6-character code, but cheap to just retry a handful of times
// instead of leaving a 1-in-300-million request to fail outright.
async function withUniqueJoinCode(createOrUpdate) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await createOrUpdate(generateJoinCode());
    } catch (err) {
      if (err.code === "P2002" && attempt < 4) continue;
      throw err;
    }
  }
}

// Same "compute the URL, strip the raw bytes/mime out of the payload"
// pattern as serializeUser.js's toSafeUser — a workspace row select never
// includes imageData in the first place (see below), so this only ever
// needs to turn imageMimeType/imageUpdatedAt into a URL and pass everything
// else (including each member's own avatarUrl) through.
function serializeWorkspace(workspace) {
  const { imageMimeType, imageUpdatedAt, ...rest } = workspace;
  const imageUrl = imageMimeType ? `/api/workspaces/${workspace.id}/image?v=${new Date(imageUpdatedAt).getTime()}` : null;
  return {
    ...rest,
    imageUrl,
    members: workspace.members?.map((m) => ({ ...m, user: toPublicUser(m.user) })),
  };
}

async function ensurePersonalWorkspace(userId) {
  let personal = await prisma.workspace.findFirst({
    where: { ownerId: userId, isPersonal: true },
  });
  if (!personal) {
    personal = await prisma.workspace.create({
      data: {
        name: "ของฉัน",
        isPersonal: true,
        ownerId: userId,
        members: { create: { userId, role: "owner" } },
      },
    });
  }
  return personal;
}

async function getMyWorkspaces(req, res) {
  try {
    await ensurePersonalWorkspace(req.userId);

    const workspaces = await prisma.workspace.findMany({
      where: { members: { some: { userId: req.userId } } },
      select: WORKSPACE_SELECT,
      orderBy: [{ isPersonal: "desc" }, { createdAt: "asc" }],
    });

    return res.status(200).json({ workspaces: workspaces.map(serializeWorkspace) });
  } catch (err) {
    console.error("Get workspaces error:", err);
    return res.status(500).json({ error: "เกิดข้อผิดพลาดในเซิร์ฟเวอร์" });
  }
}

async function createWorkspace(req, res) {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: "กรุณากรอกชื่อกลุ่ม" });
    }

    const workspace = await withUniqueJoinCode((joinCode) =>
      prisma.workspace.create({
        data: {
          name: name.trim(),
          isPersonal: false,
          ownerId: req.userId,
          joinCode,
          members: { create: { userId: req.userId, role: "owner" } },
        },
        select: WORKSPACE_SELECT,
      })
    );

    return res.status(201).json({ workspace: serializeWorkspace(workspace) });
  } catch (err) {
    console.error("Create workspace error:", err);
    return res.status(500).json({ error: "เกิดข้อผิดพลาดในเซิร์ฟเวอร์" });
  }
}

async function addMember(req, res) {
  try {
    const { workspaceId } = req.params;
    const { username } = req.body;

    if (!username || !username.trim()) {
      return res.status(400).json({ error: "กรุณาระบุ username" });
    }

    const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId } });
    if (!workspace) {
      return res.status(404).json({ error: "ไม่พบกลุ่มนี้" });
    }
    if (workspace.isPersonal) {
      return res.status(400).json({ error: "ไม่สามารถเชิญสมาชิกเข้ากลุ่มส่วนตัวได้" });
    }

    const requesterMembership = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: req.userId } },
    });
    if (!requesterMembership) {
      return res.status(403).json({ error: "คุณไม่ได้อยู่ในกลุ่มนี้" });
    }

    const targetUser = await prisma.user.findUnique({ where: { username: username.trim() } });
    if (!targetUser) {
      return res.status(404).json({ error: `ไม่พบผู้ใช้ @${username.trim()}` });
    }

    const existing = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: targetUser.id } },
    });
    if (existing) {
      return res.status(409).json({ error: "ผู้ใช้นี้อยู่ในกลุ่มอยู่แล้ว" });
    }

    const member = await prisma.workspaceMember.create({
      data: { workspaceId, userId: targetUser.id, role: "member" },
      include: { user: { select: PUBLIC_USER_SELECT } },
    });

    return res.status(201).json({ member: { ...member, user: toPublicUser(member.user) } });
  } catch (err) {
    console.error("Add workspace member error:", err);
    return res.status(500).json({ error: "เกิดข้อผิดพลาดในเซิร์ฟเวอร์" });
  }
}

async function removeMember(req, res) {
  try {
    const { workspaceId, userId } = req.params;

    const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId } });
    if (!workspace) {
      return res.status(404).json({ error: "ไม่พบกลุ่มนี้" });
    }

    // Anyone can remove themself (leave); only the owner can remove others.
    if (userId !== req.userId && workspace.ownerId !== req.userId) {
      return res.status(403).json({ error: "คุณไม่มีสิทธิ์ลบสมาชิกคนนี้" });
    }
    if (userId === workspace.ownerId) {
      return res.status(400).json({ error: "เจ้าของกลุ่มออกจากกลุ่มไม่ได้ ลบกลุ่มแทน" });
    }

    await prisma.workspaceMember.deleteMany({ where: { workspaceId, userId } });
    return res.status(200).json({ message: "ลบสมาชิกแล้ว" });
  } catch (err) {
    console.error("Remove workspace member error:", err);
    return res.status(500).json({ error: "เกิดข้อผิดพลาดในเซิร์ฟเวอร์" });
  }
}

// Deletes the whole group: its board and everything on that board (tasks,
// subtasks, comments, columns, categories), then its members, then the
// workspace itself. Owner only — and never the personal workspace, since
// that one is auto-managed and every user is expected to have exactly one.
async function deleteWorkspace(req, res) {
  try {
    const { workspaceId } = req.params;

    const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId } });
    if (!workspace) {
      return res.status(404).json({ error: "ไม่พบกลุ่มนี้" });
    }
    if (workspace.ownerId !== req.userId) {
      return res.status(403).json({ error: "เฉพาะเจ้าของกลุ่มเท่านั้นที่ลบกลุ่มได้" });
    }
    if (workspace.isPersonal) {
      return res.status(400).json({ error: "ลบกลุ่มส่วนตัวไม่ได้" });
    }

    const board = await prisma.board.findUnique({ where: { workspaceId } });

    await prisma.$transaction(async (tx) => {
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
    });

    return res.status(200).json({ message: "ลบกลุ่มแล้ว" });
  } catch (err) {
    console.error("Delete workspace error:", err);
    return res.status(500).json({ error: "เกิดข้อผิดพลาดในเซิร์ฟเวอร์" });
  }
}

// Owner-only, same reasoning as who's allowed to delete the group — a
// shared group photo isn't something every member should be able to
// overwrite. Multer's uploadAvatar instance is reused as-is: same allowed
// image types and 5MB cap fit a group photo just as well as a profile one.
async function uploadWorkspaceImage(req, res) {
  try {
    const { workspaceId } = req.params;
    if (!req.file) {
      return res.status(400).json({ error: "กรุณาเลือกรูปภาพ" });
    }

    const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId } });
    if (!workspace) {
      return res.status(404).json({ error: "ไม่พบกลุ่มนี้" });
    }
    if (workspace.ownerId !== req.userId) {
      return res.status(403).json({ error: "เฉพาะเจ้าของกลุ่มเท่านั้นที่เปลี่ยนรูปกลุ่มได้" });
    }

    const updated = await prisma.workspace.update({
      where: { id: workspaceId },
      data: {
        imageData: req.file.buffer,
        imageMimeType: req.file.mimetype,
        imageUpdatedAt: new Date(),
      },
      select: WORKSPACE_SELECT,
    });

    return res.status(200).json({ workspace: serializeWorkspace(updated) });
  } catch (err) {
    console.error("Upload workspace image error:", err);
    return res.status(500).json({ error: "เกิดข้อผิดพลาดในเซิร์ฟเวอร์" });
  }
}

// Unauthenticated, same as profile.controller.js's getAvatarHandler — a
// plain <img src> can't attach an Authorization header, and a workspace id
// (a random UUID) isn't something you could guess your way into anyway.
async function getWorkspaceImage(req, res) {
  try {
    const { workspaceId } = req.params;
    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { imageData: true, imageMimeType: true },
    });

    if (!workspace || !workspace.imageData || !workspace.imageMimeType) {
      return res.status(404).end();
    }

    res.setHeader("Content-Type", workspace.imageMimeType);
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable"); // safe: URL is versioned via ?v=
    return res.status(200).send(Buffer.from(workspace.imageData));
  } catch (err) {
    console.error("Get workspace image error:", err);
    return res.status(500).json({ error: "เกิดข้อผิดพลาดในเซิร์ฟเวอร์" });
  }
}

// Owner-only — rotating the code invalidates the old one immediately (any
// link/code someone shared before this stops working), same as regenerating
// an API key.
async function regenerateJoinCode(req, res) {
  try {
    const { workspaceId } = req.params;

    const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId } });
    if (!workspace) {
      return res.status(404).json({ error: "ไม่พบกลุ่มนี้" });
    }
    if (workspace.ownerId !== req.userId) {
      return res.status(403).json({ error: "เฉพาะเจ้าของกลุ่มเท่านั้นที่สร้างรหัสใหม่ได้" });
    }
    if (workspace.isPersonal) {
      return res.status(400).json({ error: "กลุ่มส่วนตัวไม่มีรหัสเข้ากลุ่ม" });
    }

    const updated = await withUniqueJoinCode((joinCode) =>
      prisma.workspace.update({ where: { id: workspaceId }, data: { joinCode }, select: WORKSPACE_SELECT })
    );

    return res.status(200).json({ workspace: serializeWorkspace(updated) });
  } catch (err) {
    console.error("Regenerate join code error:", err);
    return res.status(500).json({ error: "เกิดข้อผิดพลาดในเซิร์ฟเวอร์" });
  }
}

// Anyone signed in can join a group this way — the code stands in for an
// invite, same trust level as being added by username, just self-service.
async function joinWorkspaceByCode(req, res) {
  try {
    const { code } = req.body;
    if (!code || !code.trim()) {
      return res.status(400).json({ error: "กรุณากรอกรหัสเข้ากลุ่ม" });
    }

    const workspace = await prisma.workspace.findUnique({
      where: { joinCode: code.trim().toUpperCase() },
    });
    if (!workspace) {
      return res.status(404).json({ error: "รหัสเข้ากลุ่มไม่ถูกต้องหรือหมดอายุแล้ว" });
    }

    const existing = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: workspace.id, userId: req.userId } },
    });
    if (existing) {
      return res.status(409).json({ error: "คุณอยู่ในกลุ่มนี้อยู่แล้ว" });
    }

    await prisma.workspaceMember.create({
      data: { workspaceId: workspace.id, userId: req.userId, role: "member" },
    });

    const full = await prisma.workspace.findUnique({ where: { id: workspace.id }, select: WORKSPACE_SELECT });
    return res.status(200).json({ workspace: serializeWorkspace(full) });
  } catch (err) {
    console.error("Join workspace by code error:", err);
    return res.status(500).json({ error: "เกิดข้อผิดพลาดในเซิร์ฟเวอร์" });
  }
}

// Only the current Head can hand the role off, and only to someone already
// in the group — "สละสิทธิ์และเลือกคนที่จะมาเป็น Head ต่อเท่านั้น". Swaps
// both the workspace's ownerId and the two members' roles in one
// transaction so the group is never left with zero or two owners.
async function transferOwnership(req, res) {
  try {
    const { workspaceId } = req.params;
    const { userId: nextOwnerId } = req.body;

    if (!nextOwnerId) {
      return res.status(400).json({ error: "กรุณาเลือกสมาชิกที่จะเป็น Head คนใหม่" });
    }

    const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId } });
    if (!workspace) {
      return res.status(404).json({ error: "ไม่พบกลุ่มนี้" });
    }
    if (workspace.ownerId !== req.userId) {
      return res.status(403).json({ error: "เฉพาะ Head กลุ่มเท่านั้นที่โอนสิทธิ์ได้" });
    }
    if (workspace.isPersonal) {
      return res.status(400).json({ error: "กลุ่มส่วนตัวโอนสิทธิ์ไม่ได้" });
    }
    if (nextOwnerId === req.userId) {
      return res.status(400).json({ error: "คุณเป็น Head อยู่แล้ว" });
    }

    const targetMembership = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: nextOwnerId } },
    });
    if (!targetMembership) {
      return res.status(400).json({ error: "เลือกได้เฉพาะสมาชิกที่อยู่ในกลุ่มนี้เท่านั้น" });
    }

    const updated = await prisma.$transaction(async (tx) => {
      await tx.workspace.update({ where: { id: workspaceId }, data: { ownerId: nextOwnerId } });
      await tx.workspaceMember.update({
        where: { workspaceId_userId: { workspaceId, userId: nextOwnerId } },
        data: { role: "owner" },
      });
      await tx.workspaceMember.update({
        where: { workspaceId_userId: { workspaceId, userId: req.userId } },
        data: { role: "member" },
      });
      return tx.workspace.findUnique({ where: { id: workspaceId }, select: WORKSPACE_SELECT });
    });

    return res.status(200).json({ workspace: serializeWorkspace(updated) });
  } catch (err) {
    console.error("Transfer workspace ownership error:", err);
    return res.status(500).json({ error: "เกิดข้อผิดพลาดในเซิร์ฟเวอร์" });
  }
}

module.exports = {
  getMyWorkspaces,
  createWorkspace,
  addMember,
  removeMember,
  deleteWorkspace,
  uploadWorkspaceImage,
  getWorkspaceImage,
  regenerateJoinCode,
  joinWorkspaceByCode,
  transferOwnership,
};
