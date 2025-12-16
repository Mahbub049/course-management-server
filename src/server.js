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

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/health', healthRoute);
app.use('/api/auth', authRoute);
app.use('/api/courses', courseRoute);
app.use('/api/student', studentRoute); // from previous scrum
app.use('/api/complaints', complaintRoute);
app.use("/api/attendance", attendanceRoutes);


// Connect DB and start server
const PORT = process.env.PORT || 5000;

connectDB().then(() => {
    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT} 🚀`);
    });
});
