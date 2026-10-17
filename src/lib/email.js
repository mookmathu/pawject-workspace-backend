const { Resend } = require("resend");

const resend = new Resend(process.env.RESEND_API_KEY);

// During development, Resend lets you send from this address to the email
// you signed up with, with no domain setup needed. Once you verify your own
// domain on resend.com/domains, replace this with e.g. "Pawject <noreply@yourdomain.com>".
const FROM_ADDRESS = process.env.RESEND_FROM || "Pawject <onboarding@resend.dev>";

async function sendOtpEmail(toEmail, otpCode) {
  const { error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to: toEmail,
    subject: `${otpCode} คือรหัสยืนยันของคุณ — Pawject`,
    html: `
      <div style="font-family: sans-serif; max-width: 420px; margin: 0 auto;">
        <h2 style="color: #221D17;">ยืนยันอีเมลของคุณ</h2>
        <p>ใช้รหัสด้านล่างเพื่อยืนยันอีเมลของคุณใน Pawject:</p>
        <p style="font-size: 32px; font-weight: 700; letter-spacing: 6px; color: #3E6BE0;">
          ${otpCode}
        </p>
        <p style="color: #8A8071; font-size: 13px;">รหัสนี้จะหมดอายุใน 10 นาที</p>
      </div>
    `,
  });

  if (error) {
    throw new Error(error.message || "ส่งอีเมลไม่สำเร็จ");
  }
}

module.exports = { sendOtpEmail };
