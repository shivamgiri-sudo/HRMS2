"""
Disposition -> Connectivity lookup for LP Onboarding's Call Register CDR.

Same purpose as lp_feedback/lp_disposition_map.py (see that file's docstring
for the full background on why this exists), but a SEPARATE table -- LP
Onboarding is a different business process (loan/advisor allocation, not
lawyer-panel feedback) and uses a completely different disposition
vocabulary. Confirmed live (2026-09-29): of LP Onboarding's 15 real distinct
dispositions, only "SESSION TERMINATED" overlaps with LP Feedback's list at
all, so LP Feedback's mapping cannot be reused here.

This mapping was proposed by inference (most of these describe a real
conversation outcome -- you cannot allocate an advisor, categorise a loan
amount, or record someone as an "Existing Client" without a conversation
having happened, so those all imply Connected) and confirmed by the user
(2026-09-29). "Hung up the call" was initially flagged as genuinely
ambiguous and left out -- resolved afterwards not by guessing but by
checking real ground truth: 919 pre-existing rows (imported before this
pipeline existed) already carried disposition_status for this exact
disposition, and all 919 of them, with zero exceptions, are "Not Connected".
"""
from __future__ import annotations

import re

_CONNECTED = "Connected"
_NOT_CONNECTED = "Not Connected"
_CALL_BACK = "Call Back"

_RAW_MAP: dict[str, str] = {
    "did not answer the call": _NOT_CONNECTED,
    "session terminated": _NOT_CONNECTED,
    "blank call": _NOT_CONNECTED,
    "allocate to advisor_less than 5 lac loan": _CONNECTED,
    "allocate to advisor - more than 10 lac loan": _CONNECTED,
    "allocate to advisor - 5 to 10 lac loan": _CONNECTED,
    "request for the call back": _CALL_BACK,
    "existing client": _CONNECTED,
    "did not enquire": _CONNECTED,
    "looking for loan": _CONNECTED,
    "secured loan": _CONNECTED,
    "loan<1.5 lac": _CONNECTED,
    "govt. employee": _CONNECTED,
    "language barrier": _CONNECTED,
    "hung up the call": _NOT_CONNECTED,
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
