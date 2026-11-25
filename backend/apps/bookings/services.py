"""Booking lifecycle shared by every channel (web, USSD, SMS, voice, host console):

hold → pay → confirm → pre-arrival → directions → door code → stay → checkout → review
"""

import logging
from datetime import timedelta

from django.conf import settings
from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.core.activity import record
from apps.core.models import OnceMarker, SiteSettings
from apps.core.utils import at_local, first_name, is_kenyan, kes, nice_date, nice_time, today
from apps.messaging import services as messaging
from apps.properties.models import Unit
from apps.properties.services import is_available
from apps.properties.services import quote as price_quote

from . import locks
from .models import Addon, Booking, BookingAddon, BookingEvent, BookingGuest, Waitlist

log = logging.getLogger("amina.bookings")

CHANNEL_LABEL = dict(Booking.CHANNELS)
BREAKFAST_STYLES = {
    "swahili": "Swahili (mahamri, chai, mbaazi, fruit)",
    "continental": "Continental",
    "english": "Full English",
    "vegetarian": "Vegetarian / vegan",
}
RISK_LABELS = {
    "one_night_weekend": "One-night weekend stay",
    "same_day": "Same-day booking",
    "last_minute": "Booked for tomorrow",
    "new_guest": "First stay with us",
    "full_occupancy": "At maximum occupancy",
    "previous_incident": "Previous incident on record",
}


class BookingError(Exception):
    pass


# ---------- helpers ----------


def event(booking, kind, text, channel="", actor=None, **data):
    BookingEvent.objects.create(
        booking=booking,
        kind=kind,
        text=text[:300],
        channel=channel or "",
        actor=actor if getattr(actor, "pk", None) else None,
        data=data,
    )


def trip_link(booking):
    return f"{settings.FRONTEND_URL}/trips/{booking.ref}"


def dates_text(check_in, check_out, lang="en"):
    return f"{nice_date(check_in, lang)} - {nice_date(check_out, lang)}"


def _addon(booking, code, statuses=("confirmed", "fulfilled")):
    return booking.addons.filter(addon__code=code, status__in=statuses).select_related("addon").first()


def effective_checkin_time(booking):
    early = _addon(booking, "early_checkin")
    return (early.details.get("time") if early else None) or booking.unit.effective_checkin()


def effective_checkout_time(booking):
    late = _addon(booking, "late_checkout")
    return (late.details.get("time") if late else None) or booking.unit.effective_checkout()


def guest_context(booking):
    """Everything a message template or knowledge-base answer may mention about this stay."""
    u, g, lang = booking.unit, booking.guest, booking.lang
    s = SiteSettings.load()
    code = booking.access_codes.filter(revoked_at__isnull=True, sent_at__isnull=False).first()
    breakfast = _addon(booking, "breakfast", ("requested", "confirmed", "fulfilled"))
    ctx = {
        "first_name": first_name(g.name),
        "name": g.name or "",
        "unit": u.name,
        "area": u.area.name,
        "ref": booking.ref,
        "dates": dates_text(booking.check_in, booking.check_out, lang),
        "check_in": nice_date(booking.check_in, lang),
        "check_out": nice_date(booking.check_out, lang),
        "nights": booking.nights,
        "s": "s" if booking.nights != 1 else "",
        "total": kes(booking.total),
        "paid": kes(booking.amount_paid),
        "balance": kes(booking.balance_due),
        "due_date": nice_date(booking.check_in - timedelta(days=s.balance_due_days), lang),
        "checkin_time": nice_time(effective_checkin_time(booking)),
        "checkout_time": nice_time(effective_checkout_time(booking)),
        "trip_link": trip_link(booking),
        "tips": u.local_tips or u.area.tips,
        "taxi": settings_taxi(),
        "status": booking.get_status_display(),
        "breakfast": breakfast_summary(breakfast) if breakfast else "",
    }
    if booking.status in ("confirmed", "checked_in"):
        ctx.update(
            wifi=f"{u.wifi_name} / {u.wifi_password}" if u.wifi_name else "",
            directions=u.directions,
            landmark=u.landmark,
            map_link=u.map_link,
            address=u.address,
            parking=u.parking,
        )
    if code:
        ctx.update(
            code=code.code,
            valid_from=f"{nice_date(timezone.localtime(code.valid_from).date(), lang)} {nice_time(timezone.localtime(code.valid_from).strftime('%H:%M'))}",
            valid_until=f"{nice_date(timezone.localtime(code.valid_until).date(), lang)} {nice_time(timezone.localtime(code.valid_until).strftime('%H:%M'))}",
        )
    return ctx


