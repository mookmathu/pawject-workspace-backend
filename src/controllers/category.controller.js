const prisma = require("../lib/prisma");
const { getAccessibleBoard } = require("../lib/permissions");

async function createCategory(req, res) {
  try {
    const { boardId } = req.params;
    const { name, color } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: "กรุณากรอกชื่อหมวดหมู่" });
    }

    const board = await getAccessibleBoard(boardId, req.userId);
    if (!board) {
      return res.status(404).json({ error: "ไม่พบบอร์ดนี้" });
    }

    const category = await prisma.boardCategory.create({
      data: { boardId, name: name.trim(), color: color || "#E7E2D6" },
    });

    return res.status(201).json({ category });
  } catch (err) {
    console.error("Create category error:", err);
    return res.status(500).json({ error: "เกิดข้อผิดพลาดในเซิร์ฟเวอร์" });
  }
}

async function updateCategory(req, res) {
  try {
    const { categoryId } = req.params;
    const { name, color } = req.body;

    if (name !== undefined && !name.trim()) {
      return res.status(400).json({ error: "ชื่อหมวดหมู่ห้ามว่าง" });
    }

    const category = await prisma.boardCategory.findUnique({ where: { id: categoryId } });
    if (!category) {
      return res.status(404).json({ error: "ไม่พบหมวดหมู่นี้" });
    }
    const board = await getAccessibleBoard(category.boardId, req.userId);
    if (!board) {
      return res.status(404).json({ error: "ไม่พบหมวดหมู่นี้" });
    }

    const updated = await prisma.boardCategory.update({
      where: { id: categoryId },
      data: {
        ...(name !== undefined ? { name: name.trim() } : {}),
        ...(color !== undefined ? { color } : {}),
      },
    });

    return res.status(200).json({ category: updated });
  } catch (err) {
    console.error("Update category error:", err);
    return res.status(500).json({ error: "เกิดข้อผิดพลาดในเซิร์ฟเวอร์" });
  }
}

async function deleteCategory(req, res) {
  try {
    const { categoryId } = req.params;

    const category = await prisma.boardCategory.findUnique({
      where: { id: categoryId },
      include: { tasks: true },
    });
    if (!category) {
      return res.status(404).json({ error: "ไม่พบหมวดหมู่นี้" });
    }
    const board = await getAccessibleBoard(category.boardId, req.userId);
    if (!board) {
      return res.status(404).json({ error: "ไม่พบหมวดหมู่นี้" });
    }

    // Rather than blocking the delete, just clear the tag off any tasks
    // using it — losing a category shouldn't strand a task.
    if (category.tasks.length > 0) {
      await prisma.task.updateMany({
        where: { categoryId },
        data: { categoryId: null },
      });
    }

    await prisma.boardCategory.delete({ where: { id: categoryId } });
    return res.status(200).json({ message: "ลบหมวดหมู่แล้ว" });
  } catch (err) {
    console.error("Delete category error:", err);
    return res.status(500).json({ error: "เกิดข้อผิดพลาดในเซิร์ฟเวอร์" });
  }
}

module.exports = { createCategory, updateCategory, deleteCategory };
