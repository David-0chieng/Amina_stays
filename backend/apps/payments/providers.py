"""Payment providers. Each takes a pending Payment and starts collection; results arrive by callback.

M-Pesa:  simulate (default, auto-succeeds) | daraja (Safaricom Daraja STK push, the production path)
         | africastalking (AT Mobile Checkout — now onboarding-gated, kept for accounts that have it)
Card:    simulate (hosted test page, no card data) | paystack (hosted checkout; webhook HMAC-verified, then
         confirmed with Verify Transaction before it counts)
Card numbers never touch this server: guests are always sent to a hosted page.
"""

import base64
import logging
import os
import re
import secrets
import threading
from urllib.parse import urlsplit

import httpx
from django.conf import settings
from django.core.cache import cache
from django.db import close_old_connections
from django.utils import timezone

from apps.core.utils import today

log = logging.getLogger("amina.payments")

TOKEN_KEY = "daraja_token"
# Safaricom: "Do not use public URL testers e.g. ngrok ... especially on production ... usually blocked by the API"
TUNNEL_HOSTS = ("ngrok", "trycloudflare", "requestbin", "mockbin")
SETUP_FAILED = "We couldn't start the M-Pesa payment - Amina has been alerted. Please try again later or pay by card."


class PaymentError(Exception):
    """A payment that couldn't start. failure_code is the M-Pesa result code when there is one; suggest is the
    next step for the guest (retry | card | deposit | wait | paybill)."""

    def __init__(self, message="", *, failure_code=None, suggest=None):
        super().__init__(message)
        self.failure_code = failure_code or None
        self.suggest = suggest or None

    def as_dict(self):
        return {"error": str(self), "failure_code": self.failure_code, "suggest": self.suggest}


class DarajaSetupError(PaymentError):
    """Daraja refused us because of how M-Pesa is set up here (keys, shortcode, passkey), not anything the guest did."""


def _callback_base():
    return settings.PUBLIC_URL.rstrip("/")


def callback_secret():
    """The path secret Daraja calls back on, for the M-Pesa prompt (STK) callback and the Paybill (C2B) ones alike:
    DARAJA_CALLBACK_SECRET, else AT_WEBHOOK_SECRET, else the placeholder "cb"."""
    return (
        getattr(settings, "DARAJA_CALLBACK_SECRET", "")
        or os.environ.get("DARAJA_CALLBACK_SECRET", "")
        or settings.AT_WEBHOOK_SECRET
        or "cb"
    )


def tunnel_host(url):
    """A tunnel or public URL tester (ngrok, trycloudflare, ...): fine for a sandbox demo, blocked by Safaricom live."""
    host = urlsplit(url).hostname or ""
    return any(name in host for name in TUNNEL_HOSTS)


