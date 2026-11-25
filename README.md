# Amina Stays

**Book, pay, check in and get help — on the web, by USSD, by SMS or with a phone call.**

Amina Stays is a direct-booking and guest-communication platform for a small host with several apartments on the Kenyan coast. It was built for the *Innovate Mombasa: Hospitality & Tourism Hackathon* (Africa's Talking, Nov 2026), AMINA-STAYS challenge:

> Amina has several apartments in Mombasa and struggles to communicate prices, suites, breakfast preferences and check-in information to guests.

Our answer is one source of truth for every home: prices, suites, breakfast, check-in. It is available on **every channel** a Kenyan or international guest might use, and it automates the whole stay from enquiry to review. Amina runs it from a host console, or from her own phone by SMS.

| | |
|---|---|
| 🌍 **Web** | Search with an all-in price, listing pages, checkout with M-Pesa or card (pay in full or a 30% deposit), and a living trip page with directions, Wi-Fi, door code, breakfast, extras and help |
| 📟 **USSD** | Full booking with no data and no smartphone. Also: prices, my booking, breakfast, report a problem, talk to Amina, check out, language, emergency |
| 💬 **SMS — "Ask Amina"** | Natural-language booking in English, Kiswahili, Italian, German and French; instant answers from each home's knowledge base; HELP for emergencies |
| 📞 **Voice — "Call Amina"** | English/Kiswahili IVR: availability and booking, prices, directions, bridge to Amina, voicemail, emergencies |
| 🛎️ **Host console** | Today view, multi-home calendar and pricing, reservations, a unified inbox, tasks and kitchen, listings editor, guest CRM, messaging automations, reviews, insights with the TRA return, payments, safety and channels |

**Research first.** We studied Airbnb, Booking.com, Vrbo, Agoda and Trip.com, small-host operations, Kenyan regulation and Africa's Talking's real limits before writing code. See [docs/RESEARCH.md](docs/RESEARCH.md) for the problem → solution matrix, and [docs/research/](docs/research/) for the five full briefs with sources.

---

## For the judges

| Criterion | Where to look |
|---|---|
| **Usefulness** | Amina's daily pain (prices, suites, breakfast, check-in) is answered on every channel from one knowledge base. Her console's Today view and morning SMS digest show what needs doing; staff work from SMS. |
| **Solves the problem** | Prices: all-in quotes on web/USSD/SMS/voice. Suites: listing pages and SMS/USSD price lists. Breakfast: structured preferences that reach the cook's sheet. Check-in: staged directions, Wi-Fi and a door code on arrival morning. See the [problem → solution matrix](docs/RESEARCH.md#industry-problems-and-how-amina-stays-answers-them). |
| **Implementation** | Django + PostgreSQL with a database-enforced no-double-booking guarantee, idempotent payments, an outbox for messages and a single-instance scheduler; Next.js 16 front end; 41 backend tests. See [Architecture](docs/ARCHITECTURE.md). |
| **Africa's Talking** | SMS (two-way, delivery reports, opt-out), USSD, Voice (IVR, bridge, voicemail, outbound safety calls), Airtime, Mobile Data, SIM Swap; WhatsApp and AT checkout optional. |
| **Demo** | `/demo` runs every channel live in the browser, with no handset or API key needed. |

---

## What makes it work for Mombasa

- **No double bookings across channels.** A PostgreSQL exclusion constraint makes the database itself refuse overlapping stays from the web, USSD, SMS, voice and iCal (Airbnb/Booking.com). A two-channel race is covered by a test.
- **All-in prices everywhere.** Nights + cleaning + 2% tourism levy, with USD/EUR/GBP approximations. No surprise fees.
- **Check-in without a phone call.**
  - Address once booked; directions and Wi-Fi 48 h before.
  - The **door code by SMS at 08:00 on arrival day**, only once the balance is paid, the guest register is complete and an **Africa's Talking SIM-swap check** passes.
  - The code stops working at checkout.
- **Breakfast that reaches the kitchen.** Style (Swahili, continental, full English, vegetarian), people, time and dietary needs (halal, vegan, gluten-free…) are chosen at booking, on the trip page, by SMS or USSD. The cook gets tomorrow's sheet at 18:00.
- **Safety.**
  - Text HELP, dial 9 on USSD, press 9 on a call, or tap SOS. Amina, the caretaker and security are alerted together, and voice calls escalate until someone answers.
  - Emergency numbers (999 / 112 / 1199 / 1514) are always one tap away.
- **Operations.**
  - Checkout creates a cleaning task; guest problems become work orders assigned to the right person.
  - Staff reply DONE by SMS.
  - The guard gets the day's arrivals and car plates; Amina gets a morning digest.
- **Compliance built in.**
  - TRA licence on every listing and receipt.
  - An encrypted, consented guest register kept for the 5-year legal period, then purged.
  - A one-click monthly TRA return and the tourism levy in every quote.
  - Data Protection Act export and erasure; promotional SMS only 08:00–18:00, with STOP.

### Africa's Talking products used

**SMS** (two-way, delivery reports, opt-out) · **USSD** · **Voice** (IVR, bridging, recording, outbound safety calls) · **Airtime** (automatic apology when Amina cancels) · **Mobile Data** (optional welcome bundle) · **Insights SIM Swap** (before door codes) · WhatsApp (optional) · M-Pesa checkout via AT (optional; see [payments](#payments)).

---

## Quick start

Requirements:
- Python 3.12+ with [uv](https://docs.astral.sh/uv/)
- Node.js 20.9+
- PostgreSQL 16+: local, via Docker, or `scripts/db.sh install` (micromamba, no root)

```bash
scripts/dev.sh            # Postgres + migrations + demo data + Django + scheduler + Next.js
```

Then open:

| URL | What |
|---|---|
| http://localhost:3000 | Guest site |
| http://localhost:3000/demo | **Demo Lab**: SMS, USSD and voice phones in the browser, Amina's phone and a lifecycle time machine |
| http://localhost:3000/host | Host console: log in as **+254 700 000 001** (Amina); in demo mode the login code is shown on screen |
| http://localhost:8000/api/docs | OpenAPI docs |

<details>
<summary>Step by step, or with Docker</summary>

```bash
# Database (pick one)
scripts/db.sh install && scripts/db.sh init       # local PostgreSQL 18 in .data/ (micromamba, no root)
docker compose up -d db                           # or Docker

# Backend
cd backend
uv sync
DEBUG=1 DEMO=1 uv run python manage.py migrate
DEBUG=1 DEMO=1 uv run python manage.py seed_demo
DEBUG=1 DEMO=1 uv run python manage.py runserver      # API on :8000
DEBUG=1 DEMO=1 uv run python manage.py run_scheduler  # background jobs (another terminal)

# Frontend
cd frontend
npm install
npm run dev                                       # http://localhost:3000

# Everything in containers
docker compose up --build
```
</details>

Configuration is environment-driven; every variable is documented in [.env.example](.env.example). With no keys at all you get:
- dry-run SMS and voice (logged, not sent);
- simulated M-Pesa (it "succeeds" after 6 seconds);
- a simulated card checkout and simulated smart-lock codes;
- the Demo Lab to drive every channel.

Demo personas (seeded): Giulia 🇮🇹 and Wanjiku 🇰🇪 are staying now, Hans 🇩🇪 arrives today with his ID missing (so his door code is held), Sarah 🇬🇧 arrives tomorrow with a deposit paid and an early check-in request, Peter 🇰🇪 checks out today. Staff: Fatuma (cleaner), Juma (caretaker), Mama Zawadi (cook), Hassan (security).

## Connecting Africa's Talking

1. Create a sandbox app at [africastalking.com](https://account.africastalking.com) and set `AT_USERNAME=sandbox`, `AT_API_KEY`, `AT_USSD_CODE`, `AT_SMS_NUMBER` and a long random `AT_WEBHOOK_SECRET` in `.env`.
2. Expose port 3000: `ngrok http 3000` (or `cloudflared tunnel --url http://localhost:3000`) and set `PUBLIC_URL=https://<your-tunnel>`.
3. Register these callback URLs in the AT dashboard (replace `<secret>`):

| Product | Callback URL |
|---|---|
| USSD | `https://<tunnel>/at/<secret>/ussd` |
| USSD end-of-session (optional) | `https://<tunnel>/at/<secret>/ussd/events` |
| SMS incoming messages | `https://<tunnel>/at/<secret>/sms/incoming` |
| SMS delivery reports | `https://<tunnel>/at/<secret>/sms/delivery` |
| SMS opt-out | `https://<tunnel>/at/<secret>/sms/optout` |
| Voice (live number only; Voice has no sandbox) | `https://<tunnel>/at/<secret>/voice` |
| Airtime status | `https://<tunnel>/at/<secret>/airtime/status` |
| Mobile Data status | `https://<tunnel>/at/<secret>/data/status` |
| SIM Swap (Insights) | `https://<tunnel>/at/<secret>/insights/simswap` |

4. Test with the [AT simulator](https://simulator.africastalking.com): dial your USSD code or text your shortcode. The host console's **Channels** page shows which products are configured, plus the AT balance.

### Payments

| Variable | Options |
|---|---|
| `MPESA_PROVIDER` | `simulate` (default) · `daraja` (Safaricom STK push; set the `DARAJA_*` keys; callback `https://<tunnel>/api/payments/daraja/callback/<secret>`) · `africastalking` (AT mobile checkout, onboarding-gated, with no sandbox) |
| `CARD_PROVIDER` | `simulate` (default: a hosted test card page) · `paystack` (`PAYSTACK_SECRET_KEY`; webhook `https://<tunnel>/api/payments/paystack/webhook`) |

Africa's Talking no longer offers self-serve payments with a sandbox (see [research](docs/research/04-africas-talking.md)), so the payment layer is pluggable and Safaricom Daraja is the production path.

## Demo script (5 minutes)

1. **The problem.** Amina answers the same questions all day across WhatsApp, calls and SMS. Breakfast orders get lost, guests wait outside for keys, and she can't see who's arriving.
2. **Feature-phone booking.** In the Demo Lab, holding *New guest*'s phone, dial USSD and answer 1 (book) → 2 (Diani) → 3 (this weekend) → 2 nights → 2 guests → 1 (the home) → 1 (Swahili breakfast) → 1 (pay all now). About 6 seconds later the simulated M-Pesa payment confirms, and the confirmation SMS with a trip link arrives on the SMS phone.
3. **Ask Amina by SMS.** Text "Bei?" (Kiswahili for "price?"), then "WIFI", then "Nataka nyumba Diani 12 Dec siku 3 watu 2" (a booking in plain Kiswahili).
4. **Call Amina.** Press 2 for Kiswahili, then 2 for prices and breakfast. The IVR is read aloud in the browser.
5. **Web.** Search → listing → checkout with a 30% deposit and breakfast → trip page: the checklist, directions unlocking 48 h before, and the receipt.
6. **Time machine.** Pick Hans's booking and press *Release door code*: it is held because the guest register (ID) is missing. Hold Hans's phone, text "ID C01X00T47", release again, and the door code arrives by SMS in German.
7. **Safety.** Holding Wanjiku's phone, text "HELP": she gets an instant reply in Kiswahili and Amina gets an SMS alert. Switch to Amina's phone and *Answer the SOS safety call*: it names the guest, home and booking, and pressing 1 connects Amina to her.
8. **Host console.** Today (the Today | Upcoming reservation cards), Calendar and Messages (Amina can also reply from her phone with "#3 …"). Then open the Menu for the kitchen sheet, insights and the one-click TRA return.

## Tests

```bash
cd backend && uv run pytest          # 42 tests on a real PostgreSQL test database
cd backend && uv run ruff check .
cd frontend && npx tsc --noEmit && npm run lint
```

## Project structure

```
backend/                 Django 6 + DRF API, Africa's Talking webhooks, scheduler
  apps/core              settings, scheduler, audit log, demo endpoints, seed data
  apps/accounts          phone-number users, OTP login, ID encryption, data rights
  apps/properties        homes, photos, pricing, calendars, iCal, quote engine
  apps/bookings          booking lifecycle, add-ons, breakfast, guest register, door codes
  apps/payments          M-Pesa (simulated / Daraja / AT), cards (simulated / Paystack), refunds
  apps/messaging         outbox, templates (5 languages), automations, FAQ, broadcasts
  apps/comms             AT client, SMS bot, USSD, voice IVR, SIM swap, webhooks
  apps/operations        tasks, staff, kitchen sheet, gate list, digest, CRM
  apps/safety            SOS alerts and escalation, guest register export
  apps/reviews           ratings and responses
  apps/insights          occupancy, ADR, RevPAR, TRA monthly return
  tests/                 pytest suite
frontend/                Next.js 16 (App Router), Tailwind CSS v4, TanStack Query, Radix
  src/app/(site)         guest site, Demo Lab
  src/app/host           host console
  src/components         UI kit, site, host and demo components
docs/                    research synthesis, architecture, full research briefs
scripts/                 dev.sh (run everything), db.sh (local PostgreSQL)
```

More: [Architecture](docs/ARCHITECTURE.md) · [Research](docs/RESEARCH.md) · [Project brief](<AMINA-STAYS_Project_Brief (2).pdf>)

## Credits

- 3D icons: [Microsoft Fluent Emoji](https://github.com/microsoft/fluentui-emoji) (MIT licence), downscaled copies in `frontend/public/3d`.
- Photos: [Unsplash](https://unsplash.com) (Unsplash licence), loaded from their CDN.
- Map data: © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors.
- Typeface: [Figtree](https://fonts.google.com/specimen/Figtree) (SIL Open Font License).
- Interaction patterns follow the published Airbnb product (see [research 06/07](docs/RESEARCH.md#design-language)); all branding, names and artwork are Amina Stays' own.
