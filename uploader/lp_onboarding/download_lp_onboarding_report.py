#!/usr/bin/env python3
"""
Downloads a report export from the IDCloud webconsole
(https://eresolution.idcloud.in:9003) -- LP Onboarding's source for both
db_masmis.lp_onboarding_apr ("Agent Wise Performance", report ID 18, under
Group=Outbound/Sub Group=Agent) and db_masmis.lp_onboarding_cdr ("Call
Register", report ID 13, same group).

Everything below was confirmed live against the real portal (2026-09-28),
much of it only after several wrong guesses -- see the notes at each step:

  - Login is TWO steps: #LoginId -> #submit reveals a NEW #LoginPassword
    field (not present on the first form at all) -> #submit again.
  - The Report List page (/​_report/_list) render sits on top of a Kendo grid
    that repeatedly failed to show any rows in an automated session (stuck
    on "No items to display" even after long waits/retries) -- not because
    the reports don't exist (they do -- the same account's real browser
    session lists 29 of them across 3 pages), but because the grid's own
    AJAX call (POST /Report/_list/GetReport?ISparent=True) defaults to
    pageSize=10 and no combination of retries fixes a UI that just isn't
    rendering in headless Chrome. Avoided entirely here: this script goes
    straight to the report's own edit URL
    (/_Report/_edit/_tab/<report_id>), which works reliably.
  - The "Agent" field defaults to EMPTY in a fresh session, not "all
    agents" -- despite a real user's own browser showing it pre-filled with
    all 9 LP Onboarding agents (persisted per-account state from their own
    prior use). Generating a report with it empty silently returns
    "NOAGENT" / all-zero summary rows, not an error -- this cost real time
    to notice. Fixed here by reading the field's own Kendo MultiSelect
    dataSource and selecting every id in it (currently 9 agents -- the
    whole real LP Onboarding team; if that number changes, this script keeps
    working since it always selects "whatever the field offers", not a
    hardcoded list).
  - The date fields default to dateType="Current" (today + a day offset),
    but setting that offset's Kendo NumericTextBox value does NOT reliably
    propagate to what Generate actually queries (confirmed live: offset -2
    displayed "2026-09-26" in the date field but Generate still returned
    today's data). What DOES work reliably: switching dateType to "Fixed"
    (via its Kendo ComboBox -- options are '1st day of the month'/'1st day
    of the week'/'Current'/'Fixed') and setting the date field's own Kendo
    DatePicker value directly. All of the above must go through each
    field's real Kendo widget API (`$(el).data('kendoXxx')`, then
    `.value(...)` + `.trigger('change')`) -- setting the underlying
    `<input>`'s DOM value directly (even with dispatched input/change/blur
    events) updates the on-screen text but does not update the value
    Generate actually reads.
  - Clicking "Generate" (a `<span class="galaxyreport-search">`, NOT a
    `<button>` -- confirmed by dumping every button on the page and finding
    none of them said "Generate") lands directly on the Report View content
    on the SAME page; no separate tab click needed.
  - "Export to CSV" is not a plain link either -- it is
    `<input type="submit" data-format="csv" value="Export to CSV">` inside
    a real `<form action="/Home/_list/ExportServer_New" method="POST">`.
    Clicking it submits that form and Chrome's normal download manager
    handles the response like any other file download.
  - Format stays "Summary" (the field's own default) for both reports --
    never touched.

Usage:
    py download_lp_onboarding_report.py --report apr --date 2026-09-27 --headless
    py download_lp_onboarding_report.py --report cdr --headless   # defaults to yesterday
"""
from __future__ import annotations

import argparse
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path

from dotenv import dotenv_values
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait

HERE = Path(__file__).parent
DOWNLOAD_DIR = HERE / "downloads"
LOGIN_URL = "https://eresolution.idcloud.in:9003/Login"

# (report_id, human label used for the download's renamed filename)
REPORTS = {
    "apr": (18, "AgentWisePerformance"),
    "cdr": (13, "CallRegister"),
}


def load_credentials() -> dict[str, str]:
    env_path = HERE / "idcloud.env"
    if not env_path.exists():
        sys.exit(f"Cannot find {env_path} -- credentials must come from this file, not be hardcoded.")
    creds = dotenv_values(env_path)
    if not creds.get("IDCLOUD_USERNAME") or not creds.get("IDCLOUD_PASSWORD"):
        sys.exit("idcloud.env is missing IDCLOUD_USERNAME / IDCLOUD_PASSWORD.")
    return creds


def build_driver(headless: bool = False) -> webdriver.Chrome:
    DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)
    opts = Options()
    opts.add_argument("--window-size=1600,1200")
    opts.add_argument("--ignore-certificate-errors")  # the portal's cert chain isn't trusted by a clean Chrome profile
    if headless:
        opts.add_argument("--headless=new")
        opts.add_argument("--disable-gpu")
    opts.add_experimental_option("prefs", {
        "download.default_directory": str(DOWNLOAD_DIR),
        "download.prompt_for_download": False,
        "download.directory_upgrade": True,
        "profile.default_content_setting_values.media_stream_camera": 2,
        "profile.default_content_setting_values.media_stream_mic": 2,
        "profile.default_content_setting_values.notifications": 2,
    })
    driver = webdriver.Chrome(options=opts)
    driver.execute_cdp_cmd("Page.setDownloadBehavior", {"behavior": "allow", "downloadPath": str(DOWNLOAD_DIR)})
    return driver


