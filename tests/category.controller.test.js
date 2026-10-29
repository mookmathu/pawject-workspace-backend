jest.mock("../src/lib/prisma", () => require("./helpers/prismaMock"));
jest.mock("../src/lib/permissions", () => ({ getAccessibleBoard: jest.fn() }));

const prisma = require("../src/lib/prisma");
const { getAccessibleBoard } = require("../src/lib/permissions");
const { createCategory, updateCategory, deleteCategory } = require("../src/controllers/category.controller");
const { mockReq, mockRes, silenceErrors } = require("./helpers/http");

beforeEach(() => {
  prisma.__reset();
  jest.resetAllMocks();
  silenceErrors();
});
afterEach(() => jest.restoreAllMocks());

describe("createCategory", () => {
  const req = (body) => mockReq({ params: { boardId: "b1" }, body });

  it("requires a name", async () => {
    const res = mockRes();
    await createCategory(req({ name: "  " }), res);
    expect(res.statusCode).toBe(400);
  });

  it("404s without board access", async () => {
    getAccessibleBoard.mockResolvedValue(null);
    const res = mockRes();
    await createCategory(req({ name: "A" }), res);
    expect(res.statusCode).toBe(404);
  });

  it("trims the name and defaults the colour", async () => {
    getAccessibleBoard.mockResolvedValue({ id: "b1" });
    prisma.boardCategory.create.mockImplementation(async ({ data }) => data);
    const res = mockRes();
    await createCategory(req({ name: "  Work " }), res);
    expect(res.statusCode).toBe(201);
    expect(res.body.category).toEqual({ boardId: "b1", name: "Work", color: "#E7E2D6" });
  });

  it("keeps a given colour", async () => {
    getAccessibleBoard.mockResolvedValue({ id: "b1" });
    prisma.boardCategory.create.mockImplementation(async ({ data }) => data);
    const res = mockRes();
    await createCategory(req({ name: "A", color: "#fff" }), res);
    expect(res.body.category.color).toBe("#fff");
  });

  it("500s on error", async () => {
    getAccessibleBoard.mockRejectedValue(new Error("x"));
    const res = mockRes();
    await createCategory(req({ name: "A" }), res);
    expect(res.statusCode).toBe(500);
  });
});

describe("updateCategory", () => {
  const req = (body) => mockReq({ params: { categoryId: "c1" }, body });

  it("rejects an empty name", async () => {
    const res = mockRes();
    await updateCategory(req({ name: " " }), res);
    expect(res.statusCode).toBe(400);
  });

  it("404s when the category is missing", async () => {
    prisma.boardCategory.findUnique.mockResolvedValue(null);
    const res = mockRes();
    await updateCategory(req({ name: "A" }), res);
    expect(res.statusCode).toBe(404);
  });

  it("404s when the board is not accessible", async () => {
    prisma.boardCategory.findUnique.mockResolvedValue({ boardId: "b1" });
    getAccessibleBoard.mockResolvedValue(null);
    const res = mockRes();
    await updateCategory(req({ name: "A" }), res);
    expect(res.statusCode).toBe(404);
  });

  it("updates only the provided fields", async () => {
    prisma.boardCategory.findUnique.mockResolvedValue({ boardId: "b1" });
    getAccessibleBoard.mockResolvedValue({ id: "b1" });
    prisma.boardCategory.update.mockResolvedValue({ id: "c1" });
    const res = mockRes();
    await updateCategory(req({ color: "#000" }), res);
    expect(prisma.boardCategory.update.mock.calls[0][0].data).toEqual({ color: "#000" });
    await updateCategory(req({ name: " N " }), mockRes());
    expect(prisma.boardCategory.update.mock.calls[1][0].data).toEqual({ name: "N" });
    expect(res.statusCode).toBe(200);
  });

  it("500s on error", async () => {
    prisma.boardCategory.findUnique.mockRejectedValue(new Error("x"));
    const res = mockRes();
    await updateCategory(req({}), res);
    expect(res.statusCode).toBe(500);
  });
});

describe("deleteCategory", () => {
  const req = () => mockReq({ params: { categoryId: "c1" } });

  it("404s when missing", async () => {
    prisma.boardCategory.findUnique.mockResolvedValue(null);
    const res = mockRes();
    await deleteCategory(req(), res);
    expect(res.statusCode).toBe(404);
  });

  it("404s without board access", async () => {
    prisma.boardCategory.findUnique.mockResolvedValue({ boardId: "b1", tasks: [] });
    getAccessibleBoard.mockResolvedValue(null);
    const res = mockRes();
    await deleteCategory(req(), res);
    expect(res.statusCode).toBe(404);
  });

  it("clears the tag from tasks before deleting", async () => {
    prisma.boardCategory.findUnique.mockResolvedValue({ boardId: "b1", tasks: [{ id: "t" }] });
    getAccessibleBoard.mockResolvedValue({ id: "b1" });
    const res = mockRes();
    await deleteCategory(req(), res);
    expect(prisma.task.updateMany).toHaveBeenCalledWith({ where: { categoryId: "c1" }, data: { categoryId: null } });
    expect(prisma.boardCategory.delete).toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
  });

  it("skips updateMany when no tasks use it", async () => {
    prisma.boardCategory.findUnique.mockResolvedValue({ boardId: "b1", tasks: [] });
    getAccessibleBoard.mockResolvedValue({ id: "b1" });
    await deleteCategory(req(), mockRes());
    expect(prisma.task.updateMany).not.toHaveBeenCalled();
  });

  it("500s on error", async () => {
    prisma.boardCategory.findUnique.mockRejectedValue(new Error("x"));
    const res = mockRes();
    await deleteCategory(req(), res);
    expect(res.statusCode).toBe(500);
  });
});
