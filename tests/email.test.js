const mockSend = jest.fn();
jest.mock("resend", () => ({
  Resend: jest.fn().mockImplementation(() => ({ emails: { send: mockSend } })),
}));

const { sendOtpEmail } = require("../src/lib/email");
const { sendPasswordResetEmail } = require("../src/lib/resetEmail");

beforeEach(() => mockSend.mockReset());

describe("sendOtpEmail", () => {
  it("sends the code to the given address", async () => {
    mockSend.mockResolvedValue({ error: null });
    await sendOtpEmail("a@b.com", "123456", "login");
    const arg = mockSend.mock.calls[0][0];
    expect(arg.to).toBe("a@b.com");
    expect(arg.subject).toContain("123456");
    expect(arg.html).toContain("ยืนยันการเข้าสู่ระบบ");
    expect(arg.text).toContain("123456");
  });

  it("throws when the email provider reports an error", async () => {
    mockSend.mockResolvedValue({ error: { message: "boom" } });
    await expect(sendOtpEmail("a@b.com", "123456")).rejects.toThrow("boom");
  });

  it("uses a default message when the provider error has none", async () => {
    mockSend.mockResolvedValue({ error: {} });
    await expect(sendOtpEmail("a@b.com", "123456")).rejects.toThrow("ส่งอีเมลไม่สำเร็จ");
  });
});

describe("sendPasswordResetEmail", () => {
  it("includes the reset link in the body", async () => {
    mockSend.mockResolvedValue({});
    await sendPasswordResetEmail("a@b.com", "https://x.test/reset?token=abc");
    const arg = mockSend.mock.calls[0][0];
    expect(arg.to).toBe("a@b.com");
    expect(arg.html).toContain("https://x.test/reset?token=abc");
  });
});
