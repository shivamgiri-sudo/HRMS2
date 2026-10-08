import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
}));

vi.mock('../../../db/mysql.js', () => ({
  db: {
    execute: mocks.execute,
  },
}));

import {
  listProfiles,
  createProfile,
  updateProfile,
  deleteProfile,
  type HeaderMappingProfile,
} from '../header-mapping-profile.service.js';

describe('header-mapping-profile service', () => {
  beforeEach(() => {
    mocks.execute.mockReset();
  });

  it('listProfiles returns all active profiles', async () => {
    const mockRow = {
      id: 1,
      process_id: 'proc-123',
      profile_name: 'Test Profile',
      source_identifier: null,
      column_mappings: JSON.stringify({ employeeId: 'col_A', name: 'col_B' }),
      shift_alias_overrides: null,
      status_alias_overrides: null,
      blank_handling: 'UNASSIGNED',
      hd_maps_to: 'NEEDS_MAPPING',
      is_default: 0,
      is_active: 1,
      created_by: 'user-123',
      created_at: '2026-08-19T10:00:00Z',
    };

    mocks.execute.mockResolvedValueOnce([[mockRow], []]);

    const profiles = await listProfiles();

    expect(profiles).toHaveLength(1);
    expect(profiles[0].id).toBe(1);
    expect(profiles[0].profileName).toBe('Test Profile');
    expect(profiles[0].columnMappings).toEqual({ employeeId: 'col_A', name: 'col_B' });
    expect(profiles[0].isActive).toBe(true);
  });

  it('listProfiles filters by processId', async () => {
    const mockRow = {
      id: 1,
      process_id: 'proc-123',
      profile_name: 'Test Profile',
      source_identifier: null,
      column_mappings: JSON.stringify({ employeeId: 'col_A' }),
      shift_alias_overrides: null,
      status_alias_overrides: null,
      blank_handling: 'UNASSIGNED',
      hd_maps_to: 'NEEDS_MAPPING',
      is_default: 0,
      is_active: 1,
      created_by: 'user-123',
      created_at: '2026-08-19T10:00:00Z',
    };

    mocks.execute.mockResolvedValueOnce([[mockRow], []]);

    const profiles = await listProfiles('proc-123');

    expect(profiles).toHaveLength(1);
    expect(mocks.execute).toHaveBeenCalledWith(
      expect.stringContaining('process_id = ?'),
      expect.arrayContaining(['proc-123']),
    );
  });

  it('listProfiles only returns is_active=1 profiles', async () => {
    const activeRow = {
      id: 1,
      process_id: 'proc-123',
      profile_name: 'Active Profile',
      source_identifier: null,
      column_mappings: JSON.stringify({ col: 'a' }),
      shift_alias_overrides: null,
      status_alias_overrides: null,
      blank_handling: 'UNASSIGNED',
      hd_maps_to: 'NEEDS_MAPPING',
      is_default: 0,
      is_active: 1,
      created_by: 'user-123',
      created_at: '2026-08-19T10:00:00Z',
    };

    mocks.execute.mockResolvedValueOnce([[activeRow], []]);

    const profiles = await listProfiles();

    expect(profiles).toHaveLength(1);
    expect(mocks.execute).toHaveBeenCalledWith(
      expect.stringContaining('is_active = 1'),
      expect.any(Array),
    );
  });

  it('createProfile inserts and returns new profile', async () => {
    const newRow = {
      id: 2,
      process_id: 'proc-456',
      profile_name: 'New Profile',
      source_identifier: null,
      column_mappings: JSON.stringify({ field1: 'col_C' }),
      shift_alias_overrides: JSON.stringify({ shift1: 'Morning' }),
      status_alias_overrides: null,
      blank_handling: 'NO_CHANGE',
      hd_maps_to: 'HALF_DAY',
      is_default: 1,
      is_active: 1,
      created_by: 'user-456',
      created_at: '2026-08-19T11:00:00Z',
    };

    // First call: check for duplicates
    mocks.execute.mockResolvedValueOnce([[], []]);
    // Second call: insert
    mocks.execute.mockResolvedValueOnce([{ insertId: 2 }, []]);
    // Third call: fetch inserted row
    mocks.execute.mockResolvedValueOnce([[newRow], []]);

    const profile = await createProfile({
      processId: 'proc-456',
      profileName: 'New Profile',
      columnMappings: { field1: 'col_C' },
      shiftAliasOverrides: { shift1: 'Morning' },
      blankHandling: 'NO_CHANGE',
      hdMapsTo: 'HALF_DAY',
      isDefault: true,
      createdBy: 'user-456',
    });

    expect(profile.id).toBe(2);
    expect(profile.profileName).toBe('New Profile');
    expect(profile.blankHandling).toBe('NO_CHANGE');
    expect(profile.isDefault).toBe(true);
  });

  it('createProfile throws 409 on duplicate processId+profileName', async () => {
    // First call: check for duplicates - returns existing row
    mocks.execute.mockResolvedValueOnce(
      [
        [
          {
            id: 1,
            process_id: 'proc-123',
            profile_name: 'Test Profile',
          },
        ],
        [],
      ],
    );

    try {
      await createProfile({
        processId: 'proc-123',
        profileName: 'Test Profile',
        columnMappings: { col: 'a' },
        createdBy: 'user-123',
      });
      expect.fail('Should have thrown 409 error');
    } catch (err: any) {
      expect(err.statusCode).toBe(409);
      expect(err.message).toContain('already exists');
    }
  });

  it('updateProfile updates partial fields', async () => {
    const updatedRow = {
      id: 1,
      process_id: 'proc-123',
      profile_name: 'Updated Profile',
      source_identifier: null,
      column_mappings: JSON.stringify({ newField: 'col_X' }),
      shift_alias_overrides: null,
      status_alias_overrides: null,
      blank_handling: 'NO_CHANGE',
      hd_maps_to: 'NEEDS_MAPPING',
      is_default: 1,
      is_active: 1,
      created_by: 'user-123',
      created_at: '2026-08-19T10:00:00Z',
    };

    // First call: update
    mocks.execute.mockResolvedValueOnce([{}, []]);
    // Second call: fetch updated row
    mocks.execute.mockResolvedValueOnce([[updatedRow], []]);

    const profile = await updateProfile(1, {
      profileName: 'Updated Profile',
      columnMappings: { newField: 'col_X' },
      blankHandling: 'NO_CHANGE',
      isDefault: true,
    });

    expect(profile.id).toBe(1);
    expect(profile.profileName).toBe('Updated Profile');
    expect(profile.blankHandling).toBe('NO_CHANGE');
    expect(profile.isDefault).toBe(true);
  });

  it('deleteProfile soft-deletes (sets is_active=0)', async () => {
    mocks.execute.mockResolvedValueOnce([{}, []]);

    await deleteProfile(1);

    expect(mocks.execute).toHaveBeenCalledWith(
      expect.stringContaining('is_active = 0'),
      expect.arrayContaining([1]),
    );
  });

  it('handles JSON parsing of alias overrides', async () => {
    const mockRow = {
      id: 3,
      process_id: 'proc-789',
      profile_name: 'Complex Profile',
      source_identifier: 'source-1',
      column_mappings: JSON.stringify({ col1: 'a', col2: 'b' }),
      shift_alias_overrides: JSON.stringify({ nightShift: 'Night', dayShift: 'Day' }),
      status_alias_overrides: JSON.stringify({ present: 'P', absent: 'A' }),
      blank_handling: 'UNASSIGNED',
      hd_maps_to: 'HALF_DAY',
      is_default: 0,
      is_active: 1,
      created_by: 'user-789',
      created_at: '2026-08-19T12:00:00Z',
    };

    mocks.execute.mockResolvedValueOnce([[mockRow], []]);

    const profiles = await listProfiles();

    expect(profiles[0].shiftAliasOverrides).toEqual({
      nightShift: 'Night',
      dayShift: 'Day',
    });
    expect(profiles[0].statusAliasOverrides).toEqual({
      present: 'P',
      absent: 'A',
    });
  });
});
