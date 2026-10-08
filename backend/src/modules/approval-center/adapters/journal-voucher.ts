import type { ApprovalAdapter, ApprovalItem } from "../types.js";
import { badge, date, f, fields, iso, long, money, str } from "../format.js";
import { rowsOf } from "./finance-shared.js";

const MAX_DETAIL = 30;
const TYPE_LABEL = (t: unknown) => str(t).replace(/_/g, " ");

function lineText(l: any): string {
  const dr = Number(l.debitAmount) > 0 ? `Dr ${money("", l.debitAmount).value}` : "";
  const cr = Number(l.creditAmount) > 0 ? `Cr ${money("", l.creditAmount).value}` : "";
  return `${str(l.accountLabel)}${l.accountHint ? ` (${str(l.accountHint)})` : ""} — ${[dr, cr].filter(Boolean).join(" ")}${l.narration ? ` — ${str(l.narration)}` : ""}`;
}

/**
 * Manual journal voucher awaiting approval. The module computes `permissions.canApprove` per row
 * (approver role AND not the maker); we only surface rows where it is true. Approving posts to the ledger.
 */
export const journalVoucherAdapter: ApprovalAdapter = {
  kind: "journal_voucher",
  label: "Journal voucher",
  category: "Finance",
  async list(ctx) {
    const res = await ctx.call("GET", "/api/finance/journal-vouchers", { query: { status: "pending_approval", pageSize: 100, sort: "voucherDate", dir: "asc" } });
    const rows = rowsOf(res?.data ?? res).filter((r) => str(r.status) === "pending_approval" && r.permissions?.canApprove === true);
    const picked = rows.slice(0, MAX_DETAIL);
    const details = await Promise.all(
      picked.map((r) => ctx.call("GET", `/api/finance/journal-vouchers/${encodeURIComponent(String(r.id))}`).then((d) => d?.data ?? d).catch(() => null)),
    );
    const out: ApprovalItem[] = [];
    picked.forEach((r, i) => {
      const d: any = details[i];
      const lines: any[] = Array.isArray(d?.lines) ? d.lines : [];
      const hours = r.pendingHours === null || r.pendingHours === undefined ? null : Number(r.pendingHours);
      out.push({
        uid: `journal_voucher:${r.id}`,
        kind: "journal_voucher",
        kindLabel: "Journal voucher",
        category: "Finance",
        id: String(r.id),
        title: `${str(r.voucherNumber) || "Journal voucher"} — ${money("", r.totalAmount).value}`,
        subtitle: `${TYPE_LABEL(r.jvType)} · ${str(r.narration).slice(0, 80)}`,
        requester: { name: r.createdByName, branch: r.branchName },
        stage: "Finance Head / CEO approval",
        fields: fields(
          f("Voucher number", r.voucherNumber),
          badge("Voucher type", TYPE_LABEL(r.jvType)),
          date("Voucher date", r.voucherDate),
          money("Total amount", r.totalAmount),
          f("Reference", r.referenceNo),
          f("Branch", r.branchName),
          f("Cost centre", r.costCentreName),
          f("Process", r.processName),
          f("Lines", r.lineCount),
          long("Posting lines", lines.map(lineText).join("\n")),
          f("Prepared by", r.createdByName),
          date("Submitted on", r.submittedAt),
          f("Hours pending", hours),
          long("Narration", r.narration),
        ),
        submittedAt: iso(r.submittedAt ?? r.createdAt),
        priority: hours !== null && hours > 48 ? "high" : "normal",
        viewPath: `/finance/ledger?tab=journal&approvalId=${encodeURIComponent(String(r.id))}`,
        rejectNeedsReason: true,
        approveLabel: "Approve & post",
      });
    });
    return out;
  },
  async decide(ctx, item, action, remarks) {
    const base = `/api/finance/journal-vouchers/${encodeURIComponent(item.id)}`;
    if (action === "approve") await ctx.call("POST", `${base}/approve`, { body: { note: remarks || undefined } });
    else await ctx.call("POST", `${base}/reject`, { body: { reason: remarks } });
  },
};
