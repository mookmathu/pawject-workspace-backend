jest.mock("../src/lib/prisma", () => require("./helpers/prismaMock"));

const prisma = require("../src/lib/prisma");
const e = require("../src/controllers/event.controller");
const { mockReq, mockRes, silenceErrors } = require("./helpers/http");

beforeEach(() => {
  prisma.__reset();
  jest.resetAllMocks();
  silenceErrors();
});
afterEach(() => jest.restoreAllMocks());

describe("getEvents", () => {
  it("returns everything visible to the user", async () => {
    prisma.event.findMany.mockResolvedValue([{ id: "e1" }]);
    const res = mockRes();
    await e.getEvents(mockReq(), res);
    expect(prisma.event.findMany.mock.calls[0][0].where.OR).toHaveLength(2);
    expect(res.body.events).toHaveLength(1);
  });

  it("limits to a month in UTC when year and month are given", async () => {
    prisma.event.findMany.mockResolvedValue([]);
    await e.getEvents(mockReq({ query: { year: "2026", month: "12" } }), mockRes());
    const range = prisma.event.findMany.mock.calls[0][0].where.AND[1].startDate;
    expect(range.gte.toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(range.lt.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("500s on error", async () => {
    prisma.event.findMany.mockRejectedValue(new Error("x"));
    const res = mockRes();
    await e.getEvents(mockReq(), res);
    expect(res.statusCode).toBe(500);
  });
});

describe("createEvent", () => {
  const base = { title: " Party ", startDate: "2026-05-01T10:00:00Z" };
  const req = (body) => mockReq({ body: { ...base, ...body } });

  it("validates title, start, order, label and sticker", async () => {
    const cases = [
      [{ title: " " }, 400],
      [{ startDate: undefined }, 400],
      [{ endDate: "2026-04-01T00:00:00Z" }, 400],
      [{ label: "nope" }, 400],
      [{ sticker: "mascot:unknown" }, 400],
      [{ sticker: 5 }, 400],
      [{ sticker: "<b>" }, 400],
      [{ sticker: "abc" }, 400],
      [{ sticker: "x".repeat(20) + "!" }, 400],
    ];
    for (const [body, code] of cases) {
      const res = mockRes();
      await e.createEvent(req(body), res);
      expect(res.statusCode).toBe(code);
    }
  });

  it("returns a recent duplicate instead of creating another", async () => {
    prisma.event.findFirst.mockResolvedValue({ id: "dup" });
    const res = mockRes();
    await e.createEvent(req({}), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.event.id).toBe("dup");
    expect(prisma.event.create).not.toHaveBeenCalled();
  });

  it("creates with attendees, skipping the owner and reporting unknown usernames", async () => {
    prisma.event.findFirst.mockResolvedValue(null);
    prisma.user.findMany.mockResolvedValue([
      { id: "u1", username: "me" },
      { id: "u2", username: "bob" },
    ]);
    prisma.event.create.mockImplementation(async ({ data }) => data);
    const res = mockRes();
    await e.createEvent(
      req({ attendeeUsernames: ["me", "bob", " bob ", "ghost", ""], sticker: "mascot:puppy", label: "urgent", endDate: "2026-05-02T00:00:00Z", description: "d", isAllDay: false }),
      res,
    );
    expect(res.statusCode).toBe(201);
    expect(res.body.notFoundUsernames).toEqual(["ghost"]);
    expect(res.body.event).toMatchObject({ title: "Party", sticker: "mascot:puppy", label: "urgent", isAllDay: false, description: "d" });
    expect(res.body.event.attendees.create).toEqual([{ userId: "u2" }]);
  });

  it("defaults label, all-day and empty attendees; clears an empty sticker", async () => {
    prisma.event.findFirst.mockResolvedValue(null);
    prisma.event.create.mockImplementation(async ({ data }) => data);
    const res = mockRes();
    await e.createEvent(req({ sticker: "  ", attendeeUsernames: [] }), res);
    expect(res.body.event).toMatchObject({ label: "general", isAllDay: true, sticker: null, endDate: null, description: null });
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it("accepts an emoji sticker", async () => {
    prisma.event.findFirst.mockResolvedValue(null);
    prisma.event.create.mockImplementation(async ({ data }) => data);
    const res = mockRes();
    await e.createEvent(req({ sticker: "🎉" }), res);
    expect(res.body.event.sticker).toBe("🎉");
  });

  it("500s on error", async () => {
    prisma.event.findFirst.mockRejectedValue(new Error("x"));
    const res = mockRes();
    await e.createEvent(req({}), res);
    expect(res.statusCode).toBe(500);
  });
});

describe("updateEvent", () => {
  const req = (body) => mockReq({ params: { eventId: "e1" }, body });
  const own = (over = {}) => prisma.event.findUnique.mockResolvedValue({ id: "e1", ownerId: "u1", startDate: new Date("2026-05-01"), endDate: null, ...over });

  it("404s unless the caller owns it", async () => {
    prisma.event.findUnique.mockResolvedValue(null);
    let res = mockRes();
    await e.updateEvent(req({}), res);
    expect(res.statusCode).toBe(404);
    own({ ownerId: "other" });
    res = mockRes();
    await e.updateEvent(req({}), res);
    expect(res.statusCode).toBe(404);
  });

  it("validates date order, label and sticker", async () => {
    own();
    let res = mockRes();
    await e.updateEvent(req({ endDate: "2020-01-01" }), res);
    expect(res.statusCode).toBe(400);
    res = mockRes();
    await e.updateEvent(req({ label: "bad" }), res);
    expect(res.statusCode).toBe(400);
    res = mockRes();
    await e.updateEvent(req({ sticker: "mascot:x" }), res);
    expect(res.statusCode).toBe(400);
  });

  it("replaces attendees and updates provided fields", async () => {
    own();
    prisma.user.findMany.mockResolvedValue([{ id: "u2", username: "bob" }]);
    prisma.event.update.mockResolvedValue({ id: "e1" });
    const res = mockRes();
    await e.updateEvent(
      req({ title: " N ", description: "d", isAllDay: false, startDate: "2026-06-01", endDate: "2026-06-02", label: "idea", sticker: "mascot:ears", attendeeUsernames: ["bob", "ghost"] }),
      res,
    );
    expect(prisma.eventAttendee.deleteMany).toHaveBeenCalled();
    expect(prisma.eventAttendee.createMany.mock.calls[0][0].data).toEqual([{ eventId: "e1", userId: "u2" }]);
    expect(prisma.event.update.mock.calls[0][0].data).toMatchObject({ title: "N", label: "idea", sticker: "mascot:ears", isAllDay: false });
    expect(res.body.notFoundUsernames).toEqual(["ghost"]);
  });

  it("clears attendees and endDate when asked", async () => {
    own();
    prisma.event.update.mockResolvedValue({ id: "e1" });
    await e.updateEvent(req({ attendeeUsernames: [], endDate: null }), mockRes());
    expect(prisma.eventAttendee.createMany).not.toHaveBeenCalled();
    expect(prisma.event.update.mock.calls[0][0].data).toEqual({ endDate: null });
  });

  it("500s on error", async () => {
    prisma.event.findUnique.mockRejectedValue(new Error("x"));
    const res = mockRes();
    await e.updateEvent(req({}), res);
    expect(res.statusCode).toBe(500);
  });
});

describe("deleteEvent", () => {
  const req = () => mockReq({ params: { eventId: "e1" } });

  it("404s when not the owner", async () => {
    prisma.event.findUnique.mockResolvedValue(null);
    const res = mockRes();
    await e.deleteEvent(req(), res);
    expect(res.statusCode).toBe(404);
  });

  it("deletes attendees then the event", async () => {
    prisma.event.findUnique.mockResolvedValue({ ownerId: "u1" });
    const res = mockRes();
    await e.deleteEvent(req(), res);
    expect(prisma.eventAttendee.deleteMany).toHaveBeenCalled();
    expect(prisma.event.delete).toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
  });

  it("500s on error", async () => {
    prisma.event.findUnique.mockRejectedValue(new Error("x"));
    const res = mockRes();
    await e.deleteEvent(req(), res);
    expect(res.statusCode).toBe(500);
  });
});
