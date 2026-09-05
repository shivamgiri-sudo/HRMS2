import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Six fixes from the same live incident (MAS63438, NISHU VERMA, 2026-09-04),
 * each pinned against the file it lives in.
 *
 * 1. Manual e-sign recheck. The background poller can leave a genuinely
 *    completed signature reading as pending for up to an hour (see
 *    esignReconciliationBudget.contract.test.ts for the backoff itself); this is
 *    the escape hatch that asks the provider immediately instead of waiting.
 * 2. JCLR is no longer a readiness blocker, on either side: the readiness
 *    computation and the JCLR-entry save both stop requiring
 *    jclr_approval_status, which read from a pre-offer table a candidate's real
 *    offer approval does not always populate.
 * 3. Salary register locks itself the moment Payroll HR validates — there was no
 *    button anywhere to do it manually, so every validated candidate sat
 *    permanently unlocked.
 * 4. A verified onboarding bank submission is copied into employee_bank_detail —
 *    the table payroll's NEFT export reads — both automatically at employee
 *    creation and via a manual action for employees created before this existed.
 * 5. A candidate's onboarding-portal DPDP consent is carried into
 *    dpdp_consent_register for the candidate_onboarding purpose only — never
 *    expanded into the other three purposes the register tracks separately.
 * 6. The Statutory tab's declaration-status suggestion defaults to "verified"
 *    when the candidate already accepted the declaration at onboarding, instead
 *    of always suggesting "pending" — still just a pre-save suggestion HR must
 *    confirm with Save.
 * 7. A "Resend signing link" action mints a fresh joining-kit token and re-mails
 *    it, for the population found stuck at Luckpay's own "never opened" state
 *    because the kit flow only ever emails the link once. The same fresh-link
 *    minting also now reaches the automated daily reminder, which previously
 *    never carried a link at all.
 */
const service = readFileSync(
  resolve(process.cwd(), 'src/modules/ats/joining-control-room.service.ts'),
  'utf8',
);
const routes = readFileSync(
  resolve(process.cwd(), 'src/modules/ats/joining-control-room.routes.ts'),
  'utf8',
);
const page = readFileSync(
  resolve(process.cwd(), '../src/pages/NativeJoiningControlRoom.tsx'),
  'utf8',
);
const kitDispatch = readFileSync(
  resolve(process.cwd(), 'src/modules/employees/joiningKitDispatch.service.ts'),
  'utf8',
);
const complianceWorker = readFileSync(
  resolve(process.cwd(), 'src/workers/esign-compliance.worker.ts'),
  'utf8',
);

