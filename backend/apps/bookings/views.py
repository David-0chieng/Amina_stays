from django.db.models import Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import viewsets
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from apps.accounts.services import AuthError, get_or_create_user, set_identity
from apps.core.activity import record
from apps.core.api import IsGuest, IsHost
from apps.core.utils import parse_date
from apps.messaging import services as messaging
from apps.payments import services as payments
from apps.payments.providers import PaymentError
from apps.properties.models import Unit

from . import services
from .models import Addon, Booking, BookingAddon, BookingGuest
from .serializers import AddonSerializer, BookingCreateSerializer, reservation_row, trip_card, trip_dict


def _mine(request, ref):
    return get_object_or_404(Booking.objects.select_related("unit", "unit__area", "guest"), ref=ref.upper(), guest=request.user)


def _err(e, status=400):
    return Response({"error": str(e)}, status=status)


# ---------- guest ----------


@api_view(["GET", "POST"])
@permission_classes([IsGuest])
def bookings(request):
    if request.method == "GET":
        qs = Booking.objects.filter(guest=request.user).exclude(status="expired").select_related("unit", "unit__area").prefetch_related("unit__photos")
        return Response([trip_card(b) for b in qs.order_by("-check_in")])
    ser = BookingCreateSerializer(data=request.data)
    ser.is_valid(raise_exception=True)
    d = ser.validated_data
    user = request.user
    unit = get_object_or_404(Unit, slug=d["listing"], status="active")
    changed = []
    if d["name"]:
        user.name = d["name"][:80]
        changed.append("name")
    if d["email"]:
        user.email = d["email"]
        changed.append("email")
    if d["lang"] in ("en", "sw", "it", "de", "fr"):
        user.lang = d["lang"]
        changed.append("lang")
    if d["marketing_opt_in"]:
        user.marketing_opt_in = True
        changed.append("marketing_opt_in")
    if changed:
        user.save(update_fields=changed)
    ident = d.get("identity") or {}
    if ident.get("id_number"):
        try:
            set_identity(user, id_type=ident.get("id_type", ""), id_number=ident["id_number"], nationality=ident.get("nationality", ""),
                         consent=bool(ident.get("consent")))
        except AuthError as e:
            return _err(e)
    try:
        b = services.create_hold(
            unit=unit, guest=user, check_in=d["check_in"], check_out=d["check_out"], channel="web", adults=d["adults"], children=d["children"],
            infants=d["infants"], addons=d["addons"], payment_plan=d["payment_plan"], arrival_eta=d["arrival_eta"], arrival_mode=d["arrival_mode"],
            special_requests=d["special_requests"], purpose=d["purpose"], vehicle_plate=d["vehicle_plate"], occupants=d["occupants"],
        )
    except services.BookingError as e:
        return _err(e, 409)
    try:
        pay = payments.start_payment(b, method=d.get("payment_method"))
    except PaymentError as e:
        pay = {"error": str(e)}
    return Response({"booking": trip_dict(b), "payment": pay}, status=201)


@api_view(["GET", "PATCH"])
@permission_classes([IsGuest])
def booking_detail(request, ref):
    b = _mine(request, ref)
    if request.method == "PATCH":
        d = request.data
        for field, limit in (("arrival_eta", 40), ("arrival_mode", 10), ("vehicle_plate", 12), ("special_requests", 1000)):
            if field in d:
                setattr(b, field, str(d[field] or "")[:limit].strip().upper() if field == "vehicle_plate" else str(d[field] or "")[:limit])
        b.save()
        services.event(b, "arrival", "Arrival details updated", "web")
    return Response(trip_dict(b))


@api_view(["POST"])
@permission_classes([IsGuest])
def pay(request, ref):
    b = _mine(request, ref)
    try:
        return Response(payments.start_payment(b, method=request.data.get("method"), amount=request.data.get("amount")))
    except PaymentError as e:
        return _err(e)


@api_view(["GET", "POST"])
@permission_classes([IsGuest])
def cancel(request, ref):
    b = _mine(request, ref)
    if request.method == "GET":
        return Response(services.refund_quote(b))
    try:
        return Response(services.cancel(b, by="guest", reason=request.data.get("reason", "")[:200]))
    except services.BookingError as e:
        return _err(e)


@api_view(["POST"])
@permission_classes([IsGuest])
def add_extra(request, ref):
    b = _mine(request, ref)
    try:
        services.add_addon(b, request.data.get("code"), quantity=request.data.get("quantity"), details=request.data.get("details") or {}, channel="web")
    except services.BookingError as e:
        return _err(e)
    b.refresh_from_db()
    return Response(trip_dict(b))


