jest.mock("../src/lib/prisma", () => require("./helpers/prismaMock"));
jest.mock("../src/lib/resetEmail", () => ({ sendPasswordResetEmail: jest.fn() }));

const bcrypt = require("bcryptjs");
const prisma = require("../src/lib/prisma");
const { sendPasswordResetEmail } = require("../src/lib/resetEmail");
const { forgotPassword, resetPassword } = require("../src/controllers/password-reset.controller");
const { mockReq, mockRes, silenceErrors } = require("./helpers/http");

beforeEach(() => {
  prisma.__reset();
  jest.resetAllMocks();
  silenceErrors();
});
afterEach(() => jest.restoreAllMocks());

describe("forgotPassword", () => {
  it("requires an email", async () => {
    const res = mockRes();
    await forgotPassword(mockReq({ body: { email: " " } }), res);
    expect(res.statusCode).toBe(400);
  });

  it("answers identically for unknown emails and sends nothing", async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    const res = mockRes();
    await forgotPassword(mockReq({ body: { email: "a@b.co" } }), res);
    expect(res.statusCode).toBe(200);
    expect(sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it("stores a hashed token and emails the link", async () => {
    prisma.user.findUnique.mockResolvedValue({ id: "u1", email: "a@b.co" });
    const res = mockRes();
    await forgotPassword(mockReq({ body: { email: "a@b.co" } }), res);
    const data = prisma.user.update.mock.calls[0][0].data;
    const url = sendPasswordResetEmail.mock.calls[0][1];
    const token = new URL(url).searchParams.get("token");
    expect(await bcrypt.compare(token, data.resetTokenHash)).toBe(true);
    expect(data.resetTokenExpiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(res.statusCode).toBe(200);
  });

  it("still returns 200 when the email provider fails", async () => {
    prisma.user.findUnique.mockResolvedValue({ id: "u1", email: "a@b.co" });
    sendPasswordResetEmail.mockRejectedValue(new Error("smtp"));
    const res = mockRes();
    await forgotPassword(mockReq({ body: { email: "a@b.co" } }), res);
    expect(res.statusCode).toBe(200);
  });

  it("500s on database errors", async () => {
    prisma.user.findUnique.mockRejectedValue(new Error("x"));
    const res = mockRes();
    await forgotPassword(mockReq({ body: { email: "a@b.co" } }), res);
    expect(res.statusCode).toBe(500);
  });
});

describe("resetPassword", () => {
  const body = (over = {}) => ({ email: "a@b.co", token: "tok", newPassword: "longenough", ...over });
  const future = () => new Date(Date.now() + 60000);

  it("validates input", async () => {
    let res = mockRes();
    await resetPassword(mockReq({ body: body({ token: "" }) }), res);
    expect(res.statusCode).toBe(400);
    res = mockRes();
    await resetPassword(mockReq({ body: body({ newPassword: "short" }) }), res);
    expect(res.statusCode).toBe(400);
  });

  it("rejects missing, expired or mismatched tokens", async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    let res = mockRes();
    await resetPassword(mockReq({ body: body() }), res);
    expect(res.statusCode).toBe(400);

    prisma.user.findUnique.mockResolvedValue({ resetTokenHash: "h", resetTokenExpiresAt: new Date(0) });
    res = mockRes();
    await resetPassword(mockReq({ body: body() }), res);
    expect(res.body.error).toMatch(/หมดอายุ/);

    prisma.user.findUnique.mockResolvedValue({ resetTokenHash: await bcrypt.hash("other", 4), resetTokenExpiresAt: future() });
    res = mockRes();
    await resetPassword(mockReq({ body: body() }), res);
    expect(res.statusCode).toBe(400);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("sets the new password and clears the token", async () => {
    prisma.user.findUnique.mockResolvedValue({ id: "u1", resetTokenHash: await bcrypt.hash("tok", 4), resetTokenExpiresAt: future() });
    const res = mockRes();
    await resetPassword(mockReq({ body: body() }), res);
    const data = prisma.user.update.mock.calls[0][0].data;
    expect(await bcrypt.compare("longenough", data.password)).toBe(true);
    expect(data.resetTokenHash).toBeNull();
    expect(res.statusCode).toBe(200);
  });

  it("500s on error", async () => {
    prisma.user.findUnique.mockRejectedValue(new Error("x"));
    const res = mockRes();
    await resetPassword(mockReq({ body: body() }), res);
    expect(res.statusCode).toBe(500);
  });
});
