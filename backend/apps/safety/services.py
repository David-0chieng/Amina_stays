"""Safety & alerts. 'HELP' by SMS, 9 on a call, the SOS button on the web or USSD option 9 all
skip every queue: Amina's phone rings (Africa's Talking Voice) and she gets an SMS with who and
where. If nobody acknowledges within 3 minutes the backup contact is called."""

import logging
from datetime import timedelta

from django.utils import timezone

from apps.core.activity import record
from apps.core.models import OnceMarker, SiteSettings
from apps.core.utils import mask_phone

from .models import Alert

log = logging.getLogger("amina.safety")


def _guest_and_booking(phone):
    from apps.accounts.models import User
    from apps.bookings.services import current_booking

    guest = User.objects.filter(phone=phone).first()
    booking = current_booking(phone) if phone else None
    return guest, booking


def describe(phone):
    guest, booking = _guest_and_booking(phone)
    who = f"{guest.name} ({phone})" if guest and guest.name else phone
    if booking:
        where = f"{'staying at' if booking.status == 'checked_in' else 'booked at'} {booking.unit.name}, {booking.unit.area.name} (ref {booking.ref})"
    else:
        where = "no active booking"
    return guest, booking, who, where


def raise_alert(kind, summary, *, severity="high", booking=None, phone="", source="system", details="", dedupe=None, notify=True):
    if dedupe and not OnceMarker.mark(f"alert:{dedupe}"):
        return None
    guest = booking.guest if booking is not None else None
    alert = Alert.objects.create(
        kind=kind, severity=severity, source=source, phone=phone or (guest.phone if guest else ""), guest=guest, booking=booking,
        summary=summary[:300], details=details,
    )
    record("alert", summary, booking=booking, phone=alert.phone, severity=severity, alert_id=alert.pk)
    if notify and severity in ("critical", "high"):
        from apps.messaging import services as messaging

        messaging.send(SiteSettings.load().host_contact, f"ALERT: {summary} Reply OK when handled.", booking=booking, kind="alert")
    return alert


def _call(number, alert):
    from apps.comms import at
    from apps.comms.voice import register_outbound

    try:
        res = at.voice_call(number, client_request_id=f"alert-{alert.pk}")
        register_outbound(res, "alert", alert_id=alert.pk)
        entry = (res.get("entries") or [{}])[0]
        return "dry_run" if res.get("dry_run") else entry.get("status", "requested")
    except Exception as e:
        log.error("safety call failed: %s", e)
        return "failed"


def escalate(phone, source, *, text="", call=True):
    """Guest asked for urgent help. Returns the Alert."""
    from apps.messaging import services as messaging

    s = SiteSettings.load()
    guest, booking, who, where = describe(phone)
    alert = Alert.objects.create(
        kind="sos", severity="critical", source=source, phone=phone, guest=guest, booking=booking,
        summary=f"SOS from {who}, {where}"[:300], details=text, call_status="pending",
    )
    status = _call(s.host_contact, alert) if call else "bridged"
    alert.call_status, alert.calls_made, alert.last_call_at = status, 1 if call else 0, timezone.now()
    alert.save(update_fields=["call_status", "calls_made", "last_call_at"])
    lead = "Calling you now." if status in ("Queued", "dry_run") else "Connecting the caller to you now." if status == "bridged" else "Please call them now."
    note = f' They said: "{text[:80]}"' if text else ""
    messaging.send(s.host_contact, f"URGENT HELP ({source}): {who}, {where}.{note} {lead} Reply OK when handled.", booking=booking, kind="sos")
    if s.backup_phone:
        messaging.send(s.backup_phone, f"URGENT for {s.host_name}: guest {who}, {where} needs help ({source}). Please check in with {s.host_name}.", kind="sos")
    record("alert", f"SOS via {source}: {who}", channel=source, booking=booking, phone=phone, alert_id=alert.pk, call=status)
    return alert


def acknowledge(alert, user=None):
    if alert.status == "open":
        alert.status, alert.acknowledged_at, alert.acknowledged_by = "acknowledged", timezone.now(), user if getattr(user, "pk", None) else None
        alert.save(update_fields=["status", "acknowledged_at", "acknowledged_by"])
        record("alert", f"Alert #{alert.pk} acknowledged", actor=user)
    return alert


def resolve(alert, user=None, note=""):
    alert.status, alert.resolved_at = "resolved", timezone.now()
    alert.resolved_by = user if getattr(user, "pk", None) else None
    alert.resolution_note = note[:300]
    if not alert.acknowledged_at:
        alert.acknowledged_at = alert.resolved_at
    alert.save(update_fields=["status", "resolved_at", "resolved_by", "resolution_note", "acknowledged_at"])
    record("alert", f"Alert #{alert.pk} resolved{': ' + note if note else ''}", actor=user)
    return alert


def acknowledge_latest(user=None):
    open_alerts = Alert.objects.filter(status="open")
    alert = open_alerts.filter(kind="sos").order_by("-id").first() or open_alerts.order_by("-id").first()
    return acknowledge(alert, user) if alert else None


def followups():
    """Unacknowledged SOS: ring the backup contact, then Amina again (max 3 calls)."""
    s = SiteSettings.load()
    cutoff = timezone.now() - timedelta(minutes=3)
    for alert in Alert.objects.filter(kind="sos", status="open", calls_made__lt=3, last_call_at__lt=cutoff):
        number = s.backup_phone if (alert.calls_made % 2 == 1 and s.backup_phone) else s.host_contact
        status = _call(number, alert)
        alert.calls_made += 1
        alert.last_call_at, alert.call_status = timezone.now(), status
        alert.save(update_fields=["calls_made", "last_call_at", "call_status"])
        record("alert", f"SOS #{alert.pk} still open - calling {mask_phone(number)} (attempt {alert.calls_made})", alert_id=alert.pk)
