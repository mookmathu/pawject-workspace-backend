require("./helpers/env");

const mockUser = { current: null };
jest.mock("../src/lib/prisma", () => require("./helpers/prismaMock"));
jest.mock("../src/lib/email", () => ({ sendOtpEmail: jest.fn() }));
jest.mock("../src/lib/resetEmail", () => ({ sendPasswordResetEmail: jest.fn() }));
// Stand in for passport: authenticate() just attaches the user the test chose.
jest.mock("../src/lib/passport", () => ({
  initialize: () => (req, res, next) => next(),
  authenticate: (_name, opts) => (req, res, next) => {
    if (mockUser.current === "fail") return res.redirect(opts.failureRedirect);
    if (mockUser.current) req.user = mockUser.current;
    next();
  },
  configuredProviders: new Set(["google", "github"]),
}));

const http = require("http");
const jwt = require("jsonwebtoken");
const prisma = require("../src/lib/prisma");
const { sendOtpEmail } = require("../src/lib/email");
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
  sendOtpEmail.mockReset();
  jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

const get = (path) => fetch(base + path, { redirect: "manual" });

describe("OAuth routes", () => {
  it("returns 503 for a provider that is not configured", async () => {
    const res = await get("/api/auth/facebook");
    expect(res.status).toBe(503);
    expect(await res.text()).toContain("facebook");
  });

  it("starts configured logins", async () => {
    mockUser.current = null;
    expect((await get("/api/auth/google")).status).toBe(404); // no further handler: authenticate stub just calls next()
  });

  it("redirects failed logins back to the app", async () => {
    mockUser.current = "fail";
    const res = await get("/api/auth/google/callback");
    expect(res.headers.get("location")).toBe("https://front.example/?oauthError=1");
  });

  it("emails an OTP and sends a user with a real email to the verify page", async () => {
    mockUser.current = { id: "u1", email: "a@b.co" };
    const res = await get("/api/auth/google/callback");
    expect(res.headers.get("location")).toBe("https://front.example/verify-otp?email=a%40b.co&social=1");
    expect(sendOtpEmail).toHaveBeenCalledWith("a@b.co", expect.any(String), "login");
  });

  it("falls back to the error redirect when the OTP cannot be sent", async () => {
    mockUser.current = { id: "u1", email: "a@b.co" };
    sendOtpEmail.mockRejectedValue(new Error("smtp"));
    const res = await get("/api/auth/github/callback");
    expect(res.headers.get("location")).toBe("https://front.example/?oauthError=1");
  });

  it("signs in directly when the account has no deliverable email", async () => {
    mockUser.current = { id: "u9", email: "github_1@no-email.crewspace.local", username: null };
    const res = await get("/api/auth/github/callback");
    const url = new URL(res.headers.get("location"));
    expect(url.pathname).toBe("/oauth-callback");
    expect(url.searchParams.get("needsProfile")).toBe("true");
    expect(jwt.verify(url.searchParams.get("token"), "test-secret").sub).toBe("u9");
    expect(sendOtpEmail).not.toHaveBeenCalled();

    mockUser.current = { id: "u9", email: null, username: "named" };
    const res2 = await get("/api/auth/github/callback");
    expect(new URL(res2.headers.get("location")).searchParams.get("needsProfile")).toBe("false");
  });
});
