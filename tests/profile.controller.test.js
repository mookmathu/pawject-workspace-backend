jest.mock("../src/lib/prisma", () => require("./helpers/prismaMock"));

const bcrypt = require("bcryptjs");
const prisma = require("../src/lib/prisma");
const p = require("../src/controllers/profile.controller");
const { mockReq, mockRes, silenceErrors } = require("./helpers/http");

beforeEach(() => {
  prisma.__reset();
  jest.resetAllMocks();
  silenceErrors();
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

const safeRow = (over = {}) => ({ id: "u1", name: "N", username: "un", password: "h", hiddenFields: [], ...over });

describe("activity", () => {
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ["setImmediate", "nextTick"] }).setSystemTime(new Date("2026-10-29T05:00:00Z"));
    prisma.user.findUnique.mockResolvedValue({ createdAt: new Date("2025-03-01T00:00:00Z") });
  });
  const rows = (...days) => days.map((day) => ({ day, count: 1 }));

  it("404s for an unknown user", async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    const res = mockRes();
    await p.getMyActivity(mockReq(), res);
    expect(res.statusCode).toBe(404);
  });

  it("computes rolling streaks ending today", async () => {
    prisma.userActivityDay.findMany.mockResolvedValue(rows("2026-10-20", "2026-10-21", "2026-10-27", "2026-10-28", "2026-10-29"));
    const res = mockRes();
    await p.getMyActivity(mockReq(), res);
    expect(res.body).toMatchObject({ to: "2026-10-29", totalDays: 5, longestStreak: 3, currentStreak: 3, years: [2026, 2025] });
    expect(res.body.from).toBe("2025-10-30");
  });

  it("counts the streak from yesterday when today is empty, and 0 when broken", async () => {
    prisma.userActivityDay.findMany.mockResolvedValue(rows("2026-10-27", "2026-10-28"));
    let res = mockRes();
    await p.getMyActivity(mockReq(), res);
    expect(res.body.currentStreak).toBe(2);
    prisma.userActivityDay.findMany.mockResolvedValue(rows("2026-10-20"));
    res = mockRes();
    await p.getMyActivity(mockReq(), res);
    expect(res.body.currentStreak).toBe(0);
  });

  it("supports a past year (no current streak) and the current year", async () => {
    prisma.userActivityDay.findMany.mockResolvedValue(rows("2025-12-30", "2025-12-31"));
    let res = mockRes();
    await p.getMyActivity(mockReq({ query: { year: "2025" } }), res);
    expect(res.body).toMatchObject({ from: "2025-01-01", to: "2025-12-31", currentStreak: 0, longestStreak: 2 });
    res = mockRes();
    await p.getMyActivity(mockReq({ query: { year: "2026" } }), res);
    expect(res.body).toMatchObject({ from: "2026-01-01", to: "2026-10-29" });
  });

  it("rejects out-of-range or non-integer years", async () => {
    for (const year of ["2024", "2027", "abc", "2025.5"]) {
      const res = mockRes();
      await p.getMyActivity(mockReq({ query: { year } }), res);
      expect(res.statusCode).toBe(400);
    }
  });

  it("500s on error", async () => {
    prisma.user.findUnique.mockRejectedValue(new Error("x"));
    const res = mockRes();
    await p.getMyActivity(mockReq(), res);
    expect(res.statusCode).toBe(500);
  });

  describe("getUserActivity", () => {
    const req = (userId = "u2") => mockReq({ params: { userId }, query: {} });

    it("shows your own without checks", async () => {
      prisma.userActivityDay.findMany.mockResolvedValue([]);
      const res = mockRes();
      await p.getUserActivity(req("u1"), res);
      expect(res.statusCode).toBe(200);
      expect(prisma.friendship.findUnique).not.toHaveBeenCalled();
    });

    it("blocks non-friends", async () => {
      prisma.friendship.findUnique.mockResolvedValue(null);
      const res = mockRes();
      await p.getUserActivity(req(), res);
      expect(res.statusCode).toBe(403);
      expect(res.body.notFriend).toBe(true);
    });

    it("404s a missing owner and honours the hidden flag", async () => {
      prisma.friendship.findUnique.mockResolvedValue({});
      prisma.user.findUnique.mockResolvedValueOnce(null);
      let res = mockRes();
      await p.getUserActivity(req(), res);
      expect(res.statusCode).toBe(404);

      prisma.user.findUnique.mockResolvedValueOnce({ hiddenFields: ["activity"] });
      res = mockRes();
      await p.getUserActivity(req(), res);
      expect(res.body.hidden).toBe(true);
    });

    it("returns a friend's activity", async () => {
      prisma.friendship.findUnique.mockResolvedValue({});
      prisma.user.findUnique.mockResolvedValueOnce({ hiddenFields: null }).mockResolvedValueOnce({ createdAt: new Date("2025-03-01") });
      prisma.userActivityDay.findMany.mockResolvedValue([]);
      const res = mockRes();
      await p.getUserActivity(req(), res);
      expect(res.statusCode).toBe(200);
    });

    it("500s on error", async () => {
      prisma.friendship.findUnique.mockRejectedValue(new Error("x"));
      const res = mockRes();
      await p.getUserActivity(req(), res);
      expect(res.statusCode).toBe(500);
    });
  });
});

