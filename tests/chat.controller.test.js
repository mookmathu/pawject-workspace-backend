jest.mock("../src/lib/prisma", () => require("./helpers/prismaMock"));
jest.mock("../src/lib/permissions", () => ({ getMembership: jest.fn() }));
jest.mock("../src/lib/socket", () => ({ emitToRoom: jest.fn(), emitToUser: jest.fn() }));
jest.mock("../src/lib/notify", () => ({ createNotification: jest.fn() }));

const prisma = require("../src/lib/prisma");
const { getMembership } = require("../src/lib/permissions");
const { emitToRoom, emitToUser } = require("../src/lib/socket");
const { createNotification } = require("../src/lib/notify");
const c = require("../src/controllers/chat.controller");
const { mockReq, mockRes, silenceErrors } = require("./helpers/http");

const flush = () => new Promise((r) => setImmediate(r));
const sender = { id: "u1", name: "Ann", username: "ann", hiddenFields: [] };
const msg = (over = {}) => ({ id: "m1", sender, attachmentMimeType: null, ...over });

beforeEach(() => {
  prisma.__reset();
  jest.resetAllMocks();
  silenceErrors();
});
afterEach(() => jest.restoreAllMocks());

describe("workspace messages", () => {
  const params = { workspaceId: "w1" };

  it("refuses non-members", async () => {
    getMembership.mockResolvedValue(null);
    let res = mockRes();
    await c.getWorkspaceMessages(mockReq({ params }), res);
    expect(res.statusCode).toBe(403);
    res = mockRes();
    await c.sendWorkspaceMessage(mockReq({ params, body: { content: "hi" } }), res);
    expect(res.statusCode).toBe(403);
  });

  it("lists history, creating the conversation and marking it read", async () => {
    getMembership.mockResolvedValue({});
    prisma.conversation.findUnique.mockResolvedValue(null);
    prisma.conversation.create.mockResolvedValue({ id: "c1" });
    prisma.message.findMany.mockResolvedValue([msg({ attachmentMimeType: "image/png" }), msg({ id: "m2" })]);
    const res = mockRes();
    await c.getWorkspaceMessages(mockReq({ params }), res);
    expect(res.body.room).toBe("workspace:w1");
    expect(res.body.messages[0].attachmentUrl).toBe("/api/chat/messages/m1/attachment");
    expect(res.body.messages[1].attachmentUrl).toBeNull();
    expect(prisma.conversationRead.upsert).toHaveBeenCalled();
  });

  it("still responds when marking read fails", async () => {
    getMembership.mockResolvedValue({});
    prisma.conversation.findUnique.mockResolvedValue({ id: "c1" });
    prisma.message.findMany.mockResolvedValue([]);
    prisma.conversationRead.upsert.mockRejectedValue(new Error("x"));
    const res = mockRes();
    await c.getWorkspaceMessages(mockReq({ params }), res);
    expect(res.statusCode).toBe(200);
  });

  it("list 500s on error", async () => {
    getMembership.mockRejectedValue(new Error("x"));
    const res = mockRes();
    await c.getWorkspaceMessages(mockReq({ params }), res);
    expect(res.statusCode).toBe(500);
  });

  it("send rejects empty messages", async () => {
    const res = mockRes();
    await c.sendWorkspaceMessage(mockReq({ params, body: { content: "  " } }), res);
    expect(res.statusCode).toBe(400);
    const res2 = mockRes();
    await c.sendWorkspaceMessage(mockReq({ params, body: {} }), res2);
    expect(res2.statusCode).toBe(400);
  });

  it("send stores, broadcasts, and notifies other members", async () => {
    getMembership.mockResolvedValue({});
    prisma.conversation.findUnique.mockResolvedValue({ id: "c1" });
    prisma.message.create.mockResolvedValue(msg());
    prisma.workspaceMember.findMany.mockResolvedValue([{ userId: "u2" }, { userId: "u3" }]);
    prisma.workspace.findUnique.mockResolvedValue({ name: "Team", isPersonal: false });
    const res = mockRes();
    await c.sendWorkspaceMessage(mockReq({ params, body: { content: " hello " } }), res);
    await flush();
    expect(res.statusCode).toBe(201);
    expect(prisma.message.create.mock.calls[0][0].data.content).toBe("hello");
    expect(emitToRoom).toHaveBeenCalledWith("workspace:w1", "message:new", expect.any(Object));
    expect(emitToUser).toHaveBeenCalledTimes(2);
    expect(emitToUser).toHaveBeenCalledWith("u2", "unread:bump", { key: "workspace:w1" });
    expect(createNotification).toHaveBeenCalledTimes(2);
    expect(createNotification.mock.calls[0][0].title).toContain("Team");
  });

  it("names the personal workspace and falls back when unknown", async () => {
    getMembership.mockResolvedValue({});
    prisma.conversation.findUnique.mockResolvedValue({ id: "c1" });
    prisma.message.create.mockResolvedValue(msg());
    prisma.workspaceMember.findMany.mockResolvedValue([{ userId: "u2" }]);
    prisma.workspace.findUnique.mockResolvedValueOnce({ name: "x", isPersonal: true });
    await c.sendWorkspaceMessage(mockReq({ params, body: { content: "a" } }), mockRes());
    await flush();
    expect(createNotification.mock.calls[0][0].title).toContain("ของฉัน");
    prisma.workspace.findUnique.mockResolvedValueOnce(null);
    await c.sendWorkspaceMessage(mockReq({ params, body: { content: "a" } }), mockRes());
    await flush();
    expect(createNotification.mock.calls[1][0].title).toContain("กลุ่ม กลุ่ม");
  });

  it("send handles attachments and previews", async () => {
    getMembership.mockResolvedValue({});
    prisma.conversation.findUnique.mockResolvedValue({ id: "c1" });
    prisma.message.create.mockResolvedValue(msg());
    prisma.workspaceMember.findMany.mockResolvedValue([{ userId: "u2" }]);
    prisma.workspace.findUnique.mockResolvedValue({ name: "T" });
    const file = { buffer: Buffer.from("x"), mimetype: "application/pdf", originalname: "a.pdf" };
    await c.sendWorkspaceMessage(mockReq({ params, body: {}, file }), mockRes());
    await flush();
    expect(prisma.message.create.mock.calls[0][0].data).toMatchObject({ attachmentMimeType: "application/pdf", attachmentName: "a.pdf", content: null });
    expect(createNotification.mock.calls[0][0].body).toBe("📎 ไฟล์แนบ");
    await c.sendWorkspaceMessage(mockReq({ params, body: { content: "[[sticker:cat]]" } }), mockRes());
    await flush();
    expect(createNotification.mock.calls[1][0].body).toBe("ส่งสติกเกอร์");
  });

  it("logs a bump failure without failing the request", async () => {
    getMembership.mockResolvedValue({});
    prisma.conversation.findUnique.mockResolvedValue({ id: "c1" });
    prisma.message.create.mockResolvedValue(msg());
    prisma.workspaceMember.findMany.mockRejectedValue(new Error("x"));
    prisma.workspace.findUnique.mockResolvedValue(null);
    const res = mockRes();
    await c.sendWorkspaceMessage(mockReq({ params, body: { content: "a" } }), res);
    await flush();
    expect(res.statusCode).toBe(201);
  });

  it("send 500s on error", async () => {
    getMembership.mockRejectedValue(new Error("x"));
    const res = mockRes();
    await c.sendWorkspaceMessage(mockReq({ params, body: { content: "a" } }), res);
    expect(res.statusCode).toBe(500);
  });
});