@api_view(["PUT"])
@permission_classes([IsGuest])
def breakfast(request, ref):
    b = _mine(request, ref)
    d = request.data
    try:
        services.set_breakfast(b, d.get("style"), people=d.get("people"), dietary=d.get("dietary", ""), time=d.get("time", ""),
                               notes=d.get("notes", ""), channel="web")
    except services.BookingError as e:
        return _err(e)
    b.refresh_from_db()
    return Response(trip_dict(b))


@api_view(["POST"])
@permission_classes([IsGuest])
def occupants(request, ref):
    b = _mine(request, ref)
    for o in request.data.get("occupants") or []:
        if not o.get("full_name"):
            continue
        bg = BookingGuest(booking=b, full_name=o["full_name"][:80], id_type=o.get("id_type", "")[:20],
                          nationality=(o.get("nationality") or "")[:2].upper(), is_minor=bool(o.get("is_minor")))
        if o.get("id_number"):
            bg.set_id_number(o["id_number"])
        bg.save()
    services.event(b, "register", "Guest register updated", "web")
    return Response(trip_dict(b))


@api_view(["POST"])
@permission_classes([IsGuest])
def checkout(request, ref):
    b = _mine(request, ref)
    try:
        services.check_out(b, channel="web")
    except services.BookingError as e:
        return _err(e)
    b.refresh_from_db()
    return Response(trip_dict(b))


@api_view(["POST"])
@permission_classes([IsGuest])
def report_issue(request, ref):
    from apps.operations.services import report_issue as report

    b = _mine(request, ref)
    text = (request.data.get("description") or "").strip()
    if not text:
        return _err("Tell us what's wrong.")
    task = report(b, text, category=request.data.get("category") or None, channel="web")
    services.notify_host(f"Issue #{task.pk} at {b.unit.name} ({b.guest.display_name}, web): {text[:120]}", booking=b)
    return Response({"task": task.pk, "assignee": task.assignee.name if task.assignee else None, "priority": task.priority})


@api_view(["POST"])
@permission_classes([IsGuest])
def sos(request, ref):
    from apps.safety.services import escalate

    _mine(request, ref)
    alert = escalate(request.user.phone, "web", text=(request.data.get("text") or "")[:300])
    return Response({"alert": alert.pk, "call_status": alert.call_status})


@api_view(["POST"])
@permission_classes([IsGuest])
def review(request, ref):
    from apps.reviews.services import record_rating

    b = _mine(request, ref)
    if b.status != "completed":
        return _err("You can review once your stay is complete.")
    d = request.data
    rating = int(d.get("rating") or 0)
    if not 1 <= rating <= 5:
        return _err("Choose a rating from 1 to 5 stars.")
    record_rating(b, rating, channel="web", comment=(d.get("comment") or "")[:2000], categories=d.get("categories") or {})
    b.refresh_from_db()
    return Response(trip_dict(b))


# ---------- host ----------


@api_view(["GET", "POST"])
@permission_classes([IsHost])
def host_reservations(request):
    if request.method == "POST":
        return _host_create(request)
    p = request.query_params
    qs = Booking.objects.select_related("unit", "guest").order_by("-created_at")
    if p.get("status"):
        qs = qs.filter(status__in=p["status"].split(","))
    else:
        qs = qs.exclude(status="expired")
    if p.get("channel"):
        qs = qs.filter(channel=p["channel"])
    if p.get("unit"):
        qs = qs.filter(unit_id=p["unit"])
    if p.get("from"):
        qs = qs.filter(check_out__gte=parse_date(p["from"]))
    if p.get("to"):
        qs = qs.filter(check_in__lte=parse_date(p["to"]))
    if p.get("q"):
        q = p["q"].strip()
        qs = qs.filter(Q(ref__icontains=q) | Q(guest__name__icontains=q) | Q(guest__phone__icontains=q) | Q(unit__name__icontains=q))
    limit = min(int(p.get("limit") or 200), 500)
    return Response([reservation_row(b) for b in qs[:limit]])


