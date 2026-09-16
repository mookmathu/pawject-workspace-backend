const prisma = require("../lib/prisma");
const { getAccessibleBoard } = require("../lib/permissions");

async function createColumn(req, res) {
  try {
    const { boardId } = req.params;
    const { name } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: "กรุณากรอกชื่อสถานะ" });
    }

    const board = await getAccessibleBoard(boardId, req.userId);
    if (!board) {
      return res.status(404).json({ error: "ไม่พบบอร์ดนี้" });
    }

    const maxOrder = await prisma.boardColumn.aggregate({
      where: { boardId },
      _max: { order: true },
    });

    const column = await prisma.boardColumn.create({
      data: {
        boardId,
        name: name.trim(),
        order: (maxOrder._max.order ?? -1) + 1,
      },
    });

    return res.status(201).json({ column });
  } catch (err) {
    console.error("Create column error:", err);
    return res.status(500).json({ error: "เกิดข้อผิดพลาดในเซิร์ฟเวอร์" });
  }
}

async function updateColumn(req, res) {
  try {
    const { columnId } = req.params;
    const { name, color, isDoneColumn } = req.body;

    if (name !== undefined && !name.trim()) {
      return res.status(400).json({ error: "ชื่อสถานะห้ามว่าง" });
    }

    const column = await prisma.boardColumn.findUnique({ where: { id: columnId } });
    if (!column) {
      return res.status(404).json({ error: "ไม่พบสถานะนี้" });
    }
    const board = await getAccessibleBoard(column.boardId, req.userId);
    if (!board) {
      return res.status(404).json({ error: "ไม่พบสถานะนี้" });
    }

    const updated = await prisma.boardColumn.update({
      where: { id: columnId },
      data: {
        ...(name !== undefined ? { name: name.trim() } : {}),
        ...(color !== undefined ? { color } : {}),
        ...(isDoneColumn !== undefined ? { isDoneColumn } : {}),
      },
    });

    return res.status(200).json({ column: updated });
  } catch (err) {
    console.error("Update column error:", err);
    return res.status(500).json({ error: "เกิดข้อผิดพลาดในเซิร์ฟเวอร์" });
  }
}

async function deleteColumn(req, res) {
  try {
    const { columnId } = req.params;

    const column = await prisma.boardColumn.findUnique({
      where: { id: columnId },
      include: { tasks: true },
    });
    if (!column) {
      return res.status(404).json({ error: "ไม่พบสถานะนี้" });
    }
    const board = await getAccessibleBoard(column.boardId, req.userId);
    if (!board) {
      return res.status(404).json({ error: "ไม่พบสถานะนี้" });
    }
    if (column.tasks.length > 0) {
      return res.status(400).json({ error: "ลบไม่ได้ เพราะยังมีงานอยู่ในสถานะนี้ — ย้ายงานออกก่อน" });
    }

    await prisma.boardColumn.delete({ where: { id: columnId } });
    return res.status(200).json({ message: "ลบสถานะแล้ว" });
  } catch (err) {
    console.error("Delete column error:", err);
    return res.status(500).json({ error: "เกิดข้อผิดพลาดในเซิร์ฟเวอร์" });
  }
}

module.exports = { createColumn, updateColumn, deleteColumn };
