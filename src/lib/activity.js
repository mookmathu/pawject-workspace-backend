const prisma = require("./prisma");

const TZ = "Asia/Bangkok";
const WINDOW_MS = 5 * 60 * 1000;

// "YYYY-MM-DD" for a moment in time, in the app's home timezone (so a late
// night session doesn't spill onto the next UTC day).
function dayKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

// userId -> timestamp of the last write, so a busy user costs at most one
// tiny upsert every 5 minutes instead of one per request. (Per process —
// if the server restarts or runs several copies, the worst case is an
// occasional extra +1, which is harmless for a rough intensity score.)
const lastWrite = new Map();

function recordActivity(userId) {
  const now = Date.now();
  const last = lastWrite.get(userId) || 0;
  if (now - last < WINDOW_MS) return;
  lastWrite.set(userId, now);

  const day = dayKey(new Date(now));
  prisma.userActivityDay
    .upsert({
      where: { userId_day: { userId, day } },
      create: { userId, day, count: 1 },
      update: { count: { increment: 1 } },
    })
    .catch(() => {
      // best-effort analytics — never let it break (or slow) a real request
      lastWrite.delete(userId);
    });
}

module.exports = { recordActivity, dayKey, TZ };
