require('dotenv').config();
const express = require('express');
const cors = require('cors');
const connectDB = require('./config/db');

const healthRoute = require('./routes/healthRoute');
const authRoute = require('./routes/authRoute');
const courseRoute = require('./routes/courseRoute');
const studentRoute = require('./routes/studentRoute');
const complaintRoute = require('./routes/complaintRoute');
const attendanceRoutes = require('./routes/attendanceRoutes');
const startKeepAlive = require("./utils/keepAlive");

const app = express();

// Middleware
// Middleware
app.use(
  cors({
    origin: function (origin, callback) {
      const allowedOrigins = [
        "http://localhost:5173",
        "https://course-management-client-puce.vercel.app",
        "https://bubt-courses.vercel.app",
      ];

      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);

      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true, // 🔥 change this
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// 🔥 VERY IMPORTANT (fix preflight)
app.options(/.*/, cors());

// 🔥 VERY IMPORTANT (fix image upload size)
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Routes
app.use('/api/health', healthRoute);
app.use('/api/auth', authRoute);
app.use('/api/courses', courseRoute);
app.use('/api/student', studentRoute);
app.use('/api/complaints', complaintRoute);
app.use('/api/attendance', attendanceRoutes);

// Connect DB and start server
const PORT = process.env.PORT || 5000;

connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT} 🚀`);
    startKeepAlive(); // ✅ start after server is live
  });

});
