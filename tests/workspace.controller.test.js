jest.mock("../src/lib/prisma", () => require("./helpers/prismaMock"));

const prisma = require("../src/lib/prisma");
const w = require("../src/controllers/workspace.controller");
const { mockReq, mockRes, silenceErrors } = require("./helpers/http");

beforeEach(() => {
  prisma.__reset();
  jest.resetAllMocks();
  silenceErrors();
});
afterEach(() => jest.restoreAllMocks());

const pub = (id) => ({ id, username: id, name: id, hiddenFields: [] });
const ws = (over = {}) => ({ id: "w1", name: "G", ownerId: "u1", isPersonal: false, imageMimeType: null, members: [{ userId: "u1", user: pub("u1") }], ...over });
const params = (extra = {}) => ({ workspaceId: "w1", ...extra });

describe("getMyWorkspaces", () => {
  it("creates the personal workspace when missing and serialises image urls", async () => {
    prisma.workspace.findFirst.mockResolvedValue(null);
    prisma.workspace.findMany.mockResolvedValue([ws({ imageMimeType: "image/png", imageUpdatedAt: new Date(5) }), ws({ id: "w2", members: undefined })]);
    const res = mockRes();
    await w.getMyWorkspaces(mockReq(), res);
    expect(prisma.workspace.create).toHaveBeenCalled();
    expect(res.body.workspaces[0].imageUrl).toBe("/api/workspaces/w1/image?v=5");
    expect(res.body.workspaces[1].imageUrl).toBeNull();
    expect(res.body.workspaces[0].members[0].user.password).toBeUndefined();
  });

  it("reuses an existing personal workspace", async () => {
    prisma.workspace.findFirst.mockResolvedValue({ id: "p" });
    prisma.workspace.findMany.mockResolvedValue([]);
    await w.getMyWorkspaces(mockReq(), mockRes());
    expect(prisma.workspace.create).not.toHaveBeenCalled();
  });

  it("500s on error", async () => {
    prisma.workspace.findFirst.mockRejectedValue(new Error("x"));
    const res = mockRes();
    await w.getMyWorkspaces(mockReq(), res);
    expect(res.statusCode).toBe(500);
  });
});

describe("createWorkspace", () => {
  it("requires a name", async () => {
    const res = mockRes();
    await w.createWorkspace(mockReq({ body: { name: " " } }), res);
    expect(res.statusCode).toBe(400);
  });

  it("creates with a 6-char code from the safe alphabet", async () => {
    prisma.workspace.create.mockImplementation(async ({ data }) => ws({ joinCode: data.joinCode }));
    const res = mockRes();
    await w.createWorkspace(mockReq({ body: { name: " G " } }), res);
    expect(res.statusCode).toBe(201);
    expect(prisma.workspace.create.mock.calls[0][0].data.joinCode).toMatch(/^[A-HJKMN-Z2-9]{6}$/);
    expect(prisma.workspace.create.mock.calls[0][0].data.name).toBe("G");
  });

  it("retries on a join code collision", async () => {
    const dup = Object.assign(new Error("dup"), { code: "P2002" });
    prisma.workspace.create.mockRejectedValueOnce(dup).mockRejectedValueOnce(dup).mockResolvedValue(ws());
    const res = mockRes();
    await w.createWorkspace(mockReq({ body: { name: "G" } }), res);
    expect(prisma.workspace.create).toHaveBeenCalledTimes(3);
    expect(res.statusCode).toBe(201);
  });

  it("gives up after 5 collisions and on other errors", async () => {
    const dup = Object.assign(new Error("dup"), { code: "P2002" });
    prisma.workspace.create.mockRejectedValue(dup);
    let res = mockRes();
    await w.createWorkspace(mockReq({ body: { name: "G" } }), res);
    expect(prisma.workspace.create).toHaveBeenCalledTimes(5);
    expect(res.statusCode).toBe(500);
    prisma.workspace.create.mockRejectedValue(new Error("other"));
    res = mockRes();
    await w.createWorkspace(mockReq({ body: { name: "G" } }), res);
    expect(res.statusCode).toBe(500);
  });
});

