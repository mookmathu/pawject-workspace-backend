const { renderOtpEmail } = require("../src/lib/emailTemplate");

describe("renderOtpEmail", () => {
  it("puts the code and expiry in both the html and the plain-text body", () => {
    const { html, text } = renderOtpEmail("123456", "verify", 10);
    expect(html).toContain("ยืนยันอีเมลของคุณ");
    expect(text).toContain("รหัสของคุณ: 123456");
    expect(text).toContain("หมดอายุใน 10 นาที");
    "123456".split("").forEach((d) => expect(html).toContain(`>${d}</div>`));
  });

  it("uses the login wording for the login purpose", () => {
    const { html, text } = renderOtpEmail("654321", "login", 5);
    expect(html).toContain("ยืนยันการเข้าสู่ระบบ");
    expect(text).toContain("หมดอายุใน 5 นาที");
  });

  it("falls back to the verify wording for an unknown purpose", () => {
    const { html } = renderOtpEmail("111111", "something-else");
    expect(html).toContain("ยืนยันอีเมลของคุณ");
  });

  it("keeps only digits from the code, so nothing can be injected", () => {
    const { html, text } = renderOtpEmail('12<script>alert(1)</script>34', "verify");
    expect(html).not.toContain("<script>");
    expect(text).toContain("รหัสของคุณ: 12134");
  });
});
