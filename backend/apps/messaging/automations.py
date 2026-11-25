"""The guest message timeline. Each Automation row (editable in the console) says what goes out and
when, relative to the stay; the guard functions below say *whether* it applies to a given booking.
Every send is claimed with a OnceMarker, so restarts and overlapping scheduler runs never double-send.
"""

import logging
from datetime import timedelta

from django.utils import timezone

from apps.core.models import OnceMarker, SiteSettings
from apps.core.utils import at_local, is_kenyan, today

from .models import Automation

log = logging.getLogger("amina.automations")

DEFAULT_AUTOMATIONS = [
    (
        "pre_arrival",
        "Pre-arrival: breakfast, ETA & travel",
        "Asks breakfast preference, arrival time and how they're travelling",
        "check_in",
        -3,
        "10:00",
    ),
    (
        "id_request",
        "Guest-register ID reminder",
        "Only if the guest hasn't registered an ID yet",
        "check_in",
        -2,
        "11:00",
    ),
    (
        "balance_due",
        "Balance due (deposit bookings)",
        "Sends an M-Pesa prompt for the balance",
        "check_in",
        -1,
        "09:00",
    ),
    (
        "directions",
        "Directions, landmark & Wi-Fi",
        "Exact location is only shared once a booking is confirmed",
        "check_in",
        -1,
        "16:00",
    ),
    ("welcome_check", "Settled in?", "Evening of arrival", "check_in", 0, "19:00"),
    ("mid_stay", "Mid-stay check-in & clean offer", "Stays of 4+ nights only", "check_in", 2, "10:00"),
    (
        "checkout_reminder",
        "Checkout reminder & late checkout offer",
        "Evening before departure",
        "check_out",
        -1,
        "19:00",
    ),
    (
        "rebook_offer",
        "Come-back offer",
        "Opted-in direct guests only, never Airbnb/Booking.com guests",
        "check_out",
        21,
        "10:00",
    ),
]


def ensure_defaults():
    for i, (key, name, desc, anchor, offset, at) in enumerate(DEFAULT_AUTOMATIONS):
        Automation.objects.get_or_create(
            key=key,
            defaults={
                "name": name,
                "description": desc,
                "anchor": anchor,
                "offset_days": offset,
                "send_time": at,
                "template_key": key,
                "sort_order": i,
            },
        )


def _quiet(s):
    h = timezone.localtime().hour
    return h >= s.quiet_hours_start or h < s.quiet_hours_end


def _due_at(auto, b):
    anchor = {"check_in": b.check_in, "check_out": b.check_out}.get(auto.anchor) or timezone.localtime(
        b.created_at
    ).date()
    day = anchor + timedelta(days=auto.offset_days)
    return at_local(day, auto.send_time or "00:00"), day


def _applies(key, b, s, due_day):
    t = today()
    if key == "pre_arrival":
        return b.status == "confirmed" and t < b.check_in
    if key == "id_request":
        return b.status == "confirmed" and t <= b.check_in and s.require_id_before_code and not b.guest.has_id
    if key == "balance_due":
        return b.status == "confirmed" and b.balance_due > 0 and t <= b.check_in
    if key == "directions":
        return b.status == "confirmed" and t <= b.check_in
    if key == "welcome_check":
        return b.status == "checked_in" and t == b.check_in
    if key == "mid_stay":
        return b.status == "checked_in" and b.nights >= 4 and t == due_day
    if key == "checkout_reminder":
        return b.status == "checked_in" and t < b.check_out
    if key == "rebook_offer":
        g = b.guest
        return (
            b.status == "completed"
            and t <= due_day + timedelta(days=3)
            and g.marketing_opt_in
            and not g.sms_opt_out_at
            and b.channel not in ("airbnb", "booking_com")
            and not b.guest.bookings.filter(created_at__gt=b.created_at).exists()
        )
    return False


def _send(auto, b):
    from apps.bookings.models import Addon
    from apps.bookings.services import send_guest
    from apps.core.utils import kes
    from apps.messaging import services as messaging
    from apps.payments import services as payments

    if auto.key == "balance_due" and is_kenyan(b.guest.phone):
        try:
            payments.start_payment(b, method="mpesa", purpose="balance")
        except Exception as e:  # the SMS still goes out with the pay link
            log.info("balance STK not sent for %s: %s", b.ref, e)
    extra = {}
    if auto.key == "mid_stay":
        clean = Addon.objects.filter(code="mid_stay_clean", active=True).first()
        extra["clean_price"] = kes(clean.price) if clean else "on request"
    if auto.key == "rebook_offer":
        extra["link"] = f"{_frontend()}/stays/{b.unit.slug}"
        msg = messaging.send(
            b.guest.phone,
            messaging.render(auto.template_key, b.lang, **{**_ctx(b), **extra}),
            booking=b,
            kind=auto.key,
            marketing=True,
        )
        return msg is not None
    send_guest(b, auto.template_key, **extra)
    return True


def _ctx(b):
    from apps.bookings.services import guest_context

    return guest_context(b)


def _frontend():
    from django.conf import settings

    return settings.FRONTEND_URL


def run_automations():
    from apps.bookings.models import Booking

    s = SiteSettings.load()
    if _quiet(s):
        return 0
    now, t = timezone.now(), today()
    candidates = Booking.objects.filter(
        status__in=("confirmed", "checked_in", "completed"),
        check_out__gte=t - timedelta(days=30),
        check_in__lte=t + timedelta(days=4),
    ).select_related("unit", "unit__area", "guest")
    sent = 0
    autos = list(Automation.objects.filter(enabled=True))
    for b in candidates:
        for auto in autos:
            due, due_day = _due_at(auto, b)
            if due > now or not _applies(auto.key, b, s, due_day):
                continue
            if not OnceMarker.mark(f"auto:{auto.key}:{b.ref}"):
                continue
            try:
                if _send(auto, b):
                    sent += 1
            except Exception:
                log.exception("automation %s failed for %s", auto.key, b.ref)
    return sent


def preview(auto, booking):
    from apps.bookings.services import guest_context
    from apps.messaging import services as messaging

    return messaging.render(auto.template_key, booking.lang, **guest_context(booking))