describe("addMember", () => {
  const req = (username = "bob") => mockReq({ params: params(), body: { username } });

  it("walks through each failure", async () => {
    let res = mockRes();
    await w.addMember(req(" "), res);
    expect(res.statusCode).toBe(400);

    prisma.workspace.findUnique.mockResolvedValue(null);
    res = mockRes();
    await w.addMember(req(), res);
    expect(res.statusCode).toBe(404);

    prisma.workspace.findUnique.mockResolvedValue(ws({ isPersonal: true }));
    res = mockRes();
    await w.addMember(req(), res);
    expect(res.statusCode).toBe(400);

    prisma.workspace.findUnique.mockResolvedValue(ws());
    prisma.workspaceMember.findUnique.mockResolvedValueOnce(null);
    res = mockRes();
    await w.addMember(req(), res);
    expect(res.statusCode).toBe(403);

    prisma.workspaceMember.findUnique.mockResolvedValueOnce({ role: "member" });
    prisma.user.findUnique.mockResolvedValue(null);
    res = mockRes();
    await w.addMember(req(), res);
    expect(res.statusCode).toBe(404);

    prisma.workspaceMember.findUnique.mockResolvedValueOnce({ role: "member" }).mockResolvedValueOnce({ id: "m" });
    prisma.user.findUnique.mockResolvedValue({ id: "u2" });
    res = mockRes();
    await w.addMember(req(), res);
    expect(res.statusCode).toBe(409);
  });

  it("adds a member", async () => {
    prisma.workspace.findUnique.mockResolvedValue(ws());
    prisma.workspaceMember.findUnique.mockResolvedValueOnce({ role: "member" }).mockResolvedValueOnce(null);
    prisma.user.findUnique.mockResolvedValue({ id: "u2" });
    prisma.workspaceMember.create.mockResolvedValue({ id: "m", user: pub("u2") });
    const res = mockRes();
    await w.addMember(req(), res);
    expect(res.statusCode).toBe(201);
    expect(res.body.member.user.id).toBe("u2");
  });

  it("500s on error", async () => {
    prisma.workspace.findUnique.mockRejectedValue(new Error("x"));
    const res = mockRes();
    await w.addMember(req(), res);
    expect(res.statusCode).toBe(500);
  });
});

describe("removeMember", () => {
  const req = (userId, caller = "u1") => mockReq({ userId: caller, params: params({ userId }) });

  it("404s, 403s and protects the owner", async () => {
    prisma.workspace.findUnique.mockResolvedValue(null);
    let res = mockRes();
    await w.removeMember(req("u2"), res);
    expect(res.statusCode).toBe(404);

    prisma.workspace.findUnique.mockResolvedValue(ws());
    res = mockRes();
    await w.removeMember(req("u3", "u2"), res);
    expect(res.statusCode).toBe(403);

    res = mockRes();
    await w.removeMember(req("u1", "u1"), res);
    expect(res.statusCode).toBe(400);
  });

  it("lets a member leave and the owner remove others", async () => {
    prisma.workspace.findUnique.mockResolvedValue(ws());
    let res = mockRes();
    await w.removeMember(req("u2", "u2"), res);
    expect(res.statusCode).toBe(200);
    res = mockRes();
    await w.removeMember(req("u3", "u1"), res);
    expect(res.statusCode).toBe(200);
    expect(prisma.workspaceMember.deleteMany).toHaveBeenCalledTimes(2);
  });

  it("500s on error", async () => {
    prisma.workspace.findUnique.mockRejectedValue(new Error("x"));
    const res = mockRes();
    await w.removeMember(req("u2"), res);
    expect(res.statusCode).toBe(500);
  });
});

