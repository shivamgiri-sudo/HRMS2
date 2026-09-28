import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { groupsForDashboards, LIVE_GROUP_USERS } from '../live-dashboard-keys.js';

const routesSource = readFileSync(
  resolve(__dirname, '../process-live-dashboard.routes.ts'), 'utf8');

/** Every endpoint group the routes file serves: router.get('/<group>/...') and cdrRoutes('<group>', ...). */
function servedGroups(): string[] {
  const groups = new Set<string>();
  for (const m of routesSource.matchAll(/router\.get\(\s*['"`]\/([a-z0-9-]+)\//g)) groups.add(m[1]);
  for (const m of routesSource.matchAll(/cdrRoutes\(\s*['"]([a-z0-9-]+)['"]/g)) groups.add(m[1]);
  return [...groups].sort();
}

describe('live dashboard scope map', () => {
  it('has a scope entry for every endpoint group the routes serve (a missing one 403s everyone but admins)', () => {
    const served = servedGroups();
    expect(served.length).toBeGreaterThan(10);
    expect(served.filter((g) => !(g in LIVE_GROUP_USERS))).toEqual([]);
  });

  it('lets a Reginald viewer read the Email tabs its dashboard carries', () => {
    expect([...groupsForDashboards(['reginald-cart'])].sort())
      .toEqual(['molecular-email', 'reginald-cart', 'reginald-email']);
  });

  it('keeps one process from reading another process\'s group', () => {
    const inbound = groupsForDashboards(['inbound']);
    expect(inbound.has('inbound')).toBe(true);
    expect(inbound.has('reginald-cart')).toBe(false);
    expect(groupsForDashboards(['molecular-email']).has('reginald-cart')).toBe(false);
    expect(groupsForDashboards([]).size).toBe(0);
  });
});
