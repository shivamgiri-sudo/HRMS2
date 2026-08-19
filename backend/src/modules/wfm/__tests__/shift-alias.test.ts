import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  listAliases,
  createAlias,
  updateAlias,
  deleteAlias,
  resolveAliases,
} from '../shift-alias.service.js';

vi.mock('../../../db/mysql.js', () => ({
  db: {
    query: vi.fn(),
    executeRun: vi.fn(),
  },
}));

import { db } from '../../../db/mysql.js';

describe('shift-alias service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('listAliases returns all when no shiftId filter', async () => {
    const mockData = [
      {
        id: 1,
        shiftId: 'shift-1',
        alias: 'Morning',
        isActive: 1,
        createdAt: '2026-08-19 10:00:00',
        createdBy: 'user-1',
      },
      {
        id: 2,
        shiftId: 'shift-2',
        alias: 'Evening',
        isActive: 1,
        createdAt: '2026-08-19 11:00:00',
        createdBy: 'user-1',
      },
    ];

    vi.mocked(db.query).mockResolvedValueOnce([mockData, []] as any);

    const result = await listAliases();

    expect(result).toHaveLength(2);
    expect(result[0].alias).toBe('Morning');
    expect(result[1].alias).toBe('Evening');
    expect(vi.mocked(db.query)).toHaveBeenCalledWith(
      expect.stringContaining('FROM wfm_shift_alias'),
      []
    );
  });

  it('listAliases filters by shiftId', async () => {
    const mockData = [
      {
        id: 1,
        shiftId: 'shift-1',
        alias: 'Morning',
        isActive: 1,
        createdAt: '2026-08-19 10:00:00',
        createdBy: 'user-1',
      },
    ];

    vi.mocked(db.query).mockResolvedValueOnce([mockData, []] as any);

    const result = await listAliases('shift-1');

    expect(result).toHaveLength(1);
    expect(result[0].shiftId).toBe('shift-1');
    expect(vi.mocked(db.query)).toHaveBeenCalledWith(
      expect.stringContaining('WHERE shift_id = ?'),
      ['shift-1']
    );
  });

  it('createAlias inserts and returns new alias', async () => {
    vi.mocked(db.query)
      .mockResolvedValueOnce([[], []] as any) // Check for duplicates
    vi.mocked(db.executeRun)
      .mockResolvedValueOnce([{ insertId: 5 }, []] as any) // Insert
    vi.mocked(db.query)
      .mockResolvedValueOnce([[
        {
          id: 5,
          shiftId: 'shift-1',
          alias: 'NewAlias',
          isActive: 1,
          createdAt: '2026-08-19 12:00:00',
          createdBy: 'user-1',
        },
      ], []] as any); // Fetch result

    const result = await createAlias('shift-1', 'NewAlias', 'user-1');

    expect(result.id).toBe(5);
    expect(result.alias).toBe('NewAlias');
    expect(result.shiftId).toBe('shift-1');
    expect(result.isActive).toBe(true);
  });

  it('createAlias throws on duplicate alias (409)', async () => {
    vi.mocked(db.query).mockResolvedValueOnce([
      [{ id: 1 }], // Duplicate exists
      [],
    ] as any);

    try {
      await createAlias('shift-1', 'DupAlias', 'user-1');
      expect.fail('Should have thrown');
    } catch (error: any) {
      expect(error.statusCode).toBe(409);
      expect(error.message).toBe('Alias already exists');
    }
  });

  it('updateAlias updates fields', async () => {
    vi.mocked(db.executeRun)
      .mockResolvedValueOnce([{}, []] as any) // Update
    vi.mocked(db.query)
      .mockResolvedValueOnce([[
        {
          id: 1,
          shiftId: 'shift-1',
          alias: 'UpdatedAlias',
          isActive: 0,
          createdAt: '2026-08-19 10:00:00',
          createdBy: 'user-1',
        },
      ], []] as any); // Fetch result

    const result = await updateAlias(1, {
      alias: 'UpdatedAlias',
      isActive: false,
    });

    expect(result.alias).toBe('UpdatedAlias');
    expect(result.isActive).toBe(false);
  });

  it('deleteAlias removes entry', async () => {
    vi.mocked(db.executeRun).mockResolvedValueOnce([{}, []] as any);

    await deleteAlias(1);

    expect(vi.mocked(db.executeRun)).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM wfm_shift_alias'),
      [1]
    );
  });

  it('resolveAliases returns shiftId for known aliases', async () => {
    vi.mocked(db.query).mockResolvedValueOnce([[
      { alias: 'MORNING', shift_id: 'shift-1' },
      { alias: 'EVENING', shift_id: 'shift-2' },
    ], []] as any);

    const result = await resolveAliases(['Morning', 'Evening']);

    expect(result.get('Morning')).toBe('shift-1');
    expect(result.get('Evening')).toBe('shift-2');
  });

  it('resolveAliases returns null for unknown aliases', async () => {
    vi.mocked(db.query).mockResolvedValueOnce([[
      { alias: 'MORNING', shift_id: 'shift-1' },
    ], []] as any);

    const result = await resolveAliases(['Morning', 'Unknown']);

    expect(result.get('Morning')).toBe('shift-1');
    expect(result.get('Unknown')).toBeNull();
  });

  it('resolveAliases is case-insensitive', async () => {
    vi.mocked(db.query).mockResolvedValueOnce([[
      { alias: 'MORNING', shift_id: 'shift-1' },
      { alias: 'EVENING', shift_id: 'shift-2' },
    ], []] as any);

    const result = await resolveAliases(['morning', 'Evening']);

    expect(result.get('morning')).toBe('shift-1');
    expect(result.get('Evening')).toBe('shift-2');

    // Verify the query was called with uppercase aliases
    expect(vi.mocked(db.query)).toHaveBeenCalledWith(
      expect.stringContaining('UPPER(alias) IN (?)'),
      [['MORNING', 'EVENING']]
    );
  });
});
