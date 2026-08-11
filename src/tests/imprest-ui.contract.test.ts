import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

/**
 * Imprest UI invariants (Requirements 6 and 7).
 *
 * Two things here are quietly easy to regress, and neither shows up as a broken screen:
 *
 *   1. The export must hit the API, not serialise the loaded rows. Serialising what is on
 *      screen produces a file that silently depends on paging and on whatever filter happened
 *      to be applied — and, worse, bypasses the server-side branch entitlement that the list
 *      endpoint enforces.
 *   2. No balance may be computed from the allocation list. The float is derived server-side
 *      from an append-only ledger; a second implementation in the browser is exactly how two
 *      balances end up disagreeing, with neither obviously wrong.
 *
 * The Balance column used to be the one permitted piece of client-side arithmetic — a running
 * total seeded from the server's opening figure. It no longer is: the Imprest Details report
 * returns a balance per row, so the client accumulates nothing and cannot drift from the
 * report's own totals. The test below pins that stricter rule.
 */

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

const ALLOCATION = read("src/components/finance/grn/imprest/ImprestAllocationPanel.tsx");
const REPORT = read("src/components/finance/grn/imprest/ImprestReportPanel.tsx");
const WORKSPACE = read("src/components/finance/grn/imprest/ImprestWorkspace.tsx");
const MANAGERS = read("src/components/finance/grn/imprest/ImprestManagerPanel.tsx");
const GRN_FORM = read("src/components/finance/grn/BudgetLinkedGrnForm.tsx");
const VOUCHER = read("src/components/finance/payroll/SalaryVoucherPanel.tsx");
const QUEUE = read("src/components/finance/grn/ImprestApprovalQueue.tsx");
const SEARCH = read("src/components/finance/grn/GrnSearchWorkspace.tsx");

