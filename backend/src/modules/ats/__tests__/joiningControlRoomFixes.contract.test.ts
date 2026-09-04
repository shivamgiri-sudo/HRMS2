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
