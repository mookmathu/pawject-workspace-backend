jest.mock("../src/lib/prisma", () => require("./helpers/prismaMock"));

const prisma = require("../src/lib/prisma");
const { dayKey } = require("../src/lib/activity");
const m = require("../src/controllers/mood.controller");
const { mockReq, mockRes, silenceErrors } = require("./helpers/http");

beforeEach(() => {
  prisma.__reset();
  jest.resetAllMocks();
  silenceErrors();
});
afterEach(() => jest.restoreAllMocks());

const entry = { day: "2026-01-01", mood: "good", note: null, imageMimeType: "image/png", updatedAt: new Date(0) };

describe("listMood", () => {
  it("returns one day's entry or null", async () => {
    prisma.moodEntry.findUnique.mockResolvedValue(entry);
    let res = mockRes();
    await m.listMood(mockReq({ query: { day: "2026-01-01" } }), res);
    expect(res.body.entry).toMatchObject({ day: "2026-01-01", note: "", hasImage: true });

    prisma.moodEntry.findUnique.mockResolvedValue(null);
    res = mockRes();
    await m.listMood(mockReq({ query: { day: "2026-01-01" } }), res);
    expect(res.body.entry).toBeNull();
  });

  it("validates day and month formats", async () => {
    let res = mockRes();
    await m.listMood(mockReq({ query: { day: "bad" } }), res);
    expect(res.statusCode).toBe(400);
    res = mockRes();
    await m.listMood(mockReq({ query: { month: "2026/01" } }), res);
    expect(res.statusCode).toBe(400);
  });

  it("lists a month", async () => {
    prisma.moodEntry.findMany.mockResolvedValue([entry]);
    const res = mockRes();
    await m.listMood(mockReq({ query: { month: "2026-01" } }), res);
    expect(prisma.moodEntry.findMany.mock.calls[0][0].where.day).toEqual({ startsWith: "2026-01-" });
    expect(res.body.entries).toHaveLength(1);
  });

  it("clamps `recent` between 1 and 400 and defaults to 90", async () => {
    prisma.moodEntry.findMany.mockResolvedValue([]);
    const days = async (recent) => {
      prisma.moodEntry.findMany.mockClear();
      await m.listMood(mockReq({ query: recent === undefined ? {} : { recent } }), mockRes());
      return prisma.moodEntry.findMany.mock.calls[0][0].where.day.gte;
    };
    const ago = (n) => dayKey(new Date(Date.now() - n * 86400000));
    expect(await days(undefined)).toBe(ago(90));
    expect(await days("9999")).toBe(ago(400));
    expect(await days("-5")).toBe(ago(1));
  });

  it("500s on error", async () => {
    prisma.moodEntry.findMany.mockRejectedValue(new Error("x"));
    const res = mockRes();
    await m.listMood(mockReq(), res);
    expect(res.statusCode).toBe(500);
  });
});

describe("saveMood", () => {
  const req = (over) => mockReq({ params: { day: "2026-01-01" }, body: { mood: "good" }, ...over });

  it("validates day, future days and mood", async () => {
    let res = mockRes();
    await m.saveMood(req({ params: { day: "x" } }), res);
    expect(res.statusCode).toBe(400);
    res = mockRes();
    await m.saveMood(req({ params: { day: "2999-01-01" } }), res);
    expect(res.statusCode).toBe(400);
    res = mockRes();
    await m.saveMood(req({ body: { mood: "nope" } }), res);
    expect(res.statusCode).toBe(400);
    res = mockRes();
    await m.saveMood(req({ body: {} }), res);
    expect(res.statusCode).toBe(400);
  });

  it("saves with a trimmed, capped note", async () => {
    prisma.moodEntry.upsert.mockResolvedValue(entry);
    const res = mockRes();
    await m.saveMood(req({ body: { mood: "love", note: `  ${"a".repeat(400)}` } }), res);
    const arg = prisma.moodEntry.upsert.mock.calls[0][0];
    expect(arg.update.note).toHaveLength(280);
    expect(res.statusCode).toBe(200);
  });

  it("stores an uploaded image, removes on request, nulls an empty note", async () => {
    prisma.moodEntry.upsert.mockResolvedValue(entry);
    await m.saveMood(req({ file: { buffer: Buffer.from("x"), mimetype: "image/png" } }), mockRes());
    expect(prisma.moodEntry.upsert.mock.calls[0][0].update).toMatchObject({ imageMimeType: "image/png", note: null });
    await m.saveMood(req({ body: { mood: "ok", removeImage: "1" } }), mockRes());
    expect(prisma.moodEntry.upsert.mock.calls[1][0].update).toMatchObject({ imageData: null, imageMimeType: null });
  });

  it("500s on error", async () => {
    prisma.moodEntry.upsert.mockRejectedValue(new Error("x"));
    const res = mockRes();
    await m.saveMood(req(), res);
    expect(res.statusCode).toBe(500);
  });
});

describe("deleteMood / getMoodImage", () => {
  it("deleteMood validates, deletes and handles errors", async () => {
    let res = mockRes();
    await m.deleteMood(mockReq({ params: { day: "x" } }), res);
    expect(res.statusCode).toBe(400);
    res = mockRes();
    await m.deleteMood(mockReq({ params: { day: "2026-01-01" } }), res);
    expect(res.body).toEqual({ ok: true });
    prisma.moodEntry.deleteMany.mockRejectedValue(new Error("x"));
    res = mockRes();
    await m.deleteMood(mockReq({ params: { day: "2026-01-01" } }), res);
    expect(res.statusCode).toBe(500);
  });

  it("getMoodImage handles bad day, missing image, success and errors", async () => {
    const end = () => ({ end: jest.fn() });
    let res = { ...mockRes(), ...end() };
    res.status = jest.fn(() => res);
    await m.getMoodImage(mockReq({ params: { day: "x" } }), res);
    expect(res.status).toHaveBeenCalledWith(400);

    prisma.moodEntry.findUnique.mockResolvedValue(null);
    res = { ...mockRes(), ...end() };
    res.status = jest.fn(() => res);
    await m.getMoodImage(mockReq({ params: { day: "2026-01-01" } }), res);
    expect(res.status).toHaveBeenCalledWith(404);

    prisma.moodEntry.findUnique.mockResolvedValue({ imageData: Buffer.from("abc"), imageMimeType: "image/png" });
    res = mockRes();
    await m.getMoodImage(mockReq({ params: { day: "2026-01-01" } }), res);
    expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "image/png");
    expect(res.send).toHaveBeenCalled();

    prisma.moodEntry.findUnique.mockRejectedValue(new Error("x"));
    res = { ...mockRes(), ...end() };
    res.status = jest.fn(() => res);
    await m.getMoodImage(mockReq({ params: { day: "2026-01-01" } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