def settings_taxi():
    import os

    return os.environ.get("TAXI_CONTACT") or "Uber, Bolt and Little work well - or ask us for Amina's trusted driver"


def breakfast_summary(ba):
    d = ba.details or {}
    parts = [f"{ba.quantity} x {BREAKFAST_STYLES.get(d.get('style'), d.get('style', 'breakfast'))}"]
    if d.get("dietary"):
        parts.append(d["dietary"])
    if d.get("time"):
        parts.append(f"at {d['time']}")
    return ", ".join(parts)


def notify_host(text, *, booking=None, kind="host_notice"):
    return messaging.send(SiteSettings.load().host_contact, text, booking=booking, kind=kind, sender="system")


def send_guest(booking, key, **extra):
    ctx = {**guest_context(booking), **extra}
    return messaging.send(booking.guest.phone, messaging.render(key, booking.lang, **ctx), booking=booking, kind=key)


# ---------- screening ----------


def screen(unit, guest, check_in, check_out, guests):
    """Reservation screening, in the spirit of Airbnb's anti-party system — neutral, behavioural signals only."""
    flags, score = [], 0
    n, lead = (check_out - check_in).days, (check_in - today()).days
    if n == 1 and check_in.weekday() in (4, 5):
        flags.append("one_night_weekend")
        score += 25
    if lead <= 0:
        flags.append("same_day")
        score += 15
    elif lead == 1:
        flags.append("last_minute")
        score += 10
    past = Booking.objects.filter(guest=guest, status="completed").count()
    if past == 0:
        flags.append("new_guest")
        score += 10
    else:
        score -= 10
    if guests >= unit.max_guests and unit.max_guests >= 4:
        flags.append("full_occupancy")
        score += 10
    from apps.safety.models import Alert

    if Alert.objects.filter(guest=guest, kind__in=("security", "sos")).exclude(source="sos").exists() or "incident" in (
        guest.tags or []
    ):
        flags.append("previous_incident")
        score += 30
    if "vip" in [t.lower() for t in (guest.tags or [])]:
        score -= 20
    return max(0, min(100, score)), flags


# ---------- holds ----------


def _resolve_addons(unit, items, guests):
    resolved = []
    for item in items or []:
        code = item.get("code") if isinstance(item, dict) else item
        addon = Addon.objects.filter(code=code, active=True).first()
        if not addon or (addon.units.exists() and not addon.units.filter(pk=unit.pk).exists()):
            continue
        if addon.category == "breakfast" and not unit.breakfast_available:
            continue
        qty = int(
            (item.get("quantity") if isinstance(item, dict) else 0)
            or (guests if addon.pricing in ("per_guest_night", "per_guest") else 1)
        )
        resolved.append(
            {
                "addon": addon,
                "quantity": max(1, min(qty, 20)),
                "details": (item.get("details") if isinstance(item, dict) else None) or {},
            }
        )
    return resolved


def _expire(qs):
    from apps.payments.models import Payment

    expired = []
    for b in qs.select_related("unit", "guest"):
        if Booking.objects.filter(pk=b.pk, status="held").update(status="expired"):
            Payment.objects.filter(booking=b, status="pending").update(status="expired")
            event(b, "expired", "Hold expired - payment not completed, unit released")
            if b.channel != "web" and OnceMarker.mark(f"hold-expired:{b.ref}"):
                send_guest(b, "hold_expired")
            expired.append(b)
    return expired


def expire_stale_holds():
    expired = _expire(Booking.objects.filter(status="held", hold_expires_at__lt=timezone.now()))
    for unit_id in {b.unit_id for b in expired}:
        notify_waitlist(Unit.objects.get(pk=unit_id))
    return expired


