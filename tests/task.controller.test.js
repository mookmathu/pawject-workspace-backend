jest.mock("../src/lib/prisma", () => require("./helpers/prismaMock"));
jest.mock("../src/lib/permissions", () => ({
  ...jest.requireActual("../src/lib/permissions"),
  getMembership: jest.fn(),
  getAccessibleBoard: jest.fn(),
}));
jest.mock("../src/lib/notify", () => ({ createNotification: jest.fn() }));

const prisma = require("../src/lib/prisma");
const { getMembership, getAccessibleBoard } = require("../src/lib/permissions");
const { createNotification } = require("../src/lib/notify");
const t = require("../src/controllers/task.controller");
const { mockReq, mockRes, silenceErrors } = require("./helpers/http");

beforeEach(() => {
  prisma.__reset();
  jest.resetAllMocks();
  silenceErrors();
});
afterEach(() => jest.restoreAllMocks());

const taskRow = (over = {}) => ({
  id: "t1",
  boardId: "b1",
  title: "T",
  assigneeId: null,
  board: { workspaceId: "w1" },
  ...over,
});

describe("createTask", () => {
  const req = (body) => mockReq({ params: { boardId: "b1" }, body });
  const ok = () => getAccessibleBoard.mockResolvedValue({ id: "b1", workspaceId: "w1" });

  it("requires a title", async () => {
    const res = mockRes();
    await t.createTask(req({ title: " " }), res);
    expect(res.statusCode).toBe(400);
  });

  it("404s without board access", async () => {
    getAccessibleBoard.mockResolvedValue(null);
    const res = mockRes();
    await t.createTask(req({ title: "A" }), res);
    expect(res.statusCode).toBe(404);
  });

  it("uses the first column when no status is given", async () => {
    ok();
    prisma.boardColumn.findFirst.mockResolvedValue({ id: "c1" });
    prisma.boardColumn.findUnique.mockResolvedValue({ id: "c1", boardId: "b1" });
    prisma.task.create.mockImplementation(async ({ data }) => data);
    const res = mockRes();
    await t.createTask(req({ title: " A ", dueDate: "2026-01-02", note: "n", categoryId: "k", priority: "high" }), res);
    expect(res.statusCode).toBe(201);
    expect(res.body.task).toMatchObject({ statusId: "c1", title: "A", note: "n", categoryId: "k", priority: "high" });
    expect(res.body.task.dueDate).toBeInstanceOf(Date);
  });

  it("rejects when the board has no columns", async () => {
    ok();
    prisma.boardColumn.findFirst.mockResolvedValue(null);
    const res = mockRes();
    await t.createTask(req({ title: "A" }), res);
    expect(res.statusCode).toBe(400);
  });

  it("rejects a status from another board", async () => {
    ok();
    prisma.boardColumn.findUnique.mockResolvedValue({ id: "c9", boardId: "other" });
    const res = mockRes();
    await t.createTask(req({ title: "A", statusId: "c9" }), res);
    expect(res.statusCode).toBe(400);
  });

  it("rejects an assignee outside the workspace", async () => {
    ok();
    prisma.boardColumn.findUnique.mockResolvedValue({ id: "c1", boardId: "b1" });
    getMembership.mockResolvedValue(null);
    const res = mockRes();
    await t.createTask(req({ title: "A", statusId: "c1", assigneeId: "u9" }), res);
    expect(res.statusCode).toBe(400);
  });

  it("accepts a member assignee and nulls optional fields", async () => {
    ok();
    prisma.boardColumn.findUnique.mockResolvedValue({ id: "c1", boardId: "b1" });
    getMembership.mockResolvedValue({ userId: "u2" });
    prisma.task.create.mockImplementation(async ({ data }) => data);
    const res = mockRes();
    await t.createTask(req({ title: "A", statusId: "c1", assigneeId: "u2" }), res);
    expect(res.body.task).toMatchObject({ assigneeId: "u2", dueDate: null, note: null, categoryId: null, priority: null });
  });

  it("500s on error", async () => {
    getAccessibleBoard.mockRejectedValue(new Error("x"));
    const res = mockRes();
    await t.createTask(req({ title: "A" }), res);
    expect(res.statusCode).toBe(500);
  });
});

