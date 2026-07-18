import { db } from '../../db/mysql.js';
import { RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { getPolicyValue } from '../policy-engine/policy-engine.cache.js';
import PDFDocument from 'pdfkit';
import { Readable } from 'stream';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { emailService } from '../communication/email.service.js';

/**
 * Offer Letter Generation Service
 * Generates professional offer letters for selected candidates
 */

export interface OfferLetterTemplate {
  id: string;
  template_name: string;
  template_type: 'full_time' | 'part_time' | 'contract' | 'internship';
  subject_line: string;
  body_template: string;
  variables: string[];
  active_status: boolean;
}

export interface OfferLetterData {
  candidate_id: string;
  candidate_name: string;
  candidate_email: string;
  candidate_mobile: string;
  applied_for_role: string;
  department: string;
  branch_name: string;
  joining_date: string;
  salary_gross: number;
  salary_basic: number;
  salary_hra: number;
  salary_other_allowances: number;
  reporting_manager?: string;
  working_hours?: string;
  probation_period?: number; // in months
  notice_period?: number; // in days
}

export interface OfferLetter {
  id: string;
  candidate_id: string;
  offer_date: string;
  joining_date: string;
  position: string;
  department: string;
  salary_gross: number;
  salary_ctc: number;
  template_id?: string;
  pdf_path?: string;
  sent_at?: string;
  accepted_at?: string;
  declined_at?: string;
  status: 'draft' | 'sent' | 'accepted' | 'declined' | 'expired';
  expires_at?: string;
}

interface CandidateRow extends RowDataPacket {
  id: string;
  candidate_id?: string;
}

interface SalaryRow extends RowDataPacket {
  pf_employee?: number | null;
  esic_employee?: number | null;
  gross_salary: number;
  basic_salary: number;
  hra: number;
  other_allowances?: number | null;
}

interface OfferRow extends RowDataPacket {
  candidate_id: string;
  full_name: string;
  position: string;
  department: string;
  joining_date: string;
  salary_gross: number;
  email: string;
}

interface PendingOfferRow extends RowDataPacket {
  id: string;
  candidate_name: string;
  candidate_code: string;
  mobile: string;
  email: string;
}

/**
 * Get offer letter templates
 */
export async function getOfferTemplates(): Promise<OfferLetterTemplate[]> {
  const [results] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM ats_offer_letter_templates WHERE active_status = 1 ORDER BY created_at DESC`
  );

  return results as OfferLetterTemplate[];
}

/**
 * Generate offer letter for candidate
 */
export async function generateOfferLetter(data: OfferLetterData, templateId?: string): Promise<{
  success: boolean;
  offer_letter_id: string;
  pdf_url?: string;
}> {
  const conn = await db.getConnection();

  try {
    await conn.beginTransaction();

    // Get candidate details
    const [candidateRes] = await conn.execute<CandidateRow[]>(
      'SELECT * FROM ats_candidate WHERE id = ?',
      [data.candidate_id]
    );

    if (candidateRes.length === 0) {
      throw new Error('Candidate not found');
    }

    const candidate = candidateRes[0];

    // Get salary details from payroll validation
    const [salaryRes] = await conn.execute<SalaryRow[]>(
      `SELECT * FROM ats_payroll_hr_validation
       WHERE candidate_id = ? AND validation_status = 'approved'
       ORDER BY created_at DESC LIMIT 1`,
      [data.candidate_id]
    );

    if (salaryRes.length === 0) {
      throw new Error('Salary details not found. Please complete payroll validation first.');
    }

    const salary = salaryRes[0];

    // Calculate CTC (add employer contributions)
    const pfEmployer = salary.pf_employee || 0;
    const esicEmployer = salary.esic_employee || 0;
    const ctc = salary.gross_salary + pfEmployer + esicEmployer;

    // Create offer letter record
    const [offerRes] = await conn.execute<ResultSetHeader>(
      `INSERT INTO ats_offer_letters (
        candidate_id, offer_date, joining_date, position, department,
        branch_name, salary_gross, salary_ctc, salary_basic, salary_hra,
        salary_other_allowances, template_id, status, expires_at
      ) VALUES (?, NOW(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', DATE_ADD(NOW(), INTERVAL 7 DAY))`,
      [
        data.candidate_id,
        data.joining_date,
        data.applied_for_role,
        data.department || 'Operations',
        data.branch_name,
        salary.gross_salary,
        ctc,
        salary.basic_salary,
        salary.hra,
        salary.other_allowances || 0,
        templateId || null,
      ]
    );

    const offerId = offerRes.insertId.toString();

    // Resolve offer defaults from policy engine (fallback to static defaults)
    const [defaultProbation, defaultNotice] = await Promise.all([
      getPolicyValue("ats", "offer_defaults", "probation_period_months", "3"),
      getPolicyValue("ats", "offer_defaults", "notice_period_days", "30"),
    ]);
    const enrichedData = {
      ...data,
      probation_period: data.probation_period ?? Number(defaultProbation),
      notice_period:    data.notice_period    ?? Number(defaultNotice),
    };

    // Generate PDF
    const pdfBuffer = await generateOfferLetterPDF({
      ...enrichedData,
      salary_gross: salary.gross_salary,
      salary_ctc: ctc,
      salary_basic: salary.basic_salary,
      salary_hra: salary.hra,
      offer_letter_id: offerId,
    });

    // Save PDF to local filesystem under uploads/offers/
    const uploadsDir = path.resolve('uploads', 'offers');
    fs.mkdirSync(uploadsDir, { recursive: true });
    const pdfPath = path.join(uploadsDir, `${offerId}.pdf`);
    fs.writeFileSync(pdfPath, pdfBuffer);

    // Update with PDF path
    await conn.execute(
      'UPDATE ats_offer_letters SET pdf_path = ? WHERE id = ?',
      [pdfPath, offerId]
    );

    // Update candidate stage
    await conn.execute(
      'UPDATE ats_candidate SET current_stage = ? WHERE id = ?',
      ['offer_pending', data.candidate_id]
    );

    await conn.commit();

    return {
      success: true,
      offer_letter_id: offerId,
      pdf_url: pdfPath,
    };
  } catch (error: unknown) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

/**
 * Generate PDF for offer letter
 */
async function generateOfferLetterPDF(data: OfferLetterData & {
  salary_ctc: number;
  offer_letter_id: string;
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50 });
      const buffers: Buffer[] = [];

      doc.on('data', buffers.push.bind(buffers));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', reject);

      // Company Header
      doc.fontSize(20).font('Helvetica-Bold').text('Mas Callnet India Pvt. Ltd.', { align: 'center' });
      doc.fontSize(10).font('Helvetica').text('Corporate Office: Mumbai, India', { align: 'center' });
      doc.moveDown(2);

      // Date
      doc.fontSize(10).text(`Date: ${new Date().toLocaleDateString('en-IN')}`, { align: 'right' });
      doc.moveDown(1);

      // Candidate Address
      doc.fontSize(10).font('Helvetica-Bold').text(data.candidate_name);
      doc.font('Helvetica').text(data.candidate_email);
      doc.text(data.candidate_mobile);
      doc.moveDown(2);

      // Subject
      doc.fontSize(11).font('Helvetica-Bold').text('Subject: Offer of Employment', { underline: true });
      doc.moveDown(1);

      // Salutation
      doc.fontSize(10).font('Helvetica').text(`Dear ${data.candidate_name},`);
      doc.moveDown(1);

      // Body
      doc.text(
        `We are pleased to offer you the position of ${data.applied_for_role} at Mas Callnet India Pvt. Ltd. ` +
        `We believe that your skills and experience will be valuable assets to our team.`,
        { align: 'justify' }
      );
      doc.moveDown(1);

      doc.text('The terms and conditions of your employment are as follows:', { align: 'justify' });
      doc.moveDown(1);

      // Terms Table
      const terms = [
        ['Position', data.applied_for_role],
        ['Department', data.department || 'Operations'],
        ['Branch', data.branch_name],
        ['Date of Joining', new Date(data.joining_date).toLocaleDateString('en-IN')],
        ['Probation Period', `${data.probation_period} months`],
        ['Notice Period', `${data.notice_period} days`],
        ['Working Hours', data.working_hours || '9 AM - 6 PM (Monday to Friday)'],
      ];

      terms.forEach(([label, value]) => {
        doc.font('Helvetica-Bold').text(`${label}: `, { continued: true });
        doc.font('Helvetica').text(value);
      });

      doc.moveDown(2);

      // Compensation
      doc.fontSize(11).font('Helvetica-Bold').text('Compensation:', { underline: true });
      doc.moveDown(0.5);

      const formatINR = (amount: number) =>
        new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount);

      doc.fontSize(10).font('Helvetica');
      doc.text(`Gross Salary: ${formatINR(data.salary_gross)} per month`);
      doc.text(`Cost to Company (CTC): ${formatINR(data.salary_ctc)} per annum`);
      doc.moveDown(1);

      doc.text('Salary Breakdown:', { underline: true });
      doc.text(`  • Basic Salary: ${formatINR(data.salary_basic)}`);
      doc.text(`  • HRA: ${formatINR(data.salary_hra)}`);
      doc.text(`  • Other Allowances: ${formatINR(data.salary_other_allowances)}`);
      doc.moveDown(2);

      // Closing
      doc.text(
        'This offer is contingent upon successful completion of background verification and submission of all required documents.',
        { align: 'justify' }
      );
      doc.moveDown(1);

      doc.text(
        'Please confirm your acceptance of this offer by signing and returning a copy of this letter by ' +
        new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toLocaleDateString('en-IN') + '.',
        { align: 'justify' }
      );
      doc.moveDown(2);

      doc.text('We look forward to welcoming you to our team!');
      doc.moveDown(2);

      doc.text('Sincerely,');
      doc.moveDown(2);

      doc.font('Helvetica-Bold').text('HR Department');
      doc.font('Helvetica').text('Mas Callnet India Pvt. Ltd.');

      // Footer
      doc.moveDown(4);
      doc.fontSize(8).text('_____________________', { align: 'center' });
      doc.text('Candidate Signature & Date', { align: 'center' });

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Send offer letter via email
 */
export async function sendOfferLetter(offerId: string): Promise<{
  success: boolean;
  message: string;
}> {
    const [offerRes] = await db.execute<OfferRow[]>(
    `SELECT ol.*, c.full_name, c.email, c.mobile
     FROM ats_offer_letters ol
     JOIN ats_candidate c ON c.id = ol.candidate_id
     WHERE ol.id = ?`,
    [offerId]
  );

  if (offerRes.length === 0) {
    throw new Error('Offer letter not found');
  }

  const offer = offerRes[0];

  // Update status
  await db.execute(
    'UPDATE ats_offer_letters SET status = ?, sent_at = NOW() WHERE id = ?',
    ['sent', offerId]
  );

  // Update candidate stage
  await db.execute(
    'UPDATE ats_candidate SET current_stage = ? WHERE id = ?',
    ['offer_pending', offer.candidate_id]
  );

  // Send offer notification email via emailService
  if (emailService.isConfigured()) {
    const html = `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
  <h2 style="color: #1a3c5e;">Offer of Employment — Mas Callnet India Pvt. Ltd.</h2>
  <p>Dear ${offer.full_name},</p>
  <p>We are pleased to offer you the position of <strong>${offer.position}</strong> at Mas Callnet India Pvt. Ltd.</p>
  <table style="width:100%; border-collapse: collapse; margin: 16px 0;">
    <tr style="background:#f5f5f5;"><td style="padding:8px; border:1px solid #ddd;"><strong>Position</strong></td><td style="padding:8px; border:1px solid #ddd;">${offer.position}</td></tr>
    <tr><td style="padding:8px; border:1px solid #ddd;"><strong>Department</strong></td><td style="padding:8px; border:1px solid #ddd;">${offer.department}</td></tr>
    <tr style="background:#f5f5f5;"><td style="padding:8px; border:1px solid #ddd;"><strong>Date of Joining</strong></td><td style="padding:8px; border:1px solid #ddd;">${new Date(offer.joining_date).toLocaleDateString('en-IN')}</td></tr>
    <tr><td style="padding:8px; border:1px solid #ddd;"><strong>Gross Salary</strong></td><td style="padding:8px; border:1px solid #ddd;">₹${Number(offer.salary_gross).toLocaleString('en-IN')} per month</td></tr>
  </table>
  <p>Please report to HR to collect your official offer letter document and complete joining formalities.</p>
  <p style="color: #666; font-size: 12px;">This is an automated notification. Please do not reply to this email.</p>
</div>`;

    await emailService.send({
      to: offer.email,
      subject: 'Offer of Employment — Mas Callnet India Pvt. Ltd.',
      html,
      text: `Dear ${offer.full_name}, we are pleased to offer you the position of ${offer.position}. Please report to HR to collect your official offer letter and complete joining formalities.`,
    });
  }

  return {
    success: true,
    message: 'Offer letter sent successfully',
  };
}

/**
 * Accept offer letter
 */
export async function acceptOfferLetter(offerId: string): Promise<{
  success: boolean;
  message: string;
}> {
  const conn = await db.getConnection();

  try {
    await conn.beginTransaction();

    const [offerRes] = await conn.execute<OfferRow[]>(
      'SELECT * FROM ats_offer_letters WHERE id = ?',
      [offerId]
    );

    if (offerRes.length === 0) {
      throw new Error('Offer letter not found');
    }

    const offer = offerRes[0];

    // Update offer status
    await conn.execute(
      'UPDATE ats_offer_letters SET status = ?, accepted_at = NOW() WHERE id = ?',
      ['accepted', offerId]
    );

    // Update candidate stage
    await conn.execute(
      'UPDATE ats_candidate SET current_stage = ? WHERE id = ?',
      ['offer_accepted', offer.candidate_id]
    );

    await conn.commit();

    return {
      success: true,
      message: 'Offer letter accepted successfully',
    };
  } catch (error: unknown) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

/**
 * Get offer letters for candidate
 */
export async function getCandidateOfferLetters(candidateId: string): Promise<OfferLetter[]> {
  const [results] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM ats_offer_letters WHERE candidate_id = ? ORDER BY created_at DESC`,
    [candidateId]
  );

  return results as OfferLetter[];
}

/**
 * Get all pending offers
 */
export async function getPendingOffers(): Promise<PendingOfferRow[]> {
  const [results] = await db.execute<PendingOfferRow[]>(
    `SELECT
      ol.*,
      c.full_name as candidate_name,
      c.candidate_id as candidate_code,
      c.mobile,
      c.email
    FROM ats_offer_letters ol
    JOIN ats_candidate c ON c.id = ol.candidate_id
    WHERE ol.status IN ('draft', 'sent')
    AND ol.expires_at > NOW()
    ORDER BY ol.created_at DESC`
  );

  return results;
}
