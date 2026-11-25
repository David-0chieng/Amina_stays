"""Payments: start a collection, then settle it exactly once when the provider calls back.

Lessons from Airbnb's payments engineering (Orpheus): no network call inside a DB transaction,
a duplicate callback is a no-op, and async methods move pending → confirmed. A payment that
arrives after its hold lapsed re-confirms the booking only if the unit is still free;
otherwise the booking becomes refund_due and Amina is alerted.
"""

import logging
from datetime import timedelta

from django.conf import settings
from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.bookings import services as bookings
from apps.bookings.models import Booking
from apps.core.activity import record
from apps.core.models import SiteSettings
from apps.core.utils import is_kenyan, kes
from apps.messaging import services as messaging
from apps.properties.models import Unit
from apps.properties.services import is_available

from .models import Payment, Refund
from .providers import PaymentError, card_provider, mpesa_provider

log = logging.getLogger("amina.payments")

FAILURE_TEXT = {
    "1032": "cancelled on the phone",
    "1037": "the phone didn't respond in time",
    "2001": "wrong M-Pesa PIN",
    "1": "insufficient M-Pesa balance",
    "1025": "M-Pesa is busy, please retry",
}


def _amount_for(b, purpose):
    if b.status == "held":
        due = max(0, b.amount_due_now - b.amount_paid)
        return due, ("deposit" if b.payment_plan == "deposit" else "full")
    return b.balance_due, purpose or "balance"


def start_payment(booking, *, method=None, purpose=None, amount=None, phone=None, actor=None):
    """Returns {payment_id, method, status, amount, checkout_url?, simulated, message}. Raises PaymentError."""
    b = Booking.objects.select_related("guest", "unit").get(pk=booking.pk)
    phone = phone or b.guest.phone
    method = method or ("mpesa" if is_kenyan(phone) else "card")
    if method not in ("mpesa", "card"):
        raise PaymentError("Choose M-Pesa or card.")
    if method == "mpesa" and not is_kenyan(phone):
        raise PaymentError("M-Pesa needs a Kenyan (+254) number - please pay by card.")
    if b.status not in ("held", "confirmed", "checked_in"):
        raise PaymentError("This booking can't take payments.")
    if b.status == "held" and not b.hold_active:
        raise PaymentError("The hold on this home has expired - please book again.")
    default_amount, default_purpose = _amount_for(b, purpose)
    amount = int(amount if amount is not None else default_amount)
    purpose = purpose or default_purpose
    if amount <= 0:
        raise PaymentError("There's nothing left to pay.")

    # "Guest taps Pay twice": reuse a request made in the last minute instead of sending a second prompt
    recent = Payment.objects.filter(
        booking=b, method=method, amount=amount, status="pending", created_at__gt=timezone.now() - timedelta(seconds=60)
    ).first()
    if recent:
        return _result(recent, {"status": "pending", "message": "A payment request is already waiting on your phone."})

    provider = mpesa_provider() if method == "mpesa" else card_provider()
    p = Payment.objects.create(
        booking=b, amount=amount, method=method, purpose=purpose, phone=phone, provider=provider.name, created_by=actor
    )
    try:
        res = provider.request(p)
    except PaymentError as e:
        p.status, p.failure_reason = "failed", str(e)[:200]
        p.save(update_fields=["status", "failure_reason", "updated_at"])
        bookings.event(b, "payment_failed", f"{p.get_method_display()} request failed: {e}")
        raise
    bookings.event(b, "payment_requested", f"{p.get_method_display()} request for {kes(amount)} sent ({purpose})")
    return _result(p, res, simulated=provider.simulated)


def _checkout_url(p):
    if p.method != "card" or not p.checkout_token:
        return None
    if p.provider == "simulate":
        return f"{settings.FRONTEND_URL}/pay/card/{p.checkout_token}"
    for entry in reversed(p.raw or []):
        url = ((entry.get("request") or {}).get("data") or {}).get("authorization_url")
        if url:
            return url
    return None


def _result(p, res, simulated=None):
    return {
        "payment_id": p.pk,
        "method": p.method,
        "status": p.status,
        "amount": p.amount,
        "purpose": p.purpose,
        "checkout_url": res.get("checkout_url") or _checkout_url(p),
        "message": res.get("message", ""),
        "simulated": simulated if simulated is not None else p.provider == "simulate",
    }


