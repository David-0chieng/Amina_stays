import hashlib
import hmac
import json
import logging

from django.conf import settings
from django.db.models import Q
from django.http import HttpResponse, HttpResponseForbidden, JsonResponse
from django.shortcuts import get_object_or_404
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from apps.core.api import IsHost

from . import services
from .models import Payment, Refund

log = logging.getLogger("amina.payments")


def _secret_ok(secret):
    expected = settings.AT_WEBHOOK_SECRET
    return not expected or hmac.compare_digest(secret or "", expected)


def _json(request):
    try:
        return json.loads(request.body or b"{}")
    except ValueError:
        return request.POST.dict()


@csrf_exempt
@require_POST
def at_callback(request, secret=""):
    """Africa's Talking Mobile Checkout notification."""
    if not _secret_ok(secret or request.GET.get("key")):
        return HttpResponseForbidden("bad secret")
    d = _json(request)
    meta = d.get("requestMetadata") or d.get("metadata") or {}
    p = Payment.objects.filter(transaction_id=d.get("transactionId")).first() if d.get("transactionId") else None
    if p is None and meta.get("paymentId"):
        p = Payment.objects.filter(pk=meta["paymentId"], method="mpesa").first()
    if p is None:
        log.warning("AT payment callback for unknown transaction: %s", d)
        return HttpResponse("OK")
    value = str(d.get("value", "")).replace("KES", "").strip()
    try:
        if d.get("status") == "Success":
            services.on_success(
                p,
                transaction_id=d.get("transactionId"),
                provider_ref=d.get("providerRefId", ""),
                raw=d,
                amount=value or None,
            )
        elif d.get("status") == "Failed":
            services.on_failure(p, d.get("description", "failed"), raw=d)
    except Exception:
        log.exception("AT payment callback failed")
    return HttpResponse("OK")


@csrf_exempt
@require_POST
def daraja_callback(request, secret=""):
    """Safaricom Daraja STK push result (ResultCode 0 = paid)."""
    if not _secret_ok(secret if secret != "cb" else ""):
        return HttpResponseForbidden("bad secret")
    cb = (_json(request).get("Body") or {}).get("stkCallback") or {}
    p = Payment.objects.filter(transaction_id=cb.get("CheckoutRequestID")).first()
    if p is None:
        log.warning("Daraja callback for unknown request: %s", cb)
        return JsonResponse({"ResultCode": 0, "ResultDesc": "Accepted"})
    items = {i.get("Name"): i.get("Value") for i in (cb.get("CallbackMetadata") or {}).get("Item", [])}
    try:
        if str(cb.get("ResultCode")) == "0":
            services.on_success(
                p, provider_ref=str(items.get("MpesaReceiptNumber", "")), raw=cb, amount=items.get("Amount")
            )
        else:
            services.on_failure(
                p, services.FAILURE_TEXT.get(str(cb.get("ResultCode")), cb.get("ResultDesc", "failed")), raw=cb
            )
    except Exception:
        log.exception("Daraja callback failed")
    return JsonResponse({"ResultCode": 0, "ResultDesc": "Accepted"})


@csrf_exempt
@require_POST
def paystack_webhook(request):
    sig = request.headers.get("x-paystack-signature", "")
    expected = hmac.new((settings.PAYSTACK_SECRET_KEY or "").encode(), request.body, hashlib.sha512).hexdigest()
    if not settings.PAYSTACK_SECRET_KEY or not hmac.compare_digest(sig, expected):
        return HttpResponseForbidden("bad signature")
    event = _json(request)
    data = event.get("data") or {}
    p = Payment.objects.filter(checkout_token=data.get("reference"), method="card").first()
    if p and event.get("event") == "charge.success" and data.get("status") == "success":
        services.on_success(
            p,
            transaction_id=str(data.get("id")),
            provider_ref=data.get("reference", ""),
            raw=data,
            amount=(data.get("amount") or 0) / 100,
        )
    return HttpResponse("OK")


# ---------- simulated hosted card page (the Next.js /pay/card/[token] page calls these) ----------


def _card(token):
    return get_object_or_404(
        Payment.objects.select_related("booking", "booking__unit"), checkout_token=token, method="card"
    )


@api_view(["GET", "POST"])
def card_checkout(request, token):
    p = _card(token)
    b = p.booking
    if request.method == "POST" and p.provider == "simulate":
        if (
            p.status in ("pending", "failed")
            and b.status in ("held", "confirmed", "checked_in")
            and (b.status != "held" or b.hold_active)
        ):
            if request.data.get("action") == "pay":
                services.on_success(p, transaction_id=f"CARD-SIM-{p.pk}", provider_ref=f"AUTH{p.pk:06d}")
            else:
                if p.status == "pending":
                    services.on_failure(p, "card declined")
        p.refresh_from_db()
        b.refresh_from_db()
    return Response(
        {
            "ref": b.ref,
            "unit": b.unit.name,
            "check_in": b.check_in,
            "check_out": b.check_out,
            "amount": p.amount,
            "currency": p.currency,
            "status": p.status,
            "booking_status": b.status,
            "expires_at": b.hold_expires_at if b.status == "held" else None,
            "expired": (b.status == "held" and not b.hold_active) or b.status == "expired",
            "simulated": p.provider == "simulate",
        }
    )


# ---------- host ledger ----------


@api_view(["GET"])
@permission_classes([IsHost])
def ledger(request):
    q = request.query_params.get("q", "").strip()
    qs = Payment.objects.select_related("booking", "booking__guest", "booking__unit").order_by("-id")
    if request.query_params.get("status"):
        qs = qs.filter(status=request.query_params["status"])
    if q:
        qs = qs.filter(Q(booking__ref__icontains=q) | Q(phone__icontains=q) | Q(provider_ref__icontains=q))
    refunds = Refund.objects.select_related("booking", "booking__guest").order_by("-id")[:100]
    return Response(
        {
            "payments": [
                {
                    "id": p.pk,
                    "ref": p.booking.ref,
                    "guest": p.booking.guest.display_name,
                    "unit": p.booking.unit.name,
                    "amount": p.amount,
                    "method": p.method,
                    "method_label": p.get_method_display(),
                    "purpose": p.purpose,
                    "status": p.status,
                    "provider": p.provider,
                    "reference": p.provider_ref,
                    "failure_reason": p.failure_reason,
                    "created_at": p.created_at,
                    "completed_at": p.completed_at,
                }
                for p in qs[:300]
            ],
            "refunds": [
                {
                    "id": r.pk,
                    "ref": r.booking.ref,
                    "guest": r.booking.guest.display_name,
                    "phone": r.booking.guest.phone,
                    "amount": r.amount,
                    "method": r.get_method_display(),
                    "status": r.status,
                    "reason": r.reason,
                    "reference": r.provider_ref,
                    "created_at": r.created_at,
                }
                for r in refunds
            ],
        }
    )


@api_view(["POST"])
@permission_classes([IsHost])
def refund_sent(request, pk):
    r = get_object_or_404(Refund, pk=pk)
    services.mark_refund_sent(r, provider_ref=request.data.get("reference", ""), actor=request.user)
    return Response({"ok": True})
