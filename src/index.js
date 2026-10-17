require("dotenv").config();
const express = require("express");
const http = require("http");
const cors = require("cors");
const passport = require("./lib/passport");
const { initSocket } = require("./lib/socket");
const authRoutes = require("./routes/auth.routes");
const oauthRoutes = require("./routes/oauth.routes");
const profileRoutes = require("./routes/profile.routes");
const moodRoutes = require("./routes/mood.routes");
const passwordResetRoutes = require("./routes/password-reset.routes");
const boardRoutes = require("./routes/board.routes");
const taskRoutes = require("./routes/task.routes");
const subtaskRoutes = require("./routes/subtask.routes");
const columnRoutes = require("./routes/column.routes");
const categoryRoutes = require("./routes/category.routes");
const eventRoutes = require("./routes/event.routes");
const userRoutes = require("./routes/user.routes");
const workspaceRoutes = require("./routes/workspace.routes");
const friendRoutes = require("./routes/friend.routes");
const commentRoutes = require("./routes/comment.routes");
const chatRoutes = require("./routes/chat.routes");
const notificationRoutes = require("./routes/notification.routes");

const app = express();

app.use(cors()); // during dev this allows the React app (localhost:3000) to call this API
app.use(express.json());
app.use(passport.initialize()); // stateless — every route uses { session: false }

// Profile photos are stored as bytes in the User row (avatarData) and
// served back out through GET /api/auth/:userId/avatar — see
// profile.controller.js's getAvatarHandler — no disk/static serving needed.

app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

app.use("/api/auth", authRoutes);
app.use("/api/auth", oauthRoutes);
app.use("/api/auth", profileRoutes);
app.use("/api/auth", passwordResetRoutes);
app.use("/api/mood", moodRoutes);
app.use("/api/board", boardRoutes);
app.use("/api/tasks", taskRoutes);
app.use("/api/subtasks", subtaskRoutes);
app.use("/api/columns", columnRoutes);
app.use("/api/categories", categoryRoutes);
app.use("/api/events", eventRoutes);
app.use("/api/users", userRoutes);
app.use("/api/workspaces", workspaceRoutes);
app.use("/api/friends", friendRoutes);
app.use("/api/comments", commentRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/notifications", notificationRoutes);

// Catches multer errors (bad file type, file too large) so they come back
// as the same JSON error shape as everything else instead of an HTML page.
app.use((err, req, res, next) => {
  if (err && err.name === "MulterError") {
    // Both avatar (5MB) and chat attachment (15MB) uploads land here — the
    // route that was hit decides which limit actually applied, so the
    // message just says "too big" without guessing a number.
    const message = err.code === "LIMIT_FILE_SIZE" ? "ไฟล์ใหญ่เกินไป" : "อัปโหลดไฟล์ไม่สำเร็จ";
    return res.status(400).json({ error: message });
  }
  if (err) {
    console.error("Unhandled error:", err);
    return res.status(400).json({ error: err.message || "เกิดข้อผิดพลาด" });
  }
  next();
});

// Wrapping express in a plain http.Server (instead of app.listen() directly)
// is what lets Socket.IO attach to the same port — it needs the raw server
// to intercept the WebSocket upgrade handshake, which app.listen() hides.
const server = http.createServer(app);
initSocket(server);

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`Pawject API running on http://localhost:${PORT}`);
});
