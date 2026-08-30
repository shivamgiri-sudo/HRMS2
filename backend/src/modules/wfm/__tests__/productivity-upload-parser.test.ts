import { describe, it, expect } from 'vitest';
import {
  MANDATORY_UPLOAD_FIELDS,
  checkMappingCoversMandatoryFields,
  parseUploadRow,
} from '../productivity-upload-parser.js';

describe('MANDATORY_UPLOAD_FIELDS', () => {
  it('is exactly employee_code, report_date, login_minutes (criterion 17.4)', () => {
    expect(MANDATORY_UPLOAD_FIELDS).toEqual(['employee_code', 'report_date', 'login_minutes']);
  });
});

describe('checkMappingCoversMandatoryFields', () => {
  it('accepts a mapping that covers all three mandatory fields, plus optional ones', () => {
    const result = checkMappingCoversMandatoryFields({
      'Emp Code': 'employee_code',
      'Date': 'report_date',
      'Login Mins': 'login_minutes',
      'Calls': 'calls_handled',
    });
    expect(result).toEqual({ ok: true });
  });

  it('names every missing mandatory field (criterion 17.15)', () => {
    const result = checkMappingCoversMandatoryFields({
      'Emp Code': 'employee_code',
    });
    expect(result).toEqual({ ok: false, missingFields: ['report_date', 'login_minutes'] });
  });

  it('rejects an empty mapping, naming all three mandatory fields', () => {
    const result = checkMappingCoversMandatoryFields({});
    expect(result).toEqual({
      ok: false,
      missingFields: ['employee_code', 'report_date', 'login_minutes'],
    });
  });
});

describe('parseUploadRow', () => {
  const mapping = {
    'Emp Code': 'employee_code',
    'Report Date': 'report_date',
    'Login Minutes': 'login_minutes',
    'Calls Handled': 'calls_handled',
    'AHT Seconds': 'aht_seconds',
  };

  it('maps a well-formed row using the column mapping', () => {
    const result = parseUploadRow(
      {
        'Emp Code': 'MAS12345',
        'Report Date': '2026-07-15',
        'Login Minutes': '420',
        'Calls Handled': '38',
        'AHT Seconds': '245.5',
      },
      mapping,
    );
    expect(result).toEqual({
      ok: true,
      row: {
        employee_code: 'MAS12345',
        report_date: '2026-07-15',
        login_minutes: 420,
        calls_handled: 38,
        aht_seconds: 245.5,
      },
    });
  });

  it('omits an optional field entirely when its mapped source column is blank', () => {
    const result = parseUploadRow(
      {
        'Emp Code': 'MAS12345',
        'Report Date': '2026-07-15',
        'Login Minutes': '420',
        'Calls Handled': '',
        'AHT Seconds': '',
      },
      mapping,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.row.calls_handled).toBeUndefined();
      expect(result.row.aht_seconds).toBeUndefined();
    }
  });

  it('rejects a row missing a mandatory field value, naming which one', () => {
    const result = parseUploadRow(
      {
        'Emp Code': 'MAS12345',
        'Report Date': '',
        'Login Minutes': '420',
      },
      mapping,
    );
    expect(result).toEqual({ ok: false, reason: 'report_date is required but blank' });
  });

  it('rejects a row where a numeric field cannot be parsed as a number', () => {
    const result = parseUploadRow(
      {
        'Emp Code': 'MAS12345',
        'Report Date': '2026-07-15',
        'Login Minutes': 'not-a-number',
      },
      mapping,
    );
    expect(result).toEqual({ ok: false, reason: 'login_minutes is not a valid number: "not-a-number"' });
  });

  it('rejects a negative login_minutes value', () => {
    const result = parseUploadRow(
      {
        'Emp Code': 'MAS12345',
        'Report Date': '2026-07-15',
        'Login Minutes': '-10',
      },
      mapping,
    );
    expect(result).toEqual({ ok: false, reason: 'login_minutes must not be negative: -10' });
  });

  it('ignores a raw column with no mapping entry', () => {
    const result = parseUploadRow(
      {
        'Emp Code': 'MAS12345',
        'Report Date': '2026-07-15',
        'Login Minutes': '420',
        'Some Unmapped Column': 'whatever',
      },
      mapping,
    );
    expect(result.ok).toBe(true);
  });
});