def _host_create(request):
    d = request.data
    unit = get_object_or_404(Unit, pk=d.get("unit"))
    try:
        guest, _ = get_or_create_user(d.get("phone"), name=d.get("name", ""), channel="walk_in")
        b = services.create_hold(
            unit=unit, guest=guest, check_in=parse_date(d.get("check_in")), check_out=parse_date(d.get("check_out")),
            channel=d.get("channel") if d.get("channel") in ("walk_in", "airbnb", "booking_com", "whatsapp") else "walk_in",
            adults=int(d.get("adults") or 1), children=int(d.get("children") or 0), addons=d.get("addons") or [], actor=request.user,
            special_requests=d.get("notes", ""),
        )
    except (services.BookingError, AuthError) as e:
        return _err(e, 409)
    mode = d.get("payment", "none")
    result = {}
    try:
        if mode == "cash":
            payments.record_manual_payment(b, int(d.get("amount") or b.total), method="cash", actor=request.user)
        elif mode == "mpesa":
            result = payments.start_payment(b, method="mpesa", actor=request.user)
        elif mode == "card":
            result = payments.start_payment(b, method="card", actor=request.user)
            messaging.send(guest.phone, f"Pay {b.total:,} KES for {b.ref} securely here: {result.get('checkout_url')}", booking=b, kind="hold_card")
        else:
            services.confirm(b, actor=request.user)  # pay on arrival
    except PaymentError as e:
        result = {"error": str(e)}
    b.refresh_from_db()
    return Response({"booking": trip_dict(b, host=True), "payment": result}, status=201)


@api_view(["GET", "PATCH"])
@permission_classes([IsHost])
def host_reservation(request, ref):
    b = get_object_or_404(Booking.objects.select_related("unit", "unit__area", "guest"), ref=ref.upper())
    if request.method == "PATCH":
        for field in ("host_notes", "arrival_eta", "special_requests", "vehicle_plate", "arrival_mode"):
            if field in request.data:
                setattr(b, field, str(request.data[field] or ""))
        b.save()
    return Response(trip_dict(b, host=True))


@api_view(["POST"])
@permission_classes([IsHost])
def host_action(request, ref, action):
    b = get_object_or_404(Booking.objects.select_related("unit", "unit__area", "guest"), ref=ref.upper())
    d, user = request.data, request.user
    try:
        if action == "cancel":
            services.cancel(b, by="host", reason=d.get("reason", ""), actor=user, refund_amount=d.get("refund_amount"))
        elif action == "record-payment":
            payments.record_manual_payment(b, int(d.get("amount") or b.balance_due), method=d.get("method", "cash"), reference=d.get("reference", ""), actor=user)
        elif action == "request-payment":
            payments.start_payment(b, method=d.get("method"), amount=d.get("amount"), actor=user)
        elif action == "release-code":
            state = services.release_code(b, force=bool(d.get("force", True)), actor=user)
            if state != "released":
                return _err(f"Code not released: {state.replace('_', ' ')}")
        elif action == "check-out":
            services.check_out(b, by="host", channel="console", actor=user)
        elif action == "confirm":
            services.confirm(b, actor=user)
        elif action == "resend":
            key = d.get("template", "booking_confirmed")
            services.send_guest(b, key, balance_note="")
        elif action == "verify-id":
            b.guest.id_verified_at = timezone.now()
            b.guest.save(update_fields=["id_verified_at"])
            services.event(b, "register", "ID verified in person", actor=user)
        elif action == "message":
            from apps.comms.smsbot import reply_as_host

            reply_as_host(b.guest.phone, d.get("text", "")[:600], user=user)
        else:
            return _err("Unknown action.", 404)
    except (services.BookingError, PaymentError) as e:
        return _err(e)
    record("booking", f"{action.replace('-', ' ').capitalize()} on {b.ref}", booking=b, actor=user)
    b.refresh_from_db()
    return Response(trip_dict(b, host=True))


@api_view(["POST"])
@permission_classes([IsHost])
def decide_request(request, pk):
    ba = get_object_or_404(BookingAddon.objects.select_related("booking", "addon"), pk=pk)
    services.decide_addon(ba, bool(request.data.get("approve")), actor=request.user)
    return Response(trip_dict(ba.booking, host=True))


@api_view(["GET"])
@permission_classes([IsHost])
def pending_requests(request):
    rows = BookingAddon.objects.filter(status="requested").select_related("booking", "booking__guest", "booking__unit", "addon")
    return Response([
        {"id": r.pk, "addon": r.addon.name, "code": r.addon.code, "ref": r.booking.ref, "unit": r.booking.unit.name, "guest": r.booking.guest.display_name,
         "details": r.details, "total": r.total, "created_at": r.created_at}
        for r in rows
    ])


class HostAddonViewSet(viewsets.ModelViewSet):
    permission_classes = [IsHost]
    serializer_class = AddonSerializer
    queryset = Addon.objects.prefetch_related("units").all()
