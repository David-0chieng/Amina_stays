"""USSD (no data, any phone). Africa's Talking posts the whole input chain ('1*2*3') on every hop;
we replay it through a cursor, so the menu is stateless and survives any number of workers.

Conventions: 0 = back, 00 = main menu, 98 = more. Every screen stays within Safaricom's 160
characters, and we answer well inside AT's 10-second window (SMS go through the outbox).
"""

import logging
import re
from datetime import date, timedelta

from django.utils import timezone

from apps.accounts.services import get_or_create_user
from apps.bookings import services as bookings
from apps.bookings.models import Addon, BookingAddon
from apps.core.activity import record
from apps.core.api import STAFF_ROLES
from apps.core.models import SiteSettings
from apps.core.utils import first_name, kes, nice_date, same_phone, today, weekend_start
from apps.messaging import services as messaging
from apps.properties.models import Area, PriceOverride, Unit
from apps.properties.services import available_units, from_price
from apps.properties.services import quote as price_quote

log = logging.getLogger("amina.ussd")
LIMIT = 160

S = {
    "en": {
        "welcome": "Karibu Amina Stays", "back": "Karibu tena {name}!",
        "main": ["Book a stay", "Prices & homes", "My booking", "Breakfast", "Report problem", "Talk to Amina", "Check out", "Language", "EMERGENCY"],
        "where": "Where?", "anywhere": "Anywhere", "when": "Check-in:", "when_opts": ["Tonight", "Tomorrow", "This weekend", "Next weekend", "Enter date"],
        "ddmm": "Enter check-in date as DDMM, e.g. 0512", "nights": "How many nights? (1-14)", "guests": "How many guests? (1-8)",
        "pick": "Pick a home ({dates}):", "more": "98. More", "none": "Nothing free then. We'll SMS you if something opens up.",
        "bf_q": "Add breakfast? ({price}/person/day)", "bf_opts": ["Swahili", "Continental", "Full English", "Vegetarian", "No thanks"],
        "pay_q": "Total {total}", "pay_full": "Pay all now", "pay_dep": "Pay {pct}% now ({dep})", "confirm": "Confirm & pay",
        "held": "Holding {unit} ({ref}). {pay}", "invalid": "Invalid choice.", "no_booking": "No active booking for this number. Dial again and choose 1 to book.",
        "mine": "{ref} {unit}\n{dates}\n{status}. Paid {paid} of {total}", "mine_opts": ["Resend check-in info", "Pay balance", "Late checkout", "Cancel booking"],
        "sent": "Sent to you by SMS.", "cancel_q": "{text}", "cancel_opts": ["Yes, cancel", "No, keep it"], "kept": "Your booking is kept. See you soon!",
        "bf_menu": "Breakfast ({price}/person/day):", "bf_people": "For how many people? (1-{max})", "bf_saved": "Breakfast saved: {summary}. Kitchen told.",
        "issue_q": "What's wrong?", "issue_opts": ["No water", "Power/lights", "Wi-Fi", "AC/fan", "Cleanliness", "Lock/keys", "Noise/security", "Other"],
        "issue_ok": "Logged #{task}. {who} has been told and will sort it. Reply HELP by SMS if urgent.",
        "talk_opts": ["Call me back", "I'll text a question"], "callback": "Amina will call you back shortly.",
        "text_us": "Text your question to {number} and Amina will reply.", "co_q": "Check out of {unit} now? Your door code will stop working.",
        "yes_no": ["Yes", "No"], "co_done": "Checked out. Asante, safe travels!", "lang_set": "Language saved.",
        "sos": "Amina is being alerted and called now. If you are in danger call 999 or 112.",
        "unit_info": "{name}, {area}: {beds} bed, sleeps {guests}. From {price}/night.{bf} Details sent by SMS.",
        "late_q": "Late checkout ({price}) is requested from Amina. You'll get an SMS.",
    },
    "sw": {
        "welcome": "Karibu Amina Stays", "back": "Karibu tena {name}!",
        "main": ["Weka nafasi", "Bei na nyumba", "Nafasi yangu", "Kifungua kinywa", "Ripoti tatizo", "Ongea na Amina", "Toka", "Lugha", "DHARURA"],
        "where": "Wapi?", "anywhere": "Popote", "when": "Kuingia:", "when_opts": ["Leo usiku", "Kesho", "Wikendi hii", "Wikendi ijayo", "Andika tarehe"],
        "ddmm": "Andika tarehe kama SSMM, mf. 0512", "nights": "Usiku ngapi? (1-14)", "guests": "Wageni wangapi? (1-8)",
        "pick": "Chagua nyumba ({dates}):", "more": "98. Zaidi", "none": "Hakuna nafasi. Tutakutumia SMS nafasi ikipatikana.",
        "bf_q": "Ongeza kifungua kinywa? ({price}/mtu/siku)", "bf_opts": ["Cha Kiswahili", "Continental", "Kiingereza", "Mboga", "Hapana"],
        "pay_q": "Jumla {total}", "pay_full": "Lipa yote sasa", "pay_dep": "Lipa {pct}% sasa ({dep})", "confirm": "Thibitisha & lipa",
        "held": "Tumekuwekea {unit} ({ref}). {pay}", "invalid": "Chaguo si sahihi.", "no_booking": "Hakuna nafasi kwa nambari hii. Piga tena uchague 1.",
        "mine": "{ref} {unit}\n{dates}\n{status}. Umelipa {paid} kati ya {total}", "mine_opts": ["Tuma maelezo tena", "Lipa salio", "Kutoka baadaye", "Ghairi"],
        "sent": "Tumekutumia kwa SMS.", "cancel_q": "{text}", "cancel_opts": ["Ndiyo, ghairi", "Hapana, iweke"], "kept": "Nafasi yako iko. Karibu!",
        "bf_menu": "Kifungua kinywa ({price}/mtu/siku):", "bf_people": "Kwa watu wangapi? (1-{max})", "bf_saved": "Kimehifadhiwa: {summary}.",
        "issue_q": "Tatizo ni nini?", "issue_opts": ["Hakuna maji", "Stima", "Wi-Fi", "AC/feni", "Usafi", "Kufuli/funguo", "Kelele/usalama", "Nyingine"],
        "issue_ok": "Tumeandika #{task}. {who} ameambiwa. Tuma MSAADA kwa SMS kama ni dharura.",
        "talk_opts": ["Nipigie", "Nitatuma swali"], "callback": "Amina atakupigia hivi karibuni.",
        "text_us": "Tuma swali lako kwa {number} na Amina atakujibu.", "co_q": "Toka {unit} sasa? Nambari ya mlango itazimwa.",
        "yes_no": ["Ndiyo", "Hapana"], "co_done": "Umetoka. Asante, safari njema!", "lang_set": "Lugha imehifadhiwa.",
        "sos": "Amina anaarifiwa na kupigiwa sasa. Ukiwa hatarini piga 999 au 112.",
        "unit_info": "{name}, {area}: vyumba {beds}, wageni {guests}. Kuanzia {price}/usiku.{bf} Maelezo kwa SMS.",
        "late_q": "Ombi la kutoka baadaye ({price}) limetumwa kwa Amina. Utapata SMS.",
    },
}
ISSUE_CATEGORIES = ["water", "power", "wifi", "ac", "cleanliness", "lock", "security", "other"]
BF_STYLES = ["swahili", "continental", "english", "vegetarian"]


