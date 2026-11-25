"""SIM-swap check (Africa's Talking Insights) before a door code goes out.

A recently swapped SIM is the classic M-Pesa / account-takeover fraud signal in Kenya: whoever holds
the new SIM receives the guest's door code. If the number was swapped in the last 7 days we hold the
code and ask Amina to call the guest. Simulation: numbers ending in 999 report a fresh swap.
"""

import logging
from datetime import timedelta

from django.conf import settings
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from . import at
from .models import SimSwapCheck

log = logging.getLogger("amina.simswap")
PENDING_TIMEOUT = timedelta(minutes=10)
RECENT = timedelta(days=7)


def _simulated():
    return settings.SIM_SWAP_PROVIDER == "simulate" or (settings.SIM_SWAP_PROVIDER == "" and not at.configured())


def request_check(booking):
    phone = booking.guest.phone
    check = SimSwapCheck.objects.create(phone=phone, booking=booking)
    if _simulated():
        swapped = phone.endswith("999")
        check.status = "Swapped" if swapped else "NoSwapDate"
        check.last_swap_date = timezone.now() - timedelta(days=1) if swapped else None
        check.raw = {"simulated": True}
    else:
        try:
            res = at.sim_swap_check([phone])
            first = (res.get("responses") or res.get("data") or [{}])
            first = first[0] if isinstance(first, list) and first else res
            check.request_id = str(first.get("requestId") or first.get("transactionId") or "")[:80]
            check.status = first.get("status") or "Queued"
            check.raw = res
        except Exception as e:
            log.warning("SIM swap request failed: %s", e)
            check.status, check.raw = "Failed", {"error": str(e)}
    check.save()
    _sync_booking(check)
    return check


def _sync_booking(check):
    if check.booking_id:
        from apps.bookings.models import Booking

        Booking.objects.filter(pk=check.booking_id).update(
            sim_swap_status=check.status, sim_swap_checked_at=timezone.now(), sim_swap_request_id=check.request_id
        )


def _state(check):
    if check.status == "Queued":
        return "pending" if timezone.now() - check.created_at < PENDING_TIMEOUT else "unavailable"
    if check.status == "Swapped":
        if check.last_swap_date is None or timezone.now() - check.last_swap_date <= RECENT:
            return "swapped"
        return "clear"
    if check.status == "NoSwapDate":
        return "clear"
    return "unavailable"  # Failed / Invalid / Unsupported / InsufficientBalance — fail open, but it's recorded


def status_for(booking):
    check = SimSwapCheck.objects.filter(booking=booking).order_by("-id").first()
    if check is None or (check.status != "Queued" and timezone.now() - check.updated_at > timedelta(hours=12)):
        check = request_check(booking)
    return _state(check)


def on_callback(data):
    rid = str(data.get("requestId") or data.get("transactionId") or "")
    check = SimSwapCheck.objects.filter(request_id=rid).order_by("-id").first() if rid else None
    if check is None and data.get("phoneNumber"):
        check = SimSwapCheck.objects.filter(phone=data["phoneNumber"], status="Queued").order_by("-id").first()
    if check is None:
        return None
    check.status = data.get("status") or check.status
    swap = data.get("lastSimSwapDate")
    check.last_swap_date = parse_datetime(swap) if isinstance(swap, str) else None
    check.raw = {**check.raw, "callback": data}
    check.save()
    _sync_booking(check)
    return check
