"""Payment providers. Each takes a pending Payment and starts collection; results arrive by callback.

M-Pesa:  simulate (default, auto-succeeds) | daraja (Safaricom Daraja STK push, the production path)
         | africastalking (AT Mobile Checkout — now onboarding-gated, kept for accounts that have it)
Card:    simulate (hosted test page, no card data) | paystack (hosted checkout; webhook HMAC-verified, then
         confirmed with Verify Transaction before it counts)
Card numbers never touch this server: guests are always sent to a hosted page.
"""

import base64
import logging
import secrets
import threading
from datetime import datetime

import httpx
from django.conf import settings
from django.core.cache import cache
from django.db import close_old_connections

log = logging.getLogger("amina.payments")


class PaymentError(Exception):
    """A payment that couldn't start. failure_code is the M-Pesa result code when there is one; suggest is the
    next step for the guest (retry | card | deposit | wait | paybill)."""

    def __init__(self, message="", *, failure_code=None, suggest=None):
        super().__init__(message)
        self.failure_code = failure_code or None
        self.suggest = suggest or None

    def as_dict(self):
        return {"error": str(self), "failure_code": self.failure_code, "suggest": self.suggest}


def _callback_base():
    return settings.PUBLIC_URL.rstrip("/")


# ---------- M-Pesa ----------


class SimulatedMpesa:
    name, simulated = "simulate", True

    def request(self, payment):
        delay = settings.SIM_PAY_DELAY_SECONDS
        if delay > 0:
            timer = threading.Timer(delay, _simulate_success, args=(payment.pk,))
            timer.daemon = True
            timer.start()
        return {"status": "pending", "message": f"Simulated STK push to {payment.phone}"}

    def query(self, payment):
        return None


def _simulate_success(payment_id):
    from .services import on_success

    try:
        from .models import Payment

        p = Payment.objects.filter(pk=payment_id, status="pending").first()
        if p:
            on_success(
                p,
                transaction_id=f"SIM{secrets.token_hex(4).upper()}",
                provider_ref=f"SIM{secrets.token_hex(4).upper()}",
            )
    except Exception:
        log.exception("simulated payment failed")
    finally:
        close_old_connections()


class DarajaMpesa:
    """Safaricom Daraja Lipa na M-Pesa Online (STK push)."""

    name, simulated = "daraja", False

    @property
    def base(self):
        return (
            "https://api.safaricom.co.ke" if settings.DARAJA_ENV == "production" else "https://sandbox.safaricom.co.ke"
        )

    def _token(self):
        token = cache.get("daraja_token")
        if token:
            return token
        if not (settings.DARAJA_CONSUMER_KEY and settings.DARAJA_CONSUMER_SECRET):
            raise PaymentError("Daraja credentials are not configured")
        with httpx.Client(timeout=15) as c:
            r = c.get(
                f"{self.base}/oauth/v1/generate",
                params={"grant_type": "client_credentials"},
                auth=(settings.DARAJA_CONSUMER_KEY, settings.DARAJA_CONSUMER_SECRET),
            )
        if r.status_code != 200:
            raise PaymentError(f"Daraja auth failed (HTTP {r.status_code})")
        data = r.json()
        cache.set("daraja_token", data["access_token"], int(data.get("expires_in", 3599)) - 60)
        return data["access_token"]

    def _password(self):
        ts = datetime.now().strftime("%Y%m%d%H%M%S")
        raw = f"{settings.DARAJA_SHORTCODE}{settings.DARAJA_PASSKEY}{ts}"
        return base64.b64encode(raw.encode()).decode(), ts

    def request(self, payment):
        password, ts = self._password()
        body = {
            "BusinessShortCode": settings.DARAJA_SHORTCODE,
            "Password": password,
            "Timestamp": ts,
            "TransactionType": "CustomerPayBillOnline",
            "Amount": int(payment.amount),
            "PartyA": payment.phone.lstrip("+"),
            "PartyB": settings.DARAJA_SHORTCODE,
            "PhoneNumber": payment.phone.lstrip("+"),
            "CallBackURL": f"{_callback_base()}/api/payments/daraja/callback/{settings.AT_WEBHOOK_SECRET or 'cb'}",
            "AccountReference": payment.booking.ref[:12],
            "TransactionDesc": "Amina Stays",
        }
        try:
            with httpx.Client(timeout=20) as c:
                r = c.post(
                    f"{self.base}/mpesa/stkpush/v1/processrequest",
                    json=body,
                    headers={"Authorization": f"Bearer {self._token()}"},
                )
            data = r.json()
        except (httpx.HTTPError, ValueError) as e:
            raise PaymentError(f"M-Pesa is unreachable ({e})") from e
        payment.raw = [*payment.raw, {"request": data}]
        if str(data.get("ResponseCode")) != "0":
            # e.g. {"errorCode": "500.001.1001", "errorMessage": "Unable to lock subscriber, ..."}
            code = str(data.get("errorCode") or "").rsplit(".", 1)[-1]
            raise PaymentError(
                data.get("errorMessage") or data.get("ResponseDescription") or "STK push rejected",
                failure_code=code if code in ("1001", "1025", "1037") else None,
            )
        payment.transaction_id = data["CheckoutRequestID"]
        payment.save(update_fields=["transaction_id", "raw"])
        return {"status": "pending", "message": data.get("CustomerMessage", "")}

    def query(self, payment):
        password, ts = self._password()
        try:
            with httpx.Client(timeout=15) as c:
                r = c.post(
                    f"{self.base}/mpesa/stkpushquery/v1/query",
                    headers={"Authorization": f"Bearer {self._token()}"},
                    json={
                        "BusinessShortCode": settings.DARAJA_SHORTCODE,
                        "Password": password,
                        "Timestamp": ts,
                        "CheckoutRequestID": payment.transaction_id,
                    },
                )
            return r.json()
        except Exception as e:
            log.warning("Daraja query failed: %s", e)
            return None


