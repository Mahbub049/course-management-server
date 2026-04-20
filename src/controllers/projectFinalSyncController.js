const Course = require("../models/Course");
const Enrollment = require("../models/Enrollment");
const Assessment = require("../models/Assessment");
const Mark = require("../models/Mark");
const ProjectGroup = require("../models/ProjectGroup");
const ProjectPhase = require("../models/ProjectPhase");
const ProjectEvaluation = require("../models/ProjectEvaluation");
const ProjectMarkSyncConfig = require("../models/ProjectMarkSyncConfig");

const ensureTeacherCourseAccess = async (teacherId, courseId) => {
    const course = await Course.findOne({
        _id: courseId,
        createdBy: teacherId,
    });

    if (!course) {
        const err = new Error("Course not found");
        err.status = 404;
        throw err;
    }

    if (course?.projectFeature?.mode !== "project") {
        const err = new Error("Project workflow is not enabled for this course");
        err.status = 400;
        throw err;
    }

    return course;
};

const getOrCreateSyncConfig = async (courseId) => {
    let config = await ProjectMarkSyncConfig.findOne({ course: courseId });

    if (!config) {
        config = await ProjectMarkSyncConfig.create({
            course: courseId,
            targetAssessmentId: null,
            syncEnabled: false,
        });
    }

    return config;
};

const getTeacherProjectSyncState = async (req, res) => {
    try {
        const teacherId = req.user.userId;
        const { courseId } = req.params;

        await ensureTeacherCourseAccess(teacherId, courseId);

        const [config, assessments] = await Promise.all([
            getOrCreateSyncConfig(courseId),
            Assessment.find({ course: courseId }).sort({ createdAt: 1 }),
        ]);

        return res.json({
            config: {
                targetAssessmentId: config.targetAssessmentId
                    ? String(config.targetAssessmentId)
                    : "",
                syncEnabled: config.syncEnabled === true,
                lastSyncedAt: config.lastSyncedAt,
            },
            assessments: assessments.map((item) => ({
                id: String(item._id),
                title: item.title || item.name || "Untitled Assessment",
                marks: Number(item.totalMarks || item.marks || 0),
            })),
        });
    } catch (err) {
        console.error("getTeacherProjectSyncState error:", err);
        return res.status(err.status || 500).json({
            message: err.message || "Server error",
        });
    }
};

const saveTeacherProjectSyncConfig = async (req, res) => {
    try {
        const teacherId = req.user.userId;
        const { courseId } = req.params;
        const { targetAssessmentId, syncEnabled } = req.body;

        await ensureTeacherCourseAccess(teacherId, courseId);

        const config = await getOrCreateSyncConfig(courseId);

        if (targetAssessmentId) {
            const assessment = await Assessment.findOne({
                _id: targetAssessmentId,
                course: courseId,
            });

            if (!assessment) {
                return res.status(404).json({ message: "Target assessment not found" });
            }

            config.targetAssessmentId = targetAssessmentId;
        } else {
            config.targetAssessmentId = null;
        }

        config.syncEnabled = syncEnabled === true;
        await config.save();

        return res.json({
            message: "Project sync configuration updated successfully",
            config: {
                targetAssessmentId: config.targetAssessmentId
                    ? String(config.targetAssessmentId)
                    : "",
                syncEnabled: config.syncEnabled === true,
                lastSyncedAt: config.lastSyncedAt,
            },
        });
    } catch (err) {
        console.error("saveTeacherProjectSyncConfig error:", err);
        return res.status(err.status || 500).json({
            message: err.message || "Server error",
        });
    }
};

