const { Resend } = require("resend");

const resend = new Resend(process.env.RESEND_API_KEY);

async function sendPasswordResetEmail(to, resetUrl) {
  await resend.emails.send({
    from: process.env.RESEND_FROM,
    to,
    subject: "รีเซ็ตรหัสผ่าน Pawject",
    html: `
      <p>มีคำขอรีเซ็ตรหัสผ่านสำหรับบัญชี Pawject ของคุณ</p>
      <p><a href="${resetUrl}">คลิกที่นี่เพื่อตั้งรหัสผ่านใหม่</a> (ลิงก์นี้จะหมดอายุใน 30 นาที)</p>
      <p>ถ้าคุณไม่ได้เป็นคนขอ สามารถละเว้นอีเมลนี้ได้เลย รหัสผ่านเดิมจะไม่ถูกเปลี่ยนแปลง</p>
    `,
  });
}

module.exports = { sendPasswordResetEmail };
