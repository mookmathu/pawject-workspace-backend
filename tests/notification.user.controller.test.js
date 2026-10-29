jest.mock("../src/lib/prisma", () => require("./helpers/prismaMock"));

const prisma = require("../src/lib/prisma");
const n = require("../src/controllers/notification.controller");
const { searchUsers } = require("../src/controllers/user.controller");
const { mockReq, mockRes, silenceErrors } = require("./helpers/http");

beforeEach(() => {
  prisma.__reset();
  jest.resetAllMocks();
  silenceErrors();
});
afterEach(() => jest.restoreAllMocks());

describe("notifications", () => {
  it("lists with the unread count", async () => {
    prisma.notification.findMany.mockResolvedValue([{ id: "n1" }]);
    prisma.notification.count.mockResolvedValue(2);
    const res = mockRes();
    await n.getNotifications(mockReq(), res);
    expect(res.body).toEqual({ notifications: [{ id: "n1" }], unreadCount: 2 });
  });

  it("500s when listing fails", async () => {
    prisma.notification.findMany.mockRejectedValue(new Error("x"));
    prisma.notification.count.mockResolvedValue(0);
    const res = mockRes();
    await n.getNotifications(mockReq(), res);
    expect(res.statusCode).toBe(500);
  });

  it("only lets the owner mark one read", async () => {
    prisma.notification.findUnique.mockResolvedValue({ id: "n1", userId: "other" });
    const res = mockRes();
    await n.markNotificationRead(mockReq({ params: { notificationId: "n1" } }), res);
    expect(res.statusCode).toBe(404);
    expect(prisma.notification.update).not.toHaveBeenCalled();
  });

  it("404s when it does not exist", async () => {
    prisma.notification.findUnique.mockResolvedValue(null);
    const res = mockRes();
    await n.markNotificationRead(mockReq({ params: { notificationId: "n1" } }), res);
    expect(res.statusCode).toBe(404);
  });

  it("marks one read", async () => {
    prisma.notification.findUnique.mockResolvedValue({ id: "n1", userId: "u1" });
    prisma.notification.update.mockResolvedValue({ id: "n1", readAt: new Date() });
    const res = mockRes();
    await n.markNotificationRead(mockReq({ params: { notificationId: "n1" } }), res);
    expect(res.statusCode).toBe(200);
  });

  it("500s when marking fails", async () => {
    prisma.notification.findUnique.mockRejectedValue(new Error("x"));
    const res = mockRes();
    await n.markNotificationRead(mockReq({ params: { notificationId: "n1" } }), res);
    expect(res.statusCode).toBe(500);
  });

  it("marks all read", async () => {
    const res = mockRes();
    await n.markAllNotificationsRead(mockReq(), res);
    expect(prisma.notification.updateMany.mock.calls[0][0].where).toEqual({ userId: "u1", readAt: null });
    expect(res.statusCode).toBe(200);
  });

  it("500s when mark-all fails", async () => {
    prisma.notification.updateMany.mockRejectedValue(new Error("x"));
    const res = mockRes();
    await n.markAllNotificationsRead(mockReq(), res);
    expect(res.statusCode).toBe(500);
  });
});

describe("searchUsers", () => {
  it("returns [] for an empty query", async () => {
    const res = mockRes();
    await searchUsers(mockReq({ query: { q: "  " } }), res);
    expect(res.body).toEqual({ users: [] });
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it("returns [] when q is missing", async () => {
    const res = mockRes();
    await searchUsers(mockReq(), res);
    expect(res.body).toEqual({ users: [] });
  });

  it("searches excluding the caller", async () => {
    prisma.user.findMany.mockResolvedValue([{ id: "u2" }]);
    const res = mockRes();
    await searchUsers(mockReq({ query: { q: " bob " } }), res);
    const arg = prisma.user.findMany.mock.calls[0][0];
    expect(arg.where.username.contains).toBe("bob");
    expect(arg.where.NOT).toEqual({ id: "u1" });
    expect(res.body.users).toHaveLength(1);
  });

  it("500s on error", async () => {
    prisma.user.findMany.mockRejectedValue(new Error("x"));
    const res = mockRes();
    await searchUsers(mockReq({ query: { q: "a" } }), res);
    expect(res.statusCode).toBe(500);
  });
});
