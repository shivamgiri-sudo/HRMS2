import { describe, it, expect } from 'vitest';
import {
  parseLegacyDate,
  splitName,
  normalizeGender,
  toMasterCode,
  parseUAN,
  sumLeaveDays,
  normalizeLeaveStatus,
  toDecimal,
  boolFlag,
  buildAddress,
} from './migrate-legacy.transforms.js';
import type { LegacyLeaveRow } from './migrate-legacy.transforms.js';

describe('parseLegacyDate', () => {
  it('parses US M/D/YYYY', () => {
    expect(parseLegacyDate('6/9/1974')).toBe('1974-06-09');
  });
  it('parses US single-digit day and month', () => {
    expect(parseLegacyDate('3/25/2005')).toBe('2005-03-25');
  });
  it('extracts date from MySQL datetime string', () => {
    expect(parseLegacyDate('2018-06-16 00:00:00')).toBe('2018-06-16');
  });
  it('returns null for 0000-00-00', () => {
    expect(parseLegacyDate('0000-00-00 00:00:00')).toBeNull();
  });
  it('returns null for null', () => {
    expect(parseLegacyDate(null)).toBeNull();
  });
  it('returns null for NA', () => {
    expect(parseLegacyDate('NA')).toBeNull();
  });
  it('returns null for empty string', () => {
    expect(parseLegacyDate('')).toBeNull();
  });
});

describe('splitName', () => {
  it('splits on first space', () => {
    expect(splitName('DEEPAK KASHYAP')).toEqual({ firstName: 'DEEPAK', lastName: 'KASHYAP' });
  });
  it('handles multi-word last name', () => {
    expect(splitName('SHYAM BABU JANGIR')).toEqual({ firstName: 'SHYAM', lastName: 'BABU JANGIR' });
  });
  it('handles single name with no space', () => {
    expect(splitName('RAJNI')).toEqual({ firstName: 'RAJNI', lastName: '' });
  });
  it('trims surrounding whitespace', () => {
    expect(splitName('  RITU CHAUDHARY  ')).toEqual({ firstName: 'RITU', lastName: 'CHAUDHARY' });
  });
});

describe('normalizeGender', () => {
  it('MALE → Male', () => expect(normalizeGender('MALE')).toBe('Male'));
  it('FEMALE → Female', () => expect(normalizeGender('FEMALE')).toBe('Female'));
  it('null → Other', () => expect(normalizeGender(null)).toBe('Other'));
  it('unknown string → Other', () => expect(normalizeGender('UNKNOWN')).toBe('Other'));
  it('lowercase male → Male', () => expect(normalizeGender('male')).toBe('Male'));
});

describe('toMasterCode', () => {
  it('converts spaces to underscores and uppercases', () => {
    expect(toMasterCode('HEAD OFFICE')).toBe('HEAD_OFFICE');
  });
  it('removes forward slashes', () => {
    expect(toMasterCode('IT/SYSTEM')).toBe('ITSYSTEM');
  });
  it('handles already clean value', () => {
    expect(toMasterCode('OPERATIONS')).toBe('OPERATIONS');
  });
  it('collapses multiple spaces', () => {
    expect(toMasterCode('COLLECTION  MANAGEMENT')).toBe('COLLECTION_MANAGEMENT');
  });
  it('truncates at 50 characters', () => {
    expect(toMasterCode('A'.repeat(60)).length).toBe(50);
  });
});

describe('parseUAN', () => {
  it('converts scientific notation string to integer string', () => {
    expect(parseUAN('1.00143E+11')).toBe('100143000000');
  });
  it('converts scientific notation number to integer string', () => {
    expect(parseUAN(1.00298e11)).toBe('100298000000');
  });
  it('passes through plain number string', () => {
    expect(parseUAN('100143000000')).toBe('100143000000');
  });
  it('returns null for null', () => expect(parseUAN(null)).toBeNull());
  it('returns null for undefined', () => expect(parseUAN(undefined)).toBeNull());
  it('returns null for empty string', () => expect(parseUAN('')).toBeNull());
});

describe('sumLeaveDays', () => {
  it('sums all leave type columns', () => {
    const row = { CL: 1, ML: 0, DL: null, EL: 2, PTRL: 0, MTRL: 0, LWP: 1 } as LegacyLeaveRow;
    expect(sumLeaveDays(row)).toBe(4);
  });
  it('returns 0 when all are null', () => {
    const row = { CL: null, ML: null, DL: null, EL: null, PTRL: null, MTRL: null, LWP: null } as LegacyLeaveRow;
    expect(sumLeaveDays(row)).toBe(0);
  });
  it('handles mixed null and number', () => {
    const row = { CL: 2, ML: null, DL: null, EL: null, PTRL: null, MTRL: null, LWP: null } as LegacyLeaveRow;
    expect(sumLeaveDays(row)).toBe(2);
  });
});

describe('normalizeLeaveStatus', () => {
  it('Approved → approved', () => expect(normalizeLeaveStatus('Approved')).toBe('approved'));
  it('Rejected → rejected', () => expect(normalizeLeaveStatus('Rejected')).toBe('rejected'));
  it('Disapproved → rejected', () => expect(normalizeLeaveStatus('Disapproved')).toBe('rejected'));
  it('null → pending', () => expect(normalizeLeaveStatus(null)).toBe('pending'));
  it('empty → pending', () => expect(normalizeLeaveStatus('')).toBe('pending'));
  it('uppercase APPROVED → approved', () => expect(normalizeLeaveStatus('APPROVED')).toBe('approved'));
});

describe('toDecimal', () => {
  it('parses string number', () => expect(toDecimal('25000')).toBe(25000));
  it('parses decimal string', () => expect(toDecimal('10274.84')).toBeCloseTo(10274.84));
  it('returns 0 for null', () => expect(toDecimal(null)).toBe(0));
  it('returns 0 for empty string', () => expect(toDecimal('')).toBe(0));
  it('returns 0 for non-numeric string', () => expect(toDecimal('N/A')).toBe(0));
});

describe('boolFlag', () => {
  it('YES → 1', () => expect(boolFlag('YES')).toBe(1));
  it('yes → 1', () => expect(boolFlag('yes')).toBe(1));
  it('NO → 0', () => expect(boolFlag('NO')).toBe(0));
  it('null → 0', () => expect(boolFlag(null)).toBe(0));
  it('empty → 0', () => expect(boolFlag('')).toBe(0));
});

describe('buildAddress', () => {
  it('joins all non-null parts with comma-space', () => {
    expect(buildAddress('123 Street', 'Delhi', 'Delhi', '110001'))
      .toBe('123 Street, Delhi, Delhi, 110001');
  });
  it('skips null parts', () => {
    expect(buildAddress('123 Street', null, 'Delhi', null))
      .toBe('123 Street, Delhi');
  });
  it('returns null when all parts are null', () => {
    expect(buildAddress(null, null, null, null)).toBeNull();
  });
});