describe("updateTask", () => {
  const req = (body) => mockReq({ params: { taskId: "t1" }, body });

  it("404s when the task is missing", async () => {
    prisma.task.findUnique.mockResolvedValue(null);
    const res = mockRes();
    await t.updateTask(req({}), res);
    expect(res.statusCode).toBe(404);
  });

  it("404s for non-members", async () => {
    prisma.task.findUnique.mockResolvedValue(taskRow());
    getMembership.mockResolvedValue(null);
    const res = mockRes();
    await t.updateTask(req({}), res);
    expect(res.statusCode).toBe(404);
  });

  it("403s when assigned to someone else and requester is a plain member", async () => {
    prisma.task.findUnique.mockResolvedValue(taskRow({ assigneeId: "u2" }));
    getMembership.mockResolvedValue({ role: "member", userId: "u1" });
    const res = mockRes();
    await t.updateTask(req({ title: "x" }), res);
    expect(res.statusCode).toBe(403);
  });

  it("rejects an invalid status", async () => {
    prisma.task.findUnique.mockResolvedValue(taskRow());
    getMembership.mockResolvedValue({ role: "member", userId: "u1" });
    prisma.boardColumn.findUnique.mockResolvedValue(null);
    const res = mockRes();
    await t.updateTask(req({ statusId: "bad" }), res);
    expect(res.statusCode).toBe(400);
  });

  it("rejects an assignee who is not a member", async () => {
    prisma.task.findUnique.mockResolvedValue(taskRow());
    getMembership.mockResolvedValueOnce({ role: "member", userId: "u1" }).mockResolvedValueOnce(null);
    const res = mockRes();
    await t.updateTask(req({ assigneeId: "u9" }), res);
    expect(res.statusCode).toBe(400);
  });

  it("updates every provided field", async () => {
    prisma.task.findUnique.mockResolvedValue(taskRow());
    getMembership.mockResolvedValue({ role: "member", userId: "u1" });
    prisma.boardColumn.findUnique.mockResolvedValue({ id: "c2", boardId: "b1" });
    prisma.task.update.mockResolvedValue({ id: "t1", title: "N", assigneeId: null, boardId: "b1" });
    const res = mockRes();
    await t.updateTask(
      req({ title: " N ", statusId: "c2", dueDate: "2026-02-01", note: "n", categoryId: "", priority: "low", assigneeId: "", archivedAt: "2026-03-01" }),
      res,
    );
    const data = prisma.task.update.mock.calls[0][0].data;
    expect(data).toMatchObject({ title: "N", statusId: "c2", note: "n", categoryId: null, priority: "low", assigneeId: null });
    expect(data.dueDate).toBeInstanceOf(Date);
    expect(data.archivedAt).toBeInstanceOf(Date);
    expect(res.statusCode).toBe(200);
    expect(createNotification).not.toHaveBeenCalled();
  });

  it("clears dueDate and archivedAt with falsy values", async () => {
    prisma.task.findUnique.mockResolvedValue(taskRow());
    getMembership.mockResolvedValue({ role: "owner", userId: "u1" });
    prisma.task.update.mockResolvedValue({ id: "t1", assigneeId: null });
    await t.updateTask(req({ dueDate: null, archivedAt: null }), mockRes());
    expect(prisma.task.update.mock.calls[0][0].data).toEqual({ dueDate: null, archivedAt: null });
  });

  it("notifies a newly assigned person", async () => {
    prisma.task.findUnique.mockResolvedValue(taskRow());
    getMembership.mockResolvedValue({ role: "member", userId: "u1" });
    prisma.task.update.mockResolvedValue({ id: "t1", title: "T", boardId: "b1", assigneeId: "u2" });
    await t.updateTask(req({ assigneeId: "u2" }), mockRes());
    expect(createNotification).toHaveBeenCalledWith(expect.objectContaining({ userId: "u2", type: "task_assigned" }));
  });

  it("does not notify when self-assigning or unchanged", async () => {
    prisma.task.findUnique.mockResolvedValue(taskRow({ assigneeId: "u1" }));
    getMembership.mockResolvedValue({ role: "member", userId: "u1" });
    prisma.task.update.mockResolvedValue({ id: "t1", boardId: "b1", assigneeId: "u1" });
    await t.updateTask(req({ assigneeId: "u1" }), mockRes());
    expect(createNotification).not.toHaveBeenCalled();
  });

  it("500s on error", async () => {
    prisma.task.findUnique.mockRejectedValue(new Error("x"));
    const res = mockRes();
    await t.updateTask(req({}), res);
    expect(res.statusCode).toBe(500);
  });
});