def start_remote_payment(booking):
    """For SMS / USSD / voice: start payment and return wording for the guest; card links go out by SMS."""
    b = booking
    try:
        r = start_payment(b)
    except PaymentError as e:
        return {
            "error": str(e),
            "text": f"We couldn't start payment ({e}). Your hold lasts a few minutes - reply PAY to try again.",
        }
    ctx = {
        **bookings.guest_context(b),
        "amount": kes(r["amount"]),
        "minutes": SiteSettings.load().hold_minutes,
        "link": r.get("checkout_url") or "",
    }
    if r["method"] == "card":
        messaging.send(b.guest.phone, messaging.render("hold_card", b.lang, **ctx), booking=b, kind="hold_card")
        return {**r, "text": f"We've texted you a secure card payment link for {kes(r['amount'])}."}
    return {**r, "text": f"Check your phone for an M-Pesa prompt for {kes(r['amount'])}."}


def on_success(payment, *, transaction_id=None, provider_ref="", raw=None, amount=None):
    """Settle a payment exactly once. Safe to call repeatedly (duplicate callbacks, retries, the simulator)."""
    outcome = None
    try:
        with transaction.atomic():
            p = Payment.objects.select_for_update().get(pk=payment.pk)
            if p.status == "success":
                return p.booking
            if amount is not None and int(float(amount)) < p.amount:
                p.status, p.failure_reason = "failed", f"Amount mismatch: got {amount}, expected {p.amount}"
                p.raw = [*p.raw, {"callback": raw or {}}]
                p.save(update_fields=["status", "failure_reason", "raw", "updated_at"])
                outcome = "mismatch"
            else:
                p.status, p.completed_at = "success", timezone.now()
                if transaction_id and not p.transaction_id:
                    p.transaction_id = transaction_id
                p.provider_ref = (provider_ref or p.provider_ref or "")[:80]
                if raw:
                    p.raw = [*p.raw, {"callback": raw}]
                p.save()
                Unit.objects.select_for_update().filter(pk=p.booking.unit_id).first()
                b = Booking.objects.select_for_update().get(pk=p.booking_id)
                b.amount_paid += p.amount
                bookings.update_payment_status(b, save=False)
                b.save(update_fields=["amount_paid", "payment_status", "updated_at"])
                bookings.event(
                    b,
                    "payment",
                    f"{p.get_method_display()} payment received: {kes(p.amount)}{' (' + p.provider_ref + ')' if p.provider_ref else ''}",
                )
                if b.status == "held":
                    outcome = "confirm"
                elif b.status in ("expired", "cancelled"):
                    if b.status == "expired" and is_available(b.unit, b.check_in, b.check_out, exclude_booking_id=b.pk):
                        b.status, b.hold_expires_at = "held", timezone.now() + timedelta(minutes=5)
                        b.save(update_fields=["status", "hold_expires_at", "updated_at"])
                        bookings.event(
                            b, "reinstated", "Paid after the hold lapsed - unit still free, booking reinstated"
                        )
                        outcome = "confirm"
                    else:
                        b.status = "refund_due"
                        b.save(update_fields=["status", "updated_at"])
                        outcome = "refund_due"
                else:
                    outcome = "extra"
    except IntegrityError:
        # the reinstated dates were taken in the meantime (exclusion constraint)
        Booking.objects.filter(pk=payment.booking_id).update(status="refund_due")
        outcome = "refund_due"

    p = Payment.objects.select_related("booking", "booking__guest", "booking__unit", "booking__unit__area").get(
        pk=payment.pk
    )
    b = p.booking
    if outcome == "confirm":
        bookings.confirm(b)
    elif outcome == "refund_due":
        from apps.safety.services import raise_alert

        bookings.send_guest(b, "late_payment_refund", amount=kes(p.amount))
        raise_alert(
            "payment",
            f"Refund due: {kes(p.amount)} to {b.guest.phone} for {b.ref} (paid after the unit was re-let)",
            severity="high",
            booking=b,
            dedupe=f"refund-due:{p.pk}",
        )
    elif outcome == "extra":
        b.refresh_from_db()
        balance_line = f"Balance due: {kes(b.balance_due)}." if b.balance_due else "You're fully paid - thank you!"
        bookings.send_guest(b, "payment_received", amount=kes(p.amount), balance_line=balance_line)
    elif outcome == "mismatch":
        from apps.safety.services import raise_alert

        raise_alert(
            "payment",
            f"Payment amount mismatch on {b.ref}: {p.failure_reason}",
            severity="high",
            booking=b,
            dedupe=f"mismatch:{p.pk}",
        )
    if outcome in ("confirm", "extra", "refund_due"):
        record(
            "payment",
            f"{p.get_method_display()} {kes(p.amount)} received for {b.ref}",
            booking=b,
            method=p.method,
            amount=p.amount,
        )
    return b