describe("deleteWorkspace", () => {
  const req = () => mockReq({ params: params() });

  it("404 / 403 / personal guard", async () => {
    prisma.workspace.findUnique.mockResolvedValue(null);
    let res = mockRes();
    await w.deleteWorkspace(req(), res);
    expect(res.statusCode).toBe(404);
    prisma.workspace.findUnique.mockResolvedValue(ws({ ownerId: "other" }));
    res = mockRes();
    await w.deleteWorkspace(req(), res);
    expect(res.statusCode).toBe(403);
    prisma.workspace.findUnique.mockResolvedValue(ws({ isPersonal: true }));
    res = mockRes();
    await w.deleteWorkspace(req(), res);
    expect(res.statusCode).toBe(400);
  });

  it("deletes the board contents in a transaction", async () => {
    prisma.workspace.findUnique.mockResolvedValue(ws());
    prisma.board.findUnique.mockResolvedValue({ id: "b1" });
    prisma.task.findMany.mockResolvedValue([{ id: "t1" }]);
    const res = mockRes();
    await w.deleteWorkspace(req(), res);
    expect(prisma.taskComment.deleteMany).toHaveBeenCalled();
    expect(prisma.subtask.deleteMany).toHaveBeenCalled();
    expect(prisma.board.delete).toHaveBeenCalled();
    expect(prisma.workspace.delete).toHaveBeenCalledWith({ where: { id: "w1" } });
    expect(res.statusCode).toBe(200);
  });

  it("handles a workspace without a board or tasks", async () => {
    prisma.workspace.findUnique.mockResolvedValue(ws());
    prisma.board.findUnique.mockResolvedValue(null);
    let res = mockRes();
    await w.deleteWorkspace(req(), res);
    expect(prisma.board.delete).not.toHaveBeenCalled();
    prisma.board.findUnique.mockResolvedValue({ id: "b1" });
    prisma.task.findMany.mockResolvedValue([]);
    res = mockRes();
    await w.deleteWorkspace(req(), res);
    expect(prisma.task.deleteMany).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
  });

  it("500s on error", async () => {
    prisma.workspace.findUnique.mockRejectedValue(new Error("x"));
    const res = mockRes();
    await w.deleteWorkspace(req(), res);
    expect(res.statusCode).toBe(500);
  });
});

describe("workspace image", () => {
  const file = { buffer: Buffer.from("x"), mimetype: "image/png" };

  it("upload: validates file, existence and ownership, then saves", async () => {
    let res = mockRes();
    await w.uploadWorkspaceImage(mockReq({ params: params() }), res);
    expect(res.statusCode).toBe(400);
    prisma.workspace.findUnique.mockResolvedValue(null);
    res = mockRes();
    await w.uploadWorkspaceImage(mockReq({ params: params(), file }), res);
    expect(res.statusCode).toBe(404);
    prisma.workspace.findUnique.mockResolvedValue(ws({ ownerId: "other" }));
    res = mockRes();
    await w.uploadWorkspaceImage(mockReq({ params: params(), file }), res);
    expect(res.statusCode).toBe(403);
    prisma.workspace.findUnique.mockResolvedValue(ws());
    prisma.workspace.update.mockResolvedValue(ws({ imageMimeType: "image/png", imageUpdatedAt: new Date(1) }));
    res = mockRes();
    await w.uploadWorkspaceImage(mockReq({ params: params(), file }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.workspace.imageUrl).toContain("/image?v=1");
    prisma.workspace.findUnique.mockRejectedValue(new Error("x"));
    res = mockRes();
    await w.uploadWorkspaceImage(mockReq({ params: params(), file }), res);
    expect(res.statusCode).toBe(500);
  });

  it("serve: 404, success and error", async () => {
    prisma.workspace.findUnique.mockResolvedValue(null);
    let res = mockRes();
    res.end = jest.fn();
    await w.getWorkspaceImage(mockReq({ params: params() }), res);
    expect(res.status).toHaveBeenCalledWith(404);

    prisma.workspace.findUnique.mockResolvedValue({ imageData: Buffer.from("x"), imageMimeType: "image/png" });
    res = mockRes();
    await w.getWorkspaceImage(mockReq({ params: params() }), res);
    expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "image/png");
    expect(res.send).toHaveBeenCalled();

    prisma.workspace.findUnique.mockRejectedValue(new Error("x"));
    res = mockRes();
    await w.getWorkspaceImage(mockReq({ params: params() }), res);
    expect(res.statusCode).toBe(500);
  });
});

describe("regenerateJoinCode", () => {
  const req = () => mockReq({ params: params() });

  it("guards then rotates the code", async () => {
    prisma.workspace.findUnique.mockResolvedValue(null);
    let res = mockRes();
    await w.regenerateJoinCode(req(), res);
    expect(res.statusCode).toBe(404);
    prisma.workspace.findUnique.mockResolvedValue(ws({ ownerId: "other" }));
    res = mockRes();
    await w.regenerateJoinCode(req(), res);
    expect(res.statusCode).toBe(403);
    prisma.workspace.findUnique.mockResolvedValue(ws({ isPersonal: true }));
    res = mockRes();
    await w.regenerateJoinCode(req(), res);
    expect(res.statusCode).toBe(400);

    prisma.workspace.findUnique.mockResolvedValue(ws());
    prisma.workspace.update.mockResolvedValue(ws({ joinCode: "ABC234" }));
    res = mockRes();
    await w.regenerateJoinCode(req(), res);
    expect(res.statusCode).toBe(200);

    prisma.workspace.findUnique.mockRejectedValue(new Error("x"));
    res = mockRes();
    await w.regenerateJoinCode(req(), res);
    expect(res.statusCode).toBe(500);
  });
});

