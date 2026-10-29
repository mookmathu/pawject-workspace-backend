process.env.JWT_SECRET = "test-secret";

jest.mock("../src/lib/prisma", () => require("./helpers/prismaMock"));
jest.mock("../src/lib/email", () => ({ sendOtpEmail: jest.fn() }));

const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const prisma = require("../src/lib/prisma");
const { sendOtpEmail } = require("../src/lib/email");
const a = require("../src/controllers/auth.controller");
const { mockReq, mockRes, silenceErrors } = require("./helpers/http");

beforeEach(() => {
  prisma.__reset();
  jest.resetAllMocks();
  silenceErrors();
});
afterEach(() => jest.restoreAllMocks());

const full = { name: "N", username: "un", email: "a@b.co", password: "pw", orgType: "uni", orgName: "KU" };

describe("register", () => {
  it("requires every field", async () => {
    const res = mockRes();
    await a.register(mockReq({ body: { ...full, orgName: "" } }), res);
    expect(res.statusCode).toBe(400);
  });

  it("409s on duplicate email, then duplicate username", async () => {
    prisma.user.findUnique.mockResolvedValueOnce({ id: "x" }).mockResolvedValueOnce(null);
    let res = mockRes();
    await a.register(mockReq({ body: full }), res);
    expect(res.body.error).toMatch(/อีเมล/);
    prisma.user.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "x" });
    res = mockRes();
    await a.register(mockReq({ body: full }), res);
    expect(res.body.error).toMatch(/ชื่อผู้ใช้/);
    expect(res.statusCode).toBe(409);
  });

  it("hashes the password and sends an OTP", async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockImplementation(async ({ data }) => ({ id: "u1", ...data }));
    const res = mockRes();
    await a.register(mockReq({ body: full }), res);
    expect(res.statusCode).toBe(201);
    expect(res.body.token).toBeUndefined();
    const created = prisma.user.create.mock.calls[0][0].data;
    expect(created.password).not.toBe("pw");
    expect(await bcrypt.compare("pw", created.password)).toBe(true);
    expect(sendOtpEmail).toHaveBeenCalledWith("a@b.co", expect.stringMatching(/^\d{6}$/), "verify");
  });

  it("still succeeds when the email fails", async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({ id: "u1", email: "a@b.co" });
    sendOtpEmail.mockRejectedValue(new Error("smtp"));
    const res = mockRes();
    await a.register(mockReq({ body: full }), res);
    expect(res.statusCode).toBe(201);
  });

  it("500s on error", async () => {
    prisma.user.findUnique.mockRejectedValue(new Error("x"));
    const res = mockRes();
    await a.register(mockReq({ body: full }), res);
    expect(res.statusCode).toBe(500);
  });
});

describe("verifyOtp", () => {
  const body = (otp = "123456") => ({ email: "v@b.co", otp });
  const future = () => new Date(Date.now() + 60000);

  it("validates input and account state", async () => {
    let res = mockRes();
    await a.verifyOtp(mockReq({ body: { email: "x" } }), res);
    expect(res.statusCode).toBe(400);

    prisma.user.findUnique.mockResolvedValue(null);
    res = mockRes();
    await a.verifyOtp(mockReq({ body: body() }), res);
    expect(res.statusCode).toBe(404);

    prisma.user.findUnique.mockResolvedValue({ otpCodeHash: null, otpExpiresAt: null });
    res = mockRes();
    await a.verifyOtp(mockReq({ body: body() }), res);
    expect(res.statusCode).toBe(400);

    prisma.user.findUnique.mockResolvedValue({ otpCodeHash: "h", otpExpiresAt: new Date(0) });
    res = mockRes();
    await a.verifyOtp(mockReq({ body: body() }), res);
    expect(res.body.error).toMatch(/หมดอายุ/);
  });

  it("issues a token for the right code", async () => {
    const hash = await bcrypt.hash("123456", 4);
    prisma.user.findUnique.mockResolvedValue({ id: "u1", otpCodeHash: hash, otpExpiresAt: future() });
    prisma.user.update.mockResolvedValue({ id: "u1", email: "v@b.co", emailVerified: true, password: "x" });
    const res = mockRes();
    await a.verifyOtp(mockReq({ body: body(123456) }), res);
    expect(res.statusCode).toBe(200);
    expect(jwt.verify(res.body.token, "test-secret").sub).toBe("u1");
    expect(res.body.user.password).toBeUndefined();
    expect(res.body.user.hasPassword).toBe(true);
  });

  it("locks the code after 5 wrong attempts", async () => {
    const hash = await bcrypt.hash("123456", 4);
    prisma.user.findUnique.mockResolvedValue({ id: "u1", otpCodeHash: hash, otpExpiresAt: future() });
    const email = "lock@b.co";
    for (let i = 0; i < 4; i++) {
      const res = mockRes();
      await a.verifyOtp(mockReq({ body: { email, otp: "000000" } }), res);
      expect(res.body.error).toMatch(/ไม่ถูกต้อง/);
    }
    const res = mockRes();
    await a.verifyOtp(mockReq({ body: { email, otp: "000000" } }), res);
    expect(res.body.error).toMatch(/หลายครั้ง/);
    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: "u1" }, data: { otpCodeHash: null, otpExpiresAt: null } });
  });

  it("500s on error", async () => {
    prisma.user.findUnique.mockRejectedValue(new Error("x"));
    const res = mockRes();
    await a.verifyOtp(mockReq({ body: body() }), res);
    expect(res.statusCode).toBe(500);
  });
});

