const jwt = require("jsonwebtoken");

const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization; // "Bearer token"

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Authorization token missing" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    req.user = {
      userId: decoded.id,     // make sure your login signs { id, role }
      role: decoded.role,
    };

    // ✅ extra safety
    if (!req.user.userId || !req.user.role) {
      return res.status(401).json({ message: "Invalid token payload" });
    }

    next();
  } catch (err) {
    console.error("JWT error", err);
    return res.status(401).json({ message: "Invalid or expired token" });
  }
};

const requireTeacher = (req, res, next) => {
  // ✅ FIX: req.user may be undefined if authMiddleware didn't run
  if (!req.user) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  if (req.user.role !== "teacher") {
    return res.status(403).json({ message: "Teacher access only" });
  }

  next();
};

const requireStudent = (req, res, next) => {
  // ✅ FIX: req.user may be undefined if authMiddleware didn't run
  if (!req.user) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  if (req.user.role !== "student") {
    return res.status(403).json({ message: "Student access only" });
  }

  next();
};

// ✅ convenience wrappers (recommended)
const teacherOnly = [authMiddleware, requireTeacher];
const studentOnly = [authMiddleware, requireStudent];

module.exports = {
  authMiddleware,
  requireTeacher,
  requireStudent,
  teacherOnly,
  studentOnly,
};