def create_hold(
    *,
    unit,
    guest,
    check_in,
    check_out,
    channel,
    adults=1,
    children=0,
    infants=0,
    addons=None,
    payment_plan="full",
    lang=None,
    arrival_eta="",
    arrival_mode="",
    special_requests="",
    purpose="",
    vehicle_plate="",
    occupants=None,
    actor=None,
):
    s = SiteSettings.load()
    if not check_in or not check_out or check_out <= check_in:
        raise BookingError("Check-out must be after check-in.")
    if check_in < today():
        raise BookingError("That check-in date has already passed.")
    if (check_in - today()).days > 540:
        raise BookingError("We take bookings up to 18 months ahead.")
    n = (check_out - check_in).days
    if n < unit.min_nights:
        raise BookingError(f"{unit.name} has a minimum stay of {unit.min_nights} nights.")
    if n > unit.max_nights:
        raise BookingError(f"{unit.name} takes stays of up to {unit.max_nights} nights.")
    guests = max(1, adults + children)
    if guests > unit.max_guests:
        raise BookingError(f"{unit.name} sleeps up to {unit.max_guests} guests.")
    if unit.status != "active":
        raise BookingError("This home isn't taking bookings right now.")
    if guest.is_blocked:
        raise BookingError("We're unable to accept this booking. Please contact us.")

    resolved = _resolve_addons(unit, addons, guests)
    try:
        with transaction.atomic():
            Unit.objects.select_for_update().filter(pk=unit.pk).first()  # serialise holds on this unit
            _expire(Booking.objects.filter(unit=unit, status="held", hold_expires_at__lt=timezone.now()))
            if not is_available(unit, check_in, check_out):
                raise BookingError("Sorry - those dates were just taken.")
            q = price_quote(unit, check_in, check_out, guests=guests, addons=resolved, payment_plan=payment_plan)
            plan = "deposit" if payment_plan == "deposit" and q["deposit_available"] else "full"
            score, flags = screen(unit, guest, check_in, check_out, guests)
            booking = Booking.objects.create(
                ref=Booking.new_ref(),
                unit=unit,
                guest=guest,
                check_in=check_in,
                check_out=check_out,
                adults=max(1, adults),
                children=children,
                infants=infants,
                status="held",
                channel=channel,
                lang=lang or guest.lang,
                hold_expires_at=timezone.now() + timedelta(minutes=s.hold_minutes),
                nightly=q["nightly"],
                accommodation_amount=q["accommodation"],
                discount_amount=q["discount"],
                cleaning_fee=q["cleaning_fee"],
                addons_amount=q["addons"],
                levy_amount=q["levy"],
                vat_amount=q["vat"],
                total=q["total"],
                payment_plan=plan,
                amount_due_now=q["due_now"] if plan == "deposit" else q["total"],
                cancellation_policy=unit.cancellation_policy,
                arrival_eta=arrival_eta[:40],
                arrival_mode=arrival_mode[:10],
                special_requests=special_requests[:1000],
                purpose=purpose[:20],
                vehicle_plate=vehicle_plate.upper()[:12],
                risk_score=score,
                risk_flags=flags,
            )
            for item in resolved:
                a, qty = item["addon"], item["quantity"]
                BookingAddon.objects.create(
                    booking=booking,
                    addon=a,
                    quantity=qty,
                    unit_price=a.price,
                    total=a.price_for(n, guests, qty),
                    status="requested" if a.requires_approval else "confirmed",
                    details=item["details"],
                )
            BookingGuest.objects.create(
                booking=booking,
                full_name=guest.name or guest.phone,
                id_type=guest.id_type,
                id_number_enc=guest.id_number_enc,
                id_last4=guest.id_last4,
                nationality=guest.nationality,
                is_lead=True,
            )
            for o in occupants or []:
                if not o.get("full_name"):
                    continue
                bg = BookingGuest(
                    booking=booking,
                    full_name=o["full_name"][:80],
                    id_type=o.get("id_type", "")[:20],
                    nationality=(o.get("nationality") or "")[:2].upper(),
                    is_minor=bool(o.get("is_minor")),
                )
                if o.get("id_number"):
                    bg.set_id_number(o["id_number"])
                bg.save()
            event(
                booking,
                "held",
                f"Held via {CHANNEL_LABEL.get(channel, channel)} for {s.hold_minutes} minutes",
                channel,
                actor,
            )
    except IntegrityError as e:  # the exclusion constraint caught a race between two channels
        log.info("overlap rejected by database: %s", e)
        raise BookingError("Sorry - those dates were just taken.") from e

    changed = []
    if not guest.first_channel:
        guest.first_channel = channel
        changed.append("first_channel")
    guest.last_area, guest.last_guests = unit.area.name, guests
    guest.save(update_fields=changed + ["last_area", "last_guests"])
    record(
        "booking",
        f"Hold {booking.ref}: {unit.name}, {check_in:%d %b}-{check_out:%d %b} via {CHANNEL_LABEL.get(channel, channel)}",
        channel=channel,
        booking=booking,
        actor=actor,
        total=booking.total,
    )
    return booking


