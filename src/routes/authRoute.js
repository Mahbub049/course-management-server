const express = require("express");
const router = express.Router();

const {
  login,
  changePassword,
  getProfile,
  updateProfile,
  registerTeacher,
  requestPasswordResetOtp,
  verifyPasswordResetOtp,
  resetPasswordWithOtp,
} = require("../controllers/authController");

const { authMiddleware } = require("../middleware/authMiddleware");

// Public routes
router.post("/login", login);
router.post("/teacher/register", registerTeacher);

// Forgot password OTP routes for students
router.post("/forgot-password/request-otp", requestPasswordResetOtp);
router.post("/forgot-password/verify-otp", verifyPasswordResetOtp);
router.post("/forgot-password/reset", resetPasswordWithOtp);

// Protected routes
router.post("/change-password", authMiddleware, changePassword);
router.get("/profile", authMiddleware, getProfile);
router.put("/profile", authMiddleware, updateProfile);

module.exports = router;