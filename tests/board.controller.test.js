jest.mock("../src/lib/prisma", () => require("./helpers/prismaMock"));
jest.mock("../src/lib/permissions", () => ({
  getMembership: jest.fn(),
  getAccessibleBoard: jest.fn(),
}));

const prisma = require("../src/lib/prisma");
const { getMembership, getAccessibleBoard } = require("../src/lib/permissions");
const { getWorkspaceBoard, updateBoardNote } = require("../src/controllers/board.controller");
const { mockReq, mockRes, silenceErrors } = require("./helpers/http");

beforeEach(() => {
  prisma.__reset();
  jest.resetAllMocks();
  silenceErrors();
});
afterEach(() => jest.restoreAllMocks());

describe("getWorkspaceBoard", () => {
  it("404s for non-members", async () => {
    getMembership.mockResolvedValue(null);
    const res = mockRes();
    await getWorkspaceBoard(mockReq({ params: { workspaceId: "w1" } }), res);
    expect(res.statusCode).toBe(404);
  });

  it("returns the existing board", async () => {
    getMembership.mockResolvedValue({ role: "member" });
    prisma.board.findUnique.mockResolvedValue({ id: "b1" });
    const res = mockRes();
    await getWorkspaceBoard(mockReq({ params: { workspaceId: "w1" } }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.board.id).toBe("b1");
    expect(prisma.board.create).not.toHaveBeenCalled();
  });

  it("creates a default board with 4 columns when none exists", async () => {
    getMembership.mockResolvedValue({ role: "owner" });
    prisma.board.findUnique.mockResolvedValue(null);
    prisma.board.create.mockResolvedValue({ id: "b2" });
    const res = mockRes();
    await getWorkspaceBoard(mockReq({ params: { workspaceId: "w1" } }), res);
    const data = prisma.board.create.mock.calls[0][0].data;
    expect(data.columns.create).toHaveLength(4);
    expect(data.columns.create[3]).toMatchObject({ name: "Done", isDoneColumn: true, order: 3 });
    expect(data.categories.create).toHaveLength(4);
    expect(res.body.board.id).toBe("b2");
  });

  it("500s when the database throws", async () => {
    getMembership.mockRejectedValue(new Error("db"));
    const res = mockRes();
    await getWorkspaceBoard(mockReq({ params: { workspaceId: "w1" } }), res);
    expect(res.statusCode).toBe(500);
  });
});

describe("updateBoardNote", () => {
  it("rejects a non-array note", async () => {
    const res = mockRes();
    await updateBoardNote(mockReq({ params: { boardId: "b1" }, body: { noteContent: "x" } }), res);
    expect(res.statusCode).toBe(400);
  });

  it("404s when the board is not accessible", async () => {
    getAccessibleBoard.mockResolvedValue(null);
    const res = mockRes();
    await updateBoardNote(mockReq({ params: { boardId: "b1" }, body: { noteContent: [] } }), res);
    expect(res.statusCode).toBe(404);
  });

  it("saves the note", async () => {
    getAccessibleBoard.mockResolvedValue({ id: "b1" });
    prisma.board.update.mockResolvedValue({ noteContent: [{ id: 1 }] });
    const res = mockRes();
    await updateBoardNote(mockReq({ params: { boardId: "b1" }, body: { noteContent: [{ id: 1 }] } }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.noteContent).toEqual([{ id: 1 }]);
  });

  it("500s on error", async () => {
    getAccessibleBoard.mockRejectedValue(new Error("db"));
    const res = mockRes();
    await updateBoardNote(mockReq({ params: { boardId: "b1" }, body: { noteContent: [] } }), res);
    expect(res.statusCode).toBe(500);
  });
});