# ---------- confirmation ----------


def confirm(booking, *, actor=None):
    with transaction.atomic():
        b = Booking.objects.select_for_update().select_related("unit", "guest", "unit__area").get(pk=booking.pk)
        if b.status != "held":
            return b
        b.status, b.hold_expires_at = "confirmed", None
        b.save(update_fields=["status", "hold_expires_at", "updated_at"])
        locks.create_code(b)
        event(b, "confirmed", "Booking confirmed - door code generated (sent on arrival day)", actor=actor)
    balance_note = messaging.render("balance_note", b.lang, **guest_context(b)) if b.balance_due else ""
    send_guest(b, "booking_confirmed", balance_note=" " + balance_note if balance_note else "")
    risk = f" Screening: {', '.join(RISK_LABELS.get(f, f) for f in b.risk_flags)}." if b.risk_score >= 40 else ""
    notify_host(
        f"New booking {b.ref} via {CHANNEL_LABEL.get(b.channel, b.channel)}: {b.unit.name}, {dates_text(b.check_in, b.check_out)}, "
        f"{kes(b.total)} ({kes(b.amount_paid)} paid). Guest {b.guest.name or ''} {b.guest.phone}.{risk}",
        booking=b,
    )
    record(
        "booking",
        f"Confirmed {b.ref}: {b.unit.name} for {b.guest.display_name}",
        channel=b.channel,
        booking=b,
        actor=actor,
        total=b.total,
    )
    if b.risk_score >= 60:
        from apps.safety.services import raise_alert

        raise_alert(
            "security",
            f"High-risk reservation {b.ref} ({', '.join(RISK_LABELS.get(f, f) for f in b.risk_flags)})",
            severity="medium",
            booking=b,
            dedupe=f"risk:{b.ref}",
        )
    return b


def recalc(booking):
    """Re-total after add-ons change (levy follows the gross)."""
    from decimal import Decimal

    s = SiteSettings.load()
    b = booking
    addons_total = sum(a.total for a in b.addons.exclude(status__in=("declined", "cancelled")))
    taxable = b.accommodation_amount - b.discount_amount + b.cleaning_fee + addons_total
    b.addons_amount = addons_total
    b.levy_amount = round(taxable * Decimal(s.tourism_levy_percent) / 100)
    b.vat_amount = round(taxable * Decimal(s.vat_percent) / 100) if s.vat_registered and s.vat_percent else 0
    b.total = taxable + b.levy_amount + b.vat_amount
    update_payment_status(b, save=False)
    b.save(update_fields=["addons_amount", "levy_amount", "vat_amount", "total", "payment_status", "updated_at"])
    return b


def update_payment_status(b, save=True):
    net = b.amount_paid - b.amount_refunded
    if b.amount_refunded and net <= 0:
        b.payment_status = "refunded"
    elif b.amount_refunded:
        b.payment_status = "partially_refunded"
    elif b.amount_paid >= b.total and b.total > 0:
        b.payment_status = "paid"
    elif b.amount_paid > 0:
        b.payment_status = "deposit_paid"
    else:
        b.payment_status = "unpaid"
    if save:
        b.save(update_fields=["payment_status", "updated_at"])


# ---------- cancellation ----------

POLICY_TEXT = {
    "flexible": "Full refund until 24 hours before check-in.",
    "moderate": "Full refund until 5 days before check-in, then 50%.",
    "firm": "Full refund until 30 days before check-in, 50% until 7 days before, then non-refundable.",
    "strict": "50% refund until 7 days before check-in, then non-refundable.",
}


