#!/usr/bin/env python3
"""
Downloads DU Digital's Korea "Export Calls Report" (CDR) from the DU dialer
admin panel -- same flow as download_cdr_thailand.py with Korea's own group
list, plus the user's own txt->xlsx conversion step (upload_du_cdr.py can
read the raw .txt directly too, but this mirrors the original working
script exactly). See download_cdr_thailand.py's header for the safety
changes applied (credentials in du.env, download dir not hardcoded).

Usage:
    py download_cdr_korea.py [--headless]
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

import pandas as pd
from dotenv import dotenv_values
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait, Select
from selenium.webdriver.support import expected_conditions as EC

HERE = Path(__file__).resolve().parent
DEFAULT_DOWNLOAD_DIR = HERE / "downloads"

KOREA_GROUPS = ["South_Korea_IB", "SouthKoreaEnglish", "SouthKoreaHindi", "SouthKoreaKorean"]


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


def download_korea_cdr(headless: bool = False, date_from: str | None = None, date_to: str | None = None) -> Path:
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

        # See download_cdr_thailand.py's own note: query_date/end_date default to today.
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
        for g in KOREA_GROUPS:
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
        link_xpath = "//a[contains(@href,'.txt') or contains(@href,'.csv') or contains(@href,'.xls')]"
        try:
            download_link = WebDriverWait(driver, 30).until(EC.element_to_be_clickable((By.XPATH, link_xpath)))
        except Exception:
            for _ in range(120):
                new_txt = [f for f in {f.name for f in save_folder.iterdir()} - files_before
                           if f.endswith(".txt") and not f.endswith(".crdownload")]
                if new_txt:
                    downloaded = save_folder / new_txt[0]
                    print(f"File downloaded without a link: {downloaded}")
                    return downloaded
                time.sleep(1)
            raise RuntimeError("No download link and no new report file appeared within 30s + 120s.")
        print("Download link found.")
        driver.execute_script("arguments[0].click();", download_link)
        print("Download started.")

        seconds = 0
        latest_file: Path | None = None
        while seconds < 60:
            new_files = {f.name for f in save_folder.iterdir()} - files_before
            txt_files = [f for f in new_files if f.endswith(".txt") and not f.endswith(".crdownload")]
            if txt_files:
                latest_file = save_folder / txt_files[0]
                break
            time.sleep(1)
            seconds += 1
        if not latest_file:
            raise RuntimeError(f"Download did not complete within 60s (folder: {save_folder})")
        print(f"Latest file: {latest_file}")

        df = pd.read_csv(latest_file, sep="\t")
        excel_file = latest_file.with_suffix(".xlsx")
        df.to_excel(excel_file, index=False)
        print(f"Converted to Excel: {excel_file}")
        latest_file.unlink()
        print("txt file removed.")
        return excel_file
    finally:
        driver.quit()


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--headless", action="store_true")
    ap.add_argument("--date-from", help="YYYY-MM-DD (default: today, matching the original reference script)")
    ap.add_argument("--date-to", help="YYYY-MM-DD (default: same as --date-from, or today)")
    args = ap.parse_args()
    path = download_korea_cdr(headless=args.headless, date_from=args.date_from, date_to=args.date_to or args.date_from)
    print(path.resolve())


if __name__ == "__main__":
    main()