def setup_alert(booking, detail):
    """Tell Amina (once a day) that M-Pesa payments fail because Daraja is misconfigured."""
    from apps.safety.services import raise_alert

    raise_alert(
        "payment",
        f"Daraja is misconfigured, so M-Pesa payments are failing ({detail}). Check the DARAJA_* settings: env, "
        "shortcode, passkey, consumer key and secret, transaction type and PartyB.",
        severity="high",
        booking=booking,
        dedupe=f"daraja-setup:{today()}",
    )


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
        token = cache.get(TOKEN_KEY)
        if token:
            return token
        if not (settings.DARAJA_CONSUMER_KEY and settings.DARAJA_CONSUMER_SECRET):
            raise DarajaSetupError("Daraja credentials are not configured")
        with httpx.Client(timeout=15) as c:
            r = c.get(
                f"{self.base}/oauth/v1/generate",
                params={"grant_type": "client_credentials"},
                auth=(settings.DARAJA_CONSUMER_KEY, settings.DARAJA_CONSUMER_SECRET),
            )
        if r.status_code != 200:
            error = DarajaSetupError if r.status_code in (400, 401, 403) else PaymentError
            raise error(f"Daraja auth failed (HTTP {r.status_code})")
        data = r.json()
        cache.set(TOKEN_KEY, data["access_token"], int(data.get("expires_in", 3599)) - 60)
        return data["access_token"]

    def _post(self, path, body, timeout=20):
        """POST with the cached token. Each new token invalidates the previous one, so a token another process has
        replaced comes back as HTTP 401 or 404.001.03 "Invalid Access Token": drop it and try once more."""
        for last_try in (False, True):
            with httpx.Client(timeout=timeout) as c:
                r = c.post(f"{self.base}{path}", json=body, headers={"Authorization": f"Bearer {self._token()}"})
            if last_try or not _stale_token(r):
                return r
            cache.delete(TOKEN_KEY)

    def _password(self):
        ts = timezone.localtime().strftime("%Y%m%d%H%M%S")  # Kenya time on any server
        raw = f"{settings.DARAJA_SHORTCODE}{settings.DARAJA_PASSKEY}{ts}"
        return base64.b64encode(raw.encode()).decode(), ts

    def request(self, payment):
        password, ts = self._password()
        body = {
            "BusinessShortCode": settings.DARAJA_SHORTCODE,
            "Password": password,
            "Timestamp": ts,
            "TransactionType": settings.DARAJA_TRANSACTION_TYPE,
            "Amount": int(payment.amount),
            "PartyA": payment.phone.lstrip("+"),
            "PartyB": settings.DARAJA_PARTY_B or settings.DARAJA_SHORTCODE,
            "PhoneNumber": payment.phone.lstrip("+"),
            "CallBackURL": f"{_callback_base()}/api/payments/daraja/callback/{callback_secret()}",
            "AccountReference": payment.booking.ref[:12],
            "TransactionDesc": "Amina Stays",
        }
        try:
            r = self._post("/mpesa/stkpush/v1/processrequest", body)
            if r.status_code in (401, 403):  # refused even with a fresh token: the keys or the Daraja app are wrong
                raise DarajaSetupError(f"HTTP {r.status_code} from the STK push API")
            data = r.json()
        except DarajaSetupError as e:
            setup_alert(payment.booking, str(e))
            raise PaymentError(SETUP_FAILED) from e
        except (httpx.HTTPError, ValueError) as e:
            raise PaymentError(f"M-Pesa is unreachable ({e})") from e
        payment.raw = [*payment.raw, {"request": data}]
        if str(data.get("ResponseCode")) != "0":
            raise _rejected(payment, data)
        payment.transaction_id = data["CheckoutRequestID"]
        payment.save(update_fields=["transaction_id", "raw"])
        return {"status": "pending", "message": data.get("CustomerMessage", "")}

    def query(self, payment):
        password, ts = self._password()
        try:
            r = self._post(
                "/mpesa/stkpushquery/v1/query",
                {
                    "BusinessShortCode": settings.DARAJA_SHORTCODE,
                    "Password": password,
                    "Timestamp": ts,
                    "CheckoutRequestID": payment.transaction_id,
                },
                timeout=15,
            )
            return r.json()
        except Exception as e:
            log.warning("Daraja query failed: %s", e)
            return None


def _stale_token(r):
    if r.status_code == 401:
        return True
    try:
        return str(r.json().get("errorCode") or "") == "404.001.03"
    except (ValueError, AttributeError):
        return False


BUSY_PHONE = re.compile(r"lock subscriber|already in process", re.IGNORECASE)
GUEST_FIELDS = re.compile(r"amount|phone|partya", re.IGNORECASE)


def _rejected(payment, data):
    """The PaymentError for a push Daraja turned down, e.g. {"errorCode": "500.001.1001", "errorMessage": ...}.
    500.001.1001 is also "Merchant does not exist" and "Wrong credentials", so only "Unable to lock subscriber, a
    transaction is already in process" means another prompt is open on the phone. Errors about our setup (the access
    token, 500.001.1001, a bad request field other than the guest's amount or number) give the guest a plain message
    and alert Amina."""
    message = data.get("errorMessage") or data.get("ResponseDescription") or "STK push rejected"
    error = str(data.get("errorCode") or "")
    code = error.rsplit(".", 1)[-1]
    if code == "1001" and BUSY_PHONE.search(message):
        return PaymentError(message, failure_code="1001")
    if code in ("1025", "1037"):
        return PaymentError(message, failure_code=code)
    if error.startswith(("404.001.", "500.001.1001")) or (
        error.startswith("400.002.") and not GUEST_FIELDS.search(message)
    ):
        setup_alert(payment.booking, f"{error} {message}")
        return PaymentError(SETUP_FAILED)
    return PaymentError(message)


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