def refund_quote(b, at=None):
    now = at or timezone.now()
    paid = b.amount_paid - b.amount_refunded
    if paid <= 0:
        return {
            "refund": 0,
            "percent": 0,
            "paid": 0,
            "policy": b.cancellation_policy,
            "text": "Nothing has been charged, so there's nothing to refund.",
        }
    hours = (at_local(b.check_in, effective_checkin_time(b)) - now).total_seconds() / 3600
    policy = b.cancellation_policy
    if policy == "flexible":
        pct = 100 if hours >= 24 else 0
    elif policy == "moderate":
        pct = 100 if hours >= 5 * 24 else 50 if hours > 0 else 0
    elif policy == "firm":
        pct = 100 if hours >= 30 * 24 else 50 if hours >= 7 * 24 else 0
    else:
        pct = 50 if hours >= 7 * 24 else 0
    refund = round(paid * pct / 100)
    text = (
        f"You'll get {kes(refund)} back ({pct}% of what you paid)."
        if refund
        else "Under the cancellation policy this booking is no longer refundable."
    )
    return {
        "refund": refund,
        "percent": pct,
        "paid": paid,
        "policy": policy,
        "policy_text": POLICY_TEXT.get(policy, ""),
        "text": text,
    }


def cancel(booking, *, by, reason="", actor=None, refund_amount=None, notify=True):
    from apps.payments import services as payments

    b = Booking.objects.select_related("unit", "guest", "unit__area").get(pk=booking.pk)
    if b.status not in ("held", "confirmed"):
        raise BookingError("This booking can't be cancelled now.")
    was_paid = b.amount_paid - b.amount_refunded
    if refund_amount is not None:
        refund = max(0, min(int(refund_amount), was_paid))
    elif by == "host":
        refund = was_paid  # Amina cancelling always refunds in full
    else:
        refund = refund_quote(b)["refund"]
    with transaction.atomic():
        b.status, b.cancelled_at, b.cancelled_by, b.cancel_reason = "cancelled", timezone.now(), by, reason[:200]
        b.save(update_fields=["status", "cancelled_at", "cancelled_by", "cancel_reason", "updated_at"])
        locks.revoke_all(b, "cancelled")
        event(b, "cancelled", f"Cancelled by {by}{': ' + reason if reason else ''}", actor=actor)
    if refund:
        payments.refund(b, refund, reason=f"Cancelled by {by}", actor=actor)
    airtime = 0
    if by == "host" and was_paid:
        airtime = send_goodwill(b)
    if notify:
        lang = b.lang
        refund_line = messaging.render("refund_line", lang, amount=kes(refund)) if refund else ""
        goodwill_line = messaging.render("goodwill_line", lang, airtime=airtime) if airtime else ""
        key = "cancelled_by_host" if by == "host" else "cancelled_by_guest"
        send_guest(
            b,
            key,
            refund_line=" " + refund_line if refund_line else "",
            goodwill_line=" " + goodwill_line if goodwill_line else "",
        )
        if by != "host":
            notify_host(
                f"{b.ref} ({b.unit.name}, {dates_text(b.check_in, b.check_out)}) was cancelled by the guest. Refund {kes(refund)}.",
                booking=b,
            )
    record("booking", f"Cancelled {b.ref} by {by} (refund {kes(refund)})", booking=b, actor=actor)
    notify_waitlist(b.unit)
    return {"cancelled": b.ref, "refund": refund, "goodwill_airtime": airtime}


def send_goodwill(b):
    """Airtime apology when Amina cancels a paid stay (Africa's Talking Airtime, Kenyan numbers)."""
    from apps.comms import at

    amount = SiteSettings.load().goodwill_airtime_kes
    if not amount or not is_kenyan(b.guest.phone) or not OnceMarker.mark(f"goodwill:{b.ref}"):
        return 0
    try:
        res = at.send_airtime(b.guest.phone, amount, idempotency_key=f"goodwill-{b.ref}", metadata={"ref": b.ref})
        failed = not res.get("dry_run") and int(res.get("numSent") or 0) == 0
        event(b, "airtime", f"Goodwill airtime KES {amount} {'failed' if failed else 'sent'}")
        record("system", f"Goodwill airtime KES {amount} to {b.guest.phone} for {b.ref}", booking=b)
        return 0 if failed else amount
    except Exception as e:
        log.error("airtime failed: %s", e)
        event(b, "airtime", f"Goodwill airtime failed: {e}"[:300])
        return 0


# ---------- arrival: door code ----------


