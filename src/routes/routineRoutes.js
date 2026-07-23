const express = require("express");
const router = express.Router();

const {
  authMiddleware,
  requireTeacher,
  requireStudent,
} = require("../middleware/authMiddleware");
const {
  getRoutineReferenceData,
  getMyRoutine,
  saveMyRoutine,
  downloadMyClassRoutine,
  downloadMyFacultyNameplate,
  getStudentCounsellingInfo,
  createStudentCounsellingBooking,
  deleteStudentCounsellingBooking,
  getTeacherCounsellingBookings,
  updateTeacherCounsellingBooking,
  deleteTeacherCounsellingBooking,
} = require("../controllers/routineController");

router.get("/reference-data", getRoutineReferenceData);

router.use(authMiddleware);

router.get("/my", requireTeacher, getMyRoutine);
router.put("/my", requireTeacher, saveMyRoutine);
router.get("/my/download/class-routine", requireTeacher, downloadMyClassRoutine);
router.get("/my/download/faculty-nameplate", requireTeacher, downloadMyFacultyNameplate);

router.get("/my/counselling-bookings", requireTeacher, getTeacherCounsellingBookings);
// Backward-compatible aliases for any older local client file that still calls underscore URLs.
router.get("/my_counselling_bookings", requireTeacher, getTeacherCounsellingBookings);
router.patch(
  "/my/counselling-bookings/:bookingId",
  requireTeacher,
  updateTeacherCounsellingBooking
);
router.patch(
  "/my_counselling_bookings/:bookingId",
  requireTeacher,
  updateTeacherCounsellingBooking
);
router.delete(
  "/my/counselling-bookings/:bookingId",
  requireTeacher,
  deleteTeacherCounsellingBooking
);
router.delete(
  "/my_counselling_bookings/:bookingId",
  requireTeacher,
  deleteTeacherCounsellingBooking
);

router.get("/student/counselling", requireStudent, getStudentCounsellingInfo);
router.get("/student_counselling", requireStudent, getStudentCounsellingInfo);
router.post(
  "/student/counselling-bookings",
  requireStudent,
  createStudentCounsellingBooking
);
router.post(
  "/student_counselling_bookings",
  requireStudent,
  createStudentCounsellingBooking
);

router.delete(
  "/student/counselling-bookings/:bookingId",
  requireStudent,
  deleteStudentCounsellingBooking
);
router.delete(
  "/student_counselling_bookings/:bookingId",
  requireStudent,
  deleteStudentCounsellingBooking
);

module.exports = router;
