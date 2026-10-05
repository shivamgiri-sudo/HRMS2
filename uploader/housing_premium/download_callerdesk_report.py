#!/usr/bin/env python3
"""
Downloads a Call Logs export from the CallerDesk admin panel
(https://app.callerdesk.io/admin) for a chosen date-range preset.

Selenium drives the login and the date-range selection (this session has no
computer-use/browser MCP tool, so this is the only way to automate a
login-gated site), but the actual file fetch is done with `requests` against
the authenticated session's cookies rather than by clicking the page's own
Download icon and hoping Chrome treats the response as a download. That icon
runs this site's own JS (confirmed live by reading it off the page):

    function checkCallLogsRange(daydiff) {
        if (daydiff >= 7) { /* confirm() -> Archived Database page */ }
        else { window.location.href = 'https://app.callerdesk.io/admin/download_call_log'; }
    }

i.e. the export has no filename/date in its URL at all -- it depends entirely
on server-side session state, and a plain Selenium click of it was observed
to just bounce back to /admin/call-logs?type=yesterday with no file ever
appearing. Fetching that same URL directly with the browser's real session
cookies (and a matching Referer) lets us see the server's actual response
-- a real file, or an HTML page telling us what's still missing -- instead
of guessing from Chrome's download-manager behavior.

Safety:
  - Camera/microphone permissions are blocked in the browser profile (the
    dashboard's "Live Call" softphone widget requests both on load; this
    script never visits the dashboard, but this is a hard guarantee anyway).
  - Credentials come only from uploader/callerdesk.env (git-ignored).
  - Downloads go to uploader/downloads/, never the OS Downloads folder.

Usage:
    py download_callerdesk_report.py [--range yesterday|today|last7|last30|thismonth|lastmonth]
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

import requests
from dotenv import dotenv_values
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait

HERE = Path(__file__).parent
DOWNLOAD_DIR = HERE / "downloads"
DEBUG_DIR = DOWNLOAD_DIR / "_debug"

RANGE_LABELS = {
    "today": "Today", "yesterday": "Yesterday", "last7": "Last 7 Days",
    "last30": "Last 30 Days", "thismonth": "This Month", "lastmonth": "Last Month",
}
DOWNLOAD_URL = "https://app.callerdesk.io/admin/download_call_log"
CALL_LOGS_URL = "https://app.callerdesk.io/admin/call-logs"


def load_credentials() -> dict[str, str]:
    env_path = HERE / "callerdesk.env"
    if not env_path.exists():
        sys.exit(f"Cannot find {env_path} -- credentials must come from this file, not be hardcoded.")
    creds = dotenv_values(env_path)
    if not creds.get("CALLERDESK_EMAIL") or not creds.get("CALLERDESK_PASSWORD"):
        sys.exit("callerdesk.env is missing CALLERDESK_EMAIL / CALLERDESK_PASSWORD.")
    return creds


def build_driver(headless: bool = False) -> webdriver.Chrome:
    DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)
    DEBUG_DIR.mkdir(parents=True, exist_ok=True)
    opts = Options()
    opts.add_argument("--window-size=1600,1000")
    if headless:
        # "new" headless (not the legacy --headless) -- needed so this can
        # run from Windows Task Scheduler with no interactive desktop
        # session, e.g. at the lock screen or before anyone logs in.
        opts.add_argument("--headless=new")
        opts.add_argument("--disable-gpu")
    opts.add_experimental_option("prefs", {
        "profile.default_content_setting_values.media_stream_camera": 2,
        "profile.default_content_setting_values.media_stream_mic": 2,
        "profile.default_content_setting_values.notifications": 2,
    })
    return webdriver.Chrome(options=opts)


def click(driver: webdriver.Chrome, element) -> None:
    driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", element)
    driver.execute_script("arguments[0].click();", element)


def select_range(driver: webdriver.Chrome, wait: WebDriverWait, preset_text: str) -> None:
    """Selects a date-range preset in the page's daterangepicker widget.

    The page has TWO separate elements containing this same text: the real
    picker option (a plain <li> inside <div class="ranges"><ul>...) and an
    always-visible quick-stat tab elsewhere on the page showing e.g.
    "Yesterday 8824". An earlier, unscoped XPath match could silently hit
    either one -- confirmed live: the range input never actually changed
    from its default full-week value, so every prior "Yesterday"/"Today"
    request was actually exporting the full default range instead (which
    also explains those attempts being so much slower / erroring outright).
    Scoping to div.ranges and then verifying #rangeA's value actually
    changed makes that failure loud instead of silent.
    """
    driver.get(CALL_LOGS_URL)
    range_input = wait.until(EC.element_to_be_clickable((By.ID, "rangeA")))
    original_value = range_input.get_attribute("value")
    click(driver, range_input)

    option = wait.until(EC.element_to_be_clickable(
        (By.XPATH, f"//div[contains(@class,'ranges')]//li[normalize-space(text())='{preset_text}']")
    ))
    click(driver, option)
    try:
        submit_btn = WebDriverWait(driver, 3).until(EC.element_to_be_clickable((By.XPATH, "//button[contains(@class,'applyBtn')]")))
        click(driver, submit_btn)
    except Exception:  # noqa: BLE001 -- no Submit step for a plain preset; fine
        pass
    time.sleep(2)

    new_value = driver.find_element(By.ID, "rangeA").get_attribute("value")
    if new_value == original_value:
        raise RuntimeError(
            f"Date range did not change after selecting '{preset_text}' (still '{new_value}'). "
            f"Refusing to fetch the export against the wrong range."
        )
    print(f"  range input now: {new_value}")

    # Also run the page's own search so any server-side session state that
    # only a real filter submission sets is definitely in place before we
    # hit the download endpoint.
    try:
        search_btn = driver.find_element(By.XPATH, "//button[contains(@class,'btn') and .//i[contains(@class,'fa-search')]] | //button[@type='submit'][.//i]")
        click(driver, search_btn)
        time.sleep(2)
    except Exception:  # noqa: BLE001 -- best-effort; date-range selection alone may be enough
        pass


def set_calendar_month(driver: webdriver.Chrome, side: str, year: int, month: int) -> None:
    """Navigates one Custom Range calendar panel (left/right) to the given
    year/month via its own <select class="monthselect"/yearselect"> controls.

    Confirmed live 2026-10-01: each panel defaults to whatever month
    currently brackets "today" (e.g. left=September, right=October), and a
    day belonging to a month that isn't currently displayed is still
    present in the grid as a greyed leading/trailing-day cell with class
    "off" -- which day_cell()'s XPath deliberately excludes (clicking an
    "off" cell does not reliably select the month you intended). This
    bug was invisible all prior runs because "yesterday" always fell in the
    same month the picker already defaulted to; it first surfaced on the
    first run after a month rollover (importing 30-Sep the day after it
    turned 1-Oct).

    The selects must be re-queried fresh via document.querySelector inside
    the JS (not passed in as a pre-fetched Selenium element) because the
    widget fully re-renders the panel's DOM on month change -- a Python-side
    element reference taken beforehand goes stale the instant the month
    select's own change fires, confirmed live via StaleElementReferenceException.
    """
    driver.execute_script(
        "var sel = document.querySelector('div.calendar.' + arguments[0] + ' select.monthselect');"
        "sel.value = arguments[1]; sel.dispatchEvent(new Event('change', {bubbles: true}));",
        side, str(month - 1),  # 0-based: January=0 .. December=11, confirmed live
    )
    time.sleep(0.5)
    driver.execute_script(
        "var sel = document.querySelector('div.calendar.' + arguments[0] + ' select.yearselect');"
        "sel.value = arguments[1]; sel.dispatchEvent(new Event('change', {bubbles: true}));",
        side, str(year),
    )
    time.sleep(0.5)


def select_single_day(driver: webdriver.Chrome, wait: WebDriverWait, year: int, month: int, day: int) -> None:
    """Selects a single day (start == end) via the Custom Range calendar.

    Confirmed live (see git history for the recon that found this): the
    picker's hidden daterangepicker_start/end text inputs do NOT drive the
    widget -- setting them via JS + change/input/blur events left #rangeA
    unchanged after Submit. What actually works is clicking the real
    calendar day cells, and the two panels are NOT interchangeable: the
    currently-active cell in div.calendar.left carries class "start-date"
    and the one in div.calendar.right carries "end-date" -- i.e. the LEFT
    panel's click sets the range start, the RIGHT panel's sets the end.
    For a single day we click the same day number in both.
    """
    driver.get(CALL_LOGS_URL)
    range_input = wait.until(EC.element_to_be_clickable((By.ID, "rangeA")))
    original_value = range_input.get_attribute("value")
    click(driver, range_input)

    custom = wait.until(EC.element_to_be_clickable(
        (By.XPATH, "//div[contains(@class,'ranges')]//li[normalize-space(text())='Custom Range']")
    ))
    click(driver, custom)
    time.sleep(1)

    set_calendar_month(driver, "left", year, month)

    def day_cell(side: str):
        return wait.until(EC.element_to_be_clickable((
            By.XPATH,
            f"//div[contains(@class,'calendar') and contains(@class,'{side}')]"
            f"//td[not(contains(@class,'off')) and normalize-space(text())='{day}']",
        )))

    click(driver, day_cell("left"))
    time.sleep(0.5)
    driver.save_screenshot(str(DEBUG_DIR / "after_click_left.png"))

    # Confirmed live 2026-10-01: clicking the LEFT panel's day cell makes the
    # widget auto-advance the right panel's own view to left-month-plus-one
    # (standard "pick a start date -> show the next month as the likely end
    # date" UX), silently undoing any set_calendar_month("right", ...) done
    # beforehand. So the right panel's month must be (re-)set *after* the
    # left click, immediately before looking for its day cell, not before.
    set_calendar_month(driver, "right", year, month)
    click(driver, day_cell("right"))
    time.sleep(0.5)
    driver.save_screenshot(str(DEBUG_DIR / "after_click_right.png"))

    submit_btn = wait.until(EC.element_to_be_clickable((By.XPATH, "//button[contains(@class,'applyBtn')]")))
    click(driver, submit_btn)
    time.sleep(2)

    new_value = driver.find_element(By.ID, "rangeA").get_attribute("value")
    if new_value == original_value:
        raise RuntimeError(f"Date range did not change after selecting day {day} (still '{new_value}').")
    print(f"  range input now: {new_value}")

    try:
        search_btn = driver.find_element(By.XPATH, "//button[contains(@class,'btn') and .//i[contains(@class,'fa-search')]] | //button[@type='submit'][.//i]")
        click(driver, search_btn)
        time.sleep(2)
    except Exception:  # noqa: BLE001 -- best-effort; date-range selection alone may be enough
        pass


def fetch_export(driver: webdriver.Chrome) -> tuple[int, dict, bytes, str | None]:
    """Replays the authenticated session's cookies against the download
    endpoint via `requests`, so the server's real response (headers + body)
    is visible instead of relying on Chrome's ambiguous download handling."""
    session = requests.Session()
    for c in driver.get_cookies():
        session.cookies.set(c["name"], c["value"], domain=c.get("domain"))
    headers = {
        "User-Agent": driver.execute_script("return navigator.userAgent;"),
        "Referer": CALL_LOGS_URL,
    }
    resp = session.get(DOWNLOAD_URL, headers=headers, allow_redirects=False, timeout=570)
    redirect_to = resp.headers.get("Location")
    if resp.is_redirect or resp.is_permanent_redirect:
        # Follow once, manually, so we can inspect the final response the same way.
        resp2 = session.get(resp.headers["Location"], headers=headers, allow_redirects=False, timeout=570)
        return resp2.status_code, dict(resp2.headers), resp2.content, redirect_to
    return resp.status_code, dict(resp.headers), resp.content, redirect_to


