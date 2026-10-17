const prisma = require("./prisma");

// Returns the membership row if the user belongs to this workspace, else null.
async function getMembership(workspaceId, userId) {
  return prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
  });
}

// Returns the board if it exists AND the user is a member of its workspace.
async function getAccessibleBoard(boardId, userId) {
  const board = await prisma.board.findUnique({ where: { id: boardId } });
  if (!board) return null;
  const member = await getMembership(board.workspaceId, userId);
  return member ? board : null;
}

// Once a task has an assignee, only that assignee or the workspace's owner
// ("Head" in the UI) may edit it (fields, status, subtasks) or delete it —
// everyone else who can see the board can still view the task and comment
// on it, just not change it. A task with no assignee yet has no such
// restriction: any member can work on it, same as before this existed.
function canEditTask(task, membership) {
  if (!task.assigneeId) return true;
  if (membership.role === "owner") return true;
  return task.assigneeId === membership.userId;
}

module.exports = { getMembership, getAccessibleBoard, canEditTask };