class ATMobileCheckout:
    """Africa's Talking Mobile Checkout (legacy; activated per account on request)."""

    name, simulated = "africastalking", False

    def request(self, payment):
        url = "https://payments.africastalking.com/mobile/checkout/request"
        body = {
            "username": settings.AT_USERNAME,
            "productName": settings.AT_PAYMENT_PRODUCT,
            "phoneNumber": payment.phone,
            "currencyCode": "KES",
            "amount": int(payment.amount),
            "metadata": {"ref": payment.booking.ref, "paymentId": str(payment.pk)},
        }
        try:
            with httpx.Client(timeout=20) as c:
                r = c.post(url, json=body, headers={"apiKey": settings.AT_API_KEY, "Accept": "application/json"})
            data = r.json()
        except (httpx.HTTPError, ValueError) as e:
            raise PaymentError(f"Payment service unreachable ({e})") from e
        payment.raw = [*payment.raw, {"request": data}]
        if data.get("status") != "PendingConfirmation":
            payment.save(update_fields=["raw"])
            raise PaymentError(data.get("description") or data.get("errorMessage") or str(data.get("status")))
        payment.transaction_id = data.get("transactionId")
        payment.save(update_fields=["transaction_id", "raw"])
        return {"status": "pending", "message": data.get("description", "")}

    def query(self, payment):
        return None


# ---------- cards ----------


class SimulatedCard:
    name, simulated = "simulate", True

    def request(self, payment):
        payment.checkout_token = secrets.token_hex(16)
        payment.save(update_fields=["checkout_token"])
        return {"status": "pending", "checkout_url": f"{settings.FRONTEND_URL}/pay/card/{payment.checkout_token}"}

    def query(self, payment):
        return None


class PaystackCard:
    name, simulated = "paystack", False

    def request(self, payment):
        if not settings.PAYSTACK_SECRET_KEY:
            raise PaymentError("Card payments are not configured")
        payment.checkout_token = secrets.token_hex(16)
        guest = payment.booking.guest
        email = guest.email or f"guest{payment.phone.lstrip('+')}@aminastays.co.ke"
        body = {
            "email": email,
            "amount": int(payment.amount) * 100,
            "currency": "KES",
            "reference": payment.checkout_token,
            "callback_url": f"{settings.FRONTEND_URL}/trips/{payment.booking.ref}?paid=1",
            "metadata": {"ref": payment.booking.ref, "payment_id": payment.pk},
        }
        try:
            with httpx.Client(timeout=20) as c:
                r = c.post(
                    "https://api.paystack.co/transaction/initialize",
                    json=body,
                    headers={"Authorization": f"Bearer {settings.PAYSTACK_SECRET_KEY}"},
                )
            data = r.json()
        except (httpx.HTTPError, ValueError) as e:
            raise PaymentError(f"Card service unreachable ({e})") from e
        if not data.get("status"):
            raise PaymentError(data.get("message", "Card checkout failed"))
        payment.raw = [*payment.raw, {"request": data}]
        payment.save(update_fields=["checkout_token", "raw"])
        return {"status": "pending", "checkout_url": data["data"]["authorization_url"]}

    def query(self, payment):
        """Paystack Verify Transaction: the transaction as Paystack sees it ({"status": true, "data": {...}}),
        or None when it can't be asked."""
        if not settings.PAYSTACK_SECRET_KEY or not payment.checkout_token:
            return None
        try:
            with httpx.Client(timeout=15) as c:
                r = c.get(
                    f"https://api.paystack.co/transaction/verify/{payment.checkout_token}",
                    headers={"Authorization": f"Bearer {settings.PAYSTACK_SECRET_KEY}"},
                )
            return r.json()
        except (httpx.HTTPError, ValueError) as e:
            log.warning("Paystack verify failed: %s", e)
            return None


def mpesa_provider():
    return {"daraja": DarajaMpesa, "africastalking": ATMobileCheckout}.get(settings.MPESA_PROVIDER, SimulatedMpesa)()


def card_provider():
    return {"paystack": PaystackCard}.get(settings.CARD_PROVIDER, SimulatedCard)()
