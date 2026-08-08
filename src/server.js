require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const connectDB = require('./config/db');

const healthRoute = require('./routes/healthRoute');
const authRoute = require('./routes/authRoute');
const courseRoute = require('./routes/courseRoute');
const studentRoute = require('./routes/studentRoute');
const complaintRoute = require('./routes/complaintRoute');
const attendanceRoutes = require('./routes/attendanceRoutes');
const startKeepAlive = require('./utils/keepAlive');
const { startFacultyCalendarPushScheduler } = require("./utils/facultyCalendarPush");
const projectFormRoutes = require('./routes/projectFormRoutes');
const labSubmissionRoutes = require('./routes/labSubmissionRoutes');
const publicLabSubmissionRoutes = require('./routes/publicLabSubmissionRoutes');
const routineRoutes = require('./routes/routineRoutes');
const academicCalendarRoutes = require("./routes/academicCalendarRoutes");
const notebookRoutes = require("./routes/notebookRoutes");
const notificationRoutes = require("./routes/notificationRoutes");
const {
  MAX_SUBMISSION_UPLOAD_MB,
} = require('./middleware/submissionUploadMiddleware');

const app = express();

const configuredOrigins = String(
  process.env.CLIENT_ORIGINS || process.env.FRONTEND_URL || ''
)
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const allowedOrigins = new Set([
  'http://localhost:5173',
  'https://course-management-client-puce.vercel.app',
  'https://bubt-courses.vercel.app',

  // Firebase frontends
  'https://bubt-courses.web.app',
  'https://bubt-courses.firebaseapp.com',
  'https://bubt.web.app',
  'https://bubt.firebaseapp.com',
  'capacitor://localhost',
  'ionic://localhost',
  ...configuredOrigins,
]);

function isAllowedOrigin(origin) {
  if (allowedOrigins.has(origin)) return true;

  // Vite may automatically use another local port when 5173 is occupied.
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin || isAllowedOrigin(origin)) {
      return callback(null, true);
    }

    return callback(new Error(`Not allowed by CORS: ${origin}`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Accept',
    'Content-Type',
    'Authorization',
    'Cache-Control',
    'Pragma',
    'Expires',
    'X-Requested-With',
  ],
  exposedHeaders: ['Content-Disposition'],
  optionsSuccessStatus: 204,
  maxAge: 86400,
};

app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));

// app.options(/.*/, cors());

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

app.use('/api/health', healthRoute);
app.use('/api/auth', authRoute);
app.use('/api/courses', courseRoute);
app.use('/api/student', studentRoute);
app.use('/api/complaints', complaintRoute);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/project-form', projectFormRoutes);
app.use('/api/lab-submissions', labSubmissionRoutes);
app.use('/api/public-lab-submissions', publicLabSubmissionRoutes);
app.use('/api/routine', routineRoutes);
app.use("/api/academic-calendar", academicCalendarRoutes);
app.use("/api/notebook", notebookRoutes);
app.use("/api/notifications", notificationRoutes);

app.use((err, _req, res, next) => {
  if (err?.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({
      message: `File is too large. The portal upload limit is ${MAX_SUBMISSION_UPLOAD_MB} MB.`,
    });
  }

  if (err?.message?.startsWith('Invalid file type.')) {
    return res.status(400).json({ message: err.message });
  }

  return next(err);
});

const PORT = process.env.PORT || 5000;

connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT} 🚀`);
    startKeepAlive();
    startFacultyCalendarPushScheduler();
  });
});