class Reply(Exception):
    def __init__(self, text, end=False):
        super().__init__(text)
        self.text, self.end = text, end


def fit(text, limit=LIMIT - 4):
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def menu(title, options, start=1):
    return "\n".join([title] + [f"{i}. {o}" for i, o in enumerate(options, start)])


class Cursor:
    def __init__(self, raw):
        tokens = []
        for t in (raw or "").split("*") if raw else []:
            t = t.strip()
            if t == "00":
                tokens = []
            elif t == "0":
                if tokens:
                    tokens.pop()
            else:
                tokens.append(t)
        self.tokens, self.i = tokens, 0

    def take(self):
        if self.i >= len(self.tokens):
            return None
        tok = self.tokens[self.i]
        self.i += 1
        return tok

    def has_more(self):
        return self.i < len(self.tokens)


class Ussd:
    def __init__(self, phone, raw):
        self.phone, self.c = phone, Cursor(raw)
        self.user, _ = get_or_create_user(phone, channel="ussd")
        self.lang = self.user.lang if self.user.lang in S else "en"
        self.t = S[self.lang]

    # ---------- primitives ----------
    def choose(self, title, options, per_page=None):
        """Numbered list with paging. Returns the 0-based index chosen."""
        per_page = per_page or len(options)
        page = 0
        while True:
            chunk = options[page * per_page:(page + 1) * per_page]
            more = (page + 1) * per_page < len(options)
            screen = menu(title, chunk, start=page * per_page + 1) + (f"\n{self.t['more']}" if more else "")
            tok = self.c.take()
            if tok is None:
                raise Reply(fit(screen, LIMIT - 4) if len(screen) > LIMIT - 4 else screen)
            if tok == "98" and more:
                page += 1
                continue
            if tok.isdigit() and 1 <= int(tok) <= len(options):
                return int(tok) - 1
            if not self.c.has_more():
                raise Reply(fit(f"{self.t['invalid']}\n{screen}"))

    def number(self, prompt, lo, hi):
        while True:
            tok = self.c.take()
            if tok is None:
                raise Reply(prompt)
            if tok.isdigit() and lo <= int(tok) <= hi:
                return int(tok)
            if not self.c.has_more():
                raise Reply(f"{self.t['invalid']} {prompt}")

    def text(self, prompt):
        tok = self.c.take()
        if tok is None:
            raise Reply(prompt)
        return tok

    def end(self, text):
        raise Reply(fit(text), end=True)

    # ---------- entry ----------
    def run(self):
        s = SiteSettings.load()
        if same_phone(self.phone, s.host_contact) or self.user.role in ("owner", "manager"):
            return self.ops()
        if self.user.role in STAFF_ROLES:
            return self.staff()
        return self.guest()

    def guest(self):
        last = self.user.bookings.filter(status__in=("confirmed", "checked_in", "completed")).exists()
        name = first_name(self.user.name)[:10]
        title = self.t["back"].format(name=name) if last and name else self.t["welcome"]
        choice = self.choose(title, self.t["main"])
        return [self.book, self.prices, self.my_booking, self.breakfast, self.problem, self.talk, self.checkout, self.language, self.sos][choice]()

    # ---------- guest flows ----------
    def book(self):
        areas = list(Area.objects.filter(units__status="active").distinct()[:5])
        a = self.choose(self.t["where"], [x.name for x in areas] + [self.t["anywhere"]])
        area = areas[a] if a < len(areas) else None
        w = self.choose(self.t["when"], self.t["when_opts"])
        t = today()
        if w == 4:
            ci = self._ddmm(self.text(self.t["ddmm"]))
        else:
            ci = [t, t + timedelta(days=1), weekend_start(t), weekend_start(t) + timedelta(days=7)][w]
        nights = self.number(self.t["nights"], 1, 14)
        guests = self.number(self.t["guests"], 1, 8)
        co = ci + timedelta(days=nights)
        units = list(available_units(ci, co, area=area.slug if area else None, guests=guests)[:9])
        if not units:
            bookings.add_to_waitlist(self.user, ci, co, area=area, guests=guests, channel="ussd")
            self.end(self.t["none"])
        dates = f"{ci:%d/%m}-{co:%d/%m}"
        quotes = {u.pk: price_quote(u, ci, co, guests=guests) for u in units}
        idx = self.choose(self.t["pick"].format(dates=dates), [f"{u.name[:18]} {kes(quotes[u.pk]['total'])}" for u in units], per_page=3)
        unit = units[idx]
        addons = []
        bf = Addon.objects.filter(code="breakfast", active=True).first()
        if bf and unit.breakfast_available:
            b_idx = self.choose(self.t["bf_q"].format(price=kes(bf.price)), self.t["bf_opts"])
            if b_idx < 4:
                addons.append({"code": "breakfast", "quantity": guests, "details": {"style": BF_STYLES[b_idx]}})
        q = price_quote(unit, ci, co, guests=guests, addons=[{"addon": bf, "quantity": guests}] if addons else None, payment_plan="deposit")
        s = SiteSettings.load()
        if q["deposit_available"]:
            plan = ["full", "deposit"][self.choose(self.t["pay_q"].format(total=kes(q["total"])),
                                                   [self.t["pay_full"], self.t["pay_dep"].format(pct=s.deposit_percent, dep=kes(q["deposit"]))])]
        else:
            self.choose(self.t["pay_q"].format(total=kes(q["total"])), [self.t["confirm"]])
            plan = "full"
        try:
            b = bookings.create_hold(unit=unit, guest=self.user, check_in=ci, check_out=co, channel="ussd", adults=guests, addons=addons, payment_plan=plan)
        except bookings.BookingError as e:
            self.end(str(e))
        from apps.payments.services import start_remote_payment

        pay = start_remote_payment(b)
        self.end(self.t["held"].format(unit=unit.name, ref=b.ref, pay=pay["text"]))

    def _ddmm(self, tok):
        m = re.fullmatch(r"(\d{1,2})[/.-]?(\d{2})", tok or "")
        if not m:
            self.end(self.t["invalid"])
        t = today()
        try:
            d = date(t.year, int(m[2]), int(m[1]))
        except ValueError:
            self.end(self.t["invalid"])
        return d if d >= t else date(t.year + 1, d.month, d.day)

    def prices(self):
        units = list(Unit.objects.filter(status="active").select_related("area"))
        idx = self.choose(self.t["pick"].format(dates="/night"), [f"{u.name[:18]} {kes(from_price(u))}" for u in units], per_page=4)
        u = units[idx]
        bf = Addon.objects.filter(code="breakfast", active=True).first()
        bf_text = f" Breakfast {kes(bf.price)}." if bf and u.breakfast_available else ""
        from django.conf import settings

        messaging.send(self.phone, f"{u.name} ({u.area.name}): {u.summary} Photos & booking: {settings.FRONTEND_URL}/stays/{u.slug}", kind="ussd_info")
        self.end(self.t["unit_info"].format(name=u.name, area=u.area.name, beds=u.bedrooms, guests=u.max_guests, price=kes(from_price(u)), bf=bf_text))

    def my_booking(self):
        b = bookings.current_booking(self.phone)
        if not b:
            self.end(self.t["no_booking"])
        head = self.t["mine"].format(ref=b.ref, unit=b.unit.name[:18], dates=f"{nice_date(b.check_in, self.lang)}-{nice_date(b.check_out, self.lang)}",
                                     status=b.get_status_display()[:14], paid=kes(b.amount_paid), total=kes(b.total))
        choice = self.choose(head, self.t["mine_opts"])
        if choice == 0:
            if b.status == "checked_in":
                bookings.send_guest(b, "checkin_code")
            elif b.status == "confirmed":
                bookings.send_guest(b, "directions" if (b.check_in - today()).days <= 2 else "booking_confirmed", balance_note="")
            else:
                bookings.send_guest(b, "status")
            self.end(self.t["sent"])
        if choice == 1:
            from apps.payments.services import start_remote_payment

            self.end(start_remote_payment(b)["text"] if (b.balance_due or b.status == "held") else "You're fully paid - asante!")
        if choice == 2:
            late = Addon.objects.filter(code="late_checkout", active=True).first()
            try:
                bookings.add_addon(b, "late_checkout", channel="ussd")
            except bookings.BookingError as e:
                self.end(str(e))
            self.end(self.t["late_q"].format(price=kes(late.price) if late else ""))
        q = bookings.refund_quote(b)
        if self.choose(fit(self.t["cancel_q"].format(text=q["text"]), 120), self.t["cancel_opts"]) == 0:
            try:
                bookings.cancel(b, by="guest", reason="Cancelled by USSD")
            except bookings.BookingError as e:
                self.end(str(e))
            self.end(q["text"])
        self.end(self.t["kept"])

    def breakfast(self):
        b = bookings.current_booking(self.phone)
        bf = Addon.objects.filter(code="breakfast", active=True).first()
        if not b or not bf:
            self.end(self.t["no_booking"])
        idx = self.choose(self.t["bf_menu"].format(price=kes(bf.price)), self.t["bf_opts"])
        if idx == 4:
            bookings.set_breakfast(b, None, channel="ussd")
            self.end(self.t["bf_saved"].format(summary="-"))
        people = self.number(self.t["bf_people"].format(max=b.guests_count), 1, max(1, b.guests_count))
        ba = bookings.set_breakfast(b, BF_STYLES[idx], people=people, channel="ussd")
        self.end(self.t["bf_saved"].format(summary=bookings.breakfast_summary(ba)))

    def problem(self):
        from apps.operations.services import report_issue

        b = bookings.current_booking(self.phone)
        if not b:
            self.end(self.t["no_booking"])
        idx = self.choose(self.t["issue_q"], self.t["issue_opts"])
        task = report_issue(b, f"{self.t['issue_opts'][idx]} (reported by USSD)", category=ISSUE_CATEGORIES[idx], channel="ussd")
        bookings.notify_host(f"Issue #{task.pk} at {b.unit.name} via USSD: {self.t['issue_opts'][idx]} ({self.user.display_name})", booking=b)
        who = first_name(task.assignee.name) if task.assignee and task.assignee.name else "Our caretaker"
        self.end(self.t["issue_ok"].format(task=task.pk, who=who))

    def talk(self):
        from django.conf import settings

        from apps.messaging.models import Thread

        if self.choose(self.t["main"][5], self.t["talk_opts"]) == 0:
            b = bookings.current_booking(self.phone)
            thread = messaging.get_thread(self.phone, self.user)
            messaging.record_inbound(self.phone, "[USSD] Please call me back", channel="ussd", booking=b, handled="relayed")
            Thread.objects.filter(pk=thread.pk).update(needs_reply=True, waiting_since=timezone.now())
            bookings.notify_host(f"CALL BACK: {self.user.display_name} {self.phone}{' (' + b.ref + ' ' + b.unit.name + ')' if b else ''} asked by USSD.", booking=b)
            self.end(self.t["callback"])
        self.end(self.t["text_us"].format(number=settings.AT_SMS_NUMBER or "this number"))

    def checkout(self):
        b = bookings.active_stay(self.phone)
        if not b:
            self.end(self.t["no_booking"])
        if self.choose(self.t["co_q"].format(unit=b.unit.name), self.t["yes_no"]) == 0:
            bookings.check_out(b, channel="ussd")
            self.end(self.t["co_done"])
        self.end(self.t["kept"])

    def language(self):
        codes = ["en", "sw", "it", "de", "fr"]
        idx = self.choose("Language / Lugha", ["English", "Kiswahili", "Italiano", "Deutsch", "Francais"])
        self.user.lang = codes[idx]
        self.user.save(update_fields=["lang"])
        self.end(S.get(codes[idx], S["en"])["lang_set"])

    def sos(self):
        from apps.safety.services import escalate

        escalate(self.phone, "ussd")
        self.end(self.t["sos"])

    # ---------- Amina's ops menu ----------
    def ops(self):
        from apps.operations import services as ops

        t = today()
        choice = self.choose("Amina ops", ["Today", "Free tonight", "Arrivals/departures", "Requests", "Message guests", "Last-minute deal", "Tasks"])
        if choice == 0:
            n = ops.digest_numbers()
            self.end(f"Today: {n['arrivals']} in, {n['departures']} out, {n['in_house']} staying, {n['breakfasts']} breakfasts, "
                     f"{n['tasks']} tasks, {n['unread']} chats, {n['alerts']} alerts. Week {n['occ']}%.")
        if choice == 1:
            free = list(available_units(t, t + timedelta(days=1)))
            self.end("Free tonight: " + ("; ".join(f"{u.name} {kes(u.base_price)}" for u in free) or "none"))
        if choice == 2:
            from apps.bookings.models import Booking

            ins = Booking.objects.filter(check_in=t, status__in=("confirmed", "checked_in")).select_related("unit")
            outs = Booking.objects.filter(check_out=t, status__in=("checked_in", "completed")).select_related("unit")
            self.end(f"IN: {', '.join(b.unit.name for b in ins) or '-'}. OUT: {', '.join(b.unit.name for b in outs) or '-'}")
        if choice == 3:
            reqs = list(BookingAddon.objects.filter(status="requested").select_related("addon", "booking")[:6])
            if not reqs:
                self.end("No pending requests.")
            r = reqs[self.choose("Requests", [f"{x.addon.name[:14]} {x.booking.ref}" for x in reqs])]
            ok = self.choose(f"{r.addon.name} for {r.booking.ref}", ["Approve", "Decline"]) == 0
            bookings.decide_addon(r, ok, actor=self.user)
            self.end(f"{'Approved' if ok else 'Declined'}. Guest told by SMS.")
        if choice == 4:
            aud = ["in_house", "arriving", "waitlist"][self.choose("Message who?", ["Guests staying now", "Arriving in 7 days", "Waitlist"])]
            body = self.text("Type your message:")
            phones = messaging.audience_phones(aud)
            for p in phones:
                messaging.send(p, f"{SiteSettings.load().business_name}: {body[:300]}", kind="broadcast", sender="host", user=self.user)
            record("broadcast", f"USSD broadcast to {len(phones)} ({aud})", actor=self.user)
            self.end(f"Sent to {len(phones)} guest(s).")
        if choice == 5:
            free = list(available_units(t, t + timedelta(days=1)))
            if not free:
                self.end("Everything is booked tonight!")
            u = free[self.choose("Discount which?", [f"{x.name[:20]} {kes(x.base_price)}" for x in free])]
            pct = self.number("Discount %? (10-50)", 10, 50)
            price = round(u.base_price * (100 - pct) / 100)
            PriceOverride.objects.update_or_create(unit=u, date=t, defaults={"price": price, "note": f"Last-minute -{pct}%"})
            offered = bookings.notify_waitlist(u)
            record("pricing", f"Last-minute deal: {u.name} tonight {kes(price)} (-{pct}%)", actor=self.user)
            self.end(f"{u.name} tonight now {kes(price)}. {offered} waitlisted guest(s) told.")
        tasks = list(ops.Task.objects.filter(status__in=("open", "in_progress")).select_related("unit")[:5])
        self.end("Open tasks: " + ("; ".join(f"#{x.pk} {x.title[:30]}" for x in tasks) or "none"))

    # ---------- staff ----------
    def staff(self):
        from apps.operations import services as ops

        choice = self.choose("Amina Stays staff", ["My tasks", "Breakfast tomorrow", "Today's arrivals"])
        if choice == 0:
            tasks = list(ops.open_tasks_for(self.user))
            if not tasks:
                self.end("No open tasks. Asante!")
            task = tasks[self.choose("My tasks", [f"#{x.pk} {x.title[:24]}" for x in tasks], per_page=4)]
            if self.choose(f"#{task.pk} {task.title[:60]}", ["Start", "Done"]) == 0:
                ops.start_task(task, self.user)
                self.end(f"Task #{task.pk} started.")
            ops.complete_task(task, self.user, note="via USSD")
            self.end(f"Task #{task.pk} done. Asante!")
        if choice == 1:
            self.end(ops.kitchen_sheet_text(today() + timedelta(days=1)) or "No breakfasts tomorrow.")
        arrivals = ops.gate_list()
        self.end("Arrivals: " + ("; ".join(f"{b.unit.name}: {b.guest.display_name}" for b in arrivals) or "none"))


def handle(phone, raw_text):
    try:
        Ussd(phone, raw_text).run()
        return "END Thank you."
    except Reply as r:
        return f"{'END' if r.end else 'CON'} {r.text}"
