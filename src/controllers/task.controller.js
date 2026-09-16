const prisma = require("../lib/prisma");
const { getAccessibleBoard, getMembership } = require("../lib/permissions");

const TASK_INCLUDE = {
  subtasks: { orderBy: { createdAt: "asc" } },
  categoryRef: true,
  assignee: { select: { id: true, username: true, name: true } },
  comments: {
    orderBy: { createdAt: "asc" },
    include: { author: { select: { id: true, username: true, name: true } } },
  },
};

// Every task/subtask mutation below re-checks that the requester is a
// member of the task's board's workspace — task ids are just UUIDs a
// client could guess or reuse from another account.
async function loadAccessibleTask(taskId, userId) {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: { board: true },
  });
  if (!task) return null;
  const member = await getMembership(task.board.workspaceId, userId);
  return member ? task : null;
}

async function assertColumnBelongsToBoard(statusId, boardId) {
  const column = await prisma.boardColumn.findUnique({ where: { id: statusId } });
  return column && column.boardId === boardId;
}

// An assignee must be a member of the same workspace as the board.
async function assertAssigneeIsMember(assigneeId, workspaceId) {
  if (!assigneeId) return true;
  const member = await getMembership(workspaceId, assigneeId);
  return !!member;
}

async function createTask(req, res) {
  try {
    const { boardId } = req.params;
    const { title, statusId, dueDate, note, categoryId, priority, assigneeId } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ error: "กรุณากรอกชื่องาน" });
    }

    const board = await getAccessibleBoard(boardId, req.userId);
    if (!board) {
      return res.status(404).json({ error: "ไม่พบบอร์ดนี้" });
    }

    let targetStatusId = statusId;
    if (!targetStatusId) {
      const first = await prisma.boardColumn.findFirst({ where: { boardId }, orderBy: { order: "asc" } });
      targetStatusId = first?.id;
    }
    if (!targetStatusId || !(await assertColumnBelongsToBoard(targetStatusId, boardId))) {
      return res.status(400).json({ error: "สถานะไม่ถูกต้อง" });
    }

    if (!(await assertAssigneeIsMember(assigneeId, board.workspaceId))) {
      return res.status(400).json({ error: "ผู้รับผิดชอบต้องเป็นสมาชิกในกลุ่มนี้" });
    }

    const task = await prisma.task.create({
      data: {
        boardId,
        statusId: targetStatusId,
        title: title.trim(),
        dueDate: dueDate ? new Date(dueDate) : null,
        note: note || null,
        categoryId: categoryId || null,
        priority: priority || null,
        assigneeId: assigneeId || null,
      },
      include: TASK_INCLUDE,
    });

    return res.status(201).json({ task });
  } catch (err) {
    console.error("Create task error:", err);
    return res.status(500).json({ error: "เกิดข้อผิดพลาดในเซิร์ฟเวอร์" });
  }
}

async function updateTask(req, res) {
  try {
    const { taskId } = req.params;
    const { title, statusId, dueDate, note, categoryId, priority, assigneeId, archivedAt } = req.body;

    const existing = await loadAccessibleTask(taskId, req.userId);
    if (!existing) {
      return res.status(404).json({ error: "ไม่พบงานนี้" });
    }

    if (statusId !== undefined && !(await assertColumnBelongsToBoard(statusId, existing.boardId))) {
      return res.status(400).json({ error: "สถานะไม่ถูกต้อง" });
    }
    if (assigneeId !== undefined && !(await assertAssigneeIsMember(assigneeId, existing.board.workspaceId))) {
      return res.status(400).json({ error: "ผู้รับผิดชอบต้องเป็นสมาชิกในกลุ่มนี้" });
    }

    const task = await prisma.task.update({
      where: { id: taskId },
      data: {
        ...(title !== undefined ? { title: title.trim() } : {}),
        ...(statusId !== undefined ? { statusId } : {}),
        ...(dueDate !== undefined ? { dueDate: dueDate ? new Date(dueDate) : null } : {}),
        ...(note !== undefined ? { note } : {}),
        ...(categoryId !== undefined ? { categoryId: categoryId || null } : {}),
        ...(priority !== undefined ? { priority } : {}),
        ...(assigneeId !== undefined ? { assigneeId: assigneeId || null } : {}),
        ...(archivedAt !== undefined ? { archivedAt: archivedAt ? new Date(archivedAt) : null } : {}),
      },
      include: TASK_INCLUDE,
    });

    return res.status(200).json({ task });
  } catch (err) {
    console.error("Update task error:", err);
    return res.status(500).json({ error: "เกิดข้อผิดพลาดในเซิร์ฟเวอร์" });
  }
}

