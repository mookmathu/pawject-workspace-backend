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

module.exports = { getMembership, getAccessibleBoard };