describe("joinWorkspaceByCode", () => {
  const req = (code) => mockReq({ body: { code } });

  it("validates, looks up case-insensitively, and handles duplicates", async () => {
    let res = mockRes();
    await w.joinWorkspaceByCode(req(" "), res);
    expect(res.statusCode).toBe(400);

    prisma.workspace.findUnique.mockResolvedValue(null);
    res = mockRes();
    await w.joinWorkspaceByCode(req(" abc234 "), res);
    expect(prisma.workspace.findUnique).toHaveBeenCalledWith({ where: { joinCode: "ABC234" } });
    expect(res.statusCode).toBe(404);

    prisma.workspace.findUnique.mockResolvedValue(ws());
    prisma.workspaceMember.findUnique.mockResolvedValue({ id: "m" });
    res = mockRes();
    await w.joinWorkspaceByCode(req("ABC234"), res);
    expect(res.statusCode).toBe(409);
  });

  it("joins as a member", async () => {
    prisma.workspace.findUnique.mockResolvedValue(ws());
    prisma.workspaceMember.findUnique.mockResolvedValue(null);
    const res = mockRes();
    await w.joinWorkspaceByCode(req("ABC234"), res);
    expect(prisma.workspaceMember.create.mock.calls[0][0].data).toMatchObject({ role: "member", userId: "u1" });
    expect(res.statusCode).toBe(200);
  });

  it("500s on error", async () => {
    prisma.workspace.findUnique.mockRejectedValue(new Error("x"));
    const res = mockRes();
    await w.joinWorkspaceByCode(req("ABC234"), res);
    expect(res.statusCode).toBe(500);
  });
});

describe("transferOwnership", () => {
  const req = (userId) => mockReq({ params: params(), body: { userId } });

  it("walks through each guard", async () => {
    let res = mockRes();
    await w.transferOwnership(req(undefined), res);
    expect(res.statusCode).toBe(400);

    prisma.workspace.findUnique.mockResolvedValue(null);
    res = mockRes();
    await w.transferOwnership(req("u2"), res);
    expect(res.statusCode).toBe(404);

    prisma.workspace.findUnique.mockResolvedValue(ws({ ownerId: "other" }));
    res = mockRes();
    await w.transferOwnership(req("u2"), res);
    expect(res.statusCode).toBe(403);

    prisma.workspace.findUnique.mockResolvedValue(ws({ isPersonal: true }));
    res = mockRes();
    await w.transferOwnership(req("u2"), res);
    expect(res.statusCode).toBe(400);

    prisma.workspace.findUnique.mockResolvedValue(ws());
    res = mockRes();
    await w.transferOwnership(req("u1"), res);
    expect(res.statusCode).toBe(400);

    prisma.workspaceMember.findUnique.mockResolvedValue(null);
    res = mockRes();
    await w.transferOwnership(req("u2"), res);
    expect(res.statusCode).toBe(400);
  });

  it("swaps roles in one transaction", async () => {
    prisma.workspace.findUnique.mockResolvedValue(ws());
    prisma.workspaceMember.findUnique.mockResolvedValue({ id: "m" });
    const res = mockRes();
    await w.transferOwnership(req("u2"), res);
    expect(prisma.workspace.update).toHaveBeenCalledWith({ where: { id: "w1" }, data: { ownerId: "u2" } });
    const roles = prisma.workspaceMember.update.mock.calls.map((c) => c[0].data.role);
    expect(roles).toEqual(["owner", "member"]);
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
  });

  it("500s on error", async () => {
    prisma.workspace.findUnique.mockRejectedValue(new Error("x"));
    const res = mockRes();
    await w.transferOwnership(req("u2"), res);
    expect(res.statusCode).toBe(500);
  });
});
