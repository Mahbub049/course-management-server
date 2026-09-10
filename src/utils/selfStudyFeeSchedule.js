const schedules = {
  "B.Sc. Engg. in CSE|Day": { label: "B. Sc. in CSE", rules: [[27,30,9380,1440],[31,32,9380,1550],[33,38,9380,1650],[39,49,9380,1900],[50,50,12500,1900],[51,51,8350,2200],[52,52,9430,3050],[53,53,8380,3050],[54,54,8980,3050],[55,55,8380,3050],[56,56,9850,3350],[57,57,9380,3350]] },
  "B.Sc. Engg. in CSE (DH)|Evening": { label: "B. Sc. in CSE", rules: [[24,29,9380,1070],[30,32,9380,1250],[33,41,9380,1150],[42,42,10730,1350],[43,43,11930,1350],[44,44,8380,1400],[45,45,9430,1400],[46,46,10060,1400],[47,47,8980,1400],[48,48,9430,1400],[49,49,9850,1550],[50,50,9380,1550]] },
  "B.Sc. in Data Science and Engineering|Day": { label: "B. Sc. in DSE", rules: [[1,1,10600,3350]] },
  "B.Sc. Engg. in EEE|Day": { label: "B. Sc. in EEE", rules: [[7,15,9850,1440],[16,17,9850,1550],[18,23,9850,1650],[24,34,9850,1900],[35,35,13250,1900],[36,36,8850,2000],[37,37,9960,2600],[38,38,8850,2700],[39,39,9480,2700],[40,40,8850,2700],[41,41,10340,2950],[42,42,9850,2950]] },
  "B.Sc. Engg. in EEE (DH)|Evening": { label: "B. Sc. in EEE", rules: [[16,17,9850,1460],[18,23,9850,1550],[24,26,9850,1780],[27,27,9850,1300],[28,35,9850,1150],[36,36,10730,1350],[37,37,5960,1350],[38,38,8850,1400],[39,39,9960,1400],[40,40,10620,1400],[41,41,9480,1400],[42,42,9960,1400],[43,43,10340,1550],[44,44,9850,1550]] },
  "B.Sc. in Textile Engineering|Day": { label: "B. Sc. in Textile Engineering", rules: [[8,11,10250,1530],[12,15,10250,1700],[16,17,10250,1830],[18,23,10250,1950],[24,34,10250,2225],[35,35,13850,2225],[36,36,9250,2000],[37,37,10410,2300],[38,38,9250,2300],[39,39,9910,2300],[40,40,9250,2300],[41,41,10760,2500],[42,42,10250,2500]] },
  "B.Sc. in Textile Engineering (DH)|Evening": { label: "B. Sc. in Textile Engineering", rules: [[16,18,8580,950],[19,21,8580,1000],[22,25,8580,1165],[26,33,8580,1150],[34,34,10730,1350],[35,35,5960,1350],[36,36,9250,1400],[37,37,10410,1400],[38,38,9250,1400],[39,39,9910,1400],[40,40,9250,1400],[41,41,9010,1550],[42,42,8580,1550]] },
  "B.Sc. in Civil Engineering|Day": { label: "B. Sc. in Civil Engineering", rules: [[1,4,9380,2000],[5,5,8540,2000],[6,6,5720,2000],[7,7,9430,2350],[8,8,8380,2350],[9,9,8980,2350],[10,10,8380,2350],[11,11,9850,2550],[12,12,9380,2550]] },
  "B.Sc. in Civil Engineering (DH)|Evening": { label: "B. Sc. in Civil Engineering", rules: [[1,4,9380,1350],[5,5,8340,1350],[6,6,5580,1350],[7,7,9430,1400],[8,8,8380,1400],[9,9,8980,1400],[10,10,8380,1400],[11,11,9850,1550],[12,12,9380,1550]] },
  "BBA|Day": { label: "BBA", rules: [[26,29,8220,1700],[30,37,8220,2125],[38,39,8220,2285],[40,45,8220,2450],[46,56,8220,2775],[57,57,9200,2775],[58,58,9050,2775],[59,59,8940,2775],[60,60,5410,3050],[61,61,6490,3050],[62,62,7220,3050],[63,63,7730,3050],[64,64,7220,3050],[65,65,8630,3350],[66,66,8220,3350]] },
  "BA (Hons.) in English|Day": { label: "B.A (Hon's) in English", rules: [[37,42,8050,1200],[43,52,8050,1400],[53,54,8050,1600],[55,55,9060,1800],[56,56,8810,1800],[57,57,7050,2200],[58,58,7930,2200],[59,59,7050,2200],[60,60,7550,2200],[61,61,7050,2200],[62,62,8450,2400],[63,63,8050,2400]] },
  "B.Sc. (Hons.) in Economics|Day": { label: "B.Sc (Hon's) in Economics", rules: [[24,29,8220,1000],[30,40,8220,1175],[41,41,10730,1175],[42,42,10350,1350],[43,43,10060,1350],[44,44,5410,1775],[45,45,6490,1775],[46,46,7220,1775],[47,47,6760,1775],[48,48,7220,1775],[49,49,7840,1950],[50,50,8220,1950]] },
  "LL.B. (Hons.)|Day": { label: "LL.B (Hon's)", rules: [[29,31,10570,950],[32,34,10570,1000],[35,37,10570,1175],[38,39,7034,1175],[40,40,10570,1175],[41,41,9400,1450],[42,42,8810,1450],[43,43,10570,1450],[44,44,9870,1450],[45,45,9400,1750],[46,46,10570,1750],[47,47,10070,1750],[48,48,9690,1750],[49,50,10580,3000],[51,53,10580,3200],[54,55,12080,3650]] },
};

const BBA_VARIANTS = new Set(["BBA in Accounting", "BBA in Finance", "BBA in Management", "BBA in Marketing"]);
const SINGLE_SCHEDULE_PROGRAMS = new Set(["BBA", ...BBA_VARIANTS, "BA (Hons.) in English", "B.Sc. (Hons.) in Economics", "LL.B. (Hons.)"]);

function normalizeIntake(value) {
  const match = String(value || "").match(/\d+/);
  return match ? Number(match[0]) : null;
}

function keyFor(program, shift) {
  const normalizedProgram = BBA_VARIANTS.has(program) ? "BBA" : program;
  const normalizedShift = SINGLE_SCHEDULE_PROGRAMS.has(normalizedProgram) ? "Day" : (shift === "Evening" ? "Evening" : "Day");
  return `${normalizedProgram}|${normalizedShift}`;
}

function resolveSelfStudyFee({ program, shift, intake }) {
  const intakeNumber = normalizeIntake(intake);
  const schedule = schedules[keyFor(String(program || "").trim(), shift)];
  if (!schedule || !intakeNumber) return null;
  const rule = schedule.rules.find(([from, to]) => intakeNumber >= from && intakeNumber <= to);
  if (!rule) return null;
  return {
    program: schedule.label,
    intake: intakeNumber,
    semesterCharge: rule[2],
    tuitionFeePerCredit: rule[3],
  };
}

module.exports = { resolveSelfStudyFee, normalizeIntake };
