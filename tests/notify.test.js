jest.mock("../src/lib/prisma", () => ({
  notification: { create: jest.fn() },
}));
jest.mock("../src/lib/socket", () => ({ emitToUser: jest.fn() }));

const prisma = require("../src/lib/prisma");
const { emitToUser } = require("../src/lib/socket");
const { createNotification } = require("../src/lib/notify");

beforeEach(() => jest.clearAllMocks());

describe("createNotification", () => {
  it("does nothing without a userId", async () => {
    expect(await createNotification({ type: "message", title: "x" })).toBeNull();
    expect(prisma.notification.create).not.toHaveBeenCalled();
  });

  it("saves the notification and pushes it live to the user", async () => {
    const saved = { id: "n1", userId: "u1", title: "Hi" };
    prisma.notification.create.mockResolvedValue(saved);
    const out = await createNotification({ userId: "u1", type: "message", title: "Hi", body: "yo", link: { type: "dm" } });
    expect(prisma.notification.create).toHaveBeenCalledWith({
      data: { userId: "u1", type: "message", title: "Hi", body: "yo", link: { type: "dm" } },
    });
    expect(emitToUser).toHaveBeenCalledWith("u1", "notification:new", saved);
    expect(out).toBe(saved);
  });

  it("stores a missing body as null and a missing link as undefined", async () => {
    prisma.notification.create.mockResolvedValue({ id: "n2" });
    await createNotification({ userId: "u1", type: "task", title: "T" });
    expect(prisma.notification.create).toHaveBeenCalledWith({
      data: { userId: "u1", type: "task", title: "T", body: null, link: undefined },
    });
  });

  it("swallows database errors so the caller's request is not broken", async () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    prisma.notification.create.mockRejectedValue(new Error("db down"));
    await expect(createNotification({ userId: "u1", type: "message", title: "T" })).resolves.toBeNull();
    expect(emitToUser).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