describe('manual e-sign recheck', () => {
  it('exists as a route and calls the real provider sync, not a local guess', () => {
    expect(routes).toContain('/candidates/:candidateId/esign/recheck');
    expect(service).toContain('export async function recheckEsignStatus');
    expect(service).toContain('syncEsignStatus(String(row.client_transaction_id))');
  });

  it('checks every open transaction for the candidate, not just one', () => {
    const fn = service.slice(service.indexOf('export async function recheckEsignStatus'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    expect(body).toContain("status NOT IN ('signed', 'completed', 'failed', 'expired', 'cancelled', 'abandoned_unresolved')");
  });

  it('has a button on the page, not just an API a person cannot reach', () => {
    expect(page).toContain('esign/recheck');
    expect(page).toContain('Check e-sign status now');
  });
});

describe('JCLR is not a readiness blocker', () => {
  it('is absent from the blockers list computed by readinessBlockers', () => {
    const fn = service.slice(service.indexOf('function readinessBlockers'), service.indexOf('function readinessBlockers') + 1500);
    expect(fn).not.toContain('jclr_approval_status');
    expect(fn).not.toContain('BM / Branch Head JCLR approval is pending');
    expect(fn).not.toContain('Payroll HR JCLR entry is not complete');
  });

  it('does not gate the JCLR-entry save on the same broken approval column', () => {
    const fn = service.slice(service.indexOf('export async function saveJclrDetails'));
    const body = fn.slice(0, fn.indexOf('await db.execute'));
    // The column is legitimately named in the explanatory comment above the
    // removal; what must be gone is the CHECK — the throw that enforced it.
    expect(body).not.toContain('.toLowerCase() !== "approved"');
    expect(body).not.toContain('statusCode: 409');
  });

  it('does not disable the Save JCLR Entry button on the same column', () => {
    const button = page.slice(page.indexOf('Save JCLR Entry') - 300, page.indexOf('Save JCLR Entry'));
    expect(button).not.toContain('jclr_approval_status');
  });
});

describe('salary register auto-locks on payroll validation', () => {
  it('calls lockSalaryRegister from inside savePayrollControlRoomDetails', () => {
    const fn = service.slice(service.indexOf('export async function savePayrollControlRoomDetails'));
    const body = fn.slice(0, fn.indexOf('\nexport async function saveJclrDetails'));
    expect(body).toContain('await lockSalaryRegister(candidateId, actorId)');
  });

  it('never lets a failed auto-lock fail the save it rode in on', () => {
    const fn = service.slice(service.indexOf('export async function savePayrollControlRoomDetails'));
    const body = fn.slice(0, fn.indexOf('\nexport async function saveJclrDetails'));
    const lockCallAt = body.indexOf('await lockSalaryRegister(candidateId, actorId)');
    const catchAt = body.indexOf('.catch(', lockCallAt);
    expect(lockCallAt).toBeGreaterThan(-1);
    expect(catchAt).toBeGreaterThan(lockCallAt);
    expect(catchAt - lockCallAt).toBeLessThan(100);
  });
});

describe('bank details reach the store payroll pays from', () => {
  it('copies ciphertext directly rather than decrypting on this process', () => {
    const fn = service.slice(service.indexOf('export async function syncBankDetailFromOnboarding'));
    const body = fn.slice(0, fn.indexOf('\nexport async function generateEmployeeCode'));
    expect(body).toContain('account_no_encrypted');
    expect(body).toContain('account_number_enc');
    expect(body).not.toContain('decryptField');
    expect(body).not.toContain('encryptField');
  });

  it('requires the onboarding submission to be verified before copying it', () => {
    const fn = service.slice(service.indexOf('export async function syncBankDetailFromOnboarding'));
    const body = fn.slice(0, fn.indexOf('\nexport async function generateEmployeeCode'));
    expect(body).toContain('verification_status');
    expect(body).toContain('toLowerCase() !== "verified"');
  });

  it('never overwrites an existing active primary bank record', () => {
    const fn = service.slice(service.indexOf('export async function syncBankDetailFromOnboarding'));
    const body = fn.slice(0, fn.indexOf('\nexport async function generateEmployeeCode'));
    expect(body).toContain("WHERE employee_id = ? AND active_status = 1 AND is_primary = 1");
    expect(body.indexOf('existing')).toBeLessThan(body.indexOf('INSERT INTO employee_bank_detail'));
  });

  it('runs automatically at employee creation and is exposed as a manual action', () => {
    expect(service).toContain('await syncBankDetailFromOnboarding(result.employee_id, candidateId, actorId)');
    expect(routes).toContain('/candidates/:candidateId/bank-detail/sync');
    expect(page).toContain('bank-detail/sync');
  });
});

describe('DPDP consent carries over from onboarding, narrowly', () => {
  it('only ever grants the candidate_onboarding purpose, never the other three', () => {
    const fn = service.slice(service.indexOf('export async function syncDpdpConsentFromOnboarding'));
    const body = fn.slice(0, fn.indexOf('\nexport async function generateEmployeeCode'));
    expect(body).toContain("purpose_code: \"candidate_onboarding\"");
    expect(body).not.toContain('bgv_verification');
    expect(body).not.toContain('payroll_processing');
    expect(body).not.toContain('document_review');
  });

  it('never re-grants a purpose that already has a row', () => {
    const fn = service.slice(service.indexOf('export async function syncDpdpConsentFromOnboarding'));
    const body = fn.slice(0, fn.indexOf('\nexport async function generateEmployeeCode'));
    expect(body).toContain("SELECT 1 FROM dpdp_consent_register WHERE candidate_id = ? AND purpose_code = 'candidate_onboarding'");
    expect(body.indexOf('existing')).toBeLessThan(body.indexOf('upsertDpdpConsent('));
  });

  it('runs automatically at employee creation and is exposed as a manual action', () => {
    expect(service).toContain('await syncDpdpConsentFromOnboarding(candidateId, actorId)');
    expect(routes).toContain('/candidates/:candidateId/dpdp-consent/sync');
    expect(page).toContain('dpdp-consent/sync');
  });
});

describe('statutory declaration suggestion defaults to verified when the candidate self-certified', () => {
  it('only applies before any row is saved, and never overrides a saved decision', () => {
    const fn = page.slice(page.indexOf('function seedStatutoryForm'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    expect(body).toContain('firstFilled(row.declaration_status)');
    expect(body).toContain('!row.id && Number(p.statutory_declaration_accepted)');
  });
});

describe('resend signing link — never touches Luckpay, always mints a fresh token', () => {
  it('mints a new token rather than reusing the stored hash', () => {
    const fn = kitDispatch.slice(kitDispatch.indexOf('async function mintFreshKitSigningLink'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    expect(body).toContain("randomBytes(24).toString(\"hex\")");
    expect(body).toContain('INSERT INTO employee_joining_document_public_token');
    expect(body).not.toContain('luckpayClient');
    expect(body).not.toContain('esignWithUrl');
  });

  it('supersedes the previous active token so the reminder query never double-counts the kit', () => {
    const fn = kitDispatch.slice(kitDispatch.indexOf('async function mintFreshKitSigningLink'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    expect(body).toContain("SET token_status = 'superseded'");
    expect(body.indexOf("token_status = 'superseded'")).toBeLessThan(body.indexOf('INSERT INTO'));
  });

  it('refuses to resend a kit that is not currently awaiting a signature', () => {
    const fn = kitDispatch.slice(kitDispatch.indexOf('export async function resendKitEsignLink'));
    const body = fn.slice(0, fn.indexOf('\nexport async function autoRefreshKitLinkForReminder'));
    expect(body).toContain('String(kit.status) !== "sent"');
  });

  it('is reachable as a route and a button in the Joining Control Room', () => {
    expect(routes).toContain('/candidates/:candidateId/esign/resend-link');
    expect(service).toContain('export async function resendEsignLink');
    expect(page).toContain('esign/resend-link');
    expect(page).toContain('Resend signing link');
  });

  it('surfaces a real failure reason instead of the generic success toast', () => {
    const fn = routes.slice(routes.indexOf('/candidates/:candidateId/esign/resend-link'));
    const body = fn.slice(0, fn.indexOf('}));'));
    expect(body).toContain('if (!result.resent)');
    expect(body).toContain('res.status(409)');
  });
});

describe('the automated daily reminder can now carry a real link for kit-scoped items', () => {
  it('mints a fresh link for a kit item and passes it as the dispatch actionUrl', () => {
    expect(complianceWorker).toContain('import { autoRefreshKitLinkForReminder }');
    expect(complianceWorker).toContain('item.kit_id ? await autoRefreshKitLinkForReminder(String(item.kit_id)) : null');
    expect(complianceWorker).toContain('actionUrl: freshLink ?? ""');
  });

  it('leaves the per-document (non-kit) path unchanged — no link minted there', () => {
    const dispatchCall = complianceWorker.slice(
      complianceWorker.indexOf('const freshLink ='),
      complianceWorker.indexOf('reminders++;'),
    );
    // The ternary itself is the guard: null for anything without a kit_id.
    expect(dispatchCall).toContain('item.kit_id ?');
  });
});

describe('salary_component_assignments syncs from a locked salary register, never invented', () => {
  it('copies ats_payroll_hr_validation\'s own breakdown rather than deriving or estimating one', () => {
    const fn = service.slice(service.indexOf('export async function syncSalaryComponentFromValidation'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    expect(body).toContain('payroll.basic_salary');
    expect(body).toContain('payroll.hra');
    expect(body).toContain('payroll.conveyance');
    expect(body).toContain('payroll.special_allowance');
    // net_estimate is left NULL, not computed — no formula for it anywhere here.
    expect(body).toMatch(/NULL,\s*\?,\s*NOW\(\)/);
  });

  it('requires the register to actually be locked, not merely present', () => {
    const fn = service.slice(service.indexOf('export async function syncSalaryComponentFromValidation'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    expect(body).toContain('Number(payroll.salary_register_locked) !== 1');
  });

  it('never overwrites an existing active assignment', () => {
    const fn = service.slice(service.indexOf('export async function syncSalaryComponentFromValidation'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    expect(body).toContain("WHERE employee_id = ? AND status = 'active'");
    expect(body.indexOf('existing')).toBeLessThan(body.indexOf('INSERT INTO salary_component_assignments'));
  });

  it('runs automatically the moment a salary register locks', () => {
    const fn = service.slice(service.indexOf('export async function lockSalaryRegister'));
    const body = fn.slice(0, fn.indexOf('\nexport async function approveSalaryProposal'));
    expect(body).toContain('await syncSalaryComponentFromValidation(candidateId, actorId)');
  });
});
