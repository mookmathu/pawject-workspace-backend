const { Resend } = require("resend");

const resend = new Resend(process.env.RESEND_API_KEY);

// During development, Resend lets you send from this address to the email
// you signed up with, with no domain setup needed. Once you verify your own
// domain on resend.com/domains, replace this with e.g. "Pawject <noreply@yourdomain.com>".
const FROM_ADDRESS = process.env.RESEND_FROM || "Pawject <onboarding@resend.dev>";

const { renderOtpEmail } = require("./emailTemplate");

const OTP_TTL_MINUTES = 10;

async function sendOtpEmail(toEmail, otpCode, purpose = "verify") {
  const { html, text } = renderOtpEmail(otpCode, purpose, OTP_TTL_MINUTES);
  const { error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to: toEmail,
    subject: `🐾 ${otpCode} คือรหัสยืนยันของคุณ — Pawject`,
    html,
    text,
  });

  if (error) {
    throw new Error(error.message || "ส่งอีเมลไม่สำเร็จ");
  }
}

module.exports = { sendOtpEmail };
