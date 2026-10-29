const mockCtor = jest.fn();
jest.mock("@prisma/client", () => ({ PrismaClient: mockCtor }));

describe("lib/prisma", () => {
  it("creates one shared client", () => {
    const a = require("../src/lib/prisma");
    const b = require("../src/lib/prisma");
    expect(a).toBe(b);
    expect(mockCtor).toHaveBeenCalledTimes(1);
  });
});
