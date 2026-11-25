from datetime import timedelta

from django.conf import settings
from django.utils import timezone
from rest_framework import serializers

from apps.core.models import SiteSettings
from apps.core.utils import at_local, kes
from apps.properties.models import Unit

from . import services
from .models import Addon

GUEST_EVENT_KINDS = {
    "held", "confirmed", "payment", "payment_requested", "payment_failed", "code_released", "checked_out", "cancelled", "refund",
    "breakfast", "addon", "eta", "arrival", "expired", "reinstated",
}


def price_lines(b):
    lines = []
    if b.nights:
        lines.append({"label": f"{kes(round(b.accommodation_amount / b.nights))} x {b.nights} night{'s' if b.nights != 1 else ''}", "amount": b.accommodation_amount})
    if b.discount_amount:
        lines.append({"label": "Stay discount", "amount": -b.discount_amount})
    if b.cleaning_fee:
        lines.append({"label": "Cleaning fee", "amount": b.cleaning_fee})
    for a in b.addons.exclude(status__in=("declined", "cancelled")).select_related("addon"):
        lines.append({"label": a.addon.name + (" (requested)" if a.status == "requested" else ""), "amount": a.total})
    if b.levy_amount:
        lines.append({"label": "Tourism levy", "amount": b.levy_amount})
    if b.vat_amount:
        lines.append({"label": "VAT", "amount": b.vat_amount})
    return lines


def _addon(ba):
    return {"id": ba.pk, "code": ba.addon.code, "name": ba.addon.name, "icon": ba.addon.icon, "quantity": ba.quantity, "total": ba.total,
            "status": ba.status, "details": ba.details, "requires_approval": ba.addon.requires_approval}


def trip_dict(b, *, host=False):
    s = SiteSettings.load()
    u = b.unit
    now = timezone.now()
    confirmed = b.status in ("confirmed", "checked_in", "completed")
    checkin_dt = at_local(b.check_in, services.effective_checkin_time(b))
    reveal_at = checkin_dt - timedelta(hours=48)
    details_visible = host or (b.status in ("confirmed", "checked_in") and now >= reveal_at) or b.status == "checked_in"
    code = b.access_codes.filter(revoked_at__isnull=True).first()
    breakfast = b.addons.filter(addon__code="breakfast").exclude(status__in=("declined", "cancelled")).first()
    checkin = {"time": services.effective_checkin_time(b), "checkout_time": services.effective_checkout_time(b), "method": u.get_access_method_display(),
               "reveal_at": reveal_at, "details_visible": details_visible}
    if confirmed or host:
        checkin.update(address=u.address, map_link=u.map_link,
                       location={"lat": float(u.latitude), "lng": float(u.longitude)} if u.latitude is not None else None)
    if details_visible:
        checkin.update(directions=u.directions, landmark=u.landmark, wifi_name=u.wifi_name, wifi_password=u.wifi_password,
                       house_manual=u.house_manual, parking=u.parking, local_tips=u.local_tips or u.area.tips)
    if code and (host or (b.status == "checked_in" and code.sent_at)):
        checkin.update(code=code.code, code_valid_from=code.valid_from, code_valid_until=code.valid_until)
    review = getattr(b, "review", None) if hasattr(b, "review") else None
    data = {
        "ref": b.ref, "status": b.status, "status_label": b.get_status_display(), "channel": b.channel, "channel_label": b.get_channel_display(),
        "created_at": b.created_at, "hold_expires_at": b.hold_expires_at if b.status == "held" else None,
        "unit": {"id": u.pk, "name": u.name, "slug": u.slug, "headline": u.headline, "area": u.area.name,
                 "photos": [p.src for p in u.photos.all()][:5], "checkin_time": u.effective_checkin(), "checkout_time": u.effective_checkout()},
        "check_in": b.check_in, "check_out": b.check_out, "nights": b.nights, "adults": b.adults, "children": b.children, "infants": b.infants,
        "guests": b.guests_count,
        "price": {"lines": price_lines(b), "total": b.total, "amount_paid": b.amount_paid, "amount_refunded": b.amount_refunded,
                  "balance_due": b.balance_due, "amount_due_now": b.amount_due_now, "payment_status": b.payment_status,
                  "payment_status_label": b.get_payment_status_display(), "payment_plan": b.payment_plan,
                  "balance_due_date": b.check_in - timedelta(days=s.balance_due_days)},
        "addons": [_addon(a) for a in b.addons.select_related("addon")],
        "breakfast": {**breakfast.details, "people": breakfast.quantity, "summary": services.breakfast_summary(breakfast)} if breakfast else None,
        "payments": [{"id": p.pk, "method": p.method, "method_label": p.get_method_display(), "amount": p.amount, "status": p.status,
                      "purpose": p.purpose, "created_at": p.created_at, "reference": p.provider_ref} for p in b.payments.all()],
        "arrival": {"eta": b.arrival_eta, "mode": b.arrival_mode, "vehicle_plate": b.vehicle_plate, "special_requests": b.special_requests},
        "checkin": checkin,
        "occupants": [{"id": o.pk, "full_name": o.full_name, "id_type": o.id_type, "id_last4": o.id_last4, "nationality": o.nationality,
                       "is_minor": o.is_minor, "is_lead": o.is_lead} for o in b.occupants.all()],
        "id_registered": b.guest.has_id, "require_id": s.require_id_before_code,
        "cancellation": {"policy": b.cancellation_policy, "text": services.POLICY_TEXT.get(b.cancellation_policy, ""),
                         **(services.refund_quote(b) if b.status in ("held", "confirmed") else {})},
        "review": {"rating": review.rating, "comment": review.comment, "host_response": review.host_response} if review else None,
        "can_cancel": b.status in ("held", "confirmed"), "can_checkout": b.status == "checked_in",
        "can_review": b.status == "completed" and not review, "can_add_extras": b.status in ("confirmed", "checked_in"),
        "can_pay": (b.status == "held" and bool(b.hold_active)) or (b.status in ("confirmed", "checked_in") and b.balance_due > 0),
        "timeline": [{"kind": e.kind, "text": e.text, "created_at": e.created_at, "channel": e.channel}
                     for e in b.events.all() if host or e.kind in GUEST_EVENT_KINDS],
        "tra_licence": u.tra_licence_number or s.tra_licence_number,
        "support": {"sms": settings.AT_SMS_NUMBER, "voice": settings.AT_VOICE_NUMBER, "ussd": settings.AT_USSD_CODE},
    }
    if host:
        g = b.guest
        data.update(
            guest={"id": g.pk, "name": g.name, "phone": g.phone, "email": g.email, "nationality": g.nationality, "lang": g.lang,
                   "tags": g.tags, "notes": g.host_notes, "blocked": g.is_blocked, "id_type": g.get_id_type_display() if g.id_type else "",
                   "id_last4": g.id_last4, "id_verified": bool(g.id_verified_at),
                   "stays": g.bookings.filter(status__in=("completed", "checked_in", "confirmed")).count()},
            risk={"score": b.risk_score, "flags": [{"code": f, "label": services.RISK_LABELS.get(f, f)} for f in b.risk_flags]},
            host_notes=b.host_notes, sim_swap_status=b.sim_swap_status, purpose=b.purpose,
            codes=[{"code": c.code, "provider": c.provider, "valid_from": c.valid_from, "valid_until": c.valid_until, "sent_at": c.sent_at,
                    "revoked_at": c.revoked_at, "revoke_reason": c.revoke_reason} for c in b.access_codes.all()],
            refunds=[{"id": r.pk, "amount": r.amount, "method": r.get_method_display(), "status": r.status, "created_at": r.created_at,
                      "reference": r.provider_ref} for r in b.refunds.all()],
            cancel_info={"cancelled_at": b.cancelled_at, "by": b.cancelled_by, "reason": b.cancel_reason},
        )
    return data


