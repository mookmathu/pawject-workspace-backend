jest.mock("../src/lib/prisma", () => require("./helpers/prismaMock"));

const prisma = require("../src/lib/prisma");
const f = require("../src/controllers/friend.controller");
const { mockReq, mockRes, silenceErrors } = require("./helpers/http");

beforeEach(() => {
  prisma.__reset();
  jest.resetAllMocks();
  silenceErrors();
});
afterEach(() => jest.restoreAllMocks());

const user = (id, over = {}) => ({ id, username: id, name: id, orgType: "uni", orgName: "KU", hiddenFields: [], ...over });

describe("getFriends", () => {
  it("flattens to the other person on either side", async () => {
    prisma.friendship.findMany.mockResolvedValue([
      { userAId: "u1", userA: user("u1"), userB: user("u2") },
      { userAId: "u0", userA: user("u0"), userB: user("u1") },
    ]);
    const res = mockRes();
    await f.getFriends(mockReq(), res);
    expect(res.body.friends.map((x) => x.id)).toEqual(["u2", "u0"]);
  });

  it("500s on error", async () => {
    prisma.friendship.findMany.mockRejectedValue(new Error("x"));
    const res = mockRes();
    await f.getFriends(mockReq(), res);
    expect(res.statusCode).toBe(500);
  });
});

describe("addFriend", () => {
  const req = (friendId) => mockReq({ body: { friendId } });

  it("requires a friend id", async () => {
    let res = mockRes();
    await f.addFriend(req(undefined), res);
    expect(res.statusCode).toBe(400);
    res = mockRes();
    await f.addFriend(req("  @ "), res);
    expect(res.statusCode).toBe(400);
  });

  it("404s for an unknown id and normalises the lookup", async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    const res = mockRes();
    await f.addFriend(req(" @Bob "), res);
    expect(prisma.user.findUnique).toHaveBeenLastCalledWith({ where: { friendId: "bob" } });
    expect(res.statusCode).toBe(404);
  });

  it("refuses to add yourself", async () => {
    prisma.user.findUnique.mockResolvedValueOnce(user("u1")).mockResolvedValueOnce(user("u1"));
    const res = mockRes();
    await f.addFriend(req("me"), res);
    expect(res.statusCode).toBe(400);
  });

  it("409s when already friends", async () => {
    prisma.user.findUnique.mockResolvedValueOnce(user("u1")).mockResolvedValueOnce(user("u2"));
    prisma.friendship.findUnique.mockResolvedValue({ id: "f" });
    const res = mockRes();
    await f.addFriend(req("bob"), res);
    expect(res.statusCode).toBe(409);
  });

  it("connects immediately inside the same organisation, with ids ordered", async () => {
    prisma.user.findUnique.mockResolvedValueOnce(user("u9")).mockResolvedValueOnce(user("u2"));
    prisma.friendship.findUnique.mockResolvedValue(null);
    const res = mockRes();
    await f.addFriend(mockReq({ userId: "u9", body: { friendId: "bob" } }), res);
    expect(prisma.friendship.create).toHaveBeenCalledWith({ data: { userAId: "u2", userBId: "u9" } });
    expect(res.statusCode).toBe(201);
  });

  it("sends a request across organisations", async () => {
    prisma.user.findUnique.mockResolvedValueOnce(user("u1")).mockResolvedValueOnce(user("u2", { orgName: "CU" }));
    prisma.friendship.findUnique.mockResolvedValue(null);
    prisma.friendRequest.findFirst.mockResolvedValue(null);
    const res = mockRes();
    await f.addFriend(req("bob"), res);
    expect(prisma.friendRequest.create).toHaveBeenCalledWith({ data: { senderId: "u1", receiverId: "u2" } });
    expect(res.statusCode).toBe(202);
  });

  it("409s on a pending request", async () => {
    prisma.user.findUnique.mockResolvedValueOnce(user("u1")).mockResolvedValueOnce(user("u2", { orgType: "company" }));
    prisma.friendship.findUnique.mockResolvedValue(null);
    prisma.friendRequest.findFirst.mockResolvedValue({ id: "r" });
    const res = mockRes();
    await f.addFriend(req("bob"), res);
    expect(res.statusCode).toBe(409);
  });

  it("500s on error", async () => {
    prisma.user.findUnique.mockRejectedValue(new Error("x"));
    const res = mockRes();
    await f.addFriend(req("bob"), res);
    expect(res.statusCode).toBe(500);
  });
});