describe("deleteTask", () => {
  const req = () => mockReq({ params: { taskId: "t1" } });

  it("404s when missing", async () => {
    prisma.task.findUnique.mockResolvedValue(null);
    const res = mockRes();
    await t.deleteTask(req(), res);
    expect(res.statusCode).toBe(404);
  });

  it("403s for a non-assignee member", async () => {
    prisma.task.findUnique.mockResolvedValue(taskRow({ assigneeId: "u2" }));
    getMembership.mockResolvedValue({ role: "member", userId: "u1" });
    const res = mockRes();
    await t.deleteTask(req(), res);
    expect(res.statusCode).toBe(403);
  });

  it("deletes comments, subtasks, then the task", async () => {
    prisma.task.findUnique.mockResolvedValue(taskRow());
    getMembership.mockResolvedValue({ role: "member", userId: "u1" });
    const res = mockRes();
    await t.deleteTask(req(), res);
    expect(prisma.taskComment.deleteMany).toHaveBeenCalled();
    expect(prisma.subtask.deleteMany).toHaveBeenCalled();
    expect(prisma.task.delete).toHaveBeenCalledWith({ where: { id: "t1" } });
    expect(res.statusCode).toBe(200);
  });

  it("500s on error", async () => {
    prisma.task.findUnique.mockRejectedValue(new Error("x"));
    const res = mockRes();
    await t.deleteTask(req(), res);
    expect(res.statusCode).toBe(500);
  });
});

describe("subtasks", () => {
  const sub = (over = {}) => ({ id: "s1", task: taskRow(over) });

  it("addSubtask validates, authorises and creates", async () => {
    let res = mockRes();
    await t.addSubtask(mockReq({ params: { taskId: "t1" }, body: { title: "" } }), res);
    expect(res.statusCode).toBe(400);

    prisma.task.findUnique.mockResolvedValue(null);
    res = mockRes();
    await t.addSubtask(mockReq({ params: { taskId: "t1" }, body: { title: "a" } }), res);
    expect(res.statusCode).toBe(404);

    prisma.task.findUnique.mockResolvedValue(taskRow({ assigneeId: "u2" }));
    getMembership.mockResolvedValue({ role: "member", userId: "u1" });
    res = mockRes();
    await t.addSubtask(mockReq({ params: { taskId: "t1" }, body: { title: "a" } }), res);
    expect(res.statusCode).toBe(403);

    prisma.task.findUnique.mockResolvedValue(taskRow());
    prisma.subtask.create.mockImplementation(async ({ data }) => data);
    res = mockRes();
    await t.addSubtask(mockReq({ params: { taskId: "t1" }, body: { title: " a " } }), res);
    expect(res.statusCode).toBe(201);
    expect(res.body.subtask.title).toBe("a");
  });

  it("addSubtask 500s on error", async () => {
    prisma.task.findUnique.mockRejectedValue(new Error("x"));
    const res = mockRes();
    await t.addSubtask(mockReq({ params: { taskId: "t1" }, body: { title: "a" } }), res);
    expect(res.statusCode).toBe(500);
  });

  it("updateSubtask covers 404 / 404 / 403 / success / error", async () => {
    const r = (body = {}) => mockReq({ params: { subtaskId: "s1" }, body });
    prisma.subtask.findUnique.mockResolvedValue(null);
    let res = mockRes();
    await t.updateSubtask(r(), res);
    expect(res.statusCode).toBe(404);

    prisma.subtask.findUnique.mockResolvedValue(sub());
    getMembership.mockResolvedValue(null);
    res = mockRes();
    await t.updateSubtask(r(), res);
    expect(res.statusCode).toBe(404);

    prisma.subtask.findUnique.mockResolvedValue(sub({ assigneeId: "u2" }));
    getMembership.mockResolvedValue({ role: "member", userId: "u1" });
    res = mockRes();
    await t.updateSubtask(r(), res);
    expect(res.statusCode).toBe(403);

    prisma.subtask.findUnique.mockResolvedValue(sub());
    prisma.subtask.update.mockResolvedValue({ id: "s1" });
    res = mockRes();
    await t.updateSubtask(r({ title: " x ", done: true }), res);
    expect(prisma.subtask.update.mock.calls[0][0].data).toEqual({ title: "x", done: true });
    expect(res.statusCode).toBe(200);

    prisma.subtask.findUnique.mockRejectedValue(new Error("x"));
    res = mockRes();
    await t.updateSubtask(r(), res);
    expect(res.statusCode).toBe(500);
  });

  it("deleteSubtask covers 404 / 404 / 403 / success / error", async () => {
    const r = () => mockReq({ params: { subtaskId: "s1" } });
    prisma.subtask.findUnique.mockResolvedValue(null);
    let res = mockRes();
    await t.deleteSubtask(r(), res);
    expect(res.statusCode).toBe(404);

    prisma.subtask.findUnique.mockResolvedValue(sub());
    getMembership.mockResolvedValue(null);
    res = mockRes();
    await t.deleteSubtask(r(), res);
    expect(res.statusCode).toBe(404);

    prisma.subtask.findUnique.mockResolvedValue(sub({ assigneeId: "u2" }));
    getMembership.mockResolvedValue({ role: "member", userId: "u1" });
    res = mockRes();
    await t.deleteSubtask(r(), res);
    expect(res.statusCode).toBe(403);

    prisma.subtask.findUnique.mockResolvedValue(sub());
    res = mockRes();
    await t.deleteSubtask(r(), res);
    expect(prisma.subtask.delete).toHaveBeenCalledWith({ where: { id: "s1" } });
    expect(res.statusCode).toBe(200);

    prisma.subtask.findUnique.mockRejectedValue(new Error("x"));
    res = mockRes();
    await t.deleteSubtask(r(), res);
    expect(res.statusCode).toBe(500);
  });
});

