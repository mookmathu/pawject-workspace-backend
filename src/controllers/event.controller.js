const prisma = require("../lib/prisma");

const EVENT_INCLUDE = {
  owner: { select: { id: true, username: true, name: true } },
  attendees: {
    include: { user: { select: { id: true, username: true, name: true } } },
  },
};

async function loadOwnedEvent(eventId, userId) {
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event || event.ownerId !== userId) return null;
  return event;
}

// Resolves a list of usernames to real User ids, skipping the current user
// and any username that doesn't exist. Returns { userIds, notFound }.
async function resolveUsernames(usernames, excludeUserId) {
  if (!usernames || usernames.length === 0) return { userIds: [], notFound: [] };

  const unique = [...new Set(usernames.map((u) => u.trim()).filter(Boolean))];
  const users = await prisma.user.findMany({
    where: { username: { in: unique } },
    select: { id: true, username: true },
  });

  const found = new Set(users.map((u) => u.username));
  const notFound = unique.filter((u) => !found.has(u));
  const userIds = users.map((u) => u.id).filter((id) => id !== excludeUserId);

  return { userIds, notFound };
}

async function getEvents(req, res) {
  try {
    const { year, month } = req.query; // month is 1-12

    const visibility = {
      OR: [{ ownerId: req.userId }, { attendees: { some: { userId: req.userId } } }],
    };

    let where = visibility;
    if (year && month) {
      const y = parseInt(year, 10);
      const m = parseInt(month, 10);
      const start = new Date(Date.UTC(y, m - 1, 1));
      const end = new Date(Date.UTC(y, m, 1));
      where = { AND: [visibility, { startDate: { gte: start, lt: end } }] };
    }

    const events = await prisma.event.findMany({
      where,
      include: EVENT_INCLUDE,
      orderBy: { startDate: "asc" },
    });
    return res.status(200).json({ events });
  } catch (err) {
    console.error("Get events error:", err);
    return res.status(500).json({ error: "เกิดข้อผิดพลาดในเซิร์ฟเวอร์" });
  }
}

async function createEvent(req, res) {
  try {
    const { title, description, startDate, endDate, isAllDay, attendeeUsernames } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ error: "กรุณากรอกชื่อกิจกรรม" });
    }
    if (!startDate) {
      return res.status(400).json({ error: "กรุณาระบุวันที่เริ่มต้น" });
    }

    if (endDate && new Date(endDate) < new Date(startDate)) {
      return res.status(400).json({ error: "เวลาสิ้นสุดต้องไม่ก่อนเวลาเริ่มต้น" });
    }

    // A double-click / retry can send the same create twice — if an identical
    // event from this owner was created in the last few seconds, return that
    // one instead of adding a duplicate.
    const recentDuplicate = await prisma.event.findFirst({
      where: {
        ownerId: req.userId,
        title: title.trim(),
        startDate: new Date(startDate),
        createdAt: { gte: new Date(Date.now() - 10 * 1000) },
      },
      include: EVENT_INCLUDE,
    });
    if (recentDuplicate) {
      return res.status(200).json({ event: recentDuplicate, notFoundUsernames: [] });
    }

    const { userIds, notFound } = await resolveUsernames(attendeeUsernames, req.userId);

    const event = await prisma.event.create({
      data: {
        ownerId: req.userId,
        title: title.trim(),
        description: description || null,
        isAllDay: isAllDay !== undefined ? isAllDay : true,
        startDate: new Date(startDate),
        endDate: endDate ? new Date(endDate) : null,
        attendees: { create: userIds.map((userId) => ({ userId })) },
      },
      include: EVENT_INCLUDE,
    });

    return res.status(201).json({ event, notFoundUsernames: notFound });
  } catch (err) {
    console.error("Create event error:", err);
    return res.status(500).json({ error: "เกิดข้อผิดพลาดในเซิร์ฟเวอร์" });
  }
}

async function updateEvent(req, res) {
  try {
    const { eventId } = req.params;
    const { title, description, startDate, endDate, isAllDay, attendeeUsernames } = req.body;

    const existing = await loadOwnedEvent(eventId, req.userId);
    if (!existing) {
      return res.status(404).json({ error: "ไม่พบกิจกรรมนี้" });
    }

    const nextStart = startDate !== undefined ? startDate : existing.startDate;
    const nextEnd = endDate !== undefined ? endDate : existing.endDate;
    if (nextStart && nextEnd && new Date(nextEnd) < new Date(nextStart)) {
      return res.status(400).json({ error: "เวลาสิ้นสุดต้องไม่ก่อนเวลาเริ่มต้น" });
    }

    let notFound = [];
    if (attendeeUsernames !== undefined) {
      const resolved = await resolveUsernames(attendeeUsernames, req.userId);
      notFound = resolved.notFound;
      // Full replace: simplest correct behavior for a small attendee list.
      await prisma.eventAttendee.deleteMany({ where: { eventId } });
      if (resolved.userIds.length > 0) {
        await prisma.eventAttendee.createMany({
          data: resolved.userIds.map((userId) => ({ eventId, userId })),
          skipDuplicates: true,
        });
      }
    }

    const event = await prisma.event.update({
      where: { id: eventId },
      data: {
        ...(title !== undefined ? { title: title.trim() } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(isAllDay !== undefined ? { isAllDay } : {}),
        ...(startDate !== undefined ? { startDate: new Date(startDate) } : {}),
        ...(endDate !== undefined ? { endDate: endDate ? new Date(endDate) : null } : {}),
      },
      include: EVENT_INCLUDE,
    });

    return res.status(200).json({ event, notFoundUsernames: notFound });
  } catch (err) {
    console.error("Update event error:", err);
    return res.status(500).json({ error: "เกิดข้อผิดพลาดในเซิร์ฟเวอร์" });
  }
}

async function deleteEvent(req, res) {
  try {
    const { eventId } = req.params;

    const existing = await loadOwnedEvent(eventId, req.userId);
    if (!existing) {
      return res.status(404).json({ error: "ไม่พบกิจกรรมนี้" });
    }

    await prisma.eventAttendee.deleteMany({ where: { eventId } });
    await prisma.event.delete({ where: { id: eventId } });
    return res.status(200).json({ message: "ลบกิจกรรมแล้ว" });
  } catch (err) {
    console.error("Delete event error:", err);
    return res.status(500).json({ error: "เกิดข้อผิดพลาดในเซิร์ฟเวอร์" });
  }
}

module.exports = { getEvents, createEvent, updateEvent, deleteEvent };
