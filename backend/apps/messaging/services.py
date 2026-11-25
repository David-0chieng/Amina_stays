"""Messaging core: the outbox, conversation threads, templates, knowledge-base answers and broadcasts.

Outbound messages are written to the database first (status 'queued') and handed to a small worker
pool only after the surrounding transaction commits — the transactional-outbox pattern. A USSD or
voice webhook therefore never waits on an SMS round-trip, and nothing is lost if Africa's Talking is
slow: the scheduler re-dispatches anything still queued.
"""

import logging
import re
import string
import unicodedata
from concurrent.futures import ThreadPoolExecutor

from django.conf import settings
from django.db import close_old_connections, transaction
from django.db.models import F
from django.utils import timezone

from apps.core.models import SiteSettings
from apps.core.utils import normalize_phone

from .models import FAQ, Message, Template, Thread
from .templates_default import DEFAULTS

log = logging.getLogger("amina.messaging")
_executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="outbox")

# ---------- templates ----------


class _Safe(dict):
    def __missing__(self, key):
        return ""


def render(key, lang="en", **ctx):
    """Template text in the guest's language: console override → built-in → English override → English built-in."""
    lang = lang if lang in ("en", "sw", "it", "de", "fr") else "en"
    body = Template.objects.filter(key=key, lang=lang).values_list("body", flat=True).first() or DEFAULTS.get(
        key, {}
    ).get(lang)
    if body is None:
        body = Template.objects.filter(key=key, lang="en").values_list("body", flat=True).first() or DEFAULTS.get(
            key, {}
        ).get("en", key)
    s = SiteSettings.load()
    ctx.setdefault("business", s.business_name)
    ctx.setdefault("host", s.host_name)
    out = string.Formatter().vformat(body, (), _Safe(ctx))
    return re.sub(r"[ \t]{2,}", " ", out).strip()


# ---------- GSM-7 hygiene (one stray smart quote turns a 160-char SMS into 70-char segments) ----------

_GSM_BASIC = set(
    "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ ÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà"
)
_GSM_EXT = set("^{}\\[~]|€")
_REPLACE = {
    "‘": "'",
    "’": "'",
    "“": '"',
    "”": '"',
    "–": "-",
    "—": "-",
    "…": "...",
    "•": "-",
    "→": "->",
    "★": "*",
    "\u00a0": " ",
}


def to_gsm(text):
    out = []
    for ch in text:
        ch = _REPLACE.get(ch, ch)
        if all(c in _GSM_BASIC or c in _GSM_EXT for c in ch):
            out.append(ch)
            continue
        base = unicodedata.normalize("NFKD", ch).encode("ascii", "ignore").decode()
        out.append(base or "")
    return "".join(out)