describe("direct messages", () => {
  const params = { userId: "u2" };

  it("requires friendship", async () => {
    prisma.friendship.findUnique.mockResolvedValue(null);
    let res = mockRes();
    await c.getDmMessages(mockReq({ params }), res);
    expect(res.statusCode).toBe(403);
    res = mockRes();
    await c.sendDmMessage(mockReq({ params, body: { content: "hi" } }), res);
    expect(res.statusCode).toBe(403);
  });

  it("lists history in a deterministic room, creating the conversation with ordered ids", async () => {
    prisma.friendship.findUnique.mockResolvedValue({});
    prisma.conversation.findUnique.mockResolvedValue(null);
    prisma.conversation.create.mockResolvedValue({ id: "c1" });
    prisma.message.findMany.mockResolvedValue([]);
    const res = mockRes();
    await c.getDmMessages(mockReq({ userId: "u9", params }), res);
    expect(prisma.conversation.create).toHaveBeenCalledWith({ data: { userAId: "u2", userBId: "u9" } });
    expect(res.body.room).toBe("dm:u2:u9");
  });

  it("list 500s on error", async () => {
    prisma.friendship.findUnique.mockRejectedValue(new Error("x"));
    const res = mockRes();
    await c.getDmMessages(mockReq({ params }), res);
    expect(res.statusCode).toBe(500);
  });

  it("send rejects empty and sends to the other participant (both orderings)", async () => {
    let res = mockRes();
    await c.sendDmMessage(mockReq({ params, body: { content: "" } }), res);
    expect(res.statusCode).toBe(400);

    prisma.friendship.findUnique.mockResolvedValue({});
    prisma.conversation.findUnique.mockResolvedValue({ id: "c1" });
    prisma.message.create.mockResolvedValue(msg());
    res = mockRes();
    await c.sendDmMessage(mockReq({ userId: "u1", params, body: { content: "yo" } }), res);
    await flush();
    expect(res.statusCode).toBe(201);
    expect(emitToUser).toHaveBeenCalledWith("u2", "unread:bump", { key: "dm:u1" });
    expect(createNotification.mock.calls[0][0]).toMatchObject({ userId: "u2", type: "message" });

    emitToUser.mockClear();
    await c.sendDmMessage(mockReq({ userId: "u3", params: { userId: "u2" }, body: { content: "yo" } }), mockRes());
    await flush();
    expect(emitToUser).toHaveBeenCalledWith("u2", "unread:bump", { key: "dm:u3" });
  });

  it("send handles a file and errors", async () => {
    prisma.friendship.findUnique.mockResolvedValue({});
    prisma.conversation.findUnique.mockResolvedValue({ id: "c1" });
    prisma.message.create.mockResolvedValue(msg());
    const file = { buffer: Buffer.from("x"), mimetype: "image/png", originalname: "p.png" };
    const res = mockRes();
    await c.sendDmMessage(mockReq({ params, body: {}, file }), res);
    await flush();
    expect(res.statusCode).toBe(201);

    prisma.friendship.findUnique.mockRejectedValue(new Error("x"));
    const res2 = mockRes();
    await c.sendDmMessage(mockReq({ params, body: { content: "a" } }), res2);
    expect(res2.statusCode).toBe(500);
  });
});

