# Open policy questions — dashboard/data-quality self-audit (2026-08-05)

Four items from this session's fixes need a decision from a specific owner, not another engineering guess. Current behavior is documented below for each — nothing is broken or blocked; these are refinements once you confirm the intended answer.

---

## 1. Payroll/HR — onboarding grace-window thresholds

**Where:** Payroll Readiness dashboard tile — "missing bank/PAN/UAN" counts.

**Current behavior:** An employee is only flagged as a compliance blocker if bank/PAN are still missing **45 days** after joining, or UAN is still missing after **90 days**. Before this, every recent joiner showed up as a blocker on day one, which was noise, not signal.

**The ask:** Are 45 and 90 days the right cutoffs? We tried to derive these from actual historical onboarding-completion data instead of guessing, and couldn't — the only timestamps available in `employee_bank_detail` are from a bulk data migration, not organic per-employee completion dates, and there's no field-change audit trail to reconstruct real onboarding lag. So this needs your operational SLA, not a computed number: what's the actual expected turnaround for bank/PAN paperwork, and for UAN allocation via EPFO?

---

## 2. Dashboard/Finance owners — cache staleness tolerance

**Where:** All role dashboards (30s cache) and the P&L summary/trend views (60s cache).

**Current behavior:** Repeated requests for the same dashboard/scope within the TTL window return a cached result instead of re-querying — this is why dashboards now load in milliseconds instead of seconds for the 2nd+ viewer. Underlying data can be up to 30s (dashboards) or 60s (P&L) old.

**The ask:** Is that acceptable, particularly for P&L, since those numbers reach CEO/finance roles? The bigger question isn't the exact number — it's whether you're comfortable with *any* caching sitting in front of revenue/EBITDA/cost figures at all. (Note: P&L's cache is already cleared immediately whenever someone explicitly recalculates a period, so the 60s window only matters between an unprompted underlying data change and the next viewer — not a rolling risk on numbers being actively worked on.)

---

## 3. Compliance/Security — report data-classification policy

**Where:** Report catalog (`REPORT_CATALOG`) — 27 newly-registered reports this session, each tagged `sensitivityLevel` / `containsPII` / `containsFinancialData`, which gates who can view/export them.

**Current behavior:** Each report was classified by inspecting its columns (salary/bank → highly restricted, names/attendance → confidential, aggregates → internal), erring toward more restrictive when unsure. We searched `docs/` (including the DPDP folder) for a written data-classification policy to check this against — none exists.

**The ask:** Not "is today's classification wrong" (it's a reasonable interim judgment) — it's that there's no source of truth for the *next* report someone adds. Worth having a short written classification policy so this stops being one person's eyeballing every time.

---

## 4. WFM/Ops — shrinkage metric definition

**Where:** Ops-pulse tile — `avg_lunch_pct`, `avg_bio_pct`, `avg_training_pct`, `avg_qa_pct`, and the pre-existing `avg_shrinkage_pct` next to it.

**Current behavior:** All five are computed as a **per-agent average** — each agent's own lunch-time-as-% of their own login time, then averaged across agents equally, regardless of how long each agent was logged in.

**The ask:** Standard WFM practice usually defines "shrinkage" as an **org-wide weighted** figure (total unavailable time ÷ total available time) for staffing/capacity forecasting, which is a meaningfully different number when agents' shift lengths vary. The current per-agent-average shape matches this codebase's pre-existing convention, but given this tile sits next to capacity metrics like `avg_aht_seconds`/`total_calls`, the weighted definition may be the better fit for how it's actually used. Please confirm which one you intend before we touch the shared formula — the fix is a small SQL rewrite once we know the answer.

---

*Compiled as part of the 2026-08-04/05 dashboard data-quality self-audit. Related commits: `fa747c82`, `dcc5866f` (item 1); `f863400c`-era dashboard cache, `b1d08cc6`/`415a780a` (item 2); `9ca49d35` (item 3); `362a5081` (item 4).*
