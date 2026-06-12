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
const projectFormRoutes = require('./routes/projectFormRoutes');
const labSubmissionRoutes = require('./routes/labSubmissionRoutes');
const routineRoutes = require('./routes/routineRoutes');
const academicCalendarRoutes = require("./routes/academicCalendarRoutes");
const notebookRoutes = require("./routes/notebookRoutes");

const app = express();

const allowedOrigins = [
  'http://localhost:5173',
  'https://course-management-client-puce.vercel.app',
  'https://bubt-courses.vercel.app',

  // Firebase alternate frontend
  'https://bubt-courses.web.app',
  'https://bubt-courses.firebaseapp.com',
];

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin) {
      return callback(null, true);
    }

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(new Error(`Not allowed by CORS: ${origin}`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};

app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));

app.options(/.*/, cors());

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
app.use('/api/routine', routineRoutes);
app.use("/api/academic-calendar", academicCalendarRoutes);
app.use("/api/notebook", notebookRoutes);

const PORT = process.env.PORT || 5000;

connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT} 🚀`);
    startKeepAlive();
  });
});