def on_failure(payment, reason="", raw=None):
    with transaction.atomic():
        p = Payment.objects.select_for_update().get(pk=payment.pk)
        if p.status != "pending":
            return p
        p.status, p.failure_reason = "failed", (reason or "declined")[:200]
        if raw:
            p.raw = [*p.raw, {"callback": raw}]
        p.save(update_fields=["status", "failure_reason", "raw", "updated_at"])
    b = Booking.objects.select_related("guest", "unit", "unit__area").get(pk=p.booking_id)
    bookings.event(b, "payment_failed", f"{p.get_method_display()} payment failed: {p.failure_reason}")
    if b.status == "held" and b.channel != "web":
        bookings.send_guest(b, "payment_failed", reason=p.failure_reason)
    return p


def refund(booking, amount, *, reason="", actor=None, method=None):
    """Simulated payments refund instantly; real ones are queued for Amina to send (M-Pesa B2C / card reversal)."""
    b = booking
    last = b.payments.filter(status="success").order_by("-id").first()
    method = method or (
        "card" if last and last.method == "card" else "mpesa_b2c" if last and last.method == "mpesa" else "manual"
    )
    simulated = last is not None and last.provider == "simulate"
    r = Refund.objects.create(
        booking=b,
        payment=last,
        amount=amount,
        method=method,
        reason=reason[:200],
        created_by=actor,
        status="success" if simulated else "pending",
        completed_at=timezone.now() if simulated else None,
    )
    if simulated:
        _apply_refund(b, amount)
    else:
        from apps.safety.services import raise_alert

        raise_alert(
            "payment",
            f"Refund to send: {kes(amount)} to {b.guest.phone} for {b.ref} ({r.get_method_display()})",
            severity="medium",
            booking=b,
            dedupe=f"refund:{r.pk}",
        )
    bookings.event(
        b, "refund", f"Refund {kes(amount)} {'sent' if simulated else 'queued'} ({r.get_method_display()})", actor=actor
    )
    return r


def mark_refund_sent(r, provider_ref="", actor=None):
    if r.status == "success":
        return r
    r.status, r.provider_ref, r.completed_at = "success", provider_ref[:80], timezone.now()
    r.save(update_fields=["status", "provider_ref", "completed_at"])
    _apply_refund(r.booking, r.amount)
    bookings.event(
        r.booking,
        "refund",
        f"Refund {kes(r.amount)} marked as sent{' (' + provider_ref + ')' if provider_ref else ''}",
        actor=actor,
    )
    return r


def _apply_refund(b, amount):
    b = Booking.objects.get(pk=b.pk)
    b.amount_refunded += amount
    bookings.update_payment_status(b, save=False)
    if b.status == "refund_due" and b.amount_refunded >= b.amount_paid:
        b.status = "cancelled"
    b.save(update_fields=["amount_refunded", "payment_status", "status", "updated_at"])


def record_manual_payment(booking, amount, method="cash", reference="", actor=None):
    """Amina took cash / a bank transfer at the door."""
    p = Payment.objects.create(
        booking=booking,
        amount=int(amount),
        method=method,
        purpose="balance" if booking.amount_paid else "full",
        phone=booking.guest.phone,
        provider="manual",
        created_by=actor,
    )
    return on_success(p, provider_ref=reference or f"{method.upper()}-{p.pk}")


def reconcile_pending():
    """Ask the provider about STK pushes with no callback after 2 minutes; expire very old ones."""
    provider = mpesa_provider()
    for p in Payment.objects.filter(
        status="pending", method="mpesa", created_at__lt=timezone.now() - timedelta(minutes=2)
    )[:20]:
        res = provider.query(p) if p.transaction_id else None
        code = str((res or {}).get("ResultCode", ""))
        if code == "0":
            on_success(p, raw=res)
        elif code and code not in ("", "None"):
            on_failure(p, FAILURE_TEXT.get(code, (res or {}).get("ResultDesc", "failed")), raw=res)
        elif p.created_at < timezone.now() - timedelta(minutes=30):
            on_failure(p, "no confirmation received")
