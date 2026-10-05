#!/usr/bin/env python3
"""
Downloads DU Digital's Thailand "Agents Time Detail" report (APR) from the
DU dialer admin panel -- this report type offers a real DOWNLOAD button/file
(unlike Korea's <pre>-text report), so the flow here waits for and renames
the downloaded file instead. Adapted from the user's own working reference
script; see download_cdr_thailand.py's header for the safety changes applied
(credentials in du.env, download dir not hardcoded). Campaign group id
1212131 is unchanged from the working reference -- confirmed live against
the real site by the user.

Usage:
    py download_apr_thailand.py [--date YYYY-MM-DD] [--headless]
"""
from __future__ import annotations

import argparse
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path

from dotenv import dotenv_values
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait, Select
from selenium.webdriver.support import expected_conditions as EC

HERE = Path(__file__).resolve().parent
DEFAULT_DOWNLOAD_DIR = HERE / "downloads"
THAILAND_CAMPAIGN_GROUP = "1212131"


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


def wait_for_download_complete(path: Path, timeout: int = 120) -> bool:
    seconds = 0
    while seconds < timeout:
        files = list(path.iterdir())
        if files and not any(f.suffix in (".crdownload", ".tmp") for f in files):
            return True
        time.sleep(1)
        seconds += 1
    return False


def download_thailand_apr(target_date: str | None = None, headless: bool = False) -> Path:
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
        Select(campaign_select).select_by_value(THAILAND_CAMPAIGN_GROUP)

        user_group = driver.find_element(By.NAME, "user_group[]")
        Select(user_group).select_by_value("--ALL--")

        files_before = {f.name for f in save_folder.iterdir()}
        driver.find_element(By.NAME, "SUBMIT").click()

        wait.until(EC.presence_of_element_located((By.XPATH, "//a[contains(text(),'DOWNLOAD')]")))
        time.sleep(2)
        download_btn = driver.find_element(By.XPATH, "//a[contains(text(),'DOWNLOAD')]")
        driver.execute_script("arguments[0].click();", download_btn)
        print("Download started...")

        if not wait_for_download_complete(save_folder):
            raise RuntimeError("Download failed or timed out.")
        time.sleep(3)

        new_files = [save_folder / f for f in ({f.name for f in save_folder.iterdir()} - files_before)]
        if not new_files:
            raise RuntimeError(f"No new file appeared in {save_folder} after the download.")
        newest_file = max(new_files, key=lambda p: p.stat().st_ctime)

        file_date = report_date.replace("-", "")
        new_name = save_folder / f"DU_ThaiAPR_{file_date}.csv"
        counter = 1
        while new_name.exists():
            new_name = save_folder / f"DU_ThaiAPR_{file_date}_{counter}.csv"
            counter += 1

        for attempt in range(5):
            try:
                newest_file.rename(new_name)
                print(f"File renamed: {new_name}")
                break
            except PermissionError:
                print("File locked... retrying")
                time.sleep(2)
        else:
            raise RuntimeError(f"Could not rename {newest_file} after 5 attempts (still locked).")

        return new_name
    finally:
        driver.quit()


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--date", help="YYYY-MM-DD (default: today, matching the original reference script)")
    ap.add_argument("--headless", action="store_true")
    args = ap.parse_args()
    path = download_thailand_apr(target_date=args.date, headless=args.headless)
    print(path.resolve())


if __name__ == "__main__":
    main()