describe("comments", () => {
  const req = (content) => mockReq({ params: { taskId: "t1" }, body: { content } });

  it("validates and authorises", async () => {
    let res = mockRes();
    await t.addComment(req(" "), res);
    expect(res.statusCode).toBe(400);
    prisma.task.findUnique.mockResolvedValue(null);
    res = mockRes();
    await t.addComment(req("hi"), res);
    expect(res.statusCode).toBe(404);
  });

  it("notifies the assignee when someone else comments", async () => {
    prisma.task.findUnique.mockResolvedValue(taskRow({ assigneeId: "u2" }));
    getMembership.mockResolvedValue({ role: "member", userId: "u1" });
    prisma.taskComment.create.mockResolvedValue({ content: "x".repeat(200), author: { name: "Bob" } });
    const res = mockRes();
    await t.addComment(req("hi"), res);
    expect(res.statusCode).toBe(201);
    const arg = createNotification.mock.calls[0][0];
    expect(arg.userId).toBe("u2");
    expect(arg.body).toHaveLength(140);
  });

  it("does not notify when commenting on your own task or an unassigned one", async () => {
    getMembership.mockResolvedValue({ role: "member", userId: "u1" });
    prisma.taskComment.create.mockResolvedValue({ content: "x", author: { name: "A" } });
    prisma.task.findUnique.mockResolvedValue(taskRow({ assigneeId: "u1" }));
    await t.addComment(req("hi"), mockRes());
    prisma.task.findUnique.mockResolvedValue(taskRow());
    await t.addComment(req("hi"), mockRes());
    expect(createNotification).not.toHaveBeenCalled();
  });

  it("addComment 500s on error", async () => {
    prisma.task.findUnique.mockRejectedValue(new Error("x"));
    const res = mockRes();
    await t.addComment(req("hi"), res);
    expect(res.statusCode).toBe(500);
  });

  it("deleteComment: 404, 403, success, error", async () => {
    const r = () => mockReq({ params: { commentId: "c1" } });
    prisma.taskComment.findUnique.mockResolvedValue(null);
    let res = mockRes();
    await t.deleteComment(r(), res);
    expect(res.statusCode).toBe(404);

    prisma.taskComment.findUnique.mockResolvedValue({ authorId: "u2" });
    res = mockRes();
    await t.deleteComment(r(), res);
    expect(res.statusCode).toBe(403);

    prisma.taskComment.findUnique.mockResolvedValue({ authorId: "u1" });
    res = mockRes();
    await t.deleteComment(r(), res);
    expect(res.statusCode).toBe(200);

    prisma.taskComment.findUnique.mockRejectedValue(new Error("x"));
    res = mockRes();
    await t.deleteComment(r(), res);
    expect(res.statusCode).toBe(500);
  });
});

describe("getMyTasks", () => {
  const row = (id, dueDate, done = false, personal = false) => ({
    id,
    title: id,
    dueDate,
    priority: null,
    boardId: "b",
    board: { workspaceId: "w", workspace: { name: "Team", isPersonal: personal } },
    statusColumn: done ? { isDoneColumn: true } : null,
    categoryRef: null,
  });

  it("drops done tasks and sorts by due date with undated last", async () => {
    prisma.task.findMany.mockResolvedValue([
      row("none1", null),
      row("late", "2026-05-01"),
      row("done", "2026-01-01", true),
      row("soon", "2026-02-01", false, true),
      row("none2", null),
    ]);
    const res = mockRes();
    await t.getMyTasks(mockReq(), res);
    expect(res.body.tasks.map((x) => x.id)).toEqual(["soon", "late", "none1", "none2"]);
    expect(res.body.tasks[0].workspaceName).toBe("ของฉัน");
    expect(res.body.tasks[1].workspaceName).toBe("Team");
  });

  it("handles undated before dated in the input order", async () => {
    prisma.task.findMany.mockResolvedValue([row("a", "2026-01-01"), row("b", null)]);
    const res = mockRes();
    await t.getMyTasks(mockReq(), res);
    expect(res.body.tasks.map((x) => x.id)).toEqual(["a", "b"]);
  });

  it("500s on error", async () => {
    prisma.task.findMany.mockRejectedValue(new Error("x"));
    const res = mockRes();
    await t.getMyTasks(mockReq(), res);
    expect(res.statusCode).toBe(500);
  });
});
