const prisma = require("./prisma");
const { emitToUser } = require("./socket");

// Single entry point for creating a notification, used by task.controller.js
// (assignment, new comment) and chat.controller.js (new message) — persists
// it so it still shows up next time the bell is opened, and also pushes it
// live over the socket to whoever's online right now, the same "personal
// room" mechanism unread:bump already uses.
//
// Deliberately swallows its own errors: a failed notification should never
// take down the request that triggered it (assigning a task, posting a
// comment, sending a message) — the person doing that action still gets
// their normal success response either way.
async function createNotification({ userId, type, title, body, link }) {
  if (!userId) return null;
  try {
    const notification = await prisma.notification.create({
      data: { userId, type, title, body: body || null, link: link ?? undefined },
    });
    emitToUser(userId, "notification:new", notification);
    return notification;
  } catch (err) {
    console.error("Create notification error:", err);
    return null;
  }
}

module.exports = { createNotification };
