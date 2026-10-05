#!/usr/bin/env python3
"""
Downloads the "Agent Performance" report export from Tata Tele Services'
CloudPhone admin panel (https://cloudphone.tatateleservices.com) for a chosen
date-range preset -- Housing Owner's source for db_masmis.Owner_cdr, the same
role download_callerdesk_report.py plays for Housing Premium's Pre_cdr.

Adapted from a working reference script the user supplied (real login,
Reporting -> Agent Performance -> preset date range -> Export -> wait for the
.xlsx download), with the two changes every script in this uploader/ folder
makes to a hand-run script before it is trusted to run unattended:
  - Credentials come only from housing_owner/tatatele.env (git-ignored),
    never hardcoded in this file.
  - Downloads go to housing_owner/downloads/, never a personal path.
The double click on the Reporting link (a plain .click() then a JS
execute_script click on a freshly-located element), the JS click on the
Agent Performance link, and the #reportrange -> li[data-range-key=...] ->
#exportButton sequence are all taken verbatim from that working script and
confirmed live against the real site (2026-09-28). One field differs from
the reference script: the login page currently uses id="loginId" (camelCase),
not "login_id" -- confirmed by dumping the real login page's DOM live, since
this Console login page appears to have been rebuilt since the reference
script was last run (it now redirects through /console?...&sso-login and
renders a Next.js login form). This script adds one safety check
CallerDesk's downloader already relies on (see download_callerdesk_report.py's
select_range doc): verifying #reportrange's displayed value actually changed
after clicking the preset, so a silently-unclicked preset can never produce a
wrong-range file that looks like a normal success.

Selenium Manager (built into Selenium >=4.6) resolves the matching
chromedriver automatically -- no separate webdriver-manager dependency needed
(matching this folder's Housing Premium sibling).

Only "Yesterday" (and the other calendar-preset labels below) is supported.
An arbitrary single custom day is NOT implemented here -- unlike CallerDesk's
Custom Range calendar (confirmed live, see download_callerdesk_report.py),
this site's Custom Range calendar DOM has not been inspected against a real
session, and guessing its cell structure risks silently selecting the wrong
day. Add it once someone can confirm the real DOM against a live login.

Usage:
    py download_owner_cdr_report.py [--range yesterday|today|last7|last30|thismonth|lastmonth] [--headless]
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

from dotenv import dotenv_values
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait

HERE = Path(__file__).parent
DOWNLOAD_DIR = HERE / "downloads"
CHROME_PROFILE_DIR = HERE / "chrome_profile"

LOGIN_URL = "https://cloudphone.tatateleservices.com/login"
RANGE_LABELS = {
    "today": "Today", "yesterday": "Yesterday", "last7": "Last 7 Days",
    "last30": "Last 30 Days", "thismonth": "This Month", "lastmonth": "Last Month",
}


def load_credentials() -> dict[str, str]:
    env_path = HERE / "tatatele.env"
    if not env_path.exists():
        sys.exit(f"Cannot find {env_path} -- credentials must come from this file, not be hardcoded.")
    creds = dotenv_values(env_path)
    if not creds.get("TATATELE_LOGIN_ID") or not creds.get("TATATELE_PASSWORD"):
        sys.exit("tatatele.env is missing TATATELE_LOGIN_ID / TATATELE_PASSWORD.")
    return creds


def build_driver(headless: bool = False) -> webdriver.Chrome:
    """Confirmed live 2026-10-01: cloudphone.tatateleservices.com's login now
    sits behind a Google reCAPTCHA (invisible v2, falling back to the visible
    "I'm not a robot" checkbox when the session looks untrusted) -- a fresh,
    cookie-less Chrome profile on every run is exactly what makes Google's
    risk check distrust the session and escalate to that visible challenge,
    which this script cannot click through. CHROME_PROFILE_DIR gives Chrome a
    PERSISTENT profile instead of a throwaway one, so once a human has logged
    in through it one time (non-headless: `py download_owner_cdr_report.py`
    with no --headless) and solved the checkbox by hand, that profile's own
    cookies/device-trust carry over into later headless runs that reuse it --
    standard browser session persistence, not a CAPTCHA bypass. Not a
    guarantee: how long TataTele/Google keeps trusting a device is up to
    them, so this may need re-solving by hand again later.
    """
    DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)
    CHROME_PROFILE_DIR.mkdir(parents=True, exist_ok=True)
    opts = Options()
    opts.add_argument("--window-size=1600,1000")
    opts.add_argument(f"--user-data-dir={CHROME_PROFILE_DIR}")
    if headless:
        # "new" headless (not the legacy --headless) -- needed so this can run
        # from Windows Task Scheduler with no interactive desktop session.
        opts.add_argument("--headless=new")
        opts.add_argument("--disable-gpu")
    opts.add_experimental_option("prefs", {
        "download.default_directory": str(DOWNLOAD_DIR),
        "download.prompt_for_download": False,
        "download.directory_upgrade": True,
        "profile.default_content_setting_values.automatic_downloads": 1,
        "profile.default_content_setting_values.media_stream_camera": 2,
        "profile.default_content_setting_values.media_stream_mic": 2,
        "profile.default_content_setting_values.notifications": 2,
    })
    driver = webdriver.Chrome(options=opts)
    # Required for Chrome's download manager to work under headless mode.
    driver.execute_cdp_cmd("Page.setDownloadBehavior", {"behavior": "allow", "downloadPath": str(DOWNLOAD_DIR)})
    return driver


def click(driver: webdriver.Chrome, element) -> None:
    driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", element)
    driver.execute_script("arguments[0].click();", element)


def wait_for_download(folder: Path, before: set[str], timeout: int = 90) -> Path:
    """Waits for a new .zip/.xlsx/.xls to land in `folder`.

    Confirmed live (2026-09-28): clicking #exportButton does not download a
    plain .xlsx -- it downloads a .zip (e.g.
    'tata_agent_performance_report_27-09-2026_27-09-2026__<hash>.zip')
    containing TWO .xlsx files. An earlier version of this function only
    recognised .xlsx/.xls and so kept polling past a .zip that had already
    finished downloading, eventually timing out even though the file was
    sitting right there the whole time -- fixed by also accepting .zip.
    """
    seconds = 0
    while seconds < timeout:
        files_now = set(f.name for f in folder.iterdir())
        if any(name.endswith(".crdownload") for name in files_now):
            time.sleep(1)
            seconds += 1
            continue
        new_files = files_now - before
        matches = [f for f in new_files if f.endswith((".xlsx", ".xls", ".zip"))]
        if matches:
            return folder / matches[0]
        time.sleep(1)
        seconds += 1
    raise RuntimeError(f"Download did not complete within {timeout}s (folder: {folder})")


def unwrap_download(zip_or_file: Path, final_path: Path) -> Path:
    """If the download is the real .zip (the normal case -- see
    wait_for_download's docstring), extracts it and keeps only the
    "...datewise_agent_performance_report...xlsx" member (the one with a
    Date column per agent per day -- confirmed live to carry Date, Agent,
    Email ID and all other Owner_cdr columns except Not Connected/Connected/
    Average Talk time, which convert_owner_cdr_export.py derives). The
    zip's OTHER member ("...agent_performance_report...xlsx", no Date column,
    one row per agent for the whole range) is discarded -- it cannot tell two
    different days of the same agent apart, so it is useless for a per-day
    table like Owner_cdr. If the download is already a plain .xlsx/.xls
    (kept in case the site ever changes to not zip it), it is used as-is."""
    if zip_or_file.suffix.lower() != ".zip":
        zip_or_file.rename(final_path)
        return final_path

    import zipfile
    extract_dir = zip_or_file.with_suffix("")
    with zipfile.ZipFile(zip_or_file) as z:
        names = z.namelist()
        datewise = [n for n in names if "datewise" in n.lower()]
        if not datewise:
            raise RuntimeError(f"Zip {zip_or_file} did not contain a 'datewise' report (found: {names})")
        z.extract(datewise[0], extract_dir)
    (extract_dir / datewise[0]).rename(final_path)
    zip_or_file.unlink()
    import shutil
    shutil.rmtree(extract_dir, ignore_errors=True)
    return final_path


def download_report(range_key: str = "yesterday", headless: bool = False) -> Path:
    """Logs in, selects the given preset date range on the Agent Performance
    report, clicks Export, waits for the file, and returns its path (renamed
    with a timestamp so repeated runs never collide or silently overwrite)."""
    preset_text = RANGE_LABELS[range_key]
    creds = load_credentials()
    driver = build_driver(headless=headless)
    wait = WebDriverWait(driver, 40)
    try:
        print("Logging in...")
        driver.get(LOGIN_URL)
        wait.until(EC.presence_of_element_located((By.ID, "loginId"))).send_keys(creds["TATATELE_LOGIN_ID"])
        driver.find_element(By.ID, "password").send_keys(creds["TATATELE_PASSWORD"])
        click(driver, wait.until(EC.element_to_be_clickable((By.ID, "login_button"))))
        print("  logged in.")
        time.sleep(4)

        wait.until(EC.element_to_be_clickable((By.XPATH, "//a[contains(@href,'/reporting')]"))).click()
        reporting = wait.until(EC.presence_of_element_located((By.XPATH, "//a[contains(@href,'/reporting')]")))
        click(driver, reporting)
        print("  Reporting opened.")
        time.sleep(3)

        agent_perf = wait.until(EC.presence_of_element_located((By.XPATH, "//a[contains(@href,'agent-performance-report')]")))
        click(driver, agent_perf)
        print("  Agent Performance report opened.")

        range_input = wait.until(EC.element_to_be_clickable((By.ID, "reportrange")))
        original_value = range_input.text.strip()
        click(driver, range_input)
        option = wait.until(EC.element_to_be_clickable((By.XPATH, f"//li[@data-range-key='{preset_text}']")))
        click(driver, option)
        time.sleep(2)
        new_value = driver.find_element(By.ID, "reportrange").text.strip()
        if new_value == original_value:
            raise RuntimeError(
                f"Date range did not change after selecting '{preset_text}' (still '{new_value}'). "
                f"Refusing to export against the wrong range."
            )
        print(f"  range now: {new_value}")

        files_before = set(f.name for f in DOWNLOAD_DIR.iterdir())
        wait.until(EC.element_to_be_clickable((By.ID, "exportButton"))).click()
        print("  export clicked, waiting for download...")

        downloaded = wait_for_download(DOWNLOAD_DIR, files_before)
        final_path = DOWNLOAD_DIR / f"OwnerCDR_{range_key}_{int(time.time())}.xlsx"
        unwrap_download(downloaded, final_path)
        print(f"\nSaved: {final_path}")
        return final_path
    finally:
        driver.quit()


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--range", choices=RANGE_LABELS.keys(), default="yesterday")
    ap.add_argument("--headless", action="store_true", help="Run Chrome headless -- for unattended/scheduled runs")
    args = ap.parse_args()

    out_path = download_report(range_key=args.range, headless=args.headless)
    print(out_path.resolve())


if __name__ == "__main__":
    main()
