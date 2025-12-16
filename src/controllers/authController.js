const jwt = require('jsonwebtoken');
const User = require('../models/User');

const generateToken = (user) => {
  return jwt.sign(
    {
      id: user._id,
      role: user.role,
    },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
};

// POST /api/auth/login
const login = async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ message: 'Username and password required' });
    }

    const user = await User.findOne({ username });
    if (!user) return res.status(401).json({ message: 'Invalid credentials' });

    const valid = await user.validatePassword(password);
    if (!valid) return res.status(401).json({ message: 'Invalid credentials' });

    const token = generateToken(user);

    res.json({
      token,
      role: user.role,
      firstLogin: user.firstLogin,
      name: user.name,
      username: user.username,
    });
  } catch (err) {
    console.error('Login error', err);
    res.status(500).json({ message: 'Server error' });
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

    // Basic username validation (you can customize)
    if (cleanUsername.length < 3) {
      return res.status(400).json({
        message: "Username must be at least 3 characters",
      });
    }

    // Only allow letters, numbers, underscore, dot (optional rule)
    if (!/^[a-zA-Z0-9._]+$/.test(cleanUsername)) {
      return res.status(400).json({
        message:
          "Username can contain only letters, numbers, dot (.) and underscore (_)",
      });
    }

    // Prevent duplicate email
    const existingEmail = await User.findOne({ email: email.trim() });
    if (existingEmail) {
      return res.status(400).json({
        message: "Email already registered",
      });
    }

    // Prevent duplicate username
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
      email: email.trim(),
      department: department.trim(),
      designation: designation.trim(),
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
    const { userId } = req.user; // from middleware
    const { oldPassword, newPassword } = req.body;

    if (!oldPassword || !newPassword) {
      return res.status(400).json({ message: 'Both old and new passwords required' });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const isValid = await user.validatePassword(oldPassword);
    if (!isValid) return res.status(401).json({ message: 'Old password is incorrect' });

    await user.setPassword(newPassword);
    user.firstLogin = false;
    await user.save();

    res.json({ message: 'Password changed successfully' });
  } catch (err) {
    console.error('Change password error', err);
    res.status(500).json({ message: 'Server error' });
  }
};

// Update logged-in user's username / name
const updateProfile = async (req, res) => {
  try {
    const userId = req.user.userId;  // set by authMiddleware
    const { username, name } = req.body;

    if (!username && !name) {
      return res
        .status(400)
        .json({ message: 'Nothing to update.' });
    }

    const update = {};

    if (username) {
      // Check if username already taken by another user
      const existing = await User.findOne({
        username,
        _id: { $ne: userId },
      });

      if (existing) {
        return res
          .status(400)
          .json({ message: 'This username is already taken.' });
      }

      update.username = username;
    }

    if (name) {
      update.name = name;
    }

    const user = await User.findByIdAndUpdate(userId, update, {
      new: true,
    });

    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    return res.json({
      id: user._id,
      username: user.username,
      name: user.name,
      role: user.role,
    });
  } catch (err) {
    console.error('updateProfile error', err);
    res
      .status(500)
      .json({ message: 'Server error updating profile.' });
  }
};


module.exports = {
  login,
  changePassword,
  updateProfile,
  registerTeacher,
};

