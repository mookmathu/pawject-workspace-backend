jest.mock("../src/lib/prisma", () => ({
  workspaceMember: { findUnique: jest.fn() },
  board: { findUnique: jest.fn() },
}));

const prisma = require("../src/lib/prisma");
const { getMembership, getAccessibleBoard, canEditTask } = require("../src/lib/permissions");

beforeEach(() => jest.clearAllMocks());

describe("getMembership", () => {
  it("looks the member up by the workspace+user compound key", async () => {
    prisma.workspaceMember.findUnique.mockResolvedValue({ role: "member" });
    const out = await getMembership("w1", "u1");
    expect(prisma.workspaceMember.findUnique).toHaveBeenCalledWith({
      where: { workspaceId_userId: { workspaceId: "w1", userId: "u1" } },
    });
    expect(out).toEqual({ role: "member" });
  });
});

describe("getAccessibleBoard", () => {
  it("returns null when the board does not exist", async () => {
    prisma.board.findUnique.mockResolvedValue(null);
    expect(await getAccessibleBoard("b1", "u1")).toBeNull();
    expect(prisma.workspaceMember.findUnique).not.toHaveBeenCalled();
  });

  it("returns null when the user is not a member of the board's workspace", async () => {
    prisma.board.findUnique.mockResolvedValue({ id: "b1", workspaceId: "w1" });
    prisma.workspaceMember.findUnique.mockResolvedValue(null);
    expect(await getAccessibleBoard("b1", "u1")).toBeNull();
  });

  it("returns the board for a member", async () => {
    const board = { id: "b1", workspaceId: "w1" };
    prisma.board.findUnique.mockResolvedValue(board);
    prisma.workspaceMember.findUnique.mockResolvedValue({ role: "member" });
    expect(await getAccessibleBoard("b1", "u1")).toBe(board);
  });
});

describe("canEditTask", () => {
  it("lets anyone edit an unassigned task", () => {
    expect(canEditTask({ assigneeId: null }, { role: "member", userId: "u1" })).toBe(true);
  });

  it("lets the workspace owner edit any assigned task", () => {
    expect(canEditTask({ assigneeId: "u2" }, { role: "owner", userId: "u1" })).toBe(true);
  });

  it("lets the assignee edit their own task", () => {
    expect(canEditTask({ assigneeId: "u1" }, { role: "member", userId: "u1" })).toBe(true);
  });

  it("blocks other members from editing an assigned task", () => {
    expect(canEditTask({ assigneeId: "u2" }, { role: "member", userId: "u1" })).toBe(false);
  });
});
