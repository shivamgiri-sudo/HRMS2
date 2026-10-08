import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, sep } from 'path';

/**
 * Static guard for outbound email links.
 *
 * Three ways these have broken before, each invisible until a recipient clicked:
 *  1. a link built from a hard-coded production host (wrong in every other environment);
 *  2. a link to a frontend route that does not exist (/payroll/bank-verify/:token);
 *  3. a candidate-facing "download" link that points at an HR-only API route.
 * Links must come from buildAppLink() (or the gateway's resolveActionUrl).
 */
const SRC = join(__dirname, '..', '..', '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === '__tests__' || name === 'node_modules') continue;
      walk(p, out);
    } else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

const files = walk(SRC);
const rel = (f: string) => relative(SRC, f).split(sep).join('/');

describe('outbound email links', () => {
  it('never hard-codes the production host in an href', () => {
    const offenders = files.filter((f) => /href=["']https?:\/\/mcnhrms\.teammas\.in/.test(readFileSync(f, 'utf8'))).map(rel);
    expect(offenders).toEqual([]);
  });

  it('never links to the nonexistent /payroll/bank-verify route', () => {
    const offenders = files
      .filter((f) => /\$\{[^}]*\}\/payroll\/bank-verify\//.test(readFileSync(f, 'utf8')))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it('never puts an /api/letters download URL in an email for the recipient to click', () => {
    const offenders = files
      .filter((f) => /href="\$\{[^}]*\}"[^>]*>[^<]*Download Appointment/.test(readFileSync(f, 'utf8')))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it.each([
    'modules/exit/exit.service.ts',
    'modules/auth/auth.routes.ts',
    'workers/interview-delay-alert.worker.ts',
    'services/ats-notification.helper.ts',
    'modules/bulk-upload/bulk-approval-notify.service.ts',
    'modules/payroll/pendency/pendency.service.ts',
    'modules/break-management/break-management.service.ts',
    'modules/privacy/dpdp-breach-sla.cron.ts',
    'cron/dbbill-migration-report.cron.ts',
    'modules/ats/offer-letter.service.ts',
    'modules/wfm/roster-intelligence.cron.ts',
    'workers/report-email-delivery.worker.ts',
  ])('%s builds its email links with buildAppLink', (file) => {
    expect(readFileSync(join(SRC, file), 'utf8')).toContain('buildAppLink');
  });
});