def release_code(booking, *, force=False, actor=None):
    """Arrival morning. Returns released | waiting_balance | waiting_id | checking_sim | security_hold | not_confirmed."""
    from apps.comms import simswap
    from apps.payments import services as payments

    b = Booking.objects.select_related("unit", "guest", "unit__area").get(pk=booking.pk)
    if b.status != "confirmed":
        return "not_confirmed"
    s = SiteSettings.load()
    if b.balance_due > 0 and not force:
        if OnceMarker.mark(f"code-wait-balance:{b.ref}"):
            send_guest(b, "code_waiting_balance")
            if is_kenyan(b.guest.phone):
                payments.start_payment(b, method="mpesa", purpose="balance")
        return "waiting_balance"
    if s.require_id_before_code and not b.guest.has_id and not force:
        if OnceMarker.mark(f"code-wait-id:{b.ref}"):
            send_guest(b, "code_waiting_id")
        return "waiting_id"
    if s.sim_swap_check and is_kenyan(b.guest.phone) and not force:
        state = simswap.status_for(b)
        if state == "pending":
            return "checking_sim"
        if state == "swapped":
            if OnceMarker.mark(f"simswap-hold:{b.ref}"):
                from apps.safety.services import raise_alert

                send_guest(b, "code_security_hold")
                raise_alert(
                    "security",
                    f"SIM swap detected on {b.guest.phone} before releasing the door code for {b.ref}. Call the guest to verify.",
                    severity="high",
                    booking=b,
                    dedupe=f"simswap:{b.ref}",
                )
            return "security_hold"

    code = locks.create_code(b)
    now = timezone.now()
    with transaction.atomic():
        b.status, b.code_released_at, b.checked_in_at = "checked_in", now, now
        b.save(update_fields=["status", "code_released_at", "checked_in_at", "updated_at"])
        code.sent_at = now
        code.save(update_fields=["sent_at"])
        event(b, "code_released", f"Door code released by SMS{' (released manually)' if force else ''}", actor=actor)
    send_guest(b, "checkin_code")
    if OnceMarker.mark(f"tips:{b.ref}"):
        send_guest(b, "local_tips")
    _welcome_data(b, s)
    if s.voice_welcome_call and is_kenyan(b.guest.phone) and OnceMarker.mark(f"welcome-call:{b.ref}"):
        from apps.comms.voice import place_welcome_call

        place_welcome_call(b)
    record("lock", f"Door code released for {b.ref} at {b.unit.name}", booking=b, actor=actor)
    return "released"


def _welcome_data(b, s):
    from apps.comms import at

    if not s.welcome_data_mb or not is_kenyan(b.guest.phone) or not OnceMarker.mark(f"data:{b.ref}"):
        return
    try:
        at.send_mobile_data(
            b.guest.phone, s.welcome_data_mb, metadata={"ref": b.ref}, idempotency_key=f"welcome-{b.ref}"
        )
        event(b, "data", f"Welcome data bundle {s.welcome_data_mb}MB sent")
    except Exception as e:
        log.error("mobile data failed: %s", e)


def check_out(booking, *, by="guest", channel="", auto=False, actor=None):
    from apps.operations.services import create_turnover_task

    b = Booking.objects.select_related("unit", "guest", "unit__area").get(pk=booking.pk)
    if b.status != "checked_in":
        raise BookingError("There's no active stay to check out of.")
    with transaction.atomic():
        b.status, b.checked_out_at = "completed", timezone.now()
        b.save(update_fields=["status", "checked_out_at", "updated_at"])
        locks.revoke_all(b, "checked_out")
        Unit.objects.filter(pk=b.unit_id).update(housekeeping="dirty")
        event(
            b,
            "checked_out",
            "Auto check-out at checkout time - code deactivated"
            if auto
            else f"Checked out via {channel or by} - code deactivated",
            channel,
            actor,
        )
    create_turnover_task(b)
    send_guest(b, "auto_checkout" if auto else "checkout_thanks")
    record(
        "booking",
        f"{'Auto ' if auto else ''}check-out {b.ref} from {b.unit.name}",
        channel=channel,
        booking=b,
        actor=actor,
    )
    notify_waitlist(b.unit)
    return b


def active_stay(phone):
    return (
        Booking.objects.filter(guest__phone=phone, status="checked_in")
        .select_related("unit", "guest", "unit__area")
        .order_by("check_in")
        .first()
    )


def current_booking(phone):
    """The stay a guest most likely means: in-house first, then the next upcoming one, then a pending hold."""
    qs = Booking.objects.filter(guest__phone=phone).select_related("unit", "guest", "unit__area")
    return (
        qs.filter(status="checked_in").order_by("check_in").first()
        or qs.filter(status="confirmed", check_out__gte=today()).order_by("check_in").first()
        or qs.filter(status="held", hold_expires_at__gt=timezone.now()).order_by("-created_at").first()
    )


