# LP Onboarding data uploader module

Self-contained: this whole `lp_onboarding/` folder can be copied to any
Windows machine and run on its own — it does **not** need the rest of the
HRMS2 repo, or the `lp_feedback`/`housing_owner`/`housing_premium` folders,
checked out alongside it. It already contains its own credentials
(`idcloud.env`, `db.env`) and its own dependency list (`requirements.txt`).

This is the **twin** of `../lp_feedback/` — same website
(`eresolution.idcloud.in:9003`), same two reports (Agent Wise Performance =
report ID 18, Call Register = report ID 13, both Outbound → Agent), same
download/convert/upload pattern, same Sunday-skip rule. The only real
differences are the login (`bhawna` / `a12345` here, vs `jyotsana malik`
here for LP Feedback) and the target tables (`db_masmis.lp_onboarding_apr` /
`lp_onboarding_cdr` here, vs `lp_feedback_apr` / `lp_feedback_cdr` there).
IDCloud scopes each login to its own team automatically — logging in as
`bhawna` and generating report 18 shows Onboarding's own agents (Akanksha
rai, Bhawna Sood, Bhoomi Agnihotri, Kajal, Kiran Singh, Neha, Preeti Gautam,
Tanisha Dixit, Tanya Rajawat — 9 agents, confirmed live), not Feedback's.

**Origin note (2026-09-28):** the credentials for this pipeline were
originally (mistakenly) used to import data into `lp_feedback_apr`/`cdr`
under the impression they were the Feedback team's login. Once caught, that
data (17–26 Sep) was moved into `lp_onboarding_apr`/`lp_onboarding_cdr` —
where it already belongs — with the `upload_batch`/`upload_log` audit trail
corrected to match, and `lp_feedback_apr`/`cdr` were restored to their
original state before being re-imported correctly with the real Feedback
login. See `../lp_feedback/README.md` for that pipeline's own notes.

## What it does (daily)

Every day, for the previous day's date, downloads **Agent Wise Performance**
→ `db_masmis.lp_onboarding_apr` and **Call Register** →
`db_masmis.lp_onboarding_cdr`. `daily_lp_onboarding.py` runs both
end-to-end and is the one thing Task Scheduler should call. Each report is
independently idempotent (checked by `report_date`) and independently
fault-tolerant. **Sundays are skipped entirely** (same rule as LP Feedback).

See `../lp_feedback/README.md`'s "Hard-won details" section for the full
list of portal quirks this pipeline works around (two-step login, the
Report List grid never rendering in an automated session, the Agent field
defaulting to empty not "all", the date field needing `dateType="Fixed"`,
"Generate" being a `<span>` not a `<button>`, "Export to CSV" being a form
submit) — all of it applies identically here, just against a different
login and target tables.

## One-time setup on a new machine

1. **Copy this whole folder** (`lp_onboarding/`) to the target machine.
2. **Install Python 3.11+** and **Google Chrome**, if not already present.
3. `py -m pip install -r requirements.txt`
4. Check `idcloud.env` and `db.env` are present and filled in (git-ignored):
   - `idcloud.env`:
     ```
     IDCLOUD_USERNAME=bhawna
     IDCLOUD_PASSWORD=<real password>
     ```
   - `db.env`: same shape as every other company folder's (`DB_HOST`,
     `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME=mas_hrms`).
5. **Test it manually first**:
   ```
   py daily_lp_onboarding.py --date 2026-09-16
   ```
   (a date already known to have data.)
6. **Register the Task Scheduler job** — same pattern as
   `../lp_feedback/README.md`'s: Program/script `py`, Add arguments
   `"C:\...\lp_onboarding\daily_lp_onboarding.py"`, Start in
   `C:\...\lp_onboarding`, Daily trigger after midnight.

## Manual / one-off use

```
py download_lp_onboarding_report.py --report apr --date 2026-09-27 --headless
py convert_lp_onboarding_apr.py downloads\LpOnboarding_AgentWisePerformance_....csv --out downloads\apr.csv
py upload_lp_onboarding_apr.py downloads\apr.csv --dry-run   # check first
py upload_lp_onboarding_apr.py downloads\apr.csv             # then for real
```
Same pattern with `cdr` / `convert_lp_onboarding_cdr.py` /
`upload_lp_onboarding_cdr.py` for Call Register. Or let the orchestrator do
all six steps for yesterday:
```
py daily_lp_onboarding.py
```
