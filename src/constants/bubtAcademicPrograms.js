const BUBT_SHIFTS = ["Day", "Evening"];

const COMMON_PROGRAMS = [
    {
        key: "bba",
        label: "BBA",
        departmentLine: "Bachelor of Business Administration",
    },
    {
        key: "accounting",
        label: "BBA in Accounting",
        departmentLine: "Department of Accounting, BUBT",
    },
    {
        key: "finance",
        label: "BBA in Finance",
        departmentLine: "Department of Finance, BUBT",
    },
    {
        key: "management",
        label: "BBA in Management",
        departmentLine: "Department of Management, BUBT",
    },
    {
        key: "marketing",
        label: "BBA in Marketing",
        departmentLine: "Department of Marketing, BUBT",
    },
    {
        key: "english",
        label: "BA (Hons.) in English",
        departmentLine: "Department of English, BUBT",
    },
    {
        key: "economics",
        label: "B.Sc. (Hons.) in Economics",
        departmentLine: "Department of Economics, BUBT",
    },
    {
        key: "law",
        label: "LL.B. (Hons.)",
        departmentLine: "Department of Law & Justice, BUBT",
    },
];

const BUBT_PROGRAMS_BY_SHIFT = {
    Day: [
        {
            key: "cse",
            label: "B.Sc. Engg. in CSE",
            departmentLine: "Department of Computer Science & Engineering, BUBT",
        },
        {
            key: "data-science",
            label: "B.Sc. in Data Science and Engineering",
            departmentLine: "Department of Data Science & Engineering, BUBT",
        },
        {
            key: "eee",
            label: "B.Sc. Engg. in EEE",
            departmentLine: "Department of Electrical & Electronic Engineering, BUBT",
        },
        {
            key: "textile",
            label: "B.Sc. in Textile Engineering",
            departmentLine: "Department of Textile Engineering, BUBT",
        },
        {
            key: "civil",
            label: "B.Sc. in Civil Engineering",
            departmentLine: "Department of Civil Engineering, BUBT",
        },
        ...COMMON_PROGRAMS,
    ],
    Evening: [
        {
            key: "cse",
            label: "B.Sc. Engg. in CSE (DH)",
            departmentLine: "Department of Computer Science & Engineering, BUBT",
        },
        {
            key: "eee",
            label: "B.Sc. Engg. in EEE (DH)",
            departmentLine: "Department of Electrical & Electronic Engineering, BUBT",
        },
        {
            key: "textile",
            label: "B.Sc. in Textile Engineering (DH)",
            departmentLine: "Department of Textile Engineering, BUBT",
        },
        {
            key: "civil",
            label: "B.Sc. in Civil Engineering (DH)",
            departmentLine: "Department of Civil Engineering, BUBT",
        },
        ...COMMON_PROGRAMS,
    ],
};

const normalizeShift = (value) =>
    String(value || "").trim().toLowerCase() === "evening" ? "Evening" : "Day";

const getProgramsForShift = (shift = "Day") =>
    BUBT_PROGRAMS_BY_SHIFT[normalizeShift(shift)];

const isProgramAllowedForShift = (program, shift) =>
    getProgramsForShift(shift).some((item) => item.label === String(program || "").trim());

const findProgramByLabel = (program = "") => {
    const normalized = String(program || "").trim();
    if (!normalized) return null;

    return (
        [...BUBT_PROGRAMS_BY_SHIFT.Day, ...BUBT_PROGRAMS_BY_SHIFT.Evening].find(
            (item) => item.label === normalized
        ) || null
    );
};

const getDepartmentLineForProgram = (program = "") =>
    findProgramByLabel(program)?.departmentLine || "";

module.exports = {
    BUBT_SHIFTS,
    BUBT_PROGRAMS_BY_SHIFT,
    normalizeShift,
    getProgramsForShift,
    isProgramAllowedForShift,
    getDepartmentLineForProgram,
};
