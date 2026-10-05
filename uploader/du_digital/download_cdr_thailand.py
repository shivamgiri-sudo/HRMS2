#!/usr/bin/env python3
"""
Downloads DU Digital's Thailand "Export Calls Report" (CDR) from the DU
dialer admin panel (dudigital.par-infinity.com, a vicidial instance).

Adapted from the user's own working reference script (confirmed live
against the real site) with this repo's standard safety changes applied:
  - Credentials come only from uploader/du_digital/du.env (git-ignored),
    never hardcoded in this file.
  - Downloads go to uploader/du_digital/downloads/, never a personal path
    (the original script's D:\\MIS\\DU\\Auto is still honoured if
    DU_DOWNLOAD_DIR is set in du.env, for continuity with any existing
    Task Scheduler job already pointed at that folder).
Selenium flow (admin.php basic-auth login -> Administration -> Reports ->
Export Calls Report -> select Thailand groups -> submit -> click the
resulting .txt download link) is otherwise unchanged from the working
reference.

Usage:
    py download_cdr_thailand.py [--headless]
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

from dotenv import dotenv_values
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait, Select
from selenium.webdriver.support import expected_conditions as EC

HERE = Path(__file__).resolve().parent
DEFAULT_DOWNLOAD_DIR = HERE / "downloads"

THAILAND_GROUPS = ["Thailand_English", "Thailand_Hindi", "Thailand_Inbound", "ThailandThai"]


def load_env() -> dict[str, str]:
    env_path = HERE / "du.env"
    if not env_path.exists():
        sys.exit(f"Cannot find {env_path} -- see README.md for the required keys (DU_USERNAME, DU_PASSWORD, DU_HOST).")
    env = dotenv_values(env_path)
    missing = [k for k in ("DU_USERNAME", "DU_PASSWORD", "DU_HOST") if not env.get(k)]
    if missing:
        sys.exit(f"du.env is missing: {', '.join(missing)}")
    return env


def download_dir(env: dict[str, str]) -> Path:
    custom = env.get("DU_DOWNLOAD_DIR", "").strip()
    d = Path(custom) if custom else DEFAULT_DOWNLOAD_DIR
    d.mkdir(parents=True, exist_ok=True)
    return d


def build_driver(save_folder: Path, headless: bool) -> webdriver.Chrome:
    options = webdriver.ChromeOptions()
    if headless:
        options.add_argument("--headless=new")
        options.add_argument("--disable-gpu")
    prefs = {
        "download.default_directory": str(save_folder),
        "download.prompt_for_download": False,
        "download.directory_upgrade": True,
        "safebrowsing.enabled": True,
    }
    options.add_experimental_option("prefs", prefs)
    return webdriver.Chrome(options=options)


def download_thailand_cdr(headless: bool = False, date_from: str | None = None, date_to: str | None = None) -> Path:
    env = load_env()
    save_folder = download_dir(env)
    driver = build_driver(save_folder, headless)
    wait = WebDriverWait(driver, 40)
    try:
        url = f"https://{env['DU_USERNAME']}:{env['DU_PASSWORD']}@{env['DU_HOST']}/vicidial/admin.php"
        driver.get(url)
        print("Login successful.")

        admin_btn = wait.until(EC.element_to_be_clickable((By.XPATH, "//a[contains(@href,'admin.php')]")))
        driver.execute_script("arguments[0].click();", admin_btn)

        wait.until(EC.element_to_be_clickable((By.XPATH, "//a[contains(@href,'ADD=999999')]"))).click()
        print("Reports opened.")

        export_calls = wait.until(EC.element_to_be_clickable((By.XPATH, "//a[@href='call_report_export.php']")))
        driver.execute_script("arguments[0].click();", export_calls)
        print("Export Calls Report opened.")

        # Confirmed live 2026-10-01: query_date/end_date are plain text inputs, both
        # defaulting to today -- the original reference script never touched them, so it
        # always pulled just today's data. A caller that needs a specific day or a range
        # (e.g. a historical backfill) sets them explicitly here instead.
        if date_from:
            qd = wait.until(EC.presence_of_element_located((By.NAME, "query_date")))
            qd.clear(); qd.send_keys(date_from)
        if date_to:
            ed = driver.find_element(By.NAME, "end_date")
            ed.clear(); ed.send_keys(date_to)

        Select(driver.find_element(By.NAME, "date_field")).select_by_value("entry_date")
        Select(driver.find_element(By.NAME, "rec_fields")).select_by_value("ALL")
        Select(driver.find_element(By.NAME, "campaign[]")).select_by_value("---ALL---")

        group_select = Select(driver.find_element(By.NAME, "group[]"))
        group_select.deselect_all()
        for g in THAILAND_GROUPS:
            try:
                group_select.select_by_value(g)
            except Exception:  # noqa: BLE001 -- a group not present in this instance is skipped, not fatal
                print(f"  (group not found, skipped: {g})")

        Select(driver.find_element(By.NAME, "list_id[]")).select_by_value("---ALL---")
        Select(driver.find_element(By.NAME, "status[]")).select_by_value("---ALL---")
        Select(driver.find_element(By.NAME, "user_group[]")).select_by_value("---ALL---")

        driver.find_element(By.NAME, "SUBMIT").click()
        print("Report submitted.")
        time.sleep(5)

        files_before = {f.name for f in save_folder.iterdir()}
        # The dialer builds the report asynchronously; a busy day can take well over the 40s default.
        link_xpath = "//a[contains(@href,'.txt') or contains(@href,'.csv') or contains(@href,'.xls')]"
        try:
            download_link = WebDriverWait(driver, 30).until(EC.element_to_be_clickable((By.XPATH, link_xpath)))
        except Exception:
            # Some runs save the report to the downloads folder without showing a link; use that file if it appears.
            for _ in range(120):
                new_txt = [f for f in {f.name for f in save_folder.iterdir()} - files_before
                           if f.endswith(".txt") and not f.endswith(".crdownload")]
                if new_txt:
                    downloaded = save_folder / new_txt[0]
                    print(f"File downloaded without a link: {downloaded}")
                    return downloaded
                time.sleep(1)
            debug_dir = save_folder.parent / "logs"
            debug_dir.mkdir(exist_ok=True)
            stamp = time.strftime("%Y%m%d_%H%M%S")
            (debug_dir / f"thailand_cdr_no_link_{stamp}.html").write_text(driver.page_source, encoding="utf-8")
            driver.save_screenshot(str(debug_dir / f"thailand_cdr_no_link_{stamp}.png"))
            raise RuntimeError(
                f"No download link appeared after 180s. Page saved to logs/thailand_cdr_no_link_{stamp}.html "
                "-- the report may be empty for this date or the page layout has changed."
            )
        print("Download link found.")
        driver.execute_script("arguments[0].click();", download_link)
        print("Download started.")

        seconds = 0
        downloaded: Path | None = None
        while seconds < 60:
            new_files = {f.name for f in save_folder.iterdir()} - files_before
            txt_files = [f for f in new_files if f.endswith(".txt") and not f.endswith(".crdownload")]
            if txt_files:
                downloaded = save_folder / txt_files[0]
                break
            time.sleep(1)
            seconds += 1
        if not downloaded:
            raise RuntimeError(f"Download did not complete within 60s (folder: {save_folder})")

        print(f"File downloaded: {downloaded}")
        return downloaded
    finally:
        driver.quit()


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--headless", action="store_true")
    ap.add_argument("--date-from", help="YYYY-MM-DD (default: today, matching the original reference script)")
    ap.add_argument("--date-to", help="YYYY-MM-DD (default: same as --date-from, or today)")
    args = ap.parse_args()
    path = download_thailand_cdr(headless=args.headless, date_from=args.date_from, date_to=args.date_to or args.date_from)
    print(path.resolve())


if __name__ == "__main__":
    main()