describe("the report exports through the API", () => {
  it("opens the export endpoint rather than building a file from state", () => {
    expect(REPORT).toContain("/api/finance/imprest/reports/details/export?");
    // No client-side CSV assembly. If one appears, the branch entitlement stops being enforced
    // on the file the user actually receives.
    expect(REPORT).not.toMatch(/new Blob\(/);
    expect(REPORT).not.toMatch(/URL\.createObjectURL/);
  });

  it("sends the same filters to the export as to the table", () => {
    // One query string, built once, used by the summary, the ledger and the export.
    const uses = REPORT.match(/\$\{query\}/g) ?? [];
    expect(uses.length, "summary, ledger and export all reuse the query").toBeGreaterThanOrEqual(3);
  });
});

describe("balances are server-derived", () => {
  it("the allocation panel reads the float from the reports endpoint", () => {
    expect(ALLOCATION).toContain("/api/finance/imprest/reports/balance");
    expect(ALLOCATION).toContain("closing_balance");
  });

  it("the allocation panel never sums the allocation list into a balance", () => {
    // A .reduce over allocations would produce a figure that ignores vouchers and returns, and
    // would look plausible while being wrong by exactly the amount that has been spent.
    expect(ALLOCATION).not.toMatch(/allocations\s*\.\s*reduce/);
  });

  it("takes each row's balance from the server rather than accumulating one", () => {
    // Stronger than the old rule that the client's running total had to START at the server's
    // opening figure: the client now does no accumulation at all, so it cannot drift from the
    // report's own totals. The Balance column renders exactly what the API returned.
    expect(REPORT).toContain("money(row.balance)");
    expect(REPORT).not.toMatch(/let running/);
    expect(REPORT).not.toMatch(/running = Math\.round/);
  });

  it("shows the full identity, not just a closing number", () => {
    // Opening + allocated - vouchers - returned +/- adjustments = closing. A report showing
    // only closing cannot be reconciled by the person reading it.
    for (const field of [
      "opening_balance", "allocated", "voucher_utilisation", "returned", "adjustments", "closing_balance",
    ]) {
      expect(REPORT, `${field} must be shown`).toContain(field);
    }
  });
});

describe("the allocation form", () => {
  it("takes the branch from the manager's appointment, never from a free field", () => {
    // An allocation must credit the branch the chosen manager actually holds; letting the two
    // diverge would credit a float in a branch that manager has no appointment for.
    expect(ALLOCATION).toContain("branchId: selectedManager.branch_id");
  });

  it("refuses to submit without a manager and a positive amount", () => {
    expect(ALLOCATION).toContain("!draft.imprestManagerId || !(Number(draft.amount) > 0)");
  });

  it("requires a reason before a rejection can be sent", () => {
    expect(ALLOCATION).toContain("disabled={!rejecting.reason.trim() || review.isPending}");
  });
});

describe("the three surfaces share one tab", () => {
  it("hosts approvals, allocation and report without new routed pages", () => {
    // Three routed pages would need three page_catalog rows, three nav entries and three sets
    // of role grants to stay reachable — the checklist FINANCE_COST_CENTRES failed.
    for (const pane of ["approvals", "allocation", "report", "managers"]) {
      expect(WORKSPACE).toContain(`value: "${pane}"`);
    }
    expect(WORKSPACE).toContain("ImprestApprovalQueue");
    expect(WORKSPACE).toContain("ImprestAllocationPanel");
    expect(WORKSPACE).toContain("ImprestReportPanel");
    expect(WORKSPACE).toContain("ImprestManagerPanel");
  });
});

describe("the imprest manager master (Requirement 8)", () => {
  it("can actually appoint somebody", () => {
    // The API existed and was tested; there was nowhere to appoint anyone, so the whole chain
    // was inert: no manager means no allocation to credit and no voucher debit to post.
    expect(MANAGERS).toContain('hrmsApi.post<any>("/api/finance/imprest/managers"');
  });

  it("offers only employees who can operate a float", () => {
    // Active, at the branch, and holding a login — 119 of 1,123 active employees have no user
    // account, and appointing one creates a float nobody can operate.
    expect(MANAGERS).toContain("/api/finance/imprest/manager-candidates?branchId=");
  });

  it("sends both the user and the employee", () => {
    // user_id is who acts and is recorded on every posting; employee_id is who they are.
    expect(MANAGERS).toContain("userId: chosen.user_id");
    expect(MANAGERS).toContain("employeeId: chosen.employee_id");
  });

  it("ends an appointment rather than deleting it", () => {
    // Ledger entries posted under an appointment must stay explainable; a deleted holder makes
    // past postings anonymous.
    expect(MANAGERS).toContain("effectiveTo: today()");
    expect(MANAGERS).toContain("activeStatus: 0");
    expect(MANAGERS).not.toMatch(/hrmsApi\.delete/);
  });

  it("refuses an end date before the start date", () => {
    expect(MANAGERS).toContain("draft.effectiveTo < draft.effectiveFrom");
  });
});

describe("vendor applicability bites where a vendor is chosen", () => {
  it("scopes the GRN vendor picker by branch", () => {
    // The Vendor Master can restrict a vendor to a branch; this is the one place that has to
    // honour it, because this is where a vendor actually gets picked.
    expect(GRN_FORM).toContain("&branchId=${encodeURIComponent(form.branchId)}");
  });

  it("refetches when the branch changes, so no stale list survives", () => {
    expect(GRN_FORM).toContain('queryKey: ["grn-vendor-search", vendorSearch, form.branchId]');
  });
});

describe("the queue can show the history it promises", () => {
  it("keeps the promise it makes in its own copy", () => {
    // The reason box says "the reason is kept on the voucher's history". Until the endpoint was
    // wired, five call sites wrote finance_approval_event and nothing could read any of it back.
    expect(QUEUE).toContain("the reason is kept on the voucher's history");
    expect(QUEUE).toContain("/approval-history");
  });

  it("fetches on demand, not once per row", () => {
    // A queue of twenty would otherwise fire twenty requests to show nothing most of the time.
    expect(QUEUE).toContain("enabled: Boolean(historyFor?.id)");
  });

  it("renders every event, so a twice-returned voucher shows both reasons", () => {
    // The whole reason this is an append-only table rather than a column each transition
    // overwrites. Rendering only the latest would throw that away at the last step.
    expect(QUEUE).toContain("history.data.map((event)");
    expect(QUEUE).toContain("event.remarks");
  });

  it("shows who acted and when", () => {
    expect(QUEUE).toContain("event.actor_name");
    expect(QUEUE).toContain("dateLabel(event.created_at)");
  });
});

describe("a returned GRN can be sent on again (Requirement 9)", () => {
  it("offers resubmit, which had an endpoint and no caller", () => {
    // Return had a UI and resubmit did not, so a returned GRN was stuck: Finance could send it
    // back and the raiser had no way to send it on. Half a workflow is worse than none, because
    // the half that works is the one that takes the GRN out of circulation.
    expect(SEARCH).toContain("/resubmit");
    expect(SEARCH).toContain('String(row.status).startsWith("returned_")');
  });

  it("shows the action only on returned rows", () => {
    // On anything else it would either 400 or, worse, look like a valid thing to do.
    const cell = SEARCH.slice(SEARCH.indexOf('startsWith("returned_")'));
    expect(cell.slice(0, 400)).toContain("Resubmit");
  });
});

describe("billing status can be set, not just displayed (Requirement 4)", () => {
  it("calls the setter that previously had no caller", () => {
    expect(SEARCH).toContain("/billing-cycle");
    expect(SEARCH).toContain("billingCycleStatus: input.next");
  });

  it("cycles back to unclassified rather than trapping a row", () => {
    // Most rows are NULL because the column postdates them, and that means "nobody has
    // classified this". Forcing a guess is worse than leaving it, so the state must stay
    // reachable rather than being a one-way door out of.
    expect(SEARCH).toContain('if (current === "CLOSED") return null;');
  });

  it("refetches after a change so the row reflects it", () => {
    expect(SEARCH).toContain("refetchResults()");
  });
});

describe("the salary voucher's number is asked for, not invented", () => {
  it("sends a starting serial the user supplies", () => {
    // Tally owns this sequence. Defaulting silently to 1 printed ".../1" on every voucher —
    // authoritative-looking, wrong, and identical across generations.
    expect(VOUCHER).toContain("serialFrom=");
    expect(VOUCHER).toContain("setSerialFrom");
  });

  it("says the numbers are provisional when none is given", () => {
    // Silence would let somebody export ".../1" believing it was real.
    expect(VOUCHER).toContain("provisional");
    expect(VOUCHER).toContain("Tally owns this sequence");
  });

  it("refetches when the serial changes", () => {
    expect(VOUCHER).toContain('queryKey: ["salary-vouchers", runId, companyCode, serialFrom]');
  });

  it("sends the same serial to the export as to the preview", () => {
    // An export numbered differently from the screen it was checked on is the worst outcome.
    const uses = VOUCHER.match(/\$\{query\}/g) ?? [];
    expect(uses.length).toBeGreaterThanOrEqual(2);
  });
});

/**
 * The review payload and the role gates in front of it.
 *
 * Both defects here were invisible on screen: the buttons rendered, and the failure only
 * appeared as a toast after the click. A contract test is the only cheap way to keep a
 * hand-maintained client payload in step with a server-side enum.
 */
describe("the imprest queue speaks the API's review contract", () => {
  const GRN_SERVICE = read("backend/src/modules/finance/grn.service.ts");
  const GRN_ROUTES = read("backend/src/modules/finance/grn.routes.ts");
  const GRN_PAGE = read("src/pages/NativeGRNManagement.tsx");

  it("sends the past-tense decision the service actually accepts", () => {
    // grn.routes.ts hands req.body straight to reviewGrn, so the client's spelling IS the
    // contract. "approve"/"reject" failed the guard and every action in this queue errored.
    expect(GRN_SERVICE).toContain('["approved", "rejected"].includes(payload.decision)');
    expect(QUEUE).toContain('decision: "approved"');
    expect(QUEUE).toContain('decision: "rejected"');
    expect(QUEUE).not.toContain('decision: "approve"');
    expect(QUEUE).not.toContain('decision: "reject"');
  });

  it("sends the rejection remark under the key the service reads", () => {
    // reviewGrn requires payload.reviewNote on a rejection; `note` arrived as undefined and
    // tripped "Review remarks are required when rejecting a GRN".
    expect(GRN_SERVICE).toContain("payload.reviewNote?.trim()");
    expect(QUEUE).toContain("reviewNote: input.reason");
  });

  it("only offers review tabs to roles GRN_REVIEW_ROLES admits", () => {
    // `admin` is deliberately absent from GRN_REVIEW_ROLES; showing it the queue produced a
    // tab whose every action 403s.
    expect(GRN_ROUTES).toContain(
      'const GRN_REVIEW_ROLES: RoleKey[] = ["branch_head", "finance_head", "accounts_head", "super_admin"]'
    );
    const canReview = GRN_PAGE.slice(GRN_PAGE.indexOf("const canReview"), GRN_PAGE.indexOf("const canAttribute"));
    expect(canReview).not.toContain('"admin"');
    expect(canReview).toContain('"branch_head"');
  });

  it("gates the LOB attribution tab on the same roles as its own count", () => {
    // The count was gated and the tab was not, so `finance`/`payroll_head` got an empty panel.
    expect(GRN_PAGE).toContain("useCanAttributeGrnLob()");
    expect(GRN_PAGE).toContain("{canAttribute && (");
  });
});