describe("setFriendId", () => {
  const req = (friendId) => mockReq({ body: { friendId } });

  it("validates the format", async () => {
    for (const v of ["ab", "has space", "x".repeat(21), 5, undefined]) {
      const res = mockRes();
      await p.setFriendId(req(v), res);
      expect(res.statusCode).toBe(400);
    }
  });

  it("404s for an unknown account", async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    const res = mockRes();
    await p.setFriendId(req("valid_id"), res);
    expect(res.statusCode).toBe(404);
  });

  it("is a no-op for the same id", async () => {
    prisma.user.findUnique.mockResolvedValue({ friendId: "valid_id", friendIdChangeCount: 1 });
    const res = mockRes();
    await p.setFriendId(req(" VALID_id "), res);
    expect(res.body).toEqual({ friendId: "valid_id", changesLeft: 1 });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("sets the first id for free and counts later changes", async () => {
    prisma.user.findUnique.mockResolvedValue({ friendId: null, friendIdChangeCount: 0 });
    prisma.user.update.mockResolvedValue({ friendId: "new_id", friendIdChangeCount: 0 });
    let res = mockRes();
    await p.setFriendId(req("new_id"), res);
    expect(prisma.user.update.mock.calls[0][0].data).toEqual({ friendId: "new_id" });
    expect(res.body.changesLeft).toBe(2);

    prisma.user.findUnique.mockResolvedValue({ friendId: "old_id", friendIdChangeCount: 0 });
    prisma.user.update.mockResolvedValue({ friendId: "new_id", friendIdChangeCount: 1 });
    res = mockRes();
    await p.setFriendId(req("new_id"), res);
    expect(prisma.user.update.mock.calls[1][0].data.friendIdChangeCount).toEqual({ increment: 1 });
    expect(res.body.changesLeft).toBe(1);
  });

  it("stops after the maximum changes", async () => {
    prisma.user.findUnique.mockResolvedValue({ friendId: "old_id", friendIdChangeCount: 2 });
    const res = mockRes();
    await p.setFriendId(req("new_id"), res);
    expect(res.statusCode).toBe(403);
  });

  it("409s on a taken id and 500s otherwise", async () => {
    prisma.user.findUnique.mockResolvedValue({ friendId: null, friendIdChangeCount: 0 });
    prisma.user.update.mockRejectedValue(Object.assign(new Error("dup"), { code: "P2002" }));
    let res = mockRes();
    await p.setFriendId(req("new_id"), res);
    expect(res.statusCode).toBe(409);
    prisma.user.update.mockRejectedValue(new Error("x"));
    res = mockRes();
    await p.setFriendId(req("new_id"), res);
    expect(res.statusCode).toBe(500);
  });
});

describe("getMe / getPublicProfile", () => {
  it("getMe", async () => {
    prisma.user.findUnique.mockResolvedValue(safeRow());
    let res = mockRes();
    await p.getMe(mockReq(), res);
    expect(res.body.user.password).toBeUndefined();
    prisma.user.findUnique.mockResolvedValue(null);
    res = mockRes();
    await p.getMe(mockReq(), res);
    expect(res.statusCode).toBe(404);
    prisma.user.findUnique.mockRejectedValue(new Error("x"));
    res = mockRes();
    await p.getMe(mockReq(), res);
    expect(res.statusCode).toBe(500);
  });

  it("getPublicProfile hides what the user hid", async () => {
    prisma.user.findUnique.mockResolvedValue({ id: "u2", username: "b", name: "B", orgName: "KU", bio: "hi", hiddenFields: ["bio"] });
    let res = mockRes();
    await p.getPublicProfile(mockReq({ params: { userId: "u2" } }), res);
    expect(res.body.user.bio).toBeUndefined();
    expect(res.body.user.orgName).toBe("KU");
    prisma.user.findUnique.mockResolvedValue(null);
    res = mockRes();
    await p.getPublicProfile(mockReq({ params: { userId: "u2" } }), res);
    expect(res.statusCode).toBe(404);
    prisma.user.findUnique.mockRejectedValue(new Error("x"));
    res = mockRes();
    await p.getPublicProfile(mockReq({ params: { userId: "u2" } }), res);
    expect(res.statusCode).toBe(500);
  });
});

describe("completeProfile", () => {
  const body = (o = {}) => ({ username: " nick ", orgType: "university", orgName: " KU ", ...o });

  it("validates input", async () => {
    for (const b of [{ username: " " }, { orgType: "club" }, { orgType: undefined }, { orgName: " " }]) {
      const res = mockRes();
      await p.completeProfile(mockReq({ body: body(b) }), res);
      expect(res.statusCode).toBe(400);
    }
  });

  it("409s when another user holds the username, allows your own", async () => {
    prisma.user.findUnique.mockResolvedValue({ id: "other" });
    let res = mockRes();
    await p.completeProfile(mockReq({ body: body() }), res);
    expect(res.statusCode).toBe(409);

    prisma.user.findUnique.mockResolvedValue({ id: "u1" });
    prisma.user.update.mockResolvedValue(safeRow());
    res = mockRes();
    await p.completeProfile(mockReq({ body: body() }), res);
    expect(res.statusCode).toBe(200);
    expect(prisma.user.update.mock.calls[0][0].data).toEqual({ username: "nick", orgType: "university", orgName: "KU" });
  });

  it("500s on error", async () => {
    prisma.user.findUnique.mockRejectedValue(new Error("x"));
    const res = mockRes();
    await p.completeProfile(mockReq({ body: body() }), res);
    expect(res.statusCode).toBe(500);
  });
});

describe("updateProfile", () => {
  const run = async (body) => {
    const res = mockRes();
    await p.updateProfile(mockReq({ body }), res);
    return res;
  };

  it("rejects bad fields", async () => {
    for (const b of [{ name: " " }, { username: " " }, { orgType: "club" }, { orgName: " " }, { bio: "x".repeat(281) }, { hiddenFields: "bio" }, {}]) {
      expect((await run(b)).statusCode).toBe(400);
    }
  });

  it("updates simple fields, clearing an empty bio", async () => {
    prisma.user.update.mockResolvedValue(safeRow());
    const res = await run({ name: " New ", orgType: "company", orgName: " Co ", bio: "   " });
    expect(res.statusCode).toBe(200);
    expect(prisma.user.update.mock.calls[0][0].data).toEqual({ name: "New", orgType: "company", orgName: "Co", bio: null });
  });

  it("keeps a bio and handles null", async () => {
    prisma.user.update.mockResolvedValue(safeRow());
    await run({ bio: " hello " });
    expect(prisma.user.update.mock.calls[0][0].data.bio).toBe("hello");
    await run({ bio: null });
    expect(prisma.user.update.mock.calls[1][0].data.bio).toBeNull();
  });

  it("filters and de-duplicates hiddenFields", async () => {
    prisma.user.update.mockResolvedValue(safeRow());
    await run({ hiddenFields: ["bio", "bio", "email", "activity", "org"] });
    expect(prisma.user.update.mock.calls[0][0].data.hiddenFields.sort()).toEqual(["activity", "bio", "org"]);
  });

  it("treats an unchanged username as a no-op and counts real changes", async () => {
    prisma.user.findUnique.mockResolvedValue({ username: "same", usernameChangeCount: 3 });
    expect((await run({ username: "same" })).statusCode).toBe(400); // nothing else to change

    prisma.user.findUnique.mockResolvedValueOnce({ username: "old", usernameChangeCount: 1 }).mockResolvedValueOnce(null);
    prisma.user.update.mockResolvedValue(safeRow());
    const res = await run({ username: " fresh " });
    expect(res.statusCode).toBe(200);
    expect(prisma.user.update.mock.calls[0][0].data).toEqual({ username: "fresh", usernameChangeCount: 2 });
  });

  it("enforces the username change limit and uniqueness", async () => {
    prisma.user.findUnique.mockResolvedValueOnce({ username: "old", usernameChangeCount: 3 });
    expect((await run({ username: "fresh" })).statusCode).toBe(403);

    prisma.user.findUnique.mockResolvedValueOnce({ username: "old", usernameChangeCount: 0 }).mockResolvedValueOnce({ id: "other" });
    expect((await run({ username: "taken" })).statusCode).toBe(409);

    prisma.user.findUnique.mockResolvedValueOnce({ username: "old", usernameChangeCount: 0 }).mockResolvedValueOnce({ id: "u1" });
    prisma.user.update.mockResolvedValue(safeRow());
    expect((await run({ username: "mine" })).statusCode).toBe(200);
  });

  it("500s on error", async () => {
    prisma.user.update.mockRejectedValue(new Error("x"));
    expect((await run({ name: "A" })).statusCode).toBe(500);
  });
});

describe("updateTheme / uploadAvatar / getAvatar", () => {
  it("updateTheme validates the colour", async () => {
    for (const themeColor of [undefined, "red", "#12345", "#GGGGGG"]) {
      const res = mockRes();
      await p.updateTheme(mockReq({ body: { themeColor } }), res);
      expect(res.statusCode).toBe(400);
    }
    prisma.user.update.mockResolvedValue(safeRow({ themeColor: "#E07F52" }));
    let res = mockRes();
    await p.updateTheme(mockReq({ body: { themeColor: "#E07F52" } }), res);
    expect(res.body.user.themeColor).toBe("#E07F52");
    prisma.user.update.mockRejectedValue(new Error("x"));
    res = mockRes();
    await p.updateTheme(mockReq({ body: { themeColor: "#E07F52" } }), res);
    expect(res.statusCode).toBe(500);
  });

  it("uploadAvatarHandler", async () => {
    let res = mockRes();
    await p.uploadAvatarHandler(mockReq(), res);
    expect(res.statusCode).toBe(400);
    prisma.user.update.mockResolvedValue(safeRow({ avatarMimeType: "image/png", avatarUpdatedAt: new Date(1) }));
    res = mockRes();
    await p.uploadAvatarHandler(mockReq({ file: { buffer: Buffer.from("x"), mimetype: "image/png" } }), res);
    expect(res.body.user.avatarUrl).toBe("/api/auth/u1/avatar?v=1");
    prisma.user.update.mockRejectedValue(new Error("x"));
    res = mockRes();
    await p.uploadAvatarHandler(mockReq({ file: { buffer: Buffer.from("x"), mimetype: "image/png" } }), res);
    expect(res.statusCode).toBe(500);
  });

  it("getAvatarHandler", async () => {
    const withEnd = () => {
      const r = mockRes();
      r.end = jest.fn();
      return r;
    };
    prisma.user.findUnique.mockResolvedValue(null);
    let res = withEnd();
    await p.getAvatarHandler(mockReq({ params: { userId: "u2" } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
    prisma.user.findUnique.mockResolvedValue({ avatarData: new Uint8Array([1]), avatarMimeType: "image/png" });
    res = mockRes();
    await p.getAvatarHandler(mockReq({ params: { userId: "u2" } }), res);
    expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "image/png");
    expect(Buffer.isBuffer(res.send.mock.calls[0][0])).toBe(true);
    prisma.user.findUnique.mockRejectedValue(new Error("x"));
    res = withEnd();
    await p.getAvatarHandler(mockReq({ params: { userId: "u2" } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe("deleteAccount", () => {
  it("404s for an unknown user", async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    const res = mockRes();
    await p.deleteAccount(mockReq({ body: {} }), res);
    expect(res.statusCode).toBe(404);
  });

  it("requires and checks the password when the account has one", async () => {
    prisma.user.findUnique.mockResolvedValue({ password: await bcrypt.hash("pw", 4) });
    let res = mockRes();
    await p.deleteAccount(mockReq({ body: {} }), res);
    expect(res.statusCode).toBe(400);
    res = mockRes();
    await p.deleteAccount(mockReq({ body: { password: "bad" } }), res);
    expect(res.statusCode).toBe(401);
    expect(prisma.user.delete).not.toHaveBeenCalled();
  });

  it("deletes owned workspaces, boards, tasks and the user", async () => {
    prisma.user.findUnique.mockResolvedValue({ password: await bcrypt.hash("pw", 4) });
    prisma.workspace.findMany.mockResolvedValue([{ id: "w1" }, { id: "w2" }]);
    prisma.board.findUnique.mockResolvedValueOnce({ id: "b1" }).mockResolvedValueOnce(null);
    prisma.task.findMany.mockResolvedValue([{ id: "t1" }]);
    prisma.event.findMany.mockResolvedValue([{ id: "e1" }]);
    const res = mockRes();
    await p.deleteAccount(mockReq({ body: { password: "pw" } }), res);
    expect(res.statusCode).toBe(200);
    expect(prisma.workspace.delete).toHaveBeenCalledTimes(2);
    expect(prisma.board.delete).toHaveBeenCalledTimes(1);
    expect(prisma.task.updateMany).toHaveBeenCalledWith({ where: { assigneeId: "u1" }, data: { assigneeId: null } });
    expect(prisma.event.deleteMany).toHaveBeenCalled();
    expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: "u1" } });
  });

  it("skips empty task/event cleanups and needs no password for OAuth-only accounts", async () => {
    prisma.user.findUnique.mockResolvedValue({ password: null });
    prisma.workspace.findMany.mockResolvedValue([{ id: "w1" }]);
    prisma.board.findUnique.mockResolvedValue({ id: "b1" });
    prisma.task.findMany.mockResolvedValue([]);
    prisma.event.findMany.mockResolvedValue([]);
    const res = mockRes();
    await p.deleteAccount(mockReq({ body: {} }), res);
    expect(res.statusCode).toBe(200);
    expect(prisma.task.deleteMany).not.toHaveBeenCalled();
    expect(prisma.eventAttendee.deleteMany).toHaveBeenCalledTimes(1);
  });

  it("500s on error", async () => {
    prisma.user.findUnique.mockRejectedValue(new Error("x"));
    const res = mockRes();
    await p.deleteAccount(mockReq({ body: {} }), res);
    expect(res.statusCode).toBe(500);
  });
});
