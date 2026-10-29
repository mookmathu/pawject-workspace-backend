jest.mock("../src/lib/prisma", () => require("./helpers/prismaMock"));
jest.mock("../src/lib/permissions", () => ({ getAccessibleBoard: jest.fn() }));

const prisma = require("../src/lib/prisma");
const { getAccessibleBoard } = require("../src/lib/permissions");
const { createColumn, updateColumn, deleteColumn } = require("../src/controllers/column.controller");
const { mockReq, mockRes, silenceErrors } = require("./helpers/http");

beforeEach(() => {
  prisma.__reset();
  jest.resetAllMocks();
  silenceErrors();
});
afterEach(() => jest.restoreAllMocks());

describe("createColumn", () => {
  const req = (body) => mockReq({ params: { boardId: "b1" }, body });

  it("requires a name", async () => {
    const res = mockRes();
    await createColumn(req({}), res);
    expect(res.statusCode).toBe(400);
  });

  it("404s without access", async () => {
    getAccessibleBoard.mockResolvedValue(null);
    const res = mockRes();
    await createColumn(req({ name: "A" }), res);
    expect(res.statusCode).toBe(404);
  });

  it("appends after the highest order", async () => {
    getAccessibleBoard.mockResolvedValue({ id: "b1" });
    prisma.boardColumn.aggregate.mockResolvedValue({ _max: { order: 3 } });
    prisma.boardColumn.create.mockImplementation(async ({ data }) => data);
    const res = mockRes();
    await createColumn(req({ name: " QA " }), res);
    expect(res.statusCode).toBe(201);
    expect(res.body.column).toEqual({ boardId: "b1", name: "QA", order: 4 });
  });

  it("starts at 0 on an empty board", async () => {
    getAccessibleBoard.mockResolvedValue({ id: "b1" });
    prisma.boardColumn.aggregate.mockResolvedValue({ _max: { order: null } });
    prisma.boardColumn.create.mockImplementation(async ({ data }) => data);
    const res = mockRes();
    await createColumn(req({ name: "A" }), res);
    expect(res.body.column.order).toBe(0);
  });

  it("500s on error", async () => {
    getAccessibleBoard.mockRejectedValue(new Error("x"));
    const res = mockRes();
    await createColumn(req({ name: "A" }), res);
    expect(res.statusCode).toBe(500);
  });
});

describe("updateColumn", () => {
  const req = (body) => mockReq({ params: { columnId: "c1" }, body });

  it("rejects an empty name", async () => {
    const res = mockRes();
    await updateColumn(req({ name: "" }), res);
    expect(res.statusCode).toBe(400);
  });

  it("404s when the column is missing", async () => {
    prisma.boardColumn.findUnique.mockResolvedValue(null);
    const res = mockRes();
    await updateColumn(req({ name: "A" }), res);
    expect(res.statusCode).toBe(404);
  });

  it("404s without board access", async () => {
    prisma.boardColumn.findUnique.mockResolvedValue({ boardId: "b1" });
    getAccessibleBoard.mockResolvedValue(null);
    const res = mockRes();
    await updateColumn(req({ name: "A" }), res);
    expect(res.statusCode).toBe(404);
  });

  it("applies only provided fields", async () => {
    prisma.boardColumn.findUnique.mockResolvedValue({ boardId: "b1" });
    getAccessibleBoard.mockResolvedValue({ id: "b1" });
    prisma.boardColumn.update.mockResolvedValue({ id: "c1" });
    await updateColumn(req({ name: " X ", color: "#111", isDoneColumn: true }), mockRes());
    expect(prisma.boardColumn.update.mock.calls[0][0].data).toEqual({ name: "X", color: "#111", isDoneColumn: true });
    const res = mockRes();
    await updateColumn(req({}), res);
    expect(prisma.boardColumn.update.mock.calls[1][0].data).toEqual({});
    expect(res.statusCode).toBe(200);
  });

  it("500s on error", async () => {
    prisma.boardColumn.findUnique.mockRejectedValue(new Error("x"));
    const res = mockRes();
    await updateColumn(req({}), res);
    expect(res.statusCode).toBe(500);
  });
});

describe("deleteColumn", () => {
  const req = () => mockReq({ params: { columnId: "c1" } });

  it("404s when missing", async () => {
    prisma.boardColumn.findUnique.mockResolvedValue(null);
    const res = mockRes();
    await deleteColumn(req(), res);
    expect(res.statusCode).toBe(404);
  });

  it("404s without access", async () => {
    prisma.boardColumn.findUnique.mockResolvedValue({ boardId: "b1", tasks: [] });
    getAccessibleBoard.mockResolvedValue(null);
    const res = mockRes();
    await deleteColumn(req(), res);
    expect(res.statusCode).toBe(404);
  });

  it("refuses to delete a column that still has tasks", async () => {
    prisma.boardColumn.findUnique.mockResolvedValue({ boardId: "b1", tasks: [{ id: "t" }] });
    getAccessibleBoard.mockResolvedValue({ id: "b1" });
    const res = mockRes();
    await deleteColumn(req(), res);
    expect(res.statusCode).toBe(400);
    expect(prisma.boardColumn.delete).not.toHaveBeenCalled();
  });

  it("deletes an empty column", async () => {
    prisma.boardColumn.findUnique.mockResolvedValue({ boardId: "b1", tasks: [] });
    getAccessibleBoard.mockResolvedValue({ id: "b1" });
    const res = mockRes();
    await deleteColumn(req(), res);
    expect(res.statusCode).toBe(200);
    expect(prisma.boardColumn.delete).toHaveBeenCalledWith({ where: { id: "c1" } });
  });

  it("500s on error", async () => {
    prisma.boardColumn.findUnique.mockRejectedValue(new Error("x"));
    const res = mockRes();
    await deleteColumn(req(), res);
    expect(res.statusCode).toBe(500);
  });
});