describe("resendOtp", () => {
  const req = () => mockReq({ body: { email: "a@b.co" } });

  it("validates and looks the user up", async () => {
    let res = mockRes();
    await a.resendOtp(mockReq({ body: {} }), res);
    expect(res.statusCode).toBe(400);
    prisma.user.findUnique.mockResolvedValue(null);
    res = mockRes();
    await a.resendOtp(req(), res);
    expect(res.statusCode).toBe(404);
  });

  it("refuses already-verified accounts with no pending code", async () => {
    prisma.user.findUnique.mockResolvedValue({ emailVerified: true, otpCodeHash: null });
    const res = mockRes();
    await a.resendOtp(req(), res);
    expect(res.statusCode).toBe(400);
  });

  it("enforces the cooldown", async () => {
    prisma.user.findUnique.mockResolvedValue({ emailVerified: false, otpExpiresAt: new Date(Date.now() + 10 * 60 * 1000 - 1000) });
    const res = mockRes();
    await a.resendOtp(req(), res);
    expect(res.statusCode).toBe(429);
  });

  it("sends a verify code to unverified users and a login code to verified ones", async () => {
    prisma.user.findUnique.mockResolvedValue({ id: "u1", email: "a@b.co", emailVerified: false, otpExpiresAt: new Date(Date.now() - 1000) });
    let res = mockRes();
    await a.resendOtp(req(), res);
    expect(res.statusCode).toBe(200);
    expect(sendOtpEmail.mock.calls[0][2]).toBe("verify");

    prisma.user.findUnique.mockResolvedValue({ id: "u1", email: "a@b.co", emailVerified: true, otpCodeHash: "h", otpExpiresAt: null });
    res = mockRes();
    await a.resendOtp(req(), res);
    expect(sendOtpEmail.mock.calls[1][2]).toBe("login");
  });

  it("500s when sending fails", async () => {
    prisma.user.findUnique.mockResolvedValue({ id: "u1", email: "a@b.co", emailVerified: false });
    sendOtpEmail.mockRejectedValue(new Error("smtp"));
    const res = mockRes();
    await a.resendOtp(req(), res);
    expect(res.statusCode).toBe(500);
  });
});

describe("login", () => {
  const req = (body) => mockReq({ body: { email: "a@b.co", password: "pw", ...body } });
  let hash;
  beforeAll(async () => {
    hash = await bcrypt.hash("pw", 4);
  });

  it("validates and rejects unknown users", async () => {
    let res = mockRes();
    await a.login(mockReq({ body: { email: "a" } }), res);
    expect(res.statusCode).toBe(400);
    prisma.user.findUnique.mockResolvedValue(null);
    res = mockRes();
    await a.login(req(), res);
    expect(res.statusCode).toBe(401);
  });

  it("explains social-login accounts", async () => {
    prisma.user.findUnique.mockResolvedValue({ password: null, provider: "google" });
    const res = mockRes();
    await a.login(req(), res);
    expect(res.statusCode).toBe(401);
    expect(res.body.error).toMatch(/google/);
  });

  it("rejects a wrong password", async () => {
    prisma.user.findUnique.mockResolvedValue({ password: hash });
    const res = mockRes();
    await a.login(req({ password: "bad" }), res);
    expect(res.statusCode).toBe(401);
  });

  it("asks unverified users to verify and re-sends a code", async () => {
    prisma.user.findUnique.mockResolvedValue({ id: "u1", email: "a@b.co", password: hash, emailVerified: false });
    let res = mockRes();
    await a.login(req(), res);
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe("EMAIL_NOT_VERIFIED");
    expect(sendOtpEmail).toHaveBeenCalled();

    sendOtpEmail.mockRejectedValue(new Error("smtp"));
    res = mockRes();
    await a.login(req(), res);
    expect(res.statusCode).toBe(403);
  });

  it("returns a token and a safe user", async () => {
    prisma.user.findUnique.mockResolvedValue({ id: "u1", email: "a@b.co", password: hash, emailVerified: true });
    const res = mockRes();
    await a.login(req(), res);
    expect(res.statusCode).toBe(200);
    expect(jwt.verify(res.body.token, "test-secret").email).toBe("a@b.co");
    expect(res.body.user.password).toBeUndefined();
  });

  it("500s on error", async () => {
    prisma.user.findUnique.mockRejectedValue(new Error("x"));
    const res = mockRes();
    await a.login(req(), res);
    expect(res.statusCode).toBe(500);
  });
});

describe("checkUsername", () => {
  it("validates, reports availability and handles errors", async () => {
    let res = mockRes();
    await a.checkUsername(mockReq(), res);
    expect(res.statusCode).toBe(400);
    prisma.user.findUnique.mockResolvedValue({ id: "x" });
    res = mockRes();
    await a.checkUsername(mockReq({ query: { username: "u" } }), res);
    expect(res.body.available).toBe(false);
    prisma.user.findUnique.mockResolvedValue(null);
    res = mockRes();
    await a.checkUsername(mockReq({ query: { username: "u" } }), res);
    expect(res.body.available).toBe(true);
    prisma.user.findUnique.mockRejectedValue(new Error("x"));
    res = mockRes();
    await a.checkUsername(mockReq({ query: { username: "u" } }), res);
    expect(res.statusCode).toBe(500);
  });
});
