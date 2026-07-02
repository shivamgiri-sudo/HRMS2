import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const failures = [];
const passes = [];

function read(path) {
  const abs = resolve(root, path);
  if (!existsSync(abs)) {
    failures.push(`${path} is missing`);
    return "";
  }
  return readFileSync(abs, "utf8");
}

function assertFile(path) {
  if (existsSync(resolve(root, path))) passes.push(`file: ${path}`);
  else failures.push(`file missing: ${path}`);
}

function assertIncludes(path, needle, label = needle) {
  const content = read(path);
  if (content.includes(needle)) passes.push(`${path}: ${label}`);
  else failures.push(`${path}: missing ${label}`);
}

function assertAny(path, needles, label) {
  const content = read(path);
  if (needles.some((needle) => content.includes(needle))) passes.push(`${path}: ${label}`);
  else failures.push(`${path}: missing ${label}`);
}

[
  "backend/src/modules/ats/bgv-verification.routes.ts",
  "backend/src/modules/ats/payroll-hr.routes.ts",
  "backend/src/modules/ats/branch-head-approval.routes.ts",
  "backend/src/modules/it-provisioning/it-provisioning.routes.ts",
  "backend/src/modules/auth/auth.routes.ts",
  "backend/sql/265_ats_lifecycle_alignment.sql",
  "backend/sql/266_hrms2_security_lifecycle_stabilization.sql",
  "backend/sql/267_lifecycle_completion_surfaces.sql",
  "docs/HRMS2_LIFECYCLE_ALIGNMENT.md",
  "docs/HRMS2_PHASE2_IMPLEMENTATION_REPORT.md",
  "docs/HRMS2_SMOKE_TEST_GUIDE.md",
].forEach(assertFile);

[
  "/ats/bgv",
  "/ats/bgv-report",
  "/ats/payroll-hr",
  "/ats/offer-approvals",
  "/provisioning/wfm-alignment",
  "/provisioning/it",
  "/provisioning/admin",
  "/provisioning/appointment-letter",
  "/two-factor",
].forEach((route) => assertIncludes("src/App.tsx", `path="${route}"`, `route ${route}`));

[
  '"/candidates"',
  '"/status/:candidateId"',
  '"/trigger/:candidateId"',
  '"/retry/:candidateId/:checkType"',
  '"/manual-feedback/:candidateId/:checkType"',
  '"/name-match/:candidateId/override"',
].forEach((endpoint) => assertIncludes("backend/src/modules/ats/bgv-verification.routes.ts", endpoint, `BGV endpoint ${endpoint}`));

[
  "'/validated-candidates'",
  "'/salary-slabs'",
  "'/validate-slab'",
  "'/salary-proposal'",
  "'/submit-offer'",
].forEach((endpoint) => assertIncludes("backend/src/modules/ats/payroll-hr.routes.ts", endpoint, `Payroll HR endpoint ${endpoint}`));

[
  "'/tasks'",
  "'/tasks/:id/complete'",
  "'/tasks/:id/waive'",
  "'/tasks/:id/block'",
  "'/appointment-letters'",
  "'/appointment-letters/:id/send'",
  "'/appointment-letters/:id/aadhaar-signed'",
  "'/appointment-letters/:id/company-signed'",
  "'/appointment-letters/:id/complete'",
].forEach((endpoint) => assertIncludes("backend/src/modules/it-provisioning/it-provisioning.routes.ts", endpoint, `Provisioning endpoint ${endpoint}`));

[
  "WFM_PROCESS_ALIGNMENT",
  "IT_EMAIL_DOMAIN_ASSET",
  "ADMIN_BIOMETRIC_ID_CARD",
  "APPOINTMENT_LETTER_ESIGN",
].forEach((taskCode) => {
  assertIncludes("backend/src/modules/it-provisioning/it-provisioning.service.ts", taskCode, `task creation ${taskCode}`);
  assertIncludes("src/pages/NativeITProvisioningTracker.tsx", taskCode, `queue label ${taskCode}`);
});

[
  "265_ats_lifecycle_alignment.sql",
  "266_hrms2_security_lifecycle_stabilization.sql",
  "267_lifecycle_completion_surfaces.sql",
].forEach((migration) => assertIncludes("backend/src/db/runPendingMigrations.ts", migration, `migration registered ${migration}`));

assertIncludes("backend/src/modules/ats/bgv.enhanced.service.ts", "name_match", "BGV name-match logic");
assertIncludes("backend/sql/266_hrms2_security_lifecycle_stabilization.sql", "name_match", "BGV name-match schema");
assertIncludes("backend/sql/267_lifecycle_completion_surfaces.sql", "salary_exception_proposal", "salary proposal schema");
assertIncludes("backend/sql/267_lifecycle_completion_surfaces.sql", "appointment_letter_request", "appointment letter schema");
assertIncludes("backend/src/modules/ats/branch-head-approval.service.ts", "payroll_correction_requested", "branch rejection correction stage");
assertIncludes("backend/src/modules/ats/branch-head-approval.service.ts", "salary_exception_proposal", "branch salary proposal action");
assertAny("backend/src/modules/auth/auth.routes.ts", ['"/2fa/send"', "'/2fa/send'"], "2FA send endpoint");
assertAny("backend/src/modules/auth/auth.routes.ts", ['"/2fa/verify"', "'/2fa/verify'"], "2FA verify endpoint");
assertIncludes("src/pages/TwoFactor.tsx", "verifyTwoFactorCode", "2FA frontend verify call");

if (failures.length) {
  console.error("HRMS2 static smoke failed");
  for (const failure of failures) console.error(`FAIL ${failure}`);
  process.exit(1);
}

console.log("HRMS2 static smoke passed");
for (const pass of passes) console.log(`PASS ${pass}`);
