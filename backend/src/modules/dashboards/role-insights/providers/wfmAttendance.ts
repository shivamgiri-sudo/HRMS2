import type { InsightProvider } from "../types.js";
import { absconderSection, attendanceKpiSection } from "./wfmParts/trends.js";
import { integrityQueue, regularizationQueues } from "./wfmParts/queues.js";
import { issueTypesSection, anomalySection, coverageSection, cosecSection, lateRulesSection, missedPunchSection, punchPipelineSection } from "./wfmAttendanceParts/integrity.js";
import { correctionQueueSection, integrityHealthSection, payrollLockSection } from "./wfmAttendanceParts/corrections.js";

/**
 * WFM_ATTENDANCE_DASHBOARD insights: the data-integrity desk. Where WFM_DASHBOARD asks "is the floor staffed",
 * this asks "can we trust the attendance record": punch pipeline, missed punches, correction ageing,
 * biometric coverage, COSEC health, abscond risk and the payroll-lock countdown. Each section is isolated.
 */
const provider: InsightProvider = {
  sections: {
    health: integrityHealthSection,
    attendance: attendanceKpiSection,
    punchPipeline: punchPipelineSection,
    missedPunch: missedPunchSection,
    anomalies: anomalySection,
    coverage: coverageSection,
    cosec: cosecSection,
    lateRules: lateRulesSection,
    corrections: correctionQueueSection,
    regularizations: regularizationQueues,
    integrity: integrityQueue,
    issueTypes: issueTypesSection,
    payrollLock: payrollLockSection,
    absconders: absconderSection,
  },
};

export default provider;