# ---------- waitlist ----------


def add_to_waitlist(guest, check_in, check_out, *, area=None, unit=None, guests=0, channel="sms"):
    w, _ = Waitlist.objects.get_or_create(
        guest=guest,
        check_in=check_in,
        check_out=check_out,
        area=area,
        unit=unit,
        status="waiting",
        defaults={"guests": guests or 0, "channel": channel},
    )
    record(
        "booking",
        f"Waitlist: {guest.phone} for {check_in:%d %b}-{check_out:%d %b}{' in ' + area.name if area else ''}",
        channel=channel,
    )
    return w


def notify_waitlist(unit):
    from apps.messaging.models import Conversation

    offered = 0
    for w in (
        Waitlist.objects.filter(status="waiting", check_out__gt=today())
        .select_related("guest", "area")
        .order_by("created_at")
    ):
        if w.check_in < today():
            w.status = "expired"
            w.save(update_fields=["status"])
            continue
        if (
            (w.unit_id and w.unit_id != unit.pk)
            or (w.area_id and w.area_id != unit.area_id)
            or (w.guests and unit.max_guests < w.guests)
        ):
            continue
        if not is_available(unit, w.check_in, w.check_out):
            continue
        w.status, w.offered_unit, w.offered_at = "offered", unit, timezone.now()
        w.save(update_fields=["status", "offered_unit", "offered_at"])
        Conversation.objects.update_or_create(
            phone=w.guest.phone,
            defaults={
                "state": "offer",
                "data": {
                    "unit_id": unit.pk,
                    "check_in": w.check_in.isoformat(),
                    "check_out": w.check_out.isoformat(),
                    "guests": w.guests,
                },
            },
        )
        messaging.send(
            w.guest.phone,
            messaging.render(
                "waitlist_offer",
                w.guest.lang,
                unit=unit.name,
                price=kes(unit.base_price),
                dates=dates_text(w.check_in, w.check_out, w.guest.lang),
            ),
            kind="waitlist_offer",
        )
        offered += 1
    if offered:
        record("broadcast", f"{unit.name} opened up - offered to {offered} waitlisted guest(s)")
    return offered


# ---------- add-ons, breakfast, requests ----------


def add_addon(booking, code, *, quantity=None, details=None, channel="web", actor=None):
    addon = Addon.objects.filter(code=code, active=True).first()
    if not addon:
        raise BookingError("That extra isn't available.")
    b = booking
    if b.status not in ("held", "confirmed", "checked_in"):
        raise BookingError("Extras can only be added to an active booking.")
    if addon.units.exists() and not addon.units.filter(pk=b.unit_id).exists():
        raise BookingError(f"{addon.name} isn't offered at {b.unit.name}.")
    existing = b.addons.filter(addon=addon).exclude(status__in=("declined", "cancelled")).first()
    if existing and addon.category in ("flexibility", "breakfast"):
        raise BookingError(f"{addon.name} is already on this booking.")
    qty = max(1, int(quantity or (b.guests_count if addon.pricing in ("per_guest_night", "per_guest") else 1)))
    ba = BookingAddon.objects.create(
        booking=b,
        addon=addon,
        quantity=qty,
        unit_price=addon.price,
        total=addon.price_for(b.nights, b.guests_count, qty),
        status="requested" if addon.requires_approval else "confirmed",
        details=details or {},
    )
    recalc(b)
    event(
        b,
        "addon",
        f"{addon.name} {'requested' if addon.requires_approval else 'added'} ({kes(ba.total)})",
        channel,
        actor,
    )
    if addon.requires_approval:
        notify_host(
            f"REQUEST #{ba.pk}: {b.guest.display_name} ({b.ref}, {b.unit.name}) asks for {addon.name}"
            f"{' at ' + ba.details['time'] if ba.details.get('time') else ''}. Reply YES {ba.pk} or NO {ba.pk}.",
            booking=b,
            kind="addon_request",
        )
    record(
        "booking",
        f"{addon.name} {'requested' if addon.requires_approval else 'added'} on {b.ref}",
        channel=channel,
        booking=b,
        actor=actor,
    )
    return ba


