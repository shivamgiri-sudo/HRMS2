import { beforeEach, describe, expect, it, vi } from 'vitest';

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('../../../db/mysql.js', () => ({ db: { execute, query: execute, getConnection: vi.fn() } }));

import { commitUploadRows } from '../kpi-studio.sources.js';

/**
 * An upload writes people's KPI inputs. A scoped uploader may load figures only for people in their own
 * processes; rows for anyone else are rejected with a reason rather than silently stored or silently dropped.
 */
const rows = [
  { Code: 'MAS1', Date: '2026-09-01', Calls: 10 },
  { Code: 'MAS2', Date: '2026-09-01', Calls: 20 },
];

beforeEach(() => {
  execute.mockReset();
  execute.mockImplementation(async (sql: string) => {
    if (/SELECT id, employee_code FROM employees/.test(sql)) return [[{ id: 'e1', employee_code: 'MAS1' }, { id: 'e2', employee_code: 'MAS2' }], []];
    if (/SELECT id, process_id FROM employees/.test(sql)) return [[{ id: 'e1', process_id: 'p1' }, { id: 'e2', process_id: 'other' }], []];
    return [[], []];
  });
});

const run = (allowedProcessIds?: ReadonlySet<string> | null) =>
  commitUploadRows({ dataSourceId: 's1', fileName: 'f.csv', employeeColumn: 'Code', dateColumn: 'Date', columnMapping: { calls: 'Calls' }, rows, dryRun: true, allowedProcessIds });

describe('upload scope', () => {
  it('rejects rows for people outside the uploader\'s processes, with a reason', async () => {
    const r = await run(new Set(['p1']));
    expect(r.accepted_rows).toBe(1);
    expect(r.rejections).toEqual([expect.objectContaining({ rowNumber: 3, employeeCode: 'MAS2', reason: 'MAS2 is not in a process you manage' })]);
  });

  it('does not restrict an organisation-wide uploader and does not query processes for them', async () => {
    const r = await run(null);
    expect(r.accepted_rows).toBe(2);
    expect(r.rejections).toEqual([]);
    expect(execute.mock.calls.some(([sql]) => /SELECT id, process_id FROM employees/.test(sql))).toBe(false);
  });

  it('an uploader with no processes can upload for nobody', async () => {
    const r = await run(new Set());
    expect(r.accepted_rows).toBe(0);
    expect(r.rejections).toHaveLength(2);
  });
});