def unwrap_download(body: bytes, label: str) -> Path:
    """Saves the export bytes, unzipping/renaming as needed so the result is
    a directly-openable .xlsx -- confirmed live: this endpoint returns a
    zip (Content-Type: application/zip) containing one file whose own name
    ends .csv but whose bytes start with the 'PK' zip signature too, i.e. it
    is actually an .xlsx (OOXML is itself a zip container) with a wrong
    extension from the server. Both layers are unwrapped/renamed here so
    the caller always gets back a real, directly-loadable .xlsx path."""
    raw_path = DOWNLOAD_DIR / f"callerdesk_{label}_{int(time.time())}.bin"
    raw_path.write_bytes(body)
    if not body.startswith(b"PK"):
        return raw_path  # not a zip/xlsx at all; hand back as-is for inspection

    import zipfile
    with zipfile.ZipFile(raw_path) as z:
        names = z.namelist()
        if len(names) != 1:
            extract_dir = DOWNLOAD_DIR / f"callerdesk_{label}_{int(time.time())}_extracted"
            z.extractall(extract_dir)
            print(f"  zip contained {len(names)} files (expected 1) -- extracted to {extract_dir}")
            return extract_dir
        inner_name = names[0]
        inner_bytes = z.read(inner_name)
    raw_path.unlink()

    final_path = DOWNLOAD_DIR / f"callerdesk_{label}_{int(time.time())}.xlsx"
    final_path.write_bytes(inner_bytes)
    return final_path