def decide_addon(ba, approve, *, actor=None):
    from apps.payments import services as payments

    if ba.status != "requested":
        return ba
    ba.status, ba.decided_at = ("confirmed" if approve else "declined"), timezone.now()
    ba.save(update_fields=["status", "decided_at"])
    b = recalc(ba.booking)
    if ba.addon.code in ("late_checkout", "early_checkin"):
        locks.refresh_window(b)
    event(b, "addon", f"{ba.addon.name} {'approved' if approve else 'declined'}", actor=actor)
    what = ba.addon.name.lower()
    if approve:
        price_line = f" {kes(ba.total)} has been added to your bill." if ba.total else ""
        send_guest(b, "request_approved", what=what, price_line=price_line)
        if ba.total and is_kenyan(b.guest.phone) and b.status in ("confirmed", "checked_in"):
            payments.start_payment(b, method="mpesa", purpose="addon", amount=ba.total)
    else:
        send_guest(b, "request_declined", what=what)
    return ba


def set_breakfast(booking, style, *, people=None, dietary="", time="", notes="", channel="sms", actor=None):
    b = booking
    current = b.addons.filter(addon__code="breakfast").exclude(status__in=("declined", "cancelled")).first()
    if not style or style == "none":
        if current:
            current.status = "cancelled"
            current.save(update_fields=["status"])
            recalc(b)
            event(b, "breakfast", "Breakfast removed", channel, actor)
        return None
    if style not in BREAKFAST_STYLES:
        raise BookingError("Unknown breakfast choice.")
    addon = Addon.objects.filter(code="breakfast", active=True).first()
    if not addon or not b.unit.breakfast_available:
        raise BookingError("Breakfast isn't available at this home.")
    qty = max(1, min(int(people or b.guests_count), b.unit.max_guests))
    details = {
        "style": style,
        "dietary": dietary[:120],
        "time": time[:10] or addon.options.get("default_time", "08:00"),
        "notes": notes[:200],
    }
    if current:
        current.quantity, current.details, current.unit_price = qty, details, addon.price
        current.total = addon.price_for(b.nights, b.guests_count, qty)
        current.save(update_fields=["quantity", "details", "unit_price", "total"])
        ba = current
    else:
        ba = BookingAddon.objects.create(
            booking=b,
            addon=addon,
            quantity=qty,
            unit_price=addon.price,
            total=addon.price_for(b.nights, b.guests_count, qty),
            status="confirmed",
            details=details,
        )
    recalc(b)
    event(b, "breakfast", f"Breakfast: {breakfast_summary(ba)}", channel, actor)
    record("booking", f"Breakfast set for {b.ref}: {breakfast_summary(ba)}", channel=channel, booking=b)
    return ba


def set_eta(booking, eta, channel="sms"):
    booking.arrival_eta = eta[:40]
    booking.save(update_fields=["arrival_eta", "updated_at"])
    event(booking, "eta", f"Arrival time: {eta}", channel)


ARRIVAL_TIPS = {
    "flight": "From Moi International Airport it's about 30-45 min to Nyali/Old Town; taxis cost around KES 1,500 - agree the fare first, or book Uber/Bolt.",
    "sgr": "The SGR terminus is at Miritini, about 12 km from town - allow 30-60 min by taxi or Uber/Bolt.",
    "car": "For Diani use the Dongo Kundu bypass to avoid Likoni ferry queues.",
    "bus": "Most buses stop near Mwembe Tayari / Buxton - take a registered taxi, Uber or Bolt from there.",
    "local": "Great - see you soon!",
}


def set_arrival_mode(booking, mode, channel="sms"):
    booking.arrival_mode = mode
    booking.save(update_fields=["arrival_mode", "updated_at"])
    event(booking, "arrival", f"Arriving by {mode}", channel)
    tip = ARRIVAL_TIPS.get(mode, "")
    if booking.unit.area.slug == "diani" and mode in ("flight", "sgr"):
        tip += " Diani is south of the Likoni channel - the Dongo Kundu bypass saves ferry queues."
    return tip


def checkout_reply(phone, channel="sms"):
    b = active_stay(phone)
    if not b:
        return messaging.render("no_booking", _lang(phone))
    check_out(b, channel=channel)
    return None  # the thank-you SMS has already been sent


def _lang(phone):
    from apps.accounts.models import User

    u = User.objects.filter(phone=phone).only("lang").first()
    return u.lang if u else "en"
