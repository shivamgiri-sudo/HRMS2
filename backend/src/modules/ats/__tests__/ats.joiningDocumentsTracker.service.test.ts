import { parseKeyDocuments, calculateTrackerSummary, type EmployeeDocumentRow } from '../ats.joiningDocumentsTracker.service';

describe('parseKeyDocuments', () => {
  it('should parse valid key_documents_raw string', () => {
    const raw = 'APPOINTMENT_LETTER:uploaded_pending_review:null||ID_PROOF:completed:verified||BANK_DETAILS:pending_hr_upload:null';
    const result = parseKeyDocuments(raw);

    expect(result).toEqual([
      { code: 'APPOINTMENT_LETTER', status: 'uploaded_pending_review', verification_status: null },
      { code: 'ID_PROOF', status: 'completed', verification_status: 'verified' },
      { code: 'BANK_DETAILS', status: 'pending_hr_upload', verification_status: null },
    ]);
  });

  it('should return empty array for null input', () => {
    expect(parseKeyDocuments(null)).toEqual([]);
  });

  it('should return empty array for empty string', () => {
    expect(parseKeyDocuments('')).toEqual([]);
  });
});

describe('calculateTrackerSummary', () => {
  it('should calculate summary stats from employee rows', () => {
    const employees: EmployeeDocumentRow[] = [
      { joining_document_completion_pct: 100, needs_correction_count: 0, overdue_count: 0 } as EmployeeDocumentRow,
      { joining_document_completion_pct: 85, needs_correction_count: 0, overdue_count: 0 } as EmployeeDocumentRow,
      { joining_document_completion_pct: 50, needs_correction_count: 1, overdue_count: 0 } as EmployeeDocumentRow,
      { joining_document_completion_pct: 0, needs_correction_count: 0, overdue_count: 2 } as EmployeeDocumentRow,
    ];

    const summary = calculateTrackerSummary(employees);

    expect(summary).toEqual({
      total: 4,
      complete: 1,             // 100%
      pending_verification: 1, // 75-99%
      in_progress: 1,          // 1-74%
      not_started: 1,          // 0%
      overdue: 1,              // overdue_count > 0
      needs_correction: 1,     // needs_correction_count > 0
    });
  });

  it('should return zeros for empty array', () => {
    const summary = calculateTrackerSummary([]);
    expect(summary).toEqual({
      total: 0,
      complete: 0,
      pending_verification: 0,
      in_progress: 0,
      not_started: 0,
      overdue: 0,
      needs_correction: 0,
    });
  });
});
