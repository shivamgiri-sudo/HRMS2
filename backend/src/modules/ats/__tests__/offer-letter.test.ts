import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db } from '../../../db/mysql.js';
import {
  generateOfferLetter,
  sendOfferLetter,
  acceptOfferLetter,
  getCandidateOfferLetters,
  getPendingOffers,
} from '../offer-letter.service';

// Legacy destructive database suite. Run only after its fixtures are migrated to
// the current UUID-based ATS schema and an isolated integration database.
describe.skip('Offer Letter Service', () => {
  let testCandidateId: string;
  let testOfferId: string;

  beforeEach(async () => {
    // Create test candidate
    const [result] = await db.execute(
      `INSERT INTO ats_candidate (
        candidate_id, full_name, mobile, email, applied_for_role,
        applied_for_branch, branch_display_name, current_stage, active_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['TEST001', 'Test Candidate', '9999999999', 'test@example.com', 'Software Engineer', 'MUM', 'Mumbai', 'payroll_validated', 1]
    );
    testCandidateId = (result as any).insertId;

    // Create payroll validation record
    await db.execute(
      `INSERT INTO ats_payroll_hr_validation (
        candidate_id, gross_salary, basic_salary, hra, other_allowances,
        pf_employee, esic_employee, validation_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [testCandidateId, 50000, 25000, 12500, 12500, 1800, 750, 'approved']
    );
  });

  afterEach(async () => {
    // Cleanup
    if (testOfferId) {
      await db.execute('DELETE FROM ats_offer_letters WHERE id = ?', [testOfferId]);
    }
    if (testCandidateId) {
      await db.execute('DELETE FROM ats_payroll_hr_validation WHERE candidate_id = ?', [testCandidateId]);
      await db.execute('DELETE FROM ats_candidate WHERE id = ?', [testCandidateId]);
    }
  });

  describe('generateOfferLetter', () => {
    it('should generate offer letter with correct data', async () => {
      const result = await generateOfferLetter({
        candidate_id: testCandidateId,
        candidate_name: 'Test Candidate',
        candidate_email: 'test@example.com',
        candidate_mobile: '9999999999',
        applied_for_role: 'Software Engineer',
        department: 'Engineering',
        branch_name: 'Mumbai',
        joining_date: '2026-07-01',
        salary_gross: 50000,
        salary_basic: 25000,
        salary_hra: 12500,
        salary_other_allowances: 12500,
      });

      expect(result.success).toBe(true);
      expect(result.offer_letter_id).toBeDefined();
      testOfferId = result.offer_letter_id!;

      // Verify database record
      const [offers] = await db.execute(
        'SELECT * FROM ats_offer_letters WHERE id = ?',
        [testOfferId]
      );
      expect((offers as any[]).length).toBe(1);
      expect((offers as any[])[0].position).toBe('Software Engineer');
      expect((offers as any[])[0].status).toBe('draft');
    });

    it('should calculate CTC correctly', async () => {
      const result = await generateOfferLetter({
        candidate_id: testCandidateId,
        candidate_name: 'Test Candidate',
        candidate_email: 'test@example.com',
        candidate_mobile: '9999999999',
        applied_for_role: 'Software Engineer',
        department: 'Engineering',
        branch_name: 'Mumbai',
        joining_date: '2026-07-01',
        salary_gross: 50000,
        salary_basic: 25000,
        salary_hra: 12500,
        salary_other_allowances: 12500,
      });

      testOfferId = result.offer_letter_id!;

      const [offers] = await db.execute(
        'SELECT salary_ctc FROM ats_offer_letters WHERE id = ?',
        [testOfferId]
      );

      // CTC = gross + PF employer + ESIC employer
      // 50000 + 1800 + 750 = 52550 per month = 630600 per annum
      const expectedCTC = (50000 + 1800 + 750);
      expect((offers as any[])[0].salary_ctc).toBe(expectedCTC);
    });

    it('should update candidate stage to offer_pending', async () => {
      await generateOfferLetter({
        candidate_id: testCandidateId,
        candidate_name: 'Test Candidate',
        candidate_email: 'test@example.com',
        candidate_mobile: '9999999999',
        applied_for_role: 'Software Engineer',
        department: 'Engineering',
        branch_name: 'Mumbai',
        joining_date: '2026-07-01',
        salary_gross: 50000,
        salary_basic: 25000,
        salary_hra: 12500,
        salary_other_allowances: 12500,
      });

      const [candidates] = await db.execute(
        'SELECT current_stage FROM ats_candidate WHERE id = ?',
        [testCandidateId]
      );
      expect((candidates as any[])[0].current_stage).toBe('offer_pending');
    });

    it('should fail if salary not validated', async () => {
      // Create candidate without salary validation
      const [result] = await db.execute(
        `INSERT INTO ats_candidate (
          candidate_id, full_name, mobile, applied_for_role,
          applied_for_branch, current_stage, active_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ['TEST002', 'Test Candidate 2', '9999999998', 'Analyst', 'DEL', 'bgv_verified', 1]
      );
      const candidateId2 = (result as any).insertId;

      await expect(
        generateOfferLetter({
          candidate_id: candidateId2,
          candidate_name: 'Test Candidate 2',
          candidate_email: 'test2@example.com',
          candidate_mobile: '9999999998',
          applied_for_role: 'Analyst',
          department: 'Operations',
          branch_name: 'Delhi',
          joining_date: '2026-07-01',
          salary_gross: 40000,
          salary_basic: 20000,
          salary_hra: 10000,
          salary_other_allowances: 10000,
        })
      ).rejects.toThrow('Salary details not found');

      // Cleanup
      await db.execute('DELETE FROM ats_candidate WHERE id = ?', [candidateId2]);
    });
  });

  describe('sendOfferLetter', () => {
    beforeEach(async () => {
      const result = await generateOfferLetter({
        candidate_id: testCandidateId,
        candidate_name: 'Test Candidate',
        candidate_email: 'test@example.com',
        candidate_mobile: '9999999999',
        applied_for_role: 'Software Engineer',
        department: 'Engineering',
        branch_name: 'Mumbai',
        joining_date: '2026-07-01',
        salary_gross: 50000,
        salary_basic: 25000,
        salary_hra: 12500,
        salary_other_allowances: 12500,
      });
      testOfferId = result.offer_letter_id!;
    });

    it('should update status to sent', async () => {
      const result = await sendOfferLetter(testOfferId);

      expect(result.success).toBe(true);

      const [offers] = await db.execute(
        'SELECT status, sent_at FROM ats_offer_letters WHERE id = ?',
        [testOfferId]
      );
      expect((offers as any[])[0].status).toBe('sent');
      expect((offers as any[])[0].sent_at).not.toBeNull();
    });
  });

  describe('acceptOfferLetter', () => {
    beforeEach(async () => {
      const result = await generateOfferLetter({
        candidate_id: testCandidateId,
        candidate_name: 'Test Candidate',
        candidate_email: 'test@example.com',
        candidate_mobile: '9999999999',
        applied_for_role: 'Software Engineer',
        department: 'Engineering',
        branch_name: 'Mumbai',
        joining_date: '2026-07-01',
        salary_gross: 50000,
        salary_basic: 25000,
        salary_hra: 12500,
        salary_other_allowances: 12500,
      });
      testOfferId = result.offer_letter_id!;
      await sendOfferLetter(testOfferId);
    });

    it('should update status to accepted', async () => {
      const result = await acceptOfferLetter(testOfferId);

      expect(result.success).toBe(true);

      const [offers] = await db.execute(
        'SELECT status, accepted_at FROM ats_offer_letters WHERE id = ?',
        [testOfferId]
      );
      expect((offers as any[])[0].status).toBe('accepted');
      expect((offers as any[])[0].accepted_at).not.toBeNull();
    });

    it('should update candidate stage to offer_accepted', async () => {
      await acceptOfferLetter(testOfferId);

      const [candidates] = await db.execute(
        'SELECT current_stage FROM ats_candidate WHERE id = ?',
        [testCandidateId]
      );
      expect((candidates as any[])[0].current_stage).toBe('offer_accepted');
    });
  });

  describe('getCandidateOfferLetters', () => {
    it('should return all offers for candidate', async () => {
      // Generate two offers
      await generateOfferLetter({
        candidate_id: testCandidateId,
        candidate_name: 'Test Candidate',
        candidate_email: 'test@example.com',
        candidate_mobile: '9999999999',
        applied_for_role: 'Software Engineer',
        department: 'Engineering',
        branch_name: 'Mumbai',
        joining_date: '2026-07-01',
        salary_gross: 50000,
        salary_basic: 25000,
        salary_hra: 12500,
        salary_other_allowances: 12500,
      });

      const offers = await getCandidateOfferLetters(testCandidateId);

      expect(offers.length).toBeGreaterThanOrEqual(1);
      expect(offers[0].candidate_id).toBe(testCandidateId);
    });
  });

  describe('getPendingOffers', () => {
    it('should return only non-expired pending offers', async () => {
      const result = await generateOfferLetter({
        candidate_id: testCandidateId,
        candidate_name: 'Test Candidate',
        candidate_email: 'test@example.com',
        candidate_mobile: '9999999999',
        applied_for_role: 'Software Engineer',
        department: 'Engineering',
        branch_name: 'Mumbai',
        joining_date: '2026-07-01',
        salary_gross: 50000,
        salary_basic: 25000,
        salary_hra: 12500,
        salary_other_allowances: 12500,
      });
      testOfferId = result.offer_letter_id!;

      const pending = await getPendingOffers();

      expect(pending.length).toBeGreaterThanOrEqual(1);
      expect(pending.some(o => o.id === testOfferId)).toBe(true);
    });
  });
});
