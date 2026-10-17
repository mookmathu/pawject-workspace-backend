const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");

let io = null;

// userId -> number of open sockets for that user (someone can have the app
// open in two tabs at once). Online means "count > 0" — we only broadcast a
// presence change on the 0->1 and 1->0 transitions, not on every tab.
const onlineCounts = new Map();

function markOnline(userId) {
  const next = (onlineCounts.get(userId) || 0) + 1;
  onlineCounts.set(userId, next);
  if (next === 1) io.emit("presence:update", { userId, online: true });
}

function markOffline(userId) {
  const next = (onlineCounts.get(userId) || 1) - 1;
  if (next <= 0) {
    onlineCounts.delete(userId);
    io.emit("presence:update", { userId, online: false });
  } else {
    onlineCounts.set(userId, next);
  }
}

// Called once from index.js, right after the HTTP server is created. Kept in
// its own module (instead of living in index.js) so chat.controller.js can
// `require("./socket")` and call emitToRoom() without circularly requiring
// the whole app back.
function initSocket(httpServer) {
  io = new Server(httpServer, {
    cors: { origin: process.env.FRONTEND_URL || "http://localhost:3000" },
  });

  // Same JWT the REST API's requireAuth middleware checks — sent by the
  // client as the connection's `auth.token` instead of an Authorization
  // header, since a socket handshake isn't an ordinary per-request call.
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error("unauthorized"));
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = payload.sub;
      next();
    } catch {
      next(new Error("unauthorized"));
    }
  });

  io.on("connection", (socket) => {
    // A personal room, independent of whatever chat window is open — used
    // for events aimed at "this user" specifically (unread badge bumps),
    // as opposed to "everyone looking at this conversation right now".
    socket.join(`user:${socket.userId}`);
    markOnline(socket.userId);

    // The client decides which rooms it cares about (one per workspace chat
    // or DM it currently has open) and joins/leaves them itself, rather than
    // the server trying to guess from the connection alone.
    socket.on("room:join", (room) => {
      if (typeof room === "string") socket.join(room);
    });
    socket.on("room:leave", (room) => {
      if (typeof room === "string") socket.leave(room);
    });

    // Lets a client ask "who's online right now" once, on load, instead of
    // waiting to passively collect presence:update events for people who
    // were already online before it connected.
    socket.on("presence:list", (ack) => {
      if (typeof ack === "function") ack(Array.from(onlineCounts.keys()));
    });

    // Relayed to everyone else in the room (not back to the sender) — the
    // UI shows "กำลังพิมพ์..." while isTyping is true and clears it on
    // false or after a client-side timeout.
    socket.on("typing", ({ room, isTyping } = {}) => {
      if (typeof room !== "string") return;
      socket.to(room).emit("typing", { userId: socket.userId, room, isTyping: !!isTyping });
    });

    socket.on("disconnect", () => {
      markOffline(socket.userId);
    });
  });

  return io;
}

// Broadcasts a new message to everyone currently viewing that conversation.
// Safe to call even if sockets aren't set up (e.g. a one-off script) — it
// just silently does nothing instead of crashing the request that sent the
// message; the REST response still carries the message either way.
function emitToRoom(room, event, payload) {
  if (!io) return;
  io.to(room).emit(event, payload);
}

// Same idea, but targeted at one user's personal room regardless of which
// conversation (if any) they currently have open — used for unread bumps.
function emitToUser(userId, event, payload) {
  if (!io) return;
  io.to(`user:${userId}`).emit(event, payload);
}

module.exports = { initSocket, emitToRoom, emitToUser };
