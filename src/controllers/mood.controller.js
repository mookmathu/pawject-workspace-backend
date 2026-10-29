const prisma = require("../lib/prisma");
const { dayKey } = require("../lib/activity");

const MOODS = new Set(["great", "good", "ok", "tired", "stressed", "sad", "angry", "love"]);
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;
const NOTE_MAX = 280;

const PUBLIC_FIELDS = {
  day: true,
  mood: true,
  note: true,
  imageMimeType: true,
  updatedAt: true,
};

function toDto(e) {
  return { day: e.day, mood: e.mood, note: e.note || "", hasImage: !!e.imageMimeType, updatedAt: e.updatedAt };
}

// GET /api/mood?month=YYYY-MM  → that month's entries
// GET /api/mood?day=YYYY-MM-DD → a single day (entry or null)
// GET /api/mood?recent=N       → the last N days (default 90), for stats
async function listMood(req, res) {
  try {
    const { month, day, recent } = req.query;

    if (day) {
      if (!DAY_RE.test(day)) return res.status(400).json({ error: "รูปแบบวันที่ไม่ถูกต้อง" });
      const e = await prisma.moodEntry.findUnique({
        where: { userId_day: { userId: req.userId, day } },
        select: PUBLIC_FIELDS,
      });
      return res.status(200).json({ entry: e ? toDto(e) : null, today: dayKey() });
    }

    let where;
    if (month) {
      if (!MONTH_RE.test(month)) return res.status(400).json({ error: "รูปแบบเดือนไม่ถูกต้อง" });
      where = { userId: req.userId, day: { startsWith: `${month}-` } };
    } else {
      const n = Math.min(Math.max(Number.parseInt(recent, 10) || 90, 1), 400);
      const from = dayKey(new Date(Date.now() - n * 86400000));
      where = { userId: req.userId, day: { gte: from } };
    }

    const rows = await prisma.moodEntry.findMany({ where, select: PUBLIC_FIELDS, orderBy: { day: "asc" } });
    return res.status(200).json({ entries: rows.map(toDto), today: dayKey() });
  } catch (err) {
    console.error("List mood error:", err);
    return res.status(500).json({ error: "เกิดข้อผิดพลาดในเซิร์ฟเวอร์" });
  }
}

// PUT /api/mood/:day  (multipart: mood, note, image?, removeImage?)
// Past days and today can be filled in; future days can't.
async function saveMood(req, res) {
  try {
    const { day } = req.params;
    if (!DAY_RE.test(day)) return res.status(400).json({ error: "รูปแบบวันที่ไม่ถูกต้อง" });
    if (day > dayKey()) return res.status(400).json({ error: "ยังบันทึกอารมณ์ล่วงหน้าไม่ได้" });

    const mood = String(req.body.mood || "");
    if (!MOODS.has(mood)) return res.status(400).json({ error: "กรุณาเลือกอารมณ์" });

    const note = String(req.body.note || "").trim().slice(0, NOTE_MAX);

    const data = { mood, note: note || null };
    if (req.file) {
      data.imageData = req.file.buffer;
      data.imageMimeType = req.file.mimetype;
    } else if (req.body.removeImage === "1") {
      data.imageData = null;
      data.imageMimeType = null;
    }

    const e = await prisma.moodEntry.upsert({
      where: { userId_day: { userId: req.userId, day } },
      create: { userId: req.userId, day, ...data },
      update: data,
      select: PUBLIC_FIELDS,
    });
    return res.status(200).json({ entry: toDto(e) });
  } catch (err) {
    console.error("Save mood error:", err);
    return res.status(500).json({ error: "บันทึกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" });
  }
}

async function deleteMood(req, res) {
  try {
    const { day } = req.params;
    if (!DAY_RE.test(day)) return res.status(400).json({ error: "รูปแบบวันที่ไม่ถูกต้อง" });
    await prisma.moodEntry.deleteMany({ where: { userId: req.userId, day } });
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Delete mood error:", err);
    return res.status(500).json({ error: "เกิดข้อผิดพลาดในเซิร์ฟเวอร์" });
  }
}

// Authenticated (the client fetches it with the bearer token and shows it
// via an object URL) so a private meme can't be loaded by anyone else.
async function getMoodImage(req, res) {
  try {
    const { day } = req.params;
    if (!DAY_RE.test(day)) return res.status(400).end();
    const e = await prisma.moodEntry.findUnique({
      where: { userId_day: { userId: req.userId, day } },
      select: { imageData: true, imageMimeType: true },
    });
    if (!e || !e.imageData || !e.imageMimeType) return res.status(404).end();
    res.setHeader("Content-Type", e.imageMimeType);
    res.setHeader("Cache-Control", "private, max-age=3600");
    return res.status(200).send(Buffer.from(e.imageData));
  } catch (err) {
    console.error("Get mood image error:", err);
    return res.status(500).end();
  }
}

module.exports = { listMood, saveMood, deleteMood, getMoodImage };
