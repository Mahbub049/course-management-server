const mongoose = require('mongoose');

const complaintSchema = new mongoose.Schema(
    {
        student: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        course: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Course',
            required: true,
        },
        assessment: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Assessment',
            required: false, // student may complain about total marks or grading too
        },
        message: {
            type: String,
            required: true,
        },
        reply: {
            type: String,
            default: '',
        },
        status: {
            type: String,
            enum: ['open', 'in_review', 'resolved'],
            default: 'open',
        },
    },
    { timestamps: true }
);

module.exports = mongoose.model('Complaint', complaintSchema);