def reservation_row(b):
    return {
        "ref": b.ref, "status": b.status, "status_label": b.get_status_display(), "channel": b.channel, "channel_label": b.get_channel_display(),
        "unit": {"id": b.unit_id, "name": b.unit.name}, "guest": {"id": b.guest_id, "name": b.guest.name, "phone": b.guest.phone, "nationality": b.guest.nationality},
        "check_in": b.check_in, "check_out": b.check_out, "nights": b.nights, "guests": b.guests_count, "total": b.total,
        "amount_paid": b.amount_paid, "balance_due": b.balance_due, "payment_status": b.payment_status, "risk_score": b.risk_score,
        "created_at": b.created_at, "hold_expires_at": b.hold_expires_at if b.status == "held" else None,
    }


def trip_card(b):
    return {
        "ref": b.ref, "status": b.status, "status_label": b.get_status_display(), "check_in": b.check_in, "check_out": b.check_out,
        "nights": b.nights, "total": b.total, "balance_due": b.balance_due, "payment_status": b.payment_status, "channel": b.channel,
        "unit": {"name": b.unit.name, "slug": b.unit.slug, "area": b.unit.area.name, "cover": b.unit.cover_photo},
        "hold_expires_at": b.hold_expires_at if b.status == "held" else None,
    }


class AddonSerializer(serializers.ModelSerializer):
    unit_ids = serializers.PrimaryKeyRelatedField(source="units", many=True, required=False, queryset=Unit.objects.all())

    class Meta:
        model = Addon
        exclude = ["units"]


class BookingCreateSerializer(serializers.Serializer):
    listing = serializers.SlugField()
    check_in = serializers.DateField()
    check_out = serializers.DateField()
    adults = serializers.IntegerField(min_value=1, max_value=16, default=1)
    children = serializers.IntegerField(min_value=0, max_value=10, default=0)
    infants = serializers.IntegerField(min_value=0, max_value=5, default=0)
    addons = serializers.ListField(child=serializers.DictField(), required=False, default=list)
    payment_plan = serializers.ChoiceField(choices=["full", "deposit"], default="full")
    payment_method = serializers.ChoiceField(choices=["mpesa", "card"], required=False)
    arrival_eta = serializers.CharField(required=False, allow_blank=True, default="")
    arrival_mode = serializers.CharField(required=False, allow_blank=True, default="")
    special_requests = serializers.CharField(required=False, allow_blank=True, default="")
    purpose = serializers.CharField(required=False, allow_blank=True, default="")
    vehicle_plate = serializers.CharField(required=False, allow_blank=True, default="")
    name = serializers.CharField(required=False, allow_blank=True, default="")
    email = serializers.EmailField(required=False, allow_blank=True, default="")
    lang = serializers.CharField(required=False, allow_blank=True, default="")
    identity = serializers.DictField(required=False)
    occupants = serializers.ListField(child=serializers.DictField(), required=False, default=list)
    marketing_opt_in = serializers.BooleanField(required=False, default=False)
