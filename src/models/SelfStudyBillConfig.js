const mongoose = require("mongoose");

const selfStudyBillConfigSchema = new mongoose.Schema(
  {
    course: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
      required: true,
      unique: true,
      index: true,
    },
    teacher: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    studentIntakes: [
      {
        _id: false,
        student: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        intake: { type: String, trim: true, default: "" },
      },
    ],
  },
  { timestamps: true }
);

module.exports = mongoose.model("SelfStudyBillConfig", selfStudyBillConfigSchema);
