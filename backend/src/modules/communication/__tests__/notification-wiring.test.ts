/**
 * Guard: every notification module must actually be CALLED by the service that owns it.
 *
 * This exists because the wiring has silently disappeared twice. Both times the
 * `*.notifications.ts` modules survived untouched while every `notifyX()` invocation
 * vanished from the owning services, inside commits about something else entirely
 * (d2bdc31e "gate ungated routes", 9cb198b2 "normalise copy-forward key").
 *
 * That failure is invisible: the code compiles, the modules still exist, the tests still
 * pass, and the notification engine simply never fires. It is indistinguishable from
 * "never built" — which is exactly how a whole feature gets rebuilt from scratch.
 *
 * These assertions are deliberately shallow. They check only that the call site EXISTS,
 * not what it does, so that ordinary refactoring of the surrounding service does not
 * break them. Static source inspection is used rather than a runtime spy because the goal
 * is to catch DELETION, and a deleted call site cannot be spied on.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const MODULES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** callSite: the service that must invoke it. functions: what must appear there. */
const WIRING: Array<{ area: string; callSite: string; module: string; functions: string[] }> = [
  {
    area: 'leave',
    callSite: 'leave/leave.service.ts',
    module: 'leave/leave.notifications.ts',
    functions: ['notifyLeaveSubmitted', 'notifyLeaveDecision'],
  },
  {
    area: 'roster',
    callSite: 'roster/roster.governance.service.ts',
    module: 'roster/roster.notifications.ts',
    functions: ['notifyRosterPublished'],
  },
  {
    area: 'attendance',
    callSite: 'wfm/wfm.regularization.secure.routes.ts',
    module: 'wfm/attendance.notifications.ts',
    functions: ['notifyRegularizationDecision', 'notifyRegularizationStage2Pending'],
  },
  {
    area: 'payroll',
    callSite: 'payroll/payroll.service.ts',
    module: 'payroll/payroll.notifications.ts',
    functions: ['notifyPayrollRunStatus', 'notifyPayslipsReady'],
  },
  {
    area: 'exit',
    callSite: 'exit/exit.service.ts',
    module: 'exit/exit.notifications.ts',
    functions: ['notifyResignationSubmitted', 'notifyResignationDecision'],
  },
];

const read = (rel: string): string => {
  const p = resolve(MODULES_DIR, rel);
  if (!existsSync(p)) throw new Error(`file missing: ${rel}`);
  return readFileSync(p, 'utf8');
};

/** Strip comments so a call site that is only MENTIONED in prose does not count as wired. */
const stripComments = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('notification wiring is not silently deleted', () => {
  for (const { area, callSite, module, functions } of WIRING) {
    describe(area, () => {
      it(`${module} exists and exports its notifiers`, () => {
        const src = read(module);
        for (const fn of functions) {
          expect(src, `${module} must export ${fn}`).toContain(`export async function ${fn}`);
        }
      });

      it(`${callSite} imports from ${module.split('/')[1]}`, () => {
        const src = stripComments(read(callSite));
        const importedName = module.split('/')[1].replace(/\.ts$/, '');
        expect(
          src,
          `${callSite} no longer imports ${importedName} — the wiring has been removed`,
        ).toMatch(new RegExp(`from\\s+["'][^"']*${importedName}\\.js["']`));
      });

      it.each(functions)(`${callSite} still calls %s()`, (fn) => {
        const src = stripComments(read(callSite));
        // `fn(` in executable code — not merely present in the import list.
        const calls = src.match(new RegExp(`\\b${fn}\\s*\\(`, 'g')) ?? [];
        expect(
          calls.length,
          `${fn}() is no longer invoked in ${callSite}. The notification module still ` +
            `exists, so this is almost certainly an accidental deletion by an unrelated ` +
            `commit rather than a deliberate removal. Restore it by rebuilding the file ` +
            `from current origin/main plus your own hunk — never by overwriting with a ` +
            `local copy, which would clobber concurrent work.`,
        ).toBeGreaterThan(0);
      });
    });
  }

  it('the gateway is the only thing the notification modules dispatch through', () => {
    for (const { module } of WIRING) {
      const src = stripComments(read(module));
      expect(src, `${module} must dispatch via notificationGateway`).toContain('notificationGateway');
      // Bypassing the gateway skips the kill switch, deny-list and dedupe claim.
      expect(src, `${module} must not call a mail transport directly`).not.toMatch(
        /createTransport|sendMail\s*\(/,
      );
    }
  });
});
