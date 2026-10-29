const prisma = require("../lib/prisma");
const { getAccessibleBoard, getMembership, canEditTask } = require("../lib/permissions");
const { createNotification } = require("../lib/notify");

const NOT_ASSIGNEE_ERROR = "งานนี้ถูกมอบหมายแล้ว ขอสงวนสิทธิ์แก้ไขให้เฉพาะผู้รับผิดชอบกับ Head กลุ่มนะคะ — ใครจะคอมเมนต์ก็ตามสบายเลย";

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
// client could guess or reuse from another account. Returns the task
// together with the requester's membership row (role + userId), which
// callers that mutate the task need anyway to run canEditTask().
async function loadAccessibleTask(taskId, userId) {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: { board: true },
  });
  if (!task) return null;
  const membership = await getMembership(task.board.workspaceId, userId);
  if (!membership) return null;
  return { task, membership };
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
    if (!canEditTask(existing.task, existing.membership)) {
      return res.status(403).json({ error: NOT_ASSIGNEE_ERROR });
    }

    if (statusId !== undefined && !(await assertColumnBelongsToBoard(statusId, existing.task.boardId))) {
      return res.status(400).json({ error: "สถานะไม่ถูกต้อง" });
    }
    if (assigneeId !== undefined && !(await assertAssigneeIsMember(assigneeId, existing.task.board.workspaceId))) {
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

    // Tell the new assignee — but only when someone actually just handed
    // them the task (a real change, not resubmitting the same value), and
    // not when they assigned it to themselves.
    if (
      assigneeId !== undefined &&
      task.assigneeId &&
      task.assigneeId !== existing.task.assigneeId &&
      task.assigneeId !== req.userId
    ) {
      void createNotification({
        userId: task.assigneeId,
        type: "task_assigned",
        title: `คุณได้รับมอบหมายงาน "${task.title}"`,
        link: { type: "task", taskId: task.id, boardId: task.boardId, workspaceId: existing.task.board.workspaceId },
      });
    }

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
    if (!canEditTask(existing.task, existing.membership)) {
      return res.status(403).json({ error: NOT_ASSIGNEE_ERROR });
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
    if (!canEditTask(existing.task, existing.membership)) {
      return res.status(403).json({ error: NOT_ASSIGNEE_ERROR });
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
    if (!canEditTask(subtask.task, member)) {
      return res.status(403).json({ error: NOT_ASSIGNEE_ERROR });
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
    if (!canEditTask(subtask.task, member)) {
      return res.status(403).json({ error: NOT_ASSIGNEE_ERROR });
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

    // Only the assignee is notified — they're the one whose task this
    // comment landed on. (If they're the one commenting, there's no one to
    // tell.)
    if (existing.task.assigneeId && existing.task.assigneeId !== req.userId) {
      void createNotification({
        userId: existing.task.assigneeId,
        type: "task_comment",
        title: `${comment.author.name} คอมเมนต์ในงาน "${existing.task.title}"`,
        body: comment.content.slice(0, 140),
        link: { type: "task", taskId, boardId: existing.task.boardId, workspaceId: existing.task.board.workspaceId },
      });
    }

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

// Every non-archived, not-yet-done task assigned to me, across every board
// I can see — powers the Home page's "งานใกล้ครบกำหนดของฉัน" dashboard
// section. Sorted with a due date first (soonest first); tasks with no due
// date trail behind those, since there's nothing to be "soon" about.
async function getMyTasks(req, res) {
  try {
    const tasks = await prisma.task.findMany({
      where: { assigneeId: req.userId, archivedAt: null },
      include: {
        board: { include: { workspace: { select: { id: true, name: true, isPersonal: true } } } },
        statusColumn: { select: { isDoneColumn: true } },
        categoryRef: true,
      },
    });

    const shaped = tasks
      .map((t) => ({
        id: t.id,
        title: t.title,
        dueDate: t.dueDate,
        priority: t.priority,
        boardId: t.boardId,
        workspaceId: t.board.workspaceId,
        workspaceName: t.board.workspace.isPersonal ? "ของฉัน" : t.board.workspace.name,
        categoryRef: t.categoryRef,
        isDoneColumn: t.statusColumn?.isDoneColumn || false,
      }))
      .filter((t) => !t.isDoneColumn)
      .sort((a, b) => {
        if (!a.dueDate && !b.dueDate) return 0;
        if (!a.dueDate) return 1;
        if (!b.dueDate) return -1;
        return new Date(a.dueDate) - new Date(b.dueDate);
      })
      .slice(0, 30);

    return res.status(200).json({ tasks: shaped });
  } catch (err) {
    console.error("Get my tasks error:", err);
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
  getMyTasks,
};
