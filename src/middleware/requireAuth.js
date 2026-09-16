const jwt = require("jsonwebtoken");

// Not wired into any route yet — use this later on routes that should only
// work for a logged-in user, e.g. router.get("/me", requireAuth, handler).
function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "ไม่ได้เข้าสู่ระบบ" });
  }

  const token = header.split(" ")[1];

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = payload.sub;
    next();
  } catch (err) {
    return res.status(401).json({ error: "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่" });
  }
}

module.exports = requireAuth;
