const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { sendMail } = require("../utils/mailer");

const OTP_EXPIRY_MINUTES = 10;
const RESET_VERIFIED_EXPIRY_MINUTES = 10;
const MAX_OTP_ATTEMPTS = 5;
const ALLOWED_DESIGNATIONS = [
  "Lecturer",
  "Assistant Professor",
  "Associate Professor",
  "Professor",
];

const generateToken = (user, rememberMe = false) => {
  return jwt.sign(
    {
      id: user._id,
      role: user.role,
    },
    process.env.JWT_SECRET,
    {
      expiresIn: rememberMe ? "30d" : "1d",
    }
  );
};

const normalizeText = (value) => {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
};

const normalizeEmail = (value) => {
  return String(value || "").trim().toLowerCase();
};

const isValidEmail = (email) => {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
};

const generateOtp = () => {
  return String(Math.floor(100000 + Math.random() * 900000));
};

const hashOtp = (otp, userId) => {
  return crypto
    .createHash("sha256")
    .update(`${otp}.${userId}.${process.env.JWT_SECRET}`)
    .digest("hex");
};

const buildOtpEmailHtml = ({ name, otp }) => {
  return `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #111827;">
      <h2>Password Reset OTP</h2>

      <p>Hello ${name || "Student"},</p>

      <p>Your OTP for Course Management System password reset is:</p>

      <div style="font-size: 28px; font-weight: 700; letter-spacing: 6px; background: #f3f4f6; padding: 14px 18px; border-radius: 10px; display: inline-block;">
        ${otp}
      </div>

      <p>This OTP will expire in ${OTP_EXPIRY_MINUTES} minutes.</p>

      <p>If you did not request this password reset, please ignore this email.</p>
    </div>
  `;
};

