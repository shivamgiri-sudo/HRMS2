import {
  parseColumnDate,
  mapIdentityColumn,
  detectHeaderRow,
  analyzeHeaders,
} from '../header-alias.service';

describe('header-alias', () => {
  describe('parseColumnDate', () => {
    it('parses DD-MMM', () => {
      const d = parseColumnDate('01-Aug');
      expect(d).not.toBeNull();
      expect(d!.getMonth()).toBe(7); // August = 7
      expect(d!.getDate()).toBe(1);
    });

    it('parses DD-MMM-YY', () => {
      const d = parseColumnDate('01-Aug-26');
      expect(d).not.toBeNull();
      expect(d!.getFullYear()).toBe(2026);
      expect(d!.getMonth()).toBe(7);
    });

    it('parses DD-MMM-YYYY', () => {
      const d = parseColumnDate('01-Aug-2026');
      expect(d).not.toBeNull();
      expect(d!.getFullYear()).toBe(2026);
    });

    it('parses DD/MM/YYYY', () => {
      const d = parseColumnDate('01/08/2026');
      expect(d).not.toBeNull();
      expect(d!.getMonth()).toBe(7);
    });

    it('parses DD/MM/YY', () => {
      const d = parseColumnDate('01/08/26');
      expect(d).not.toBeNull();
      expect(d!.getFullYear()).toBe(2026);
    });

    it('parses Excel serial number', () => {
      const d = parseColumnDate('46044');
      expect(d).not.toBeNull();
      // Excel serial 46044 = 2026-01-01 approximately; just verify it's a valid Date
      expect(d!.getFullYear()).toBeGreaterThanOrEqual(2020);
    });

    it('returns null for non-date strings', () => {
      expect(parseColumnDate('Employee Name')).toBeNull();
      expect(parseColumnDate('WO')).toBeNull();
      expect(parseColumnDate('')).toBeNull();
    });

    it('parses M/D/YYYY (same regex as DD/MM/YYYY — month and day swapped)', () => {
      // 8/1/2026 parsed as DD/MM/YYYY: day=8, month=0 (Jan)
      const d = parseColumnDate('8/1/2026');
      expect(d).not.toBeNull();
      expect(d!.getFullYear()).toBe(2026);
    });

    it('returns null for out-of-range serial numbers', () => {
      expect(parseColumnDate('99999')).toBeNull();
      expect(parseColumnDate('1000')).toBeNull();
    });

    it('parses case-insensitive month abbreviations', () => {
      const d1 = parseColumnDate('15-AUG-2026');
      const d2 = parseColumnDate('15-aug-2026');
      expect(d1).not.toBeNull();
      expect(d2).not.toBeNull();
      expect(d1!.getMonth()).toBe(7);
      expect(d2!.getMonth()).toBe(7);
    });
  });

  describe('mapIdentityColumn', () => {
    it('maps Mas Id → employeeId HIGH', () => {
      const m = mapIdentityColumn('Mas Id');
      expect(m.mappedTo).toBe('employeeId');
      expect(m.confidence).toBe('HIGH');
    });

    it('maps Emp Code → employeeId HIGH', () => {
      expect(mapIdentityColumn('Emp Code').mappedTo).toBe('employeeId');
    });

    it('maps Analyst Name → employeeName HIGH', () => {
      expect(mapIdentityColumn('Analyst Name').mappedTo).toBe('employeeName');
    });

    it('maps DoMain ID → domainId HIGH (case-insensitive)', () => {
      expect(mapIdentityColumn('DoMain ID').mappedTo).toBe('domainId');
    });

    it('maps Quality Auditor → qualityAuditor HIGH', () => {
      expect(mapIdentityColumn('Quality Auditor').mappedTo).toBe('qualityAuditor');
    });

    it('maps AM → amName HIGH', () => {
      expect(mapIdentityColumn('AM').mappedTo).toBe('amName');
    });

    it('maps TL Name → tlName HIGH', () => {
      expect(mapIdentityColumn('TL Name').mappedTo).toBe('tlName');
    });

    it('maps unknown column → null NONE', () => {
      const m = mapIdentityColumn('Random Column XYZ');
      expect(m.mappedTo).toBeNull();
      expect(m.confidence).toBe('NONE');
    });

    it('preserves sourceHeader exactly', () => {
      const m = mapIdentityColumn('  Emp Code  ');
      expect(m.sourceHeader).toBe('  Emp Code  ');
    });

    it('maps process variants', () => {
      expect(mapIdentityColumn('campaign').mappedTo).toBe('process');
      expect(mapIdentityColumn('account').mappedTo).toBe('process');
    });

    it('maps sub lob variants', () => {
      expect(mapIdentityColumn('queue').mappedTo).toBe('subLob');
      expect(mapIdentityColumn('sub-lob').mappedTo).toBe('subLob');
    });
  });

  describe('detectHeaderRow', () => {
    it('detects header row with date columns', () => {
      const rows = [
        ['', '', '', ''],
        ['Mas Id', 'Name', '01-Aug', '02-Aug'],
        ['MAS001', 'John', 'WO', '07:00-16:00'],
      ];
      expect(detectHeaderRow(rows)).toBe(1);
    });

    it('detects first row as header if it has dates', () => {
      const rows = [
        ['Emp Code', 'Name', '01-Aug-26', '02-Aug-26'],
        ['MAS001', 'John', 'WO', '07:00-16:00'],
      ];
      expect(detectHeaderRow(rows)).toBe(0);
    });

    it('skips rows with fewer than 2 dates', () => {
      const rows = [
        ['Summary', '01-Aug', 'Report'],  // only 1 date → not header
        ['Emp Code', 'Name', '01-Aug', '02-Aug'],
      ];
      expect(detectHeaderRow(rows)).toBe(1);
    });

    it('returns -1 when no header row found', () => {
      const rows = [
        ['Employee Name', 'Process', 'Status'],
        ['John', 'Extraction', 'Active'],
      ];
      expect(detectHeaderRow(rows)).toBe(-1);
    });

    it('only scans first 20 rows', () => {
      const rows: string[][] = [];
      for (let i = 0; i < 25; i++) {
        rows.push(['no date here', 'also no date']);
      }
      // Put dates in row 20 (index 20, outside scan window)
      rows[20] = ['01-Aug', '02-Aug', 'Name'];
      expect(detectHeaderRow(rows)).toBe(-1);
    });

    it('handles empty rows array', () => {
      expect(detectHeaderRow([])).toBe(-1);
    });
  });

  describe('analyzeHeaders', () => {
    it('returns correct dateColumns and identityColumns', () => {
      const rows = [
        ['Mas Id', 'Analyst Name', 'DOJ', '01-Aug-26', '02-Aug-26', '03-Aug-26'],
        ['MAS001', 'John', '2024-01-01', 'WO', '07:00-16:00', 'WO'],
      ];
      const result = analyzeHeaders(rows);
      expect(result.headerRowIndex).toBe(0);
      expect(result.dateColumns.length).toBe(3);
      expect(result.dateColumns[0].index).toBe(3);
      expect(result.identityColumns.length).toBeGreaterThanOrEqual(2);
      const empIdCol = result.identityColumns.find(c => c.mapping.mappedTo === 'employeeId');
      expect(empIdCol).toBeDefined();
      expect(empIdCol!.index).toBe(0);
    });

    it('includes unknown columns in unmappedColumns', () => {
      const rows = [
        ['Mas Id', 'Unknown Col XYZ', '01-Aug', '02-Aug'],
      ];
      const result = analyzeHeaders(rows);
      expect(result.unmappedColumns.length).toBeGreaterThanOrEqual(1);
      expect(result.unmappedColumns[0].header).toBe('Unknown Col XYZ');
    });

    it('returns -1 headerRowIndex when no header found', () => {
      const rows = [
        ['Name', 'Process', 'Status'],
        ['John', 'Extraction', 'Active'],
      ];
      const result = analyzeHeaders(rows);
      expect(result.headerRowIndex).toBe(-1);
      expect(result.dateColumns).toHaveLength(0);
      expect(result.identityColumns).toHaveLength(0);
    });

    it('dateColumns carry parsedDate objects', () => {
      const rows = [
        ['Emp Code', '01-Aug-26', '02-Aug-26'],
      ];
      const result = analyzeHeaders(rows);
      expect(result.dateColumns[0].parsedDate).toBeInstanceOf(Date);
      expect(result.dateColumns[0].parsedDate.getMonth()).toBe(7);
    });

    it('unmappedColumns is a subset of identityColumns', () => {
      const rows = [
        ['Mas Id', 'Unknown XYZ', 'Another Unknown', '01-Aug', '02-Aug'],
      ];
      const result = analyzeHeaders(rows);
      for (const col of result.unmappedColumns) {
        const found = result.identityColumns.some(c => c.index === col.index);
        expect(found).toBe(true);
      }
    });
  });
});