describe("removeFriend", () => {
  it("deletes using the ordered pair", async () => {
    const res = mockRes();
    await f.removeFriend(mockReq({ userId: "u9", params: { userId: "u2" } }), res);
    expect(prisma.friendship.deleteMany).toHaveBeenCalledWith({ where: { userAId: "u2", userBId: "u9" } });
    expect(res.statusCode).toBe(200);
  });

  it("500s on error", async () => {
    prisma.friendship.deleteMany.mockRejectedValue(new Error("x"));
    const res = mockRes();
    await f.removeFriend(mockReq({ params: { userId: "u2" } }), res);
    expect(res.statusCode).toBe(500);
  });
});

describe("friend requests", () => {
  it("lists pending requests", async () => {
    prisma.friendRequest.findMany.mockResolvedValue([{ id: "r1", createdAt: "d", sender: user("u2") }]);
    const res = mockRes();
    await f.getFriendRequests(mockReq(), res);
    expect(res.body.requests[0]).toMatchObject({ id: "r1", sender: { id: "u2" } });
  });

  it("list 500s on error", async () => {
    prisma.friendRequest.findMany.mockRejectedValue(new Error("x"));
    const res = mockRes();
    await f.getFriendRequests(mockReq(), res);
    expect(res.statusCode).toBe(500);
  });

  it.each([
    ["accept", f.acceptFriendRequest],
    ["reject", f.rejectFriendRequest],
  ])("%s 404s for a missing, foreign or non-pending request", async (_n, fn) => {
    const r = () => mockReq({ params: { requestId: "r1" } });
    prisma.friendRequest.findUnique.mockResolvedValue(null);
    let res = mockRes();
    await fn(r(), res);
    expect(res.statusCode).toBe(404);
    prisma.friendRequest.findUnique.mockResolvedValue({ receiverId: "other", status: "pending" });
    res = mockRes();
    await fn(r(), res);
    expect(res.statusCode).toBe(404);
    prisma.friendRequest.findUnique.mockResolvedValue({ receiverId: "u1", status: "accepted" });
    res = mockRes();
    await fn(r(), res);
    expect(res.statusCode).toBe(404);
  });

  it("accept creates the friendship and marks it accepted", async () => {
    prisma.friendRequest.findUnique.mockResolvedValue({ senderId: "u2", receiverId: "u1", status: "pending" });
    const res = mockRes();
    await f.acceptFriendRequest(mockReq({ params: { requestId: "r1" } }), res);
    expect(prisma.friendship.upsert.mock.calls[0][0].create).toEqual({ userAId: "u1", userBId: "u2" });
    expect(prisma.friendRequest.update).toHaveBeenCalledWith({ where: { id: "r1" }, data: { status: "accepted" } });
    expect(res.statusCode).toBe(200);
  });

  it("reject marks it rejected", async () => {
    prisma.friendRequest.findUnique.mockResolvedValue({ receiverId: "u1", status: "pending" });
    const res = mockRes();
    await f.rejectFriendRequest(mockReq({ params: { requestId: "r1" } }), res);
    expect(prisma.friendRequest.update).toHaveBeenCalledWith({ where: { id: "r1" }, data: { status: "rejected" } });
    expect(res.statusCode).toBe(200);
  });

  it("accept and reject 500 on error", async () => {
    prisma.friendRequest.findUnique.mockRejectedValue(new Error("x"));
    let res = mockRes();
    await f.acceptFriendRequest(mockReq({ params: { requestId: "r" } }), res);
    expect(res.statusCode).toBe(500);
    res = mockRes();
    await f.rejectFriendRequest(mockReq({ params: { requestId: "r" } }), res);
    expect(res.statusCode).toBe(500);
  });
});