async function deleteTask(req, res) {
  try {
    const { taskId } = req.params;

    const existing = await loadAccessibleTask(taskId, req.userId);
    if (!existing) {
      return res.status(404).json({ error: "ไม่พบงานนี้" });
    }

    await prisma.taskComment.deleteMany({ where: { taskId } });
    await prisma.subtask.deleteMany({ where: { taskId } });
    await prisma.task.delete({ where: { id: taskId } });

    return res.status(200).json({ message: "ลบงานแล้ว" });
  } catch (err) {
    console.error("Delete task error:", err);
    return res.status(500).json({ error: "เกิดข้อผิดพลาดในเซิร์ฟเวอร์" });
  }
}

async function addSubtask(req, res) {
  try {
    const { taskId } = req.params;
    const { title } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ error: "กรุณากรอกชื่อ subtask" });
    }

    const existing = await loadAccessibleTask(taskId, req.userId);
    if (!existing) {
      return res.status(404).json({ error: "ไม่พบงานนี้" });
    }

    const subtask = await prisma.subtask.create({
      data: { taskId, title: title.trim() },
    });

    return res.status(201).json({ subtask });
  } catch (err) {
    console.error("Add subtask error:", err);
    return res.status(500).json({ error: "เกิดข้อผิดพลาดในเซิร์ฟเวอร์" });
  }
}

async function updateSubtask(req, res) {
  try {
    const { subtaskId } = req.params;
    const { title, done } = req.body;

    const subtask = await prisma.subtask.findUnique({
      where: { id: subtaskId },
      include: { task: { include: { board: true } } },
    });
    if (!subtask) {
      return res.status(404).json({ error: "ไม่พบ subtask นี้" });
    }
    const member = await getMembership(subtask.task.board.workspaceId, req.userId);
    if (!member) {
      return res.status(404).json({ error: "ไม่พบ subtask นี้" });
    }

    const updated = await prisma.subtask.update({
      where: { id: subtaskId },
      data: {
        ...(title !== undefined ? { title: title.trim() } : {}),
        ...(done !== undefined ? { done } : {}),
      },
    });

    return res.status(200).json({ subtask: updated });
  } catch (err) {
    console.error("Update subtask error:", err);
    return res.status(500).json({ error: "เกิดข้อผิดพลาดในเซิร์ฟเวอร์" });
  }
}

async function deleteSubtask(req, res) {
  try {
    const { subtaskId } = req.params;

    const subtask = await prisma.subtask.findUnique({
      where: { id: subtaskId },
      include: { task: { include: { board: true } } },
    });
    if (!subtask) {
      return res.status(404).json({ error: "ไม่พบ subtask นี้" });
    }
    const member = await getMembership(subtask.task.board.workspaceId, req.userId);
    if (!member) {
      return res.status(404).json({ error: "ไม่พบ subtask นี้" });
    }

    await prisma.subtask.delete({ where: { id: subtaskId } });

    return res.status(200).json({ message: "ลบ subtask แล้ว" });
  } catch (err) {
    console.error("Delete subtask error:", err);
    return res.status(500).json({ error: "เกิดข้อผิดพลาดในเซิร์ฟเวอร์" });
  }
}

async function addComment(req, res) {
  try {
    const { taskId } = req.params;
    const { content } = req.body;

    if (!content || !content.trim()) {
      return res.status(400).json({ error: "กรุณาพิมพ์ข้อความ" });
    }

    const existing = await loadAccessibleTask(taskId, req.userId);
    if (!existing) {
      return res.status(404).json({ error: "ไม่พบงานนี้" });
    }

    const comment = await prisma.taskComment.create({
      data: { taskId, authorId: req.userId, content: content.trim() },
      include: { author: { select: { id: true, username: true, name: true } } },
    });

    return res.status(201).json({ comment });
  } catch (err) {
    console.error("Add comment error:", err);
    return res.status(500).json({ error: "เกิดข้อผิดพลาดในเซิร์ฟเวอร์" });
  }
}

async function deleteComment(req, res) {
  try {
    const { commentId } = req.params;

    const comment = await prisma.taskComment.findUnique({ where: { id: commentId } });
    if (!comment) {
      return res.status(404).json({ error: "ไม่พบคอมเมนต์นี้" });
    }
    if (comment.authorId !== req.userId) {
      return res.status(403).json({ error: "ลบได้เฉพาะคอมเมนต์ของตัวเอง" });
    }

    await prisma.taskComment.delete({ where: { id: commentId } });
    return res.status(200).json({ message: "ลบคอมเมนต์แล้ว" });
  } catch (err) {
    console.error("Delete comment error:", err);
    return res.status(500).json({ error: "เกิดข้อผิดพลาดในเซิร์ฟเวอร์" });
  }
}

module.exports = {
  createTask,
  updateTask,
  deleteTask,
  addSubtask,
  updateSubtask,
  deleteSubtask,
  addComment,
  deleteComment,
};
