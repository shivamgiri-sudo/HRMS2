# Open policy questions — dashboard/data-quality self-audit (2026-08-05)

Four items from this session's fixes need a decision from a specific owner, not another engineering guess. Items 1 and 4 have since been tightened to a more defensible interim number/formula (see below) — still not a confirmed policy, just a better placeholder pending your sign-off. Item 2 got a UI fix for the actual risk (a misleading freshness label) rather than a TTL change. Item 3 now has a written draft policy to sign off on. Nothing is broken or blocked; these are refinements once you confirm the intended answer.

---

## 1. Payroll/HR — onboarding grace-window thresholds

**Where:** Payroll Readiness dashboard tile — "missing bank/PAN/UAN" counts.

**Current behavior (updated 2026-08-05):** An employee is flagged as a compliance blocker if bank/PAN are still missing **30 days** after joining (tightened from 45 — tied to the first payroll cycle, the actual point salary disbursement becomes blocked), or UAN is still missing after **60 days** (tightened from 90 — EPFO's realistic KYC/seeding lag for a *fresh* UAN). Verified live that tightening surfaces more current, near-term gaps rather than hiding them: missingBank 81→91, missingPan 196→203, missingUan 342→471.

**The ask:** Are 30/60 days the right cutoffs? We tried to derive these from actual historical onboarding-completion data instead of guessing, and couldn't — 99.96% of `employee_bank_detail` timestamps are from two bulk data-migration batches, not organic per-employee completion dates, and there's no field-change audit trail (`audit_log`/`employee_epf_audit_log` are both empty) to reconstruct real onboarding lag. Also checked whether `employees` distinguishes a brand-new UAN from a transfer-from-previous-employer UAN (the latter should clear much faster) — no such column exists. So this still needs your operational SLA, not a computed number: what's the actual expected turnaround for bank/PAN paperwork, and for UAN allocation via EPFO?

---

## 2. Dashboard/Finance owners — cache staleness tolerance

**Where:** All role dashboards (30s cache) and the P&L summary/trend views (60s cache).

**Current behavior:** Repeated requests for the same dashboard/scope within the TTL window return a cached result instead of re-querying — this is why dashboards now load in milliseconds instead of seconds for the 2nd+ viewer. Underlying data can be up to 30s (dashboards) or 60s (P&L) old.

**The ask:** Is that acceptable, particularly for P&L, since those numbers reach CEO/finance roles? The bigger question isn't the exact number — it's whether you're comfortable with *any* caching sitting in front of revenue/EBITDA/cost figures at all. (Note: P&L's cache is already cleared immediately whenever someone explicitly recalculates a period, so the 60s window only matters between an unprompted underlying data change and the next viewer — not a rolling risk on numbers being actively worked on.)

**Fixed 2026-08-05 (a real gap, not the TTL question itself):** the CEO dashboard's page-level "Data as of" timestamp was reflecting the *general* dashboard-metrics cache (30s), not the P&L cache (60s) the Revenue Gap MTD tile actually reads — so a CEO could see a fresher-looking page timestamp than the revenue figure actually was. The tile now shows its own "P&L as of HH:MM" using `generatedAt`, which was already computed correctly end-to-end, just not surfaced. The TTL-acceptability question above is still open.

---

## 3. Compliance/Security — report data-classification policy

**Where:** Report catalog (`REPORT_CATALOG`) — all 50 entries, each tagged `sensitivityLevel` / `containsPII` / `containsFinancialData`, which gates who can view/export them.

**Current behavior:** Each report was classified by inspecting its columns (salary/bank/PAN/UAN/ESIC/TDS → highly restricted, individual-identifiable non-financial → confidential, aggregates → internal), erring toward more restrictive when unsure. No written policy existed to check this against, so it's now written up as a 4-rule policy at `docs/dashboard-audit/REPORT_DATA_CLASSIFICATION_POLICY.md`, ratifying the existing classification rather than proposing a new scheme — the ~50 current entries don't need reclassifying, only confirming.

**The ask:** Sign off on that policy doc (or send corrections). Once signed off, the next report someone adds gets classified against a written rule instead of one person's eyeballing.

---

## 4. WFM/Ops — shrinkage metric definition

**Where:** Ops-pulse tile — `avg_lunch_pct`, `avg_bio_pct`, `avg_training_pct`, `avg_qa_pct`, and `avg_shrinkage_pct`.

**Current behavior (updated 2026-08-05):** Switched the primary fields to **org-wide weighted** — SUM(unavailable time)/SUM(login time) — matching standard WFM capacity/forecasting convention, since this tile sits next to capacity metrics (`avg_aht_seconds`, `total_calls`). Verified live the two definitions actually diverge (2026-06-12: weighted 2.39% vs per-agent 2.69% on the same 220 agents). The previous **per-agent-average** shape is kept, not deleted — now returned as `avg_shrinkage_pct_per_agent`/`shrinkage_breakdown_per_agent`, for coaching use ("is the typical agent over-using breaks," a different question from capacity loss).

**The ask:** Confirm the weighted figure is the right one to treat as primary/default for staffing decisions. If WFM/ops actually wants the per-agent view front-and-center instead (e.g. for individual coaching dashboards), that field now exists too — it's a matter of which one gets the prominent tile, not an either/or rebuild.

**Also surfaced while verifying this (separate, pre-existing finding):** `apr.BIO`/`LUNCH`/`QA`/`TRAINING` have been all-zero in the live data since ~2026-06-12 — a live data-feed gap, not something this fix caused. Worth its own investigation with whoever owns the `apr` sync.

---

*Compiled as part of the 2026-08-04/05 dashboard data-quality self-audit, updated 2026-08-05 after implementing recommendations for all four items. Related commits: `fa747c82`, `dcc5866f`, `b9ba5fd8` (item 1); `f863400c`-era dashboard cache, `b1d08cc6`/`415a780a`, `a365dcf7` (item 2); `9ca49d35`, this doc + `report-catalog.ts` comment update (item 3); `362a5081`, `51c83d9b` (item 4).*
