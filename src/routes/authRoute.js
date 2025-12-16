const express = require('express');
const router = express.Router();
const { login, changePassword, updateProfile, registerTeacher } = require('../controllers/authController');
const { authMiddleware } = require('../middleware/authMiddleware');

// Login
router.post('/login', login);
router.post('/teacher/register', registerTeacher);

// Change password (must be logged in)
router.post('/change-password', authMiddleware, changePassword);

router.put('/profile', authMiddleware, updateProfile);

module.exports = router;
