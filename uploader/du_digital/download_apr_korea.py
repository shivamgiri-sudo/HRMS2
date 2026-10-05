#!/usr/bin/env python3
"""
Downloads DU Digital's Korea "Agents Time Detail" report (APR) from the DU
dialer admin panel -- reads the report's own <pre> text block directly
(no file download involved on this report type) and saves it as Excel.
Adapted from the user's own working reference script; see
download_cdr_thailand.py's header for the safety changes applied
(credentials in du.env, download dir not hardcoded). Campaign group id
1212130 and the date-range/user_group selectors are unchanged from the
working reference -- confirmed live against the real site by the user.

Usage:
    py download_apr_korea.py [--date YYYY-MM-DD] [--headless]
"""
from __future__ import annotations

import argparse
import sys
from datetime import datetime, timedelta
from pathlib import Path

import pandas as pd
from dotenv import dotenv_values
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait, Select
from selenium.webdriver.support import expected_conditions as EC

sys.path.insert(0, str(Path(__file__).resolve().parent))
from du_common import parse_ascii_table_report  # noqa: E402

HERE = Path(__file__).resolve().parent
DEFAULT_DOWNLOAD_DIR = HERE / "downloads"
KOREA_CAMPAIGN_GROUP = "1212130"


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


def download_korea_apr(target_date: str | None = None, headless: bool = False) -> Path:
    env = load_env()
    save_folder = download_dir(env)
    report_date = target_date or (datetime.now() - timedelta(days=0)).strftime("%Y-%m-%d")

    driver = build_driver(save_folder, headless)
    wait = WebDriverWait(driver, 40)
    try:
        url = f"https://{env['DU_USERNAME']}:{env['DU_PASSWORD']}@{env['DU_HOST']}/vicidial/admin.php"
        driver.get(url)

        wait.until(EC.element_to_be_clickable((By.XPATH, "//a[contains(@href,'ADD=999999')]"))).click()
        wait.until(EC.element_to_be_clickable((By.XPATH, "//a[contains(@href,'AST_agent_time_detail.php')]"))).click()

        wait.until(EC.presence_of_element_located((By.NAME, "query_date"))).clear()
        driver.find_element(By.NAME, "query_date").send_keys(report_date)
        driver.find_element(By.NAME, "end_date").clear()
        driver.find_element(By.NAME, "end_date").send_keys(report_date)

        campaign_select = wait.until(EC.presence_of_element_located((By.NAME, "group[]")))
        Select(campaign_select).select_by_value(KOREA_CAMPAIGN_GROUP)

        user_group = driver.find_element(By.NAME, "user_group[]")
        Select(user_group).select_by_value("--ALL--")

        driver.find_element(By.NAME, "SUBMIT").click()

        wait.until(EC.presence_of_element_located((By.TAG_NAME, "pre")))
        report_text = driver.find_element(By.TAG_NAME, "pre").text
        if not report_text.strip():
            raise RuntimeError("Report is empty.")

        # Confirmed live 2026-10-01: this report is an ASCII-bordered table
        # (+---+ borders, |-delimited fixed-width columns), not a clean pipe/tab file --
        # a plain pd.read_csv(sep='|'/'\t') silently produces one garbage column instead
        # of raising, so it never hit the except branch below despite being wrong. See
        # du_common.parse_ascii_table_report's own doc for the real parsing.
        parsed_rows = parse_ascii_table_report(report_text.splitlines())
        if not parsed_rows:
            raise RuntimeError("Could not find the agent table's header row in the report text.")
        df = pd.DataFrame(parsed_rows)

        file_date = report_date.replace("-", "")
        excel_path = save_folder / f"DU_KoreaAPR_{file_date}.xlsx"
        counter = 1
        while excel_path.exists():
            excel_path = save_folder / f"DU_KoreaAPR_{file_date}_{counter}.xlsx"
            counter += 1

        df.to_excel(excel_path, index=False)
        print(f"Report saved as: {excel_path}")
        return excel_path
    finally:
        driver.quit()


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--date", help="YYYY-MM-DD (default: today, matching the original reference script)")
    ap.add_argument("--headless", action="store_true")
    args = ap.parse_args()
    path = download_korea_apr(target_date=args.date, headless=args.headless)
    print(path.resolve())


if __name__ == "__main__":
    main()