async function uploadBase64ToImgbb(base64String, fileName = "profile") {
  if (!process.env.IMGBB_API_KEY) {
    throw new Error("IMGBB_API_KEY is missing in server environment");
  }

  const cleanBase64 = String(base64String).replace(
    /^data:image\/[a-zA-Z0-9.+-]+;base64,/,
    ""
  );

  const formData = new URLSearchParams();
  formData.append("image", cleanBase64);
  formData.append("name", fileName);

  const response = await fetch(
    `https://api.imgbb.com/1/upload?key=${process.env.IMGBB_API_KEY}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: formData.toString(),
    }
  );

  const data = await response.json();

  if (!response.ok || !data?.success) {
    console.error("ImgBB upload failed:", data);
    throw new Error(data?.error?.message || "Failed to upload image to ImgBB");
  }

  return data.data.url;
}

// POST /api/auth/login
const login = async (req, res) => {
  try {
    const { username, password, rememberMe } = req.body;

    if (!username || !password) {
      return res
        .status(400)
        .json({ message: "Username and password required" });
    }

    const user = await User.findOne({ username: String(username).trim() });

    if (!user) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const valid = await user.validatePassword(password);

    if (!valid) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const token = generateToken(user, rememberMe);

    res.json({
      token,
      role: user.role,
      firstLogin: user.firstLogin,
      name: user.name,
      username: user.username,
      email: user.email || "",
      phone: user.phone || "",
      shortCode: user.shortCode || "",
      designation: user.designation || "",
      department: user.department || "",
      profileImage: user.profileImage || "",
    });
  } catch (err) {
    console.error("Login error", err);
    res.status(500).json({ message: "Server error" });
  }
};

// POST /api/auth/teacher/register
const registerTeacher = async (req, res) => {
  try {
    const {
      username,
      name,
      email,
      department,
      designation,
      joiningDate,
      password,
    } = req.body;

    if (
      !username ||
      !name ||
      !email ||
      !department ||
      !designation ||
      !joiningDate ||
      !password
    ) {
      return res.status(400).json({
        message: "All fields are required",
      });
    }

    const cleanUsername = String(username).trim();
    const cleanEmail = normalizeEmail(email);
    const cleanDesignation = String(designation).trim();

    if (!ALLOWED_DESIGNATIONS.includes(cleanDesignation)) {
      return res.status(400).json({
        message:
          "Designation must be Lecturer, Assistant Professor, Associate Professor, or Professor.",
      });
    }

    if (cleanUsername.length < 3) {
      return res.status(400).json({
        message: "Username must be at least 3 characters",
      });
    }

    if (!/^[a-zA-Z0-9._]+$/.test(cleanUsername)) {
      return res.status(400).json({
        message:
          "Username can contain only letters, numbers, dot (.) and underscore (_)",
      });
    }

    if (!isValidEmail(cleanEmail)) {
      return res.status(400).json({
        message: "Please enter a valid email address.",
      });
    }

    const existingEmail = await User.findOne({ email: cleanEmail });

    if (existingEmail) {
      return res.status(400).json({
        message: "Email already registered",
      });
    }

    const existingUsername = await User.findOne({ username: cleanUsername });

    if (existingUsername) {
      return res.status(400).json({
        message: "Username already taken",
      });
    }

    const user = new User({
      role: "teacher",
      username: cleanUsername,
      name: name.trim(),
      email: cleanEmail,
      emailVerified: true,
      department: department.trim(),
      designation: cleanDesignation,
      joiningDate,
      firstLogin: true,
    });

    await user.setPassword(password);
    await user.save();

    return res.status(201).json({
      message: "Teacher registered successfully",
      username: user.username,
    });
  } catch (err) {
    console.error("Teacher register error", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// POST /api/auth/change-password
const changePassword = async (req, res) => {
  try {
    const { userId } = req.user;
    const { oldPassword, newPassword } = req.body;

    if (!oldPassword || !newPassword) {
      return res
        .status(400)
        .json({ message: "Both old and new passwords required" });
    }

    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const isValid = await user.validatePassword(oldPassword);

    if (!isValid) {
      return res.status(401).json({ message: "Old password is incorrect" });
    }

    await user.setPassword(newPassword);
    user.firstLogin = false;
    await user.save();

    res.json({ message: "Password changed successfully" });
  } catch (err) {
    console.error("Change password error", err);
    res.status(500).json({ message: "Server error" });
  }
};

// GET /api/auth/profile
const getProfile = async (req, res) => {
  try {
    const userId = req.user?.userId || req.user?.id;

    const user = await User.findById(userId).select(
      "username name email phone role shortCode designation department profileImage"
    );

    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }

    return res.json({
      id: user._id,
      username: user.username,
      name: user.name,
      email: user.email || "",
      phone: user.phone || "",
      shortCode: user.shortCode || "",
      designation: user.designation || "",
      department: user.department || "",
      role: user.role,
      profileImage: user.profileImage || "",
    });
  } catch (err) {
    console.error("getProfile error", err);
    return res.status(500).json({ message: "Server error loading profile." });
  }
};

// PUT /api/auth/profile
const updateProfile = async (req, res) => {
  try {
    const userId = req.user?.userId || req.user?.id;
    const { username, name, email, phone, shortCode, designation, profileImageBase64 } =
      req.body;
    const hasShortCode = Object.prototype.hasOwnProperty.call(
      req.body,
      "shortCode"
    );
    const hasDesignation = Object.prototype.hasOwnProperty.call(
      req.body,
      "designation"
    );

    if (
      !username &&
      !name &&
      !Object.prototype.hasOwnProperty.call(req.body, "email") &&
      !Object.prototype.hasOwnProperty.call(req.body, "phone") &&
      !hasShortCode &&
      !hasDesignation &&
      !profileImageBase64
    ) {
      return res.status(400).json({ message: "Nothing to update." });
    }

    const update = {};

    if (username) {
      const cleanUsername = String(username).trim();

      if (cleanUsername.length < 3) {
        return res.status(400).json({
          message: "Username must be at least 3 characters",
        });
      }

      if (!/^[a-zA-Z0-9._]+$/.test(cleanUsername)) {
        return res.status(400).json({
          message:
            "Username can contain only letters, numbers, dot (.) and underscore (_)",
        });
      }

      const existing = await User.findOne({
        username: cleanUsername,
        _id: { $ne: userId },
      });

      if (existing) {
        return res
          .status(400)
          .json({ message: "This username is already taken." });
      }

      update.username = cleanUsername;
    }

    if (name) {
      update.name = String(name).trim();
    }

    if (Object.prototype.hasOwnProperty.call(req.body, "email")) {
      const cleanEmail = normalizeEmail(email);
      if (!cleanEmail || !isValidEmail(cleanEmail)) {
        return res.status(400).json({ message: "Please enter a valid email address." });
      }
      const existingEmail = await User.findOne({ email: cleanEmail, _id: { $ne: userId } });
      if (existingEmail) {
        return res.status(400).json({ message: "This email address is already in use." });
      }
      update.email = cleanEmail;
    }

    if (Object.prototype.hasOwnProperty.call(req.body, "phone")) {
      const cleanPhone = String(phone || "").trim();
      if (cleanPhone.length > 30) {
        return res.status(400).json({ message: "Phone number cannot exceed 30 characters." });
      }
      update.phone = cleanPhone;
    }

    if (hasShortCode) {
      const cleanShortCode = String(shortCode || "").trim();

      if (cleanShortCode.length > 20) {
        return res.status(400).json({
          message: "Short code cannot be more than 20 characters.",
        });
      }

      update.shortCode = cleanShortCode;
    }

    if (hasDesignation) {
      const cleanDesignation = String(designation || "").trim();

      if (!ALLOWED_DESIGNATIONS.includes(cleanDesignation)) {
        return res.status(400).json({
          message:
            "Please select Lecturer, Assistant Professor, Associate Professor, or Professor.",
        });
      }

      const account = await User.findById(userId).select("role");

      if (!account) {
        return res.status(404).json({ message: "User not found." });
      }

      if (account.role !== "teacher") {
        return res.status(403).json({
          message: "Only teacher accounts can update designation.",
        });
      }

      update.designation = cleanDesignation;
    }

    if (profileImageBase64) {
      const imageUrl = await uploadBase64ToImgbb(
        profileImageBase64,
        `user_${userId}_${Date.now()}`
      );
      update.profileImage = imageUrl;
    }

    const user = await User.findByIdAndUpdate(userId, update, {
      new: true,
      runValidators: true,
    });

    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }

    return res.json({
      id: user._id,
      username: user.username,
      name: user.name,
      email: user.email || "",
      phone: user.phone || "",
      shortCode: user.shortCode || "",
      designation: user.designation || "",
      department: user.department || "",
      role: user.role,
      profileImage: user.profileImage || "",
    });
  } catch (err) {
    console.error("updateProfile error", err);
    res.status(500).json({
      message: err.message || "Server error updating profile.",
    });
  }
};

// POST /api/auth/forgot-password/request-otp
const requestPasswordResetOtp = async (req, res) => {
  try {
    const { roll, fullName, email } = req.body;

    if (!roll || !fullName || !email) {
      return res.status(400).json({
        message: "Roll, full name and email are required.",
      });
    }

    const cleanRoll = String(roll).trim();
    const cleanName = normalizeText(fullName);
    const cleanEmail = normalizeEmail(email);

    if (!isValidEmail(cleanEmail)) {
      return res.status(400).json({
        message: "Please enter a valid email address.",
      });
    }

    const user = await User.findOne({
      username: cleanRoll,
      role: "student",
    });

    if (!user) {
      return res.status(400).json({
        message: "Student information does not match our records.",
      });
    }

    if (normalizeText(user.name) !== cleanName) {
      return res.status(400).json({
        message: "Student information does not match our records.",
      });
    }

    if (user.email && normalizeEmail(user.email) !== cleanEmail) {
      return res.status(400).json({
        message:
          "This account already has a registered email. Please use the registered email.",
      });
    }

    const emailOwner = await User.findOne({
      email: cleanEmail,
      _id: { $ne: user._id },
    });

    if (emailOwner) {
      return res.status(400).json({
        message: "This email is already connected to another account.",
      });
    }

    const otp = generateOtp();

    user.pendingRecoveryEmail = cleanEmail;
    user.passwordResetOtpHash = hashOtp(otp, user._id);
    user.passwordResetOtpExpires = new Date(
      Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000
    );
    user.passwordResetOtpAttempts = 0;
    user.passwordResetVerified = false;
    user.passwordResetVerifiedExpires = null;

    await user.save();

    await sendMail({
      to: cleanEmail,
      subject: "Password Reset OTP - Course Management System",
      html: buildOtpEmailHtml({
        name: user.name,
        otp,
      }),
    });

    return res.json({
      message: `OTP has been sent to ${cleanEmail}. It will expire in ${OTP_EXPIRY_MINUTES} minutes.`,
    });
  } catch (err) {
    console.error("requestPasswordResetOtp error", err);
    return res.status(500).json({
      message: "Failed to send OTP. Please try again later.",
    });
  }
};

const verifyOtpForUser = async (user, otp) => {
  if (!otp) {
    return {
      ok: false,
      status: 400,
      message: "OTP is required.",
    };
  }

  if (!user.passwordResetOtpHash || !user.passwordResetOtpExpires) {
    return {
      ok: false,
      status: 400,
      message: "No active OTP found. Please request a new OTP.",
    };
  }

  if (new Date(user.passwordResetOtpExpires).getTime() < Date.now()) {
    return {
      ok: false,
      status: 400,
      message: "OTP has expired. Please request a new OTP.",
    };
  }

  if (Number(user.passwordResetOtpAttempts || 0) >= MAX_OTP_ATTEMPTS) {
    return {
      ok: false,
      status: 429,
      message: "Too many wrong attempts. Please request a new OTP.",
    };
  }

  const incomingHash = hashOtp(String(otp).trim(), user._id);

  if (incomingHash !== user.passwordResetOtpHash) {
    user.passwordResetOtpAttempts = Number(user.passwordResetOtpAttempts || 0) + 1;
    await user.save();

    return {
      ok: false,
      status: 400,
      message: "Invalid OTP. Please check and try again.",
    };
  }

  return {
    ok: true,
  };
};

// POST /api/auth/forgot-password/verify-otp
const verifyPasswordResetOtp = async (req, res) => {
  try {
    const { roll, otp } = req.body;

    if (!roll || !otp) {
      return res.status(400).json({
        message: "Roll and OTP are required.",
      });
    }

    const user = await User.findOne({
      username: String(roll).trim(),
      role: "student",
    });

    if (!user) {
      return res.status(400).json({
        message: "Invalid request.",
      });
    }

    const result = await verifyOtpForUser(user, otp);

    if (!result.ok) {
      return res.status(result.status).json({
        message: result.message,
      });
    }

    user.email = user.pendingRecoveryEmail || user.email;
    user.emailVerified = true;
    user.passwordResetVerified = true;
    user.passwordResetVerifiedExpires = new Date(
      Date.now() + RESET_VERIFIED_EXPIRY_MINUTES * 60 * 1000
    );

    await user.save();

    return res.json({
      message: "OTP verified successfully. You can now reset your password.",
    });
  } catch (err) {
    console.error("verifyPasswordResetOtp error", err);

    if (err?.code === 11000) {
      return res.status(400).json({
        message: "This email is already connected to another account.",
      });
    }

    return res.status(500).json({
      message: "Failed to verify OTP.",
    });
  }
};

// POST /api/auth/forgot-password/reset
const resetPasswordWithOtp = async (req, res) => {
  try {
    const { roll, otp, newPassword } = req.body;

    if (!roll || !otp || !newPassword) {
      return res.status(400).json({
        message: "Roll, OTP and new password are required.",
      });
    }

    if (String(newPassword).length < 6) {
      return res.status(400).json({
        message: "Password must be at least 6 characters long.",
      });
    }

    const user = await User.findOne({
      username: String(roll).trim(),
      role: "student",
    });

    if (!user) {
      return res.status(400).json({
        message: "Invalid request.",
      });
    }

    if (
      !user.passwordResetVerified ||
      !user.passwordResetVerifiedExpires ||
      new Date(user.passwordResetVerifiedExpires).getTime() < Date.now()
    ) {
      return res.status(400).json({
        message: "OTP verification expired. Please verify OTP again.",
      });
    }

    const result = await verifyOtpForUser(user, otp);

    if (!result.ok) {
      return res.status(result.status).json({
        message: result.message,
      });
    }

    if (user.pendingRecoveryEmail) {
      user.email = user.pendingRecoveryEmail;
      user.emailVerified = true;
    }

    await user.setPassword(newPassword);

    user.firstLogin = false;
    user.pendingRecoveryEmail = "";
    user.passwordResetOtpHash = null;
    user.passwordResetOtpExpires = null;
    user.passwordResetOtpAttempts = 0;
    user.passwordResetVerified = false;
    user.passwordResetVerifiedExpires = null;

    await user.save();

    return res.json({
      message: "Password reset successful. You can now login.",
    });
  } catch (err) {
    console.error("resetPasswordWithOtp error", err);

    if (err?.code === 11000) {
      return res.status(400).json({
        message: "This email is already connected to another account.",
      });
    }

    return res.status(500).json({
      message: "Failed to reset password.",
    });
  }
};

module.exports = {
  login,
  changePassword,
  getProfile,
  updateProfile,
  registerTeacher,
  requestPasswordResetOtp,
  verifyPasswordResetOtp,
  resetPasswordWithOtp,
};