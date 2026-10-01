"""
Disposition -> Connectivity lookup for LP Feedback's Call Register CDR.

The raw IDCloud export has no "Disposition Status" column at all (confirmed
live -- see convert_lp_feedback_cdr.py's docstring), even though
db_masmis.lp_feedback_cdr has a disposition_status column and the app's own
dashboard (lp-call-dashboard.shared.ts) reads it directly to decide
"connected" ('connected' = disposition_status exactly 'Connected') -- so
without this mapping every CDR row imported by this pipeline had
disposition_status = NULL and the dashboard's Connected/Not Connected KPIs
had nothing to work from.

This table was supplied directly by the user (2026-09-28) as the real
Desposition -> Connectivity mapping used for this process. Matching is
case/whitespace-insensitive and treats en-dash/em-dash the same as a plain
hyphen (the source table uses "–", but a real CDR export might write
either), since disposition text is user-entered/free-text on the agent's
side and small punctuation/casing drift is expected, not a different value.

A disposition NOT in this table returns None (never guessed) --
convert_lp_feedback_cdr.py reports any it doesn't recognise so the mapping
can be extended, rather than silently leaving (or worse, mis-assigning)
those rows' disposition_status.
"""
from __future__ import annotations

import re

_CONNECTED = "Connected"
_NOT_CONNECTED = "Not Connected"
_CALL_BACK = "Call Back"

# normalized disposition text -> Connectivity, exactly as supplied by the user.
_RAW_MAP: dict[str, str] = {
    "you sense something odd, urgent, or risky": _CONNECTED,
    "client unaware of above-mentioned points": _CONNECTED,
    "client says assigned person is not responding": _CONNECTED,
    "client raises a serious concern": _CONNECTED,
    "any matter requiring senior intervention": _CONNECTED,
    "unaware of monthly ls fees": _CONNECTED,
    "assigned person not responding": _CONNECTED,
    "harassment through calls on personal number (mention lender name)": _CONNECTED,
    "payment made to personal qr code - poaching": _CONNECTED,
    # bare form (no "- P"/"- Poaching" suffix) -- same disposition family, both
    # suffixed variants map to Connected, so this is inferred, not guessed blind.
    "payment made to personal qr code": _CONNECTED,
    "harassment through home visit (mention lender name)": _CONNECTED,
    "no issues or red flags": _CONNECTED,
    "client did not answer the call": _NOT_CONNECTED,
    "client asks to talk later": _CALL_BACK,
    "client is aware of everything regarding the process": _CONNECTED,
    "discussion went smooth": _CONNECTED,
    "client is satisfied": _CONNECTED,
    "client requests callback": _CALL_BACK,
    "client picked the call": _CONNECTED,
    "payment-related complaint": _CONNECTED,
    "client says not a good time": _CALL_BACK,
    "phone was switched off": _NOT_CONNECTED,
    "phone was unreachable": _NOT_CONNECTED,
    "the lead has never been picked up": _NOT_CONNECTED,
    "normal clearing": _NOT_CONNECTED,
    "session terminated": _NOT_CONNECTED,
    "client busy - requested call back": _CALL_BACK,
    "switched off/not reachable": _NOT_CONNECTED,
    "client aware of process": _CONNECTED,
    "satisfied with case progress": _CONNECTED,
    "call picked - forwarded to another person": _CONNECTED,
    "wrong number": _CONNECTED,
    "call dropped during conversation": _CONNECTED,
    "paying off loans with the help of family/friends": _CONNECTED,
    "satisfied with services": _CONNECTED,
    "requesting preferred language allocation": _CONNECTED,
    "language barrier - request for other language": _CONNECTED,
    "discontinued - negative feedback (declined discount/reallocation)": _CONNECTED,
    "continuing with our lawyer (after exit)- p": _CONNECTED,
    "continuing with our lawyer (after exit)- poaching": _CONNECTED,
    "harassment through calls to family members (mention lender name)": _CONNECTED,
    "unaware of agreement duration (3-6 months)": _CONNECTED,
    "wants to continue - payment link requested": _CONNECTED,
    "lawyer assigned & fees paid": _CONNECTED,
    "call back - concerned person not available": _CALL_BACK,
    "redial number": _NOT_CONNECTED,
    "continuing with third party (after exit) - mention name": _CONNECTED,
    "wants to continue - advisor change requested (dissatisfied with previous allocation)": _CONNECTED,
    "requesting fee discount": _CONNECTED,
    "payment made to personal qr code - p": _CONNECTED,
    "dissatisfied with settlement/offer": _CONNECTED,
    "not satisfied with lawyer/services": _CONNECTED,
    "client does not want to continue any service": _CONNECTED,
    "clinet want refund of the services": _CONNECTED,
    "executive misselling (note: exclude ls fee and agreement duration issues)": _CONNECTED,
    "satisfied with the settlement": _CONNECTED,
    "client unhappy with settlement": _CONNECTED,
    "client not received settlement": _CONNECTED,
    "clinet want renewal of the services": _CONNECTED,
    "new advisor not assigned": _CONNECTED,
    "client not interested in proceeding with the service": _CONNECTED,
    "client has received communication from the new advisor": _CONNECTED,
    "client not accepted the settlement offer yet": _CONNECTED,
    "client still in contact with the exited employee": _CONNECTED,
    "a callback was scheduled, but it has been more than 3 days since the scheduled time": _NOT_CONNECTED,
}


def _normalize(text: str) -> str:
    t = text.strip().lower()
    t = t.replace("–", "-").replace("—", "-")  # en/em dash -> hyphen
    t = re.sub(r"\s+", " ", t)
    return t


DISPOSITION_STATUS: dict[str, str] = {_normalize(k): v for k, v in _RAW_MAP.items()}


def get_disposition_status(disposition: str | None) -> str | None:
    """Returns 'Connected' / 'Not Connected' / 'Call Back', or None if this
    disposition text isn't in the mapping yet (never guessed)."""
    if not disposition:
        return None
    return DISPOSITION_STATUS.get(_normalize(disposition))
