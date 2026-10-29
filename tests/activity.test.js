jest.mock("../src/lib/prisma", () => ({
  userActivityDay: { upsert: jest.fn() },
}));

let prisma;
let recordActivity;
let dayKey;

beforeEach(() => {
  jest.resetModules();
  jest.useFakeTimers().setSystemTime(new Date("2026-10-29T10:00:00Z"));
  // resetModules gives every test a fresh module (and a fresh lastWrite map),
  // so the mocked prisma has to be re-required after it too
  prisma = require("../src/lib/prisma");
  prisma.userActivityDay.upsert.mockResolvedValue({});
  ({ recordActivity, dayKey } = require("../src/lib/activity"));
});

afterEach(() => jest.useRealTimers());

describe("dayKey", () => {
  it("formats the day in Bangkok time", () => {
    expect(dayKey(new Date("2026-10-29T10:00:00Z"))).toBe("2026-10-29");
  });

  it("does not spill onto the next UTC day late at night", () => {
    // 20:00 UTC on the 29th is already 03:00 on the 30th in Bangkok
    expect(dayKey(new Date("2026-10-29T20:00:00Z"))).toBe("2026-10-30");
    // 02:00 Bangkok on the 29th is still the 28th in UTC
    expect(dayKey(new Date("2026-10-28T19:00:00Z"))).toBe("2026-10-29");
  });
});

describe("recordActivity", () => {
  it("upserts one row for today the first time", () => {
    recordActivity("u1");
    expect(prisma.userActivityDay.upsert).toHaveBeenCalledWith({
      where: { userId_day: { userId: "u1", day: "2026-10-29" } },
      create: { userId: "u1", day: "2026-10-29", count: 1 },
      update: { count: { increment: 1 } },
    });
  });

  it("writes at most once per 5 minutes per user", () => {
    recordActivity("u1");
    jest.advanceTimersByTime(60 * 1000);
    recordActivity("u1");
    expect(prisma.userActivityDay.upsert).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(5 * 60 * 1000);
    recordActivity("u1");
    expect(prisma.userActivityDay.upsert).toHaveBeenCalledTimes(2);
  });

  it("tracks each user separately", () => {
    recordActivity("u1");
    recordActivity("u2");
    expect(prisma.userActivityDay.upsert).toHaveBeenCalledTimes(2);
  });

  it("allows an immediate retry when the write fails, without throwing", async () => {
    prisma.userActivityDay.upsert.mockRejectedValueOnce(new Error("db down"));
    recordActivity("u1");
    await Promise.resolve();
    await Promise.resolve();
    recordActivity("u1");
    expect(prisma.userActivityDay.upsert).toHaveBeenCalledTimes(2);
  });
});
