require("./helpers/env");

jest.mock("../src/lib/prisma", () => require("./helpers/prismaMock"));
jest.mock("../src/lib/email", () => ({ sendOtpEmail: jest.fn() }));
jest.mock("../src/lib/resetEmail", () => ({ sendPasswordResetEmail: jest.fn() }));

const http = require("http");
const jwt = require("jsonwebtoken");
const prisma = require("../src/lib/prisma");
const app = require("../src/app");

let server;
let base;
beforeAll(async () => {
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => new Promise((r) => server.close(r)));
beforeEach(() => {
  prisma.__reset();
  prisma.userActivityDay.upsert.mockResolvedValue({}); // requireAuth records activity (fire-and-forget)
  jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

const token = () => jwt.sign({ sub: "u1", email: "a@b.co" }, "test-secret");
const auth = () => ({ Authorization: `Bearer ${token()}` });
const call = (method, path, opts = {}) => fetch(base + path, { method, redirect: "manual", ...opts });

describe("health and CORS", () => {
  it("answers /api/health", async () => {
    const res = await call("GET", "/api/health");
    expect(await res.json()).toEqual({ ok: true });
  });

  it("allows our own origins (trailing slash on FRONTEND_URL is normalised) and no-origin requests", async () => {
    for (const origin of ["https://front.example", "https://mypawject.tech", "https://www.mypawject.tech", "http://localhost:3000"]) {
      const res = await call("GET", "/api/health", { headers: { Origin: origin } });
      expect(res.headers.get("access-control-allow-origin")).toBe(origin);
    }
    const res = await call("GET", "/api/health");
    expect(res.status).toBe(200);
  });

  it("does not send CORS headers to other origins", async () => {
    const res = await call("GET", "/api/health", { headers: { Origin: "https://evil.example" } });
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("auth guard", () => {
  const protectedRoutes = [
    ["GET", "/api/auth/me"],
    ["PATCH", "/api/auth/me"],
    ["DELETE", "/api/auth/me"],
    ["GET", "/api/auth/u2/profile"],
    ["GET", "/api/mood"],
    ["POST", "/api/board/b1/tasks"],
    ["POST", "/api/board/b1/columns"],
    ["POST", "/api/board/b1/categories"],
    ["PATCH", "/api/board/b1/note"],
    ["GET", "/api/tasks/mine"],
    ["PATCH", "/api/tasks/t1"],
    ["DELETE", "/api/subtasks/s1"],
    ["PATCH", "/api/columns/c1"],
    ["DELETE", "/api/categories/c1"],
    ["GET", "/api/events"],
    ["GET", "/api/users/search"],
    ["GET", "/api/workspaces"],
    ["POST", "/api/workspaces/join"],
    ["GET", "/api/friends"],
    ["DELETE", "/api/comments/c1"],
    ["GET", "/api/chat/unread"],
    ["GET", "/api/notifications"],
  ];

  it.each(protectedRoutes)("%s %s needs a token", async (method, path) => {
    const res = await call(method, path);
    expect(res.status).toBe(401);
  });

  it("rejects an invalid token", async () => {
    const res = await call("GET", "/api/auth/me", { headers: { Authorization: "Bearer nope" } });
    expect(res.status).toBe(401);
  });
});

describe("authenticated requests reach the controllers", () => {
  it("GET /api/notifications", async () => {
    prisma.notification.findMany.mockResolvedValue([]);
    prisma.notification.count.mockResolvedValue(0);
    const res = await call("GET", "/api/notifications", { headers: auth() });
    expect(await res.json()).toEqual({ notifications: [], unreadCount: 0 });
  });

  it("POST /api/auth/login with JSON", async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    const res = await call("POST", "/api/auth/login", {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "a@b.co", password: "x" }),
    });
    expect(res.status).toBe(401);
  });

  it("GET public avatar needs no token", async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    const res = await call("GET", "/api/auth/u2/avatar");
    expect(res.status).toBe(404);
  });
});

describe("upload error handling", () => {
  const upload = (type, bytes) => {
    const form = new FormData();
    form.append("avatar", new Blob([new Uint8Array(bytes)], { type }), "f.bin");
    return call("POST", "/api/auth/me/avatar", { headers: auth(), body: form });
  };

  it("rejects non-image files with the filter's message", async () => {
    const res = await upload("text/html", 10);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/รูปภาพ/);
  });

  it("rejects files over the size cap", async () => {
    const res = await upload("image/png", 5 * 1024 * 1024 + 10);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("ไฟล์ใหญ่เกินไป");
  });

  it("reports other multer errors generically", async () => {
    const form = new FormData();
    form.append("wrong-field", new Blob(["x"], { type: "image/png" }), "f.png");
    const res = await call("POST", "/api/auth/me/avatar", { headers: auth(), body: form });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("อัปโหลดไฟล์ไม่สำเร็จ");
  });

  it("accepts a valid avatar", async () => {
    prisma.user.update.mockResolvedValue({ id: "u1", avatarMimeType: "image/png", avatarUpdatedAt: new Date(1) });
    const res = await upload("image/png", 10);
    expect(res.status).toBe(200);
  });
});
