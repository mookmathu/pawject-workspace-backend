const prisma = require("../lib/prisma");
const { getMembership, getAccessibleBoard } = require("../lib/permissions");

const DEFAULT_COLUMNS = [
  { name: "Not started", isDoneColumn: false },
  { name: "In progress", isDoneColumn: false },
  { name: "Blocked", isDoneColumn: false },
  { name: "Done", isDoneColumn: true },
];

const DEFAULT_CATEGORIES = [
  { name: "งานทั่วไป", color: "#E7E2D6" },
  { name: "การพัฒนา", color: "#F6D3D0" },
  { name: "การออกแบบ", color: "#D7E8FB" },
  { name: "การประชุม", color: "#E3DEF6" },
];

const BOARD_INCLUDE = {
  columns: { orderBy: { order: "asc" } },
  categories: { orderBy: { createdAt: "asc" } },
  tasks: {
    orderBy: { createdAt: "asc" },
    include: {
      subtasks: { orderBy: { createdAt: "asc" } },
      categoryRef: true,
      assignee: { select: { id: true, username: true, name: true } },
      comments: {
        orderBy: { createdAt: "asc" },
        include: { author: { select: { id: true, username: true, name: true } } },
      },
    },
  },
};

// Get-or-create the board for one workspace, checking the requester is a member.
async function getWorkspaceBoard(req, res) {
  try {
    const { workspaceId } = req.params;

    const member = await getMembership(workspaceId, req.userId);
    if (!member) {
      return res.status(404).json({ error: "ไม่พบกลุ่มนี้" });
    }

    let board = await prisma.board.findUnique({
      where: { workspaceId },
      include: BOARD_INCLUDE,
    });

    if (!board) {
      board = await prisma.board.create({
        data: {
          workspaceId,
          name: "My Board",
          columns: { create: DEFAULT_COLUMNS.map((c, i) => ({ ...c, order: i })) },
          categories: { create: DEFAULT_CATEGORIES },
        },
        include: BOARD_INCLUDE,
      });
    }

    return res.status(200).json({ board });
  } catch (err) {
    console.error("Get workspace board error:", err);
    return res.status(500).json({ error: "เกิดข้อผิดพลาดในเซิร์ฟเวอร์" });
  }
}

async function updateBoardNote(req, res) {
  try {
    const { boardId } = req.params;
    const { noteContent } = req.body;

    if (!Array.isArray(noteContent)) {
      return res.status(400).json({ error: "รูปแบบโน้ตไม่ถูกต้อง" });
    }

    const board = await getAccessibleBoard(boardId, req.userId);
    if (!board) {
      return res.status(404).json({ error: "ไม่พบบอร์ดนี้" });
    }

    const updated = await prisma.board.update({
      where: { id: boardId },
      data: { noteContent },
    });

    return res.status(200).json({ noteContent: updated.noteContent });
  } catch (err) {
    console.error("Update board note error:", err);
    return res.status(500).json({ error: "เกิดข้อผิดพลาดในเซิร์ฟเวอร์" });
  }
}

module.exports = { getWorkspaceBoard, updateBoardNote, BOARD_INCLUDE };