def sms_segments(text):
    gsm = all(c in _GSM_BASIC or c in _GSM_EXT for c in text)
    length = sum(2 if c in _GSM_EXT else 1 for c in text) if gsm else len(text)
    single, multi = (160, 153) if gsm else (70, 67)
    return 1 if length <= single else -(-length // multi)


# ---------- threads ----------


def get_thread(phone, guest=None):
    thread, _ = Thread.objects.get_or_create(phone=phone, defaults={"guest": guest})
    if guest is not None and thread.guest_id is None:
        thread.guest = guest
        thread.save(update_fields=["guest"])
    return thread


def _guest(phone):
    from apps.accounts.models import User

    return User.objects.filter(phone=phone).first()


def record_inbound(phone, body, *, channel="sms", booking=None, provider_id="", sender="guest", handled="pending"):
    guest = _guest(phone)
    thread = get_thread(phone, guest)
    msg = Message.objects.create(
        thread=thread,
        phone=phone,
        booking=booking,
        direction="in",
        channel=channel,
        sender=sender,
        body=body or "",
        status="received",
        handled=handled,
        provider_id=provider_id,
    )
    Thread.objects.filter(pk=thread.pk).update(
        unread=F("unread") + 1, last_message_at=msg.created_at, last_preview=(body or "")[:160], status="open"
    )
    return msg


def mark(msg, handled, kind=""):
    """Record how an inbound message was dealt with. 'relayed' puts the thread in Amina's queue."""
    if msg is None:
        return
    msg.handled = handled
    if kind:
        msg.kind = kind[:40]
    msg.save(update_fields=["handled", "kind"])
    thread = msg.thread
    if handled == "relayed":
        thread.needs_reply = True
        thread.waiting_since = thread.waiting_since or msg.created_at
        thread.save(update_fields=["needs_reply", "waiting_since"])
    elif (
        handled in ("auto", "answered")
        and not Message.objects.filter(thread=thread, direction="in", handled="relayed").exists()
    ):
        thread.needs_reply = False
        thread.waiting_since = None
        thread.save(update_fields=["needs_reply", "waiting_since"])


# ---------- outbox ----------


def send(phone, body, *, booking=None, kind="", sender="system", user=None, channel=None, marketing=False, sync=False):
    """Queue an outbound message. Returns the Message (or None if suppressed by an opt-out)."""
    phone = normalize_phone(phone) or phone
    if not phone or not body:
        log.warning("message skipped (no recipient/body): %s", kind)
        return None
    guest = _guest(phone)
    if marketing and guest and guest.sms_opt_out_at:
        return None
    if channel is None:
        channel = (
            "whatsapp" if (guest and guest.preferred_channel == "whatsapp" and settings.AT_WHATSAPP_NUMBER) else "sms"
        )
    if channel in ("sms", "whatsapp"):
        body = to_gsm(body) if channel == "sms" else body
    thread = get_thread(phone, guest)
    msg = Message.objects.create(
        thread=thread,
        phone=phone,
        booking=booking,
        direction="out",
        channel=channel,
        sender=sender,
        body=body,
        kind=kind[:40],
        status="queued" if channel in ("sms", "whatsapp") else "sent",
        sent_by=user,
        is_marketing=marketing,
    )
    updates = {"last_message_at": msg.created_at, "last_preview": body[:160]}
    if sender in ("host", "staff"):
        updates.update(needs_reply=False, waiting_since=None, unread=0)
        Message.objects.filter(thread=thread, direction="in", handled="relayed").update(handled="answered")
    Thread.objects.filter(pk=thread.pk).update(**updates)
    if msg.status == "queued":
        _schedule(msg.pk, sync)
    return msg


def _schedule(message_id, sync=False):
    mode = "sync" if sync else settings.OUTBOX_MODE
    if mode == "sync":
        transaction.on_commit(lambda: dispatch(message_id), robust=True)
    elif mode == "thread":
        transaction.on_commit(lambda: _executor.submit(_dispatch_in_thread, message_id), robust=True)
    # mode == "queue": the scheduler picks it up


def _dispatch_in_thread(message_id):
    try:
        dispatch(message_id)
    except Exception:
        log.exception("dispatch failed for message %s", message_id)
    finally:
        close_old_connections()


def _suppressed(phone):
    """Seeded demo people have placeholder numbers: never send them real SMS, even with live credentials."""
    from apps.accounts.models import User

    return User.objects.filter(phone=phone, tags__contains=["seed"]).exists()


def dispatch(message_id):
    from apps.comms import at

    with transaction.atomic():
        msg = Message.objects.select_for_update(skip_locked=True).filter(pk=message_id, status="queued").first()
        if not msg:
            return
        msg.status = "sending"
        msg.attempts += 1
        msg.save(update_fields=["status", "attempts"])
    if _suppressed(msg.phone):
        msg.status, msg.sent_at = "logged", timezone.now()
        msg.save(update_fields=["status", "sent_at"])
        return msg
    try:
        if msg.channel == "whatsapp":
            res = at.send_whatsapp(msg.phone, msg.body)
            status = "logged" if res.get("dry_run") else "sent"
            msg.provider_id = str(res.get("messageId", ""))[:80]
        else:
            res = at.send_sms(msg.phone, msg.body)
            if res.get("dry_run"):
                status = "logged"
            else:
                r = (res.get("recipients") or [{}])[0]
                code = int(r.get("statusCode") or 0)
                status = "sent" if code in (100, 101, 102) else "failed"
                msg.provider_id = str(r.get("messageId", ""))[:80]
                msg.provider_status = str(r.get("status", ""))[:40]
                msg.cost = str(r.get("cost", ""))[:20]
                if status == "failed":
                    msg.failure_reason = (r.get("status") or res.get("message") or "rejected")[:120]
        msg.status = status
        msg.sent_at = timezone.now()
    except Exception as e:  # network/HTTP error: retry later from the scheduler
        msg.failure_reason = str(e)[:120]
        msg.status = "failed" if msg.attempts >= 3 else "queued"
        log.warning("send failed (%s/3) to %s: %s", msg.attempts, msg.phone, e)
    msg.save(update_fields=["status", "sent_at", "provider_id", "provider_status", "cost", "failure_reason"])
    return msg


def dispatch_pending():
    stale = timezone.now() - timezone.timedelta(seconds=20)
    ids = list(
        Message.objects.filter(status="queued", created_at__lt=stale, attempts__lt=3).values_list("id", flat=True)[:50]
    )
    for mid in ids:
        dispatch(mid)
    # a 'sending' row older than 2 minutes means a worker died mid-flight
    Message.objects.filter(
        status="sending", created_at__lt=timezone.now() - timezone.timedelta(minutes=2), attempts__lt=3
    ).update(status="queued")
    return len(ids)


DELIVERY_MAP = {
    "Success": "delivered",
    "Failed": "failed",
    "Rejected": "failed",
    "AbsentSubscriber": "failed",
    "Expired": "failed",
}


def on_delivery_report(provider_id, status, failure_reason=""):
    msg = Message.objects.filter(provider_id=provider_id).first()
    if not msg:
        return None
    msg.provider_status = status[:40]
    new = DELIVERY_MAP.get(status)
    if new:
        msg.status = new
        if new == "delivered":
            msg.delivered_at = timezone.now()
        if failure_reason:
            msg.failure_reason = failure_reason[:120]
    msg.save(update_fields=["provider_status", "status", "delivered_at", "failure_reason"])
    return msg


# ---------- knowledge base ----------

_STOP = {
    "the",
    "a",
    "an",
    "is",
    "are",
    "what",
    "do",
    "you",
    "i",
    "me",
    "my",
    "to",
    "of",
    "and",
    "for",
    "in",
    "at",
    "it",
    "there",
    "can",
    "how",
    "please",
}


def _tokens(text):
    return [t for t in re.findall(r"[a-zà-ÿ0-9']+", (text or "").lower()) if t not in _STOP]


def faq_context(phone, booking=None):
    """Values FAQ answers may use. Booking-only facts (Wi-Fi, directions) exist only for a booked guest."""
    from apps.bookings.services import guest_context
    from apps.properties.services import price_list_text

    s = SiteSettings.load()
    ctx = {
        "business": s.business_name,
        "host": s.host_name,
        "prices": price_list_text(),
        "checkin_time": _t(s.default_checkin_time),
        "checkout_time": _t(s.default_checkout_time),
        "ussd_code": settings.AT_USSD_CODE,
        "sms_number": settings.AT_SMS_NUMBER,
        "website": settings.FRONTEND_URL,
        "deposit_percent": s.deposit_percent,
    }
    if booking is not None:
        ctx.update(guest_context(booking))
    return ctx


def _t(hhmm):
    from apps.core.utils import nice_time

    return nice_time(hhmm)


def _normalise(text):
    """One spelling for the words guests write every way: Wi-Fi / wi fi / WiFi, check-in / check in, check-out."""
    text = re.sub(r"\bwi[\s-]?fi\b", "wifi", text, flags=re.IGNORECASE)
    return re.sub(r"\bcheck[\s-]?(in|out)\b", r"check\1", text, flags=re.IGNORECASE)


def match_faq(text, lang="en", unit=None, ctx=None):
    """Best knowledge-base answer for a free-text question, or None if not confident.
    Answers that reference booking-only facts are skipped when the sender has no booking; on a tie, a
    personalised answer (this guest's Wi-Fi, directions…) beats a generic one."""
    text = _normalise(text or "")
    low = " " + text.lower() + " "
    toks = set(_tokens(text))
    if not toks:
        return None
    ctx = ctx or {}
    scored = []
    for faq in FAQ.objects.filter(active=True).filter(unit__isnull=True) | FAQ.objects.filter(active=True, unit=unit):
        score = 0
        for kw in {_normalise(k.strip().lower()) for k in faq.keywords.split(",") if k.strip()}:
            if not kw.replace("'", "").isalnum():  # phrases and hyphenated words ("late checkout", "how do i get")
                score += 3 if kw in low else 0
            elif kw in toks:
                score += 2
            elif len(kw) > 4 and any(t.startswith(kw[:5]) for t in toks):
                score += 1
        if faq.unit_id and unit is not None:
            score += 1
        if score < 2:
            continue
        answer = faq.answer(lang)
        fields = {f for _, f, _, _ in string.Formatter().parse(answer) if f}
        if all(ctx.get(f) not in (None, "") for f in fields):
            scored.append((score, bool(fields), -faq.sort_order, faq.pk, faq, answer))
    if not scored:
        return None
    *_, faq, answer = max(scored, key=lambda x: x[:4])
    FAQ.objects.filter(pk=faq.pk).update(hits=F("hits") + 1)
    return faq, string.Formatter().vformat(answer, (), _Safe(ctx))
    scored = []
    for faq in FAQ.objects.filter(active=True).filter(unit__isnull=True) | FAQ.objects.filter(active=True, unit=unit):
        score = 0
        for kw in (_normalise(k.strip().lower()) for k in faq.keywords.split(",") if k.strip()):
            if not kw.replace("'", "").isalnum():  # phrases and hyphenated words ("check in", "check-out")
                score += 3 if kw in low else 0
            elif kw in toks:
                score += 2
            elif len(kw) > 4 and any(t.startswith(kw[:5]) for t in toks):
                score += 1
        if faq.unit_id and unit is not None:
            score += 1
        if score >= 2:
            scored.append((score, -faq.sort_order, faq))
    scored.sort(key=lambda x: (x[0], x[1]), reverse=True)
    ctx = ctx or {}
    for _, _, faq in scored:
        answer = faq.answer(lang)
        fields = {f for _, f, _, _ in string.Formatter().parse(answer) if f}
        if all(ctx.get(f) not in (None, "") for f in fields):
            FAQ.objects.filter(pk=faq.pk).update(hits=F("hits") + 1)
            return faq, string.Formatter().vformat(answer, (), _Safe(ctx))
    return None


# ---------- broadcasts ----------


def audience_phones(audience, unit=None):
    from apps.accounts.models import User
    from apps.bookings.models import Booking, Waitlist
    from apps.core.utils import today

    t = today()
    qs = Booking.objects.all()
    if unit is not None:
        qs = qs.filter(unit=unit)
    if audience == "in_house":
        phones = qs.filter(status="checked_in").values_list("guest__phone", flat=True)
    elif audience == "arriving":
        phones = qs.filter(
            status="confirmed", check_in__gte=t, check_in__lte=t + timezone.timedelta(days=7)
        ).values_list("guest__phone", flat=True)
    elif audience == "upcoming":
        phones = qs.filter(status__in=("confirmed", "checked_in"), check_out__gte=t).values_list(
            "guest__phone", flat=True
        )
    elif audience == "past":
        phones = (
            qs.filter(status="completed", guest__marketing_opt_in=True, guest__sms_opt_out_at__isnull=True)
            .exclude(channel__in=("airbnb", "booking_com"))  # OTA guests may not be solicited off-platform
            .values_list("guest__phone", flat=True)
        )
    elif audience == "waitlist":
        phones = Waitlist.objects.filter(status="waiting", check_out__gt=t).values_list("guest__phone", flat=True)
    elif audience == "staff":
        phones = User.objects.filter(
            role__in=("manager", "cleaner", "cook", "caretaker", "security", "driver"), is_active=True
        ).values_list("phone", flat=True)
    else:
        phones = []
    return sorted(set(phones))


def broadcast_window_ok(is_marketing):
    """Promotional SMS only inside the configured window (Kenyan operators restrict promo hours)."""
    if not is_marketing:
        return True
    s = SiteSettings.load()
    return s.promo_window_start <= timezone.localtime().hour < s.promo_window_end
