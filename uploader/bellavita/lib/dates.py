"""Date parsing shared by every Bellavita uploader -- ports
bb-sale-masmis-bulk.service.ts's parseBellavitaDateOnly/parseBellavitaDateTime
and bb-chat-masmis-bulk.service.ts's parseChatDate exactly, extended to also
accept a Python datetime/date object directly (pandas/openpyxl auto-converts
a cell into one when the cell itself carries Excel date formatting; when it
doesn't, the same cell comes through as a plain number instead -- this file
has to handle both, since which one you get depends on how the source file's
cells happen to be formatted, not on anything this script controls).
"""
import datetime as _dt
import math
import re

_MONTHS = {
    "jan": "01", "feb": "02", "mar": "03", "apr": "04", "may": "05", "jun": "06",
    "jul": "07", "aug": "08", "sep": "09", "oct": "10", "nov": "11", "dec": "12",
}
_MONTHS_UP = {
    "01": "Jan", "02": "Feb", "03": "Mar", "04": "Apr", "05": "May", "06": "Jun",
    "07": "Jul", "08": "Aug", "09": "Sep", "10": "Oct", "11": "Nov", "12": "Dec",
}

_EXCEL_EPOCH = _dt.date(1899, 12, 30)


def _is_blank(raw) -> bool:
    if raw is None:
        return True
    try:
        if isinstance(raw, float) and math.isnan(raw):
            return True
    except TypeError:
        pass
    s = str(raw).strip()
    return s == "" or s == "0" or s == "-"


def _serial_to_iso(serial: float) -> str:
    d = _EXCEL_EPOCH + _dt.timedelta(days=int(serial))
    return d.isoformat()


def parse_bellavita_date_only(raw) -> str | None:
    """-> "YYYY-MM-DD", or None when unrecognisable."""
    if _is_blank(raw):
        return None
    if isinstance(raw, (_dt.datetime, _dt.date)):
        return raw.strftime("%Y-%m-%d")
    s = str(raw).strip()
    try:
        n = float(s)
    except ValueError:
        n = None
    if n is not None and 40000 < n < 60000:
        return _serial_to_iso(n)
    m = re.match(r"^(\d{1,2})-([A-Za-z]{3})-(\d{2})$", s, re.IGNORECASE)
    if m:
        day = int(m.group(1))
        if day < 1 or day > 31:
            return None
        mon = _MONTHS.get(m.group(2).lower())
        if not mon:
            return None
        year = f"20{m.group(3)}" if int(m.group(3)) < 50 else f"19{m.group(3)}"
        return f"{year}-{mon}-{str(day).zfill(2)}"
    return None


def parse_bellavita_date_time(raw) -> str | None:
    """-> "YYYY-MM-DD HH:MM:SS", or None when unrecognisable."""
    if _is_blank(raw):
        return None
    if isinstance(raw, _dt.datetime):
        return raw.strftime("%Y-%m-%d %H:%M:%S")
    if isinstance(raw, _dt.date):
        return raw.strftime("%Y-%m-%d 00:00:00")
    s = str(raw).strip()
    try:
        n = float(s)
    except ValueError:
        n = None
    if n is not None and 40000 < n < 60000:
        whole_days = int(n)
        frac = n - whole_days
        d = _EXCEL_EPOCH + _dt.timedelta(days=whole_days)
        seconds = round(frac * 86400)
        t = _dt.datetime.combine(d, _dt.time()) + _dt.timedelta(seconds=seconds)
        return t.strftime("%Y-%m-%d %H:%M:%S")
    date_only = parse_bellavita_date_only(s)
    return f"{date_only} 00:00:00" if date_only else None


def excel_serial_to_iso(raw) -> str | None:
    """Plain Excel-serial -> "YYYY-MM-DD" (bb_apr's report_date). Accepts a
    datetime/date directly too, same fallback reasoning as above."""
    if _is_blank(raw):
        return None
    if isinstance(raw, (_dt.datetime, _dt.date)):
        return raw.strftime("%Y-%m-%d")
    try:
        n = float(raw)
    except (ValueError, TypeError):
        return None
    if not (40000 < n < 60000):
        return None
    return _serial_to_iso(n)


def to_d_mon_yy(raw) -> str | None:
    """Excel serial (or datetime) -> "D-Mon-YY" (bb_cart's text date convention).
    A value that's neither a serial nor a datetime is returned unchanged (assumed
    already text, e.g. a value the file happens to carry as a string)."""
    if _is_blank(raw):
        return None
    if isinstance(raw, (_dt.datetime, _dt.date)):
        return f"{raw.day}-{_MONTHS_UP[raw.strftime('%m')]}-{str(raw.year)[2:]}"
    s = str(raw).strip()
    try:
        n = float(s)
    except ValueError:
        return s
    if not (30000 < n < 80000):
        return s
    d = _EXCEL_EPOCH + _dt.timedelta(days=int(n))
    return f"{d.day}-{_MONTHS_UP[d.strftime('%m')]}-{str(d.year)[2:]}"


def parse_chat_date(raw) -> str | None:
    """-> "YYYY-MM-DD" for bb_chat's chat_date, matching parseChatDate in
    bb-chat-masmis-bulk.service.ts (ISO / D-Mon-Y(Y) / M/D/Y / Excel serial)."""
    if _is_blank(raw):
        return None
    if isinstance(raw, (_dt.datetime, _dt.date)):
        return raw.strftime("%Y-%m-%d")
    s = str(raw).strip()
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})(?:[ T].*)?$", s)
    if m:
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
    m = re.match(r"^(\d{1,2})-([A-Za-z]{3})[A-Za-z]*-(\d{2}|\d{4})$", s)
    if m:
        mon = _MONTHS.get(m.group(2).lower())
        if not mon:
            return None
        year = m.group(3) if len(m.group(3)) == 4 else f"20{m.group(3)}"
        return f"{year}-{mon}-{m.group(1).zfill(2)}"
    m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{2}|\d{4})(?:\s.*)?$", s)
    if m:
        year = m.group(3) if len(m.group(3)) == 4 else f"20{m.group(3)}"
        return f"{year}-{m.group(1).zfill(2)}-{m.group(2).zfill(2)}"
    try:
        n = float(s)
    except ValueError:
        return None
    serial = math.floor(n)
    if serial < 30000 or serial > 80000:
        return None
    d = _EXCEL_EPOCH + _dt.timedelta(days=serial)
    return d.isoformat()
