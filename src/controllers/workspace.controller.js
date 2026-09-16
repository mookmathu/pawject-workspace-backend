const prisma = require("../lib/prisma");

// Every workspace list includes a member count and, for the caller, their
// role — enough for the frontend dropdown + "who's in this group" display.
const WORKSPACE_INCLUDE = {
  members: {
    include: { user: { select: { id: true, username: true, name: true } } },
  },
};

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
      include: WORKSPACE_INCLUDE,
      orderBy: [{ isPersonal: "desc" }, { createdAt: "asc" }],
    });

    return res.status(200).json({ workspaces });
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

    const workspace = await prisma.workspace.create({
      data: {
        name: name.trim(),
        isPersonal: false,
        ownerId: req.userId,
        members: { create: { userId: req.userId, role: "owner" } },
      },
      include: WORKSPACE_INCLUDE,
    });

    return res.status(201).json({ workspace });
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
      include: { user: { select: { id: true, username: true, name: true } } },
    });

    return res.status(201).json({ member });
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

module.exports = { getMyWorkspaces, createWorkspace, addMember, removeMember, deleteWorkspace };
