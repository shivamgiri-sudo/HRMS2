import { describe, expect, it } from 'vitest';
import { docCategoryFor, isSelfServiceDocType } from '../employee-document-category.js';

describe('docCategoryFor', () => {
  it.each([
    ['pan_card', 'pan'], ['PAN Card', 'pan'], [' pan ', 'pan'],
    ['aadhaar_card', 'aadhaar'], ['Aadhaar', 'aadhaar'], ['aadhar', 'aadhaar'],
    ['bank_passbook', 'bank'], ['Bank Passbook', 'bank'], ['Cancelled Cheque', 'bank'],
    ['contract', 'other'], ['id_proof', 'other'], ['', 'other'],
  ])('%j -> %s', (input, expected) => {
    expect(docCategoryFor(input)).toBe(expected);
  });
});

describe('isSelfServiceDocType', () => {
  it('allows only the statutory documents', () => {
    expect(isSelfServiceDocType('pan_card')).toBe(true);
    expect(isSelfServiceDocType('aadhaar_card')).toBe(true);
    expect(isSelfServiceDocType('bank_passbook')).toBe(true);
    expect(isSelfServiceDocType('offer_letter')).toBe(false);
    expect(isSelfServiceDocType('contract')).toBe(false);
  });
});