const buildStudentProjectTotals = async (courseId) => {
    const [phases, groups, enrollments, evaluations] = await Promise.all([
        ProjectPhase.find({ course: courseId }),
        ProjectGroup.find({ course: courseId }).populate("members", "_id"),
        Enrollment.find({ course: courseId }).populate("student", "_id name username"),
        ProjectEvaluation.find({ course: courseId })
            .populate("phase")
            .populate("group", "members")
            .populate("student", "_id"),
    ]);

    const phaseMap = new Map(phases.map((p) => [String(p._id), p]));

    const studentTotals = new Map();

    enrollments.forEach((enrollment) => {
        const studentId = String(enrollment.student._id);
        studentTotals.set(studentId, {
            studentId,
            name: enrollment.student.name || "",
            roll: enrollment.student.username || "",
            obtained: 0,
            available: 0,
            syncedMarks: 0,
        });
    });

    phases.forEach((phase) => {
        const phaseId = String(phase._id);
        const relevantEvaluations = evaluations.filter(
            (item) => String(item.phase._id) === phaseId
        );

        if (phase.phaseType === "group") {
            const handledGroups = new Set();

            relevantEvaluations.forEach((evaluation) => {
                if (!evaluation.group) return;

                const groupId = String(evaluation.group._id);
                if (handledGroups.has(groupId)) return;
                handledGroups.add(groupId);

                const members = Array.isArray(evaluation.group.members)
                    ? evaluation.group.members.map((m) => String(m))
                    : [];

                members.forEach((studentId) => {
                    const entry = studentTotals.get(studentId);
                    if (!entry) return;
                    entry.obtained += Number(evaluation.marksObtained || 0);
                    entry.available += Number(phase.totalMarks || 0);
                });
            });

            groups.forEach((group) => {
                const groupId = String(group._id);
                if (handledGroups.has(groupId)) return;

                const members = Array.isArray(group.members)
                    ? group.members.map((m) => String(m._id || m))
                    : [];

                members.forEach((studentId) => {
                    const entry = studentTotals.get(studentId);
                    if (!entry) return;
                    entry.available += Number(phase.totalMarks || 0);
                });
            });
        } else {
            const handledStudents = new Set();

            relevantEvaluations.forEach((evaluation) => {
                if (!evaluation.student) return;

                const studentId = String(evaluation.student._id);
                handledStudents.add(studentId);

                const entry = studentTotals.get(studentId);
                if (!entry) return;
                entry.obtained += Number(evaluation.marksObtained || 0);
                entry.available += Number(phase.totalMarks || 0);
            });

            studentTotals.forEach((entry, studentId) => {
                if (handledStudents.has(studentId)) return;
                entry.available += Number(phase.totalMarks || 0);
            });
        }
    });

    studentTotals.forEach((entry) => {
        entry.syncedMarks = Number(entry.obtained || 0);
    });

    return Array.from(studentTotals.values());
};

const runProjectFinalSync = async (req, res) => {
    try {
        const teacherId = req.user.userId;
        const { courseId } = req.params;

        await ensureTeacherCourseAccess(teacherId, courseId);

        const config = await getOrCreateSyncConfig(courseId);

        if (!config.syncEnabled) {
            return res.status(400).json({
                message: "Project mark sync is disabled",
            });
        }

        if (!config.targetAssessmentId) {
            return res.status(400).json({
                message: "Please select a target assessment first",
            });
        }

        const targetAssessment = await Assessment.findOne({
            _id: config.targetAssessmentId,
            course: courseId,
        });

        if (!targetAssessment) {
            return res.status(404).json({
                message: "Target assessment not found",
            });
        }

        const totals = await buildStudentProjectTotals(courseId);

        let syncedCount = 0;

        for (const item of totals) {
            const markValue = Number(item.syncedMarks || 0);

            let existingMark = await Mark.findOne({
                course: courseId,
                assessment: targetAssessment._id,
                student: item.studentId,
            });

            if (existingMark) {
                existingMark.obtainedMarks = markValue;
                existingMark.subMarks = [];
                await existingMark.save();
            } else {
                await Mark.create({
                    course: courseId,
                    assessment: targetAssessment._id,
                    student: item.studentId,
                    obtainedMarks: markValue,
                    subMarks: [],
                });
            }

            syncedCount += 1;
        }

        config.lastSyncedAt = new Date();
        await config.save();

        return res.json({
            message: "Project marks synced successfully",
            syncedCount,
            targetAssessment: {
                id: String(targetAssessment._id),
                title: targetAssessment.title || targetAssessment.name || "Assessment",
                marks: Number(targetAssessment.totalMarks || targetAssessment.marks || 0),
            },
            lastSyncedAt: config.lastSyncedAt,
            totals,
        });
    } catch (err) {
        console.error("runProjectFinalSync error:", err);
        return res.status(err.status || 500).json({
            message: err.message || "Server error",
        });
    }
};

const getStudentProjectTotalSummary = async (req, res) => {
    try {
        const studentId = req.user.userId;
        const { courseId } = req.params;

        const enrollment = await Enrollment.findOne({
            course: courseId,
            student: studentId,
        }).populate("course");

        if (!enrollment) {
            return res.status(403).json({
                message: "You are not enrolled in this course",
            });
        }

        if (enrollment?.course?.projectFeature?.mode !== "project") {
            return res.status(400).json({
                message: "Project workflow is not enabled for this course",
            });
        }

        const totals = await buildStudentProjectTotals(courseId);
        const mine = totals.find((item) => String(item.studentId) === String(studentId));

        return res.json({
            totalObtained: Number(mine?.obtained || 0),
            totalAvailable: Number(mine?.available || 0),
            syncedMarks: Number(mine?.syncedMarks || 0),
        });
    } catch (err) {
        console.error("getStudentProjectTotalSummary error:", err);
        return res.status(err.status || 500).json({
            message: err.message || "Server error",
        });
    }
};

module.exports = {
    getTeacherProjectSyncState,
    saveTeacherProjectSyncConfig,
    runProjectFinalSync,
    getStudentProjectTotalSummary,
};