def download_day(date_str: str | None = None, range_key: str | None = None, headless: bool = False) -> Path:
    """Logs in, selects either a single day (date_str, 'YYYY-MM-DD') or a
    preset (range_key), and returns the path to the downloaded, unwrapped
    .xlsx. Raises on any failure -- callers (the CLI below, and the daily
    orchestrator) decide how to report that; this never silently returns a
    bad/missing path.
    """
    if not date_str and not range_key:
        range_key = "yesterday"
    label = date_str or range_key
    assert label is not None

    creds = load_credentials()
    driver = build_driver(headless=headless)
    wait = WebDriverWait(driver, 20)
    try:
        print("Logging in...")
        driver.get("https://app.callerdesk.io/admin")
        wait.until(EC.presence_of_element_located((By.ID, "emailuser"))).send_keys(creds["CALLERDESK_EMAIL"])
        driver.find_element(By.ID, "passworduser").send_keys(creds["CALLERDESK_PASSWORD"])
        driver.find_element(By.ID, "do_signin-submit-btn").click()
        wait.until(EC.url_contains("/admin/dashboard"))
        print("  logged in.")

        if date_str:
            year, month, day = (int(x) for x in date_str.split("-"))
            print(f"Setting range to the single day {date_str}...")
            select_single_day(driver, wait, year, month, day)
        else:
            preset_text = RANGE_LABELS[range_key]  # type: ignore[index]
            print(f"Setting range to '{preset_text}'...")
            select_range(driver, wait, preset_text)
        driver.save_screenshot(str(DEBUG_DIR / "before_fetch.png"))

        print(f"Fetching {DOWNLOAD_URL} with the authenticated session...")
        status, headers, body, redirect_to = fetch_export(driver)
        print(f"  status={status}  redirect_to={redirect_to}")
        for k in ("Content-Type", "Content-Disposition", "Content-Length"):
            if k in headers:
                print(f"  {k}: {headers[k]}")

        content_type = headers.get("Content-Type", "")
        looks_like_file = (
            "spreadsheet" in content_type or "excel" in content_type or "csv" in content_type
            or "octet-stream" in content_type or "zip" in content_type or "Content-Disposition" in headers
        )
        if not (looks_like_file and len(body) > 0):
            preview_path = DEBUG_DIR / "download_response.html"
            preview_path.write_bytes(body)
            raise RuntimeError(
                f"CallerDesk response for '{label}' did not look like a file (status={status}); "
                f"saved for inspection: {preview_path}. First 300 bytes: {body[:300]!r}"
            )
        out_path = unwrap_download(body, label)
        print(f"\nSaved: {out_path} ({len(body)} bytes downloaded)")
        return out_path
    finally:
        driver.quit()


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    group = ap.add_mutually_exclusive_group()
    group.add_argument("--range", choices=RANGE_LABELS.keys())
    group.add_argument("--date", help="Single day, YYYY-MM-DD (uses the Custom Range calendar for exactly that one day)")
    ap.add_argument("--headless", action="store_true", help="Run Chrome headless (no visible window) -- for unattended/scheduled runs")
    args = ap.parse_args()

    out_path = download_day(date_str=args.date, range_key=args.range, headless=args.headless)
    print(out_path.resolve())


if __name__ == "__main__":
    main()
