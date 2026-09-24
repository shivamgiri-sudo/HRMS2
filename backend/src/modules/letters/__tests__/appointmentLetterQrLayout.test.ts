import { describe, expect, it } from "vitest";
import QRCode from "qrcode";
import { PDFParse } from "pdf-parse";
import { PDFDocument } from "pdf-lib";
import {
  COMPANY_TEXT_MAX_WIDTH,
  ESIGN_BOX,
  PROVIDER_STAMP_RECT_PDF,
  QR_BLOCK_RECT,
  QR_RECT,
  RESERVE,
  pdfRectToTopLeft,
  renderAppointmentLetterPdf,
  type AppointmentLetterInput,
  type TopLeftRect,
} from "../appointmentLetterPdf.service.js";

/** A4 in PDF points, as pdfkit sizes it. */
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const COMPANY_TEXT_LEFT = 56;

const intersects = (a: TopLeftRect, b: TopLeftRect) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

describe("appointment letter QR layout (pdfkit top-left space)", () => {
  const stamp = pdfRectToTopLeft(PROVIDER_STAMP_RECT_PDF, PAGE_H);

  it("converts the provider's bottom-left rect into a foot strip", () => {
    expect(stamp).toEqual({ x: 425, y: PAGE_H - 160, w: 120, h: 60 });
  });

  it("does not intersect the eSign box or its label", () => {
    expect(intersects(QR_RECT, ESIGN_BOX)).toBe(false);
    expect(intersects(QR_BLOCK_RECT, ESIGN_BOX)).toBe(false);
  });

  it("does not intersect the provider stamp rect under either reading of its origin", () => {
    // Correct reading: native PDF space, bottom-left origin.
    expect(intersects(QR_BLOCK_RECT, stamp)).toBe(false);
    // Literal reading (numbers used as top-left coordinates) — the box used to sit there.
    const literal: TopLeftRect = { x: 425, y: 100, w: 120, h: 60 };
    expect(intersects(QR_BLOCK_RECT, literal)).toBe(false);
  });

  it("lies inside the page and above the reserved foot band", () => {
    expect(QR_BLOCK_RECT.x).toBeGreaterThanOrEqual(0);
    expect(QR_BLOCK_RECT.x + QR_BLOCK_RECT.w).toBeLessThanOrEqual(PAGE_W);
    expect(QR_BLOCK_RECT.y).toBeGreaterThanOrEqual(0);
    expect(QR_BLOCK_RECT.y + QR_BLOCK_RECT.h).toBeLessThanOrEqual(PAGE_H - RESERVE.band);
  });

  it("stays clear of the company signer text column", () => {
    expect(QR_BLOCK_RECT.x).toBeGreaterThanOrEqual(COMPANY_TEXT_LEFT + COMPANY_TEXT_MAX_WIDTH);
  });

  it("is roughly 72-80pt square", () => {
    expect(QR_RECT.w).toBe(QR_RECT.h);
    expect(QR_RECT.w).toBeGreaterThanOrEqual(72);
    expect(QR_RECT.w).toBeLessThanOrEqual(80);
  });
});

describe("appointment letter renders with the relocated QR", () => {
  const zero = 0;
  const input = async (): Promise<AppointmentLetterInput> => ({
    employeeName: "Test Employee",
    employeeCode: "MAS00001",
    designation: "Executive",
    dateOfJoining: "2026-09-01",
    salaryStartDate: "2026-09-01",
    letterNumber: "APL-TEST-0001",
    verificationUrl: "https://mcnhrms.teammas.in/verify/appointment/TESTTOKEN",
    qrPngDataUrl: await QRCode.toDataURL("https://mcnhrms.teammas.in/verify/appointment/TESTTOKEN", { width: 220, margin: 1 }),
    letterhead: {
      branchId: null, branchName: "Test Branch", addressLines: ["1 Test Road"],
      city: "Noida", state: "UP", hrContact: "", hasAddress: true,
    },
    salary: {
      basic: 10000, hra: 4000, lta: zero, conveyance: 1600, otherAllowance: zero,
      specialAllowance: zero, bonus: zero, medicalAllowance: zero, portfolio: zero, pli: zero,
      gross: 15600, esicEmployee: zero, epfEmployee: 1200, netSalary: 14400,
      esicEmployer: zero, epfEmployer: 1200, adminCharges: 100, ctc: 16900,
      source: "payroll_head_approved_package", sourceRef: null, approvedBy: null, approvedAt: null,
      packageEffectiveFrom: null, pfApplicable: true, esicApplicable: false, unavailableLines: [],
    },
    signerName: "Authorised Signatory",
    signerDesignation: "Director",
  });

  it("produces a PDF whose signature page keeps the eSign label and adds the QR caption", async () => {
    const bytes = await renderAppointmentLetterPdf(await input());
    expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(5000);

    const pageCount = (await PDFDocument.load(bytes)).getPageCount();
    const parser = new PDFParse({ data: new Uint8Array(bytes) });
    const last = await parser.getText({ partial: [pageCount] });
    await parser.destroy();
    expect(last.text).toContain("Aadhaar eSign area");
    expect(last.text).toContain("Scan to verify this letter");
    expect(last.text).toContain("Verify: https://mcnhrms.teammas.in/verify/appointment/TESTTOKEN");
  });

  it("omits the QR caption when there is no QR", async () => {
    const bytes = await renderAppointmentLetterPdf({ ...(await input()), qrPngDataUrl: null });
    const parser = new PDFParse({ data: new Uint8Array(bytes) });
    const all = await parser.getText();
    await parser.destroy();
    expect(all.text).toContain("Aadhaar eSign area");
    expect(all.text).not.toContain("Scan to verify this letter");
  });
});
