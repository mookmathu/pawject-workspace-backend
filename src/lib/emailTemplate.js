// Cute, table-based HTML for the OTP emails. Email clients ignore most modern
// CSS, so everything is inline styles + tables, with safe fallback fonts. The
// colours match the site's Pawject palette (cream / paw blue / peach / charcoal).

const FRONTEND_URL = (process.env.FRONTEND_URL || "https://mypawject.tech").replace(/\/$/, "");
const LOGO_URL = `${FRONTEND_URL}/logo192.png`;

const COPY = {
  verify: {
    title: "ยืนยันอีเมลของคุณ",
    lead: "ยินดีต้อนรับสู่ Pawject! ใช้รหัสด้านล่างเพื่อยืนยันอีเมล แล้วเริ่มทำงานกับทีมของคุณได้เลย",
    plain: "ใช้รหัสนี้เพื่อยืนยันอีเมลของคุณใน Pawject",
  },
  login: {
    title: "ยืนยันการเข้าสู่ระบบ",
    lead: "มีการเข้าสู่ระบบ Pawject ด้วยอีเมลนี้ ใช้รหัสด้านล่างเพื่อเข้าสู่ระบบ",
    plain: "ใช้รหัสนี้เพื่อเข้าสู่ระบบ Pawject",
  },
};

function renderOtpEmail(otpCode, purpose = "verify", ttlMinutes = 10) {
  const copy = COPY[purpose] || COPY.verify;
  const code = String(otpCode).replace(/\D/g, ""); // digits only — nothing to escape
  const FONT = "'Itim','Sarabun','Noto Sans Thai',Tahoma,'Helvetica Neue',Arial,sans-serif";

  const digitCells = code
    .split("")
    .map(
      (d) => `
              <td align="center" style="padding:0 3px;">
                <div style="width:44px;height:56px;line-height:56px;background:#DCE9F8;border:2px solid #353B46;border-radius:14px;font-size:30px;font-weight:700;color:#353B46;font-family:${FONT};">${d}</div>
              </td>`
    )
    .join("");

  const html = `<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<title>Pawject</title>
</head>
<body style="margin:0;padding:0;background:#FFF9F2;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#FFF9F2;">รหัสยืนยันของคุณคือ ${code} (หมดอายุใน ${ttlMinutes} นาที)</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FFF9F2;">
  <tr>
    <td align="center" style="padding:28px 14px;">

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:460px;">
        <tr>
          <td align="center" style="padding:0 0 14px;">
            <table role="presentation" cellpadding="0" cellspacing="0"><tr>
              <td style="padding-right:10px;"><img src="${LOGO_URL}" width="40" height="40" alt="🐾" style="display:block;border-radius:12px;"></td>
              <td style="font-family:${FONT};font-size:26px;font-weight:700;color:#4F83CC;letter-spacing:.3px;">Pawject</td>
            </tr></table>
          </td>
        </tr>
      </table>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:460px;background:#FFFEFC;border:2px solid #353B46;border-radius:24px;">
        <tr>
          <td align="center" style="padding:6px 0 0;">
            <div style="height:10px;line-height:10px;font-size:0;">&nbsp;</div>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:14px 28px 4px;font-family:${FONT};">
            <div style="font-size:38px;line-height:44px;">🐶</div>
            <h1 style="margin:8px 0 6px;font-size:25px;line-height:32px;color:#353B46;font-family:${FONT};">${copy.title}</h1>
            <p style="margin:0;font-size:16px;line-height:25px;color:#5E6573;font-family:${FONT};">${copy.lead}</p>
          </td>
        </tr>

        <tr>
          <td align="center" style="padding:22px 12px 8px;">
            <table role="presentation" cellpadding="0" cellspacing="0"><tr>${digitCells}
            </tr></table>
          </td>
        </tr>

        <tr>
          <td align="center" style="padding:6px 28px 4px;font-family:${FONT};">
            <span style="display:inline-block;background:#F7D9C7;color:#353B46;border-radius:999px;padding:5px 14px;font-size:14px;font-weight:700;">⏰ หมดอายุใน ${ttlMinutes} นาที</span>
          </td>
        </tr>

        <tr>
          <td style="padding:20px 28px 26px;font-family:${FONT};">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F1DFED;border-radius:16px;">
              <tr>
                <td style="padding:14px 16px;font-size:14px;line-height:22px;color:#353B46;font-family:${FONT};">
                  🔒 <strong>เก็บรหัสนี้เป็นความลับนะ</strong> ทีมงาน Pawject จะไม่ขอรหัสนี้จากคุณทางแชทหรืออีเมล<br>
                  ถ้าไม่ได้เป็นคนขอรหัส ไม่ต้องทำอะไร อีเมลนี้จะหมดอายุเอง 🐾
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:460px;">
        <tr>
          <td align="center" style="padding:18px 10px 0;font-family:${FONT};font-size:13px;line-height:20px;color:#8D93A0;">
            ทีมเดียวกัน งานไม่หลุดมือ ไปกับ Pawject 🐾<br>
            <a href="${FRONTEND_URL}" style="color:#4F83CC;text-decoration:none;">${FRONTEND_URL.replace(/^https?:\/\//, "")}</a>
          </td>
        </tr>
      </table>

    </td>
  </tr>
</table>
</body>
</html>`;

  const text = `${copy.title} — Pawject\n\n${copy.plain}\n\nรหัสของคุณ: ${code}\nหมดอายุใน ${ttlMinutes} นาที\n\nเก็บรหัสนี้เป็นความลับ ทีมงาน Pawject จะไม่ขอรหัสนี้จากคุณ\nถ้าไม่ได้เป็นคนขอรหัส ไม่ต้องทำอะไร`;

  return { html, text };
}

module.exports = { renderOtpEmail };
