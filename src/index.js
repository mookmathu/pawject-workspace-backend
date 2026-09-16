require("dotenv").config();
const express = require("express");
const cors = require("cors");
const passport = require("./lib/passport");
const authRoutes = require("./routes/auth.routes");
const oauthRoutes = require("./routes/oauth.routes");
const profileRoutes = require("./routes/profile.routes");
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

const app = express();

app.use(cors()); // during dev this allows the React app (localhost:3000) to call this API
app.use(express.json());
app.use(passport.initialize()); // stateless — every route uses { session: false }

app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

app.use("/api/auth", authRoutes);
app.use("/api/auth", oauthRoutes);
app.use("/api/auth", profileRoutes);
app.use("/api/auth", passwordResetRoutes);
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

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Crew Space API running on http://localhost:${PORT}`);
});
