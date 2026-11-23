const jwt = require("jsonwebtoken");

function authenticate(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.substring(7) : null;
  if (!token) return res.status(401).json({ success: false, message: "Please login first" });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET || "development_secret_change_me");
    next();
  } catch {
    res.status(401).json({ success: false, message: "Invalid or expired login token" });
  }
}
function adminOnly(req, res, next) {
  if (req.user?.role !== "admin") return res.status(403).json({ success: false, message: "Admin permission required" });
  next();
}

function requireRoles(...allowedRoles) {
  return (req, res, next) => {
    const role = String(req.user?.role || "").toLowerCase().trim();
    if (role === "admin" || allowedRoles.map(r => r.toLowerCase()).includes(role)) {
      return next();
    }
    return res.status(403).json({
      success: false,
      message: `Permission denied: ${role} role cannot access this module`
    });
  };
}

module.exports = { authenticate, adminOnly, requireRoles };