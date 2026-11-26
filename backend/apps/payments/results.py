"""M-Pesa (Daraja STK) result codes: what each one means and what the guest should do next.

This one map drives everything a failed prompt touches: the reason stored on the Payment (and shown to Amina),
the guest's message on the web, the SMS fragment for remote guests and the suggested next step
(retry | card | deposit | wait | paybill). Some suggestions depend on the booking and are settled in
services.public_failure: code 1 offers the deposit only on a held, pay-in-full booking that allows one,
and 1025/1037 point to Paybill only when one is configured.
"""

import re

MPESA_RESULTS = {
    "0": {
        "reason": "paid",
        "retryable": False,
        "suggest": None,
        "message": "Payment received - thank you.",
        "sms": {"en": "paid", "sw": "imelipwa"},
    },
    "1": {
        "reason": "insufficient M-Pesa balance",
        "retryable": True,
        "suggest": "deposit",
        "message": "Your M-Pesa balance was too low for {amount}. Top up or use Fuliza and resend{deposit_option}, "
        "or pay by card.",
        "sms": {"en": "insufficient M-Pesa balance", "sw": "salio la M-Pesa halitoshi"},
    },
    "1001": {
        "reason": "another M-Pesa request was open on the phone",
        "retryable": True,
        "suggest": "wait",
        "message": "An M-Pesa request is already open on your phone. Finish or cancel it, wait a minute, then resend.",
        "sms": {
            "en": "another M-Pesa request was open on your phone - wait a minute",
            "sw": "ombi lingine la M-Pesa lilikuwa wazi kwenye simu - subiri dakika moja",
        },
    },
    "1019": {
        "reason": "the M-Pesa prompt expired",
        "retryable": True,
        "suggest": "retry",
        "message": "The M-Pesa prompt expired before it was answered. Tap Resend for a new one.",
        "sms": {"en": "the M-Pesa prompt expired", "sw": "ombi la M-Pesa limeisha muda"},
    },
    "1025": {
        "reason": "we couldn't reach the phone",
        "retryable": True,
        "suggest": "paybill",
        "message": "We couldn't reach your phone. Check your signal and try again, or pay with Paybill or card.",
        "sms": {"en": "we couldn't reach your phone", "sw": "hatukuweza kufikia simu yako"},
    },
    "1032": {
        "reason": "cancelled on the phone",
        "retryable": True,
        "suggest": "retry",
        "message": "You cancelled the M-Pesa request.{hold_note} Tap Resend to try again, or pay by card.",
        "sms": {"en": "cancelled on the phone", "sw": "uliighairi kwenye simu"},
    },
    "1037": {
        "reason": "the phone didn't respond in time",
        "retryable": True,
        "suggest": "paybill",
        "message": "We couldn't reach your phone in time. Keep it unlocked and resend, or pay with Paybill.",
        "sms": {"en": "the phone didn't respond in time", "sw": "simu haikujibu kwa wakati"},
    },
    "2001": {
        "reason": "wrong M-Pesa PIN",
        "retryable": True,
        "suggest": "retry",
        "message": "Wrong M-Pesa PIN. Try once more carefully - repeated wrong PINs can lock M-Pesa - or pay by card.",
        "sms": {"en": "wrong M-Pesa PIN", "sw": "PIN ya M-Pesa si sahihi"},
    },
}

# Unknown codes (and prompts that never got an answer) keep Daraja's ResultDesc verbatim as the reason.
DEFAULT_RESULT = {
    "reason": "",
    "retryable": True,
    "suggest": "retry",
    "message": "We couldn't complete the payment. If M-Pesa took your money, don't pay again - "
    "send us the M-Pesa code and we'll match it.",
    "sms": {},
}

# Africa's Talking checkout callbacks and Daraja's synchronous errors carry text, not a ResultCode.
_EXPLICIT = re.compile(r"(?:^|\D)(1001|1019|1025|1032|1037|2001)(?:\D|$)")
_BY_TEXT = [
    (r"lock subscriber|already in process|another transaction", "1001"),
    (r"insufficient|balance is too low|not enough (funds|balance)", "1"),
    (r"cancel", "1032"),
    (r"expired", "1019"),
    (r"push request|sending (the )?push|unable to send", "1025"),
    (r"ds timeout|timed? ?out|cannot be reached|no response from", "1037"),
    (r"initiator information|wrong pin|invalid pin|\bpin\b", "2001"),
]


def result_for(code):
    return MPESA_RESULTS.get(str(code or "").strip()) or DEFAULT_RESULT


def code_from_text(text):
    """Best-effort ResultCode for a provider's description, e.g. 'Request cancelled by user' -> '1032'."""
    t = (text or "").lower()
    m = _EXPLICIT.search(t)
    if m:
        return m.group(1)
    for pattern, code in _BY_TEXT:
        if re.search(pattern, t):
            return code
    return ""


def sms_reason(payment, lang):
    """The fragment that fills {reason} in the payment_failed SMS, in the guest's language when we have it."""
    entry = MPESA_RESULTS.get(payment.failure_code or "")
    if entry and entry["sms"].get(lang) and lang != "en":
        return entry["sms"][lang]
    return payment.failure_reason or (entry["sms"]["en"] if entry else "")
