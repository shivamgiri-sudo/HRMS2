import { describe, it, expect } from 'vitest';
import { CLEARANCE_ROLE_MAP, canClearTask } from '../exit.routes.js';

describe('Clearance role gate', () => {
  it('manager can clear manager area', () => {
    expect(canClearTask('manager', ['manager'])).toBe(true);
  });
  it('manager cannot clear wfm area', () => {
    expect(canClearTask('wfm', ['manager'])).toBe(false);
  });
  it('manager cannot clear it area', () => {
    expect(canClearTask('it', ['manager'])).toBe(false);
  });
  it('manager cannot clear finance area', () => {
    expect(canClearTask('finance', ['manager'])).toBe(false);
  });
  it('wfm role can clear wfm area', () => {
    expect(canClearTask('wfm', ['wfm'])).toBe(true);
  });
  it('it role can clear it area', () => {
    expect(canClearTask('it', ['it'])).toBe(true);
  });
  it('hr can clear hr area', () => {
    expect(canClearTask('hr', ['hr'])).toBe(true);
  });
  it('super_admin bypasses all areas', () => {
    expect(canClearTask('finance', ['super_admin'])).toBe(true);
    expect(canClearTask('it', ['super_admin'])).toBe(true);
  });
  it('admin bypasses all areas', () => {
    expect(canClearTask('wfm', ['admin'])).toBe(true);
  });
  it('CLEARANCE_ROLE_MAP has 8 areas', () => {
    expect(Object.keys(CLEARANCE_ROLE_MAP)).toHaveLength(8);
  });
});