describe("getAttachment", () => {
  const req = () => mockReq({ params: { messageId: "m1" } });

  it("404s when missing or empty", async () => {
    const end404 = () => {
      const res = mockRes();
      res.end = jest.fn();
      return res;
    };
    prisma.message.findUnique.mockResolvedValue(null);
    let res = end404();
    await c.getAttachment(req(), res);
    expect(res.status).toHaveBeenCalledWith(404);
    prisma.message.findUnique.mockResolvedValue({ attachmentData: null, attachmentMimeType: "x" });
    res = end404();
    await c.getAttachment(req(), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("serves bytes with headers, with or without a file name", async () => {
    prisma.message.findUnique.mockResolvedValue({ attachmentData: new Uint8Array([1, 2]), attachmentMimeType: "image/png", attachmentName: "a b.png" });
    let res = mockRes();
    await c.getAttachment(req(), res);
    expect(res.setHeader).toHaveBeenCalledWith("Content-Disposition", 'inline; filename="a%20b.png"');
    expect(Buffer.isBuffer(res.send.mock.calls[0][0])).toBe(true);

    prisma.message.findUnique.mockResolvedValue({ attachmentData: new Uint8Array([1]), attachmentMimeType: "image/png", attachmentName: null });
    res = mockRes();
    await c.getAttachment(req(), res);
    expect(res.setHeader).not.toHaveBeenCalledWith("Content-Disposition", expect.anything());
  });

  it("500s on error", async () => {
    prisma.message.findUnique.mockRejectedValue(new Error("x"));
    const res = mockRes();
    await c.getAttachment(req(), res);
    expect(res.statusCode).toBe(500);
  });
});

describe("getUnreadCounts", () => {
  it("returns {} with no conversations", async () => {
    prisma.workspaceMember.findMany.mockResolvedValue([]);
    prisma.conversation.findMany.mockResolvedValue([]);
    const res = mockRes();
    await c.getUnreadCounts(mockReq(), res);
    expect(res.body).toEqual({ unread: {} });
    expect(prisma.conversationRead.findMany).not.toHaveBeenCalled();
  });

  it("keys counts by workspace or DM partner and skips zeroes", async () => {
    prisma.workspaceMember.findMany.mockResolvedValue([{ workspaceId: "w1" }]);
    prisma.conversation.findMany
      .mockResolvedValueOnce([{ id: "c1", workspaceId: "w1" }])
      .mockResolvedValueOnce([
        { id: "c2", userAId: "u1", userBId: "u2" },
        { id: "c3", userAId: "u0", userBId: "u1" },
        { id: "c4", userAId: "u1", userBId: "u5" },
      ]);
    prisma.conversationRead.findMany.mockResolvedValue([{ conversationId: "c1", lastReadAt: new Date(10) }]);
    prisma.message.count.mockResolvedValueOnce(3).mockResolvedValueOnce(1).mockResolvedValueOnce(2).mockResolvedValueOnce(0);
    const res = mockRes();
    await c.getUnreadCounts(mockReq(), res);
    expect(res.body.unread).toEqual({ "workspace:w1": 3, "dm:u2": 1, "dm:u0": 2 });
    expect(prisma.message.count.mock.calls[0][0].where.createdAt.gt).toEqual(new Date(10));
    expect(prisma.message.count.mock.calls[1][0].where.createdAt.gt).toEqual(new Date(0));
  });

  it("skips the workspace query when the user has no workspaces", async () => {
    prisma.workspaceMember.findMany.mockResolvedValue([]);
    prisma.conversation.findMany.mockResolvedValue([{ id: "c2", userAId: "u1", userBId: "u2" }]);
    prisma.conversationRead.findMany.mockResolvedValue([]);
    prisma.message.count.mockResolvedValue(0);
    const res = mockRes();
    await c.getUnreadCounts(mockReq(), res);
    expect(res.body.unread).toEqual({});
    expect(prisma.conversation.findMany).toHaveBeenCalledTimes(1);
  });

  it("500s on error", async () => {
    prisma.workspaceMember.findMany.mockRejectedValue(new Error("x"));
    const res = mockRes();
    await c.getUnreadCounts(mockReq(), res);
    expect(res.statusCode).toBe(500);
  });
});