def click(driver: webdriver.Chrome, element) -> None:
    driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", element)
    driver.execute_script("arguments[0].click();", element)


def wait_for_download(folder: Path, before: set[str], timeout: int = 30) -> Path:
    seconds = 0
    while seconds < timeout:
        files_now = set(f.name for f in folder.iterdir())
        if any(name.endswith(".crdownload") for name in files_now):
            time.sleep(1)
            seconds += 1
            continue
        new_files = files_now - before
        matches = [f for f in new_files if f.endswith((".csv", ".xlsx", ".xls"))]
        if matches:
            return folder / matches[0]
        time.sleep(1)
        seconds += 1
    raise RuntimeError(f"Download did not complete within {timeout}s (folder: {folder})")


def download_report(report: str, date_str: str | None = None, headless: bool = False) -> Path:
    """Logs in, opens the given report ('apr' or 'cdr'), selects every
    available agent, sets a fixed single-day date range, generates it, and
    exports to CSV. Returns the renamed download's path."""
    if report not in REPORTS:
        raise ValueError(f"report must be one of {list(REPORTS)}, got {report!r}")
    report_id, label = REPORTS[report]
    suffix = f"report_{report_id}_1440"
    target_date = date_str or (datetime.now() - timedelta(days=1)).strftime("%Y-%m-%d")
    y, m, d = (int(p) for p in target_date.split("-"))

    creds = load_credentials()
    driver = build_driver(headless=headless)
    wait = WebDriverWait(driver, 30)
    try:
        print("Logging in...")
        driver.get(LOGIN_URL)
        wait.until(EC.presence_of_element_located((By.ID, "LoginId"))).send_keys(creds["IDCLOUD_USERNAME"])
        click(driver, driver.find_element(By.ID, "submit"))
        wait.until(EC.presence_of_element_located((By.ID, "LoginPassword"))).send_keys(creds["IDCLOUD_PASSWORD"])
        click(driver, driver.find_element(By.ID, "submit"))
        time.sleep(4)
        print("  logged in.")

        driver.get(f"https://eresolution.idcloud.in:9003/_Report/_edit/_tab/{report_id}")
        wait.until(EC.presence_of_element_located((By.ID, f"agent_id_{suffix}")))
        time.sleep(2)

        print("  selecting all agents...")
        driver.execute_script(f"var w = $('#agent_id_{suffix}').data('kendoMultiSelect'); w.dataSource.read();")
        time.sleep(2)
        agent_count = driver.execute_script(f"""
            var w = $('#agent_id_{suffix}').data('kendoMultiSelect');
            var ids = w.dataSource.data().map(function(x) {{ return x.ID; }});
            w.value(ids);
            w.trigger('change');
            return ids.length;
        """)
        print(f"    {agent_count} agent(s) selected.")

        print(f"  setting date range to {target_date} (Fixed)...")
        driver.execute_script(f"""
            $('#dateType_from_date_{suffix}').data('kendoComboBox').value('Fixed');
            $('#dateType_from_date_{suffix}').data('kendoComboBox').trigger('change');
            $('#dateType_to_date_{suffix}').data('kendoComboBox').value('Fixed');
            $('#dateType_to_date_{suffix}').data('kendoComboBox').trigger('change');
        """)
        time.sleep(1)
        driver.execute_script(f"""
            $('#from_date_{suffix}').data('kendoDatePicker').value(new Date({y}, {m - 1}, {d}));
            $('#from_date_{suffix}').data('kendoDatePicker').trigger('change');
            $('#to_date_{suffix}').data('kendoDatePicker').value(new Date({y}, {m - 1}, {d}));
            $('#to_date_{suffix}').data('kendoDatePicker').trigger('change');
        """)
        time.sleep(2)
        actual_from = driver.find_element(By.ID, f"from_date_{suffix}").get_attribute("value")
        if actual_from != target_date:
            raise RuntimeError(f"Date did not apply correctly (wanted {target_date}, field shows {actual_from!r}). Refusing to generate against the wrong date.")

        print("  generating...")
        gen_btn = wait.until(EC.element_to_be_clickable((By.CSS_SELECTOR, "span.galaxyreport-search")))
        click(driver, gen_btn)
        time.sleep(6)

        files_before = set(f.name for f in DOWNLOAD_DIR.iterdir())
        export_btn = wait.until(EC.element_to_be_clickable((By.CSS_SELECTOR, "input[data-format='csv']")))
        click(driver, export_btn)
        print("  export clicked, waiting for download...")

        downloaded = wait_for_download(DOWNLOAD_DIR, files_before)
        final_path = DOWNLOAD_DIR / f"LpOnboarding_{label}_{target_date}_{int(time.time())}.csv"
        downloaded.rename(final_path)
        print(f"\nSaved: {final_path}")
        return final_path
    finally:
        driver.quit()


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--report", choices=REPORTS.keys(), required=True)
    ap.add_argument("--date", help="Single day, YYYY-MM-DD (default: yesterday)")
    ap.add_argument("--headless", action="store_true", help="Run Chrome headless -- for unattended/scheduled runs")
    args = ap.parse_args()

    out_path = download_report(report=args.report, date_str=args.date, headless=args.headless)
    print(out_path.resolve())


if __name__ == "__main__":
    main()
