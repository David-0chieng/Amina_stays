# Amina Stays

**Book, pay, check in and get help — on the web, by USSD, by SMS or with a phone call.**

Amina Stays is a direct-booking and guest-communication platform for a small host with several apartments on the Kenyan coast. It was built for the *Innovate Mombasa: Hospitality & Tourism Hackathon* (Africa's Talking, Nov 2026), AMINA-STAYS challenge:

> Amina has several apartments in Mombasa and struggles to communicate prices, suites, breakfast preferences and check-in information to guests.

Our answer is one source of truth for every home: prices, suites, breakfast, check-in. It is available on **every channel** a Kenyan or international guest might use, and it automates the whole stay from enquiry to review. Amina runs it from a host console, or from her own phone by SMS.

| | |
|---|---|
| 🌍 **Web** | Search with an all-in price, listing pages, checkout with M-Pesa (Paybill as a fallback) or card, in full or with a 30% deposit, and a living trip page with directions, Wi-Fi, door code, breakfast, extras, help, date changes and extensions, and a tax invoice |
| 📟 **USSD** | Full booking with no data and no smartphone. Also: prices, my booking, breakfast, report a problem, talk to Amina, check out, language, emergency |
| 💬 **SMS — "Ask Amina"** | Natural-language booking in English, Kiswahili, Italian, German and French; instant answers from each home's knowledge base; HELP for emergencies |
| 📞 **Voice — "Call Amina"** | English/Kiswahili IVR: availability and booking, prices, directions, bridge to Amina, voicemail, emergencies |
| 🛎️ **Host console** | Today view, multi-home calendar and pricing, reservations, a unified inbox, tasks and kitchen, listings editor, guest CRM, messaging automations, reviews, insights with the TRA return, payments, safety and channels |

**Research first.** We studied Airbnb, Booking.com, Vrbo, Agoda and Trip.com, small-host operations, Kenyan regulation and Africa's Talking's real limits before writing code, then compared every guest and host flow end to end with Airbnb, Hospitable and Hostaway. See [docs/RESEARCH.md](docs/RESEARCH.md) for the problem → solution matrix, and [docs/research/](docs/research/) for the eight full briefs with sources.

**Run it on your machine:** [Windows](#windows) · [Linux](#linux) · [Docker, any system](#any-system-docker). You don't need any API keys: SMS, voice and payments are simulated.

---

## For the judges

| Criterion | Where to look |
|---|---|
| **Usefulness** | Amina's daily pain (prices, suites, breakfast, check-in) is answered on every channel from one knowledge base. Her console's Today view and morning SMS digest show what needs doing; staff work from SMS. |
| **Solves the problem** | Prices: all-in quotes on web/USSD/SMS/voice. Suites: listing pages and SMS/USSD price lists. Breakfast: structured preferences that reach the cook's sheet. Check-in: staged directions, Wi-Fi and a door code on arrival morning. See the [problem → solution matrix](docs/RESEARCH.md#industry-problems-and-how-amina-stays-answers-them). |
| **Implementation** | Django + PostgreSQL with a database-enforced no-double-booking guarantee, idempotent payments, an outbox for messages and a single-instance scheduler; Next.js 16 front end; 586 backend tests, including end-to-end flow suites for every channel. See [Architecture](docs/ARCHITECTURE.md). |
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
- **Payments that recover.**
  - A failed M-Pesa prompt (wrong PIN, cancelled, low balance, phone unreachable) gets a plain explanation and the right next step: resend, pay the 30% deposit, card, or the **Paybill**, using the booking reference as the account number.
  - Paybill payments are matched to the booking automatically and confirmed by SMS. Anything unmatched waits for Amina's one-click match.
  - Balances are chased by a reminder ladder, overpayments are refunded, and every stay gets a numbered invoice (with credit notes for refunds).
- **Plans change.** Guests change dates or guests, or extend, from the trip page or by texting EXTEND. The stay is re-priced, and they pay the difference or get it back under the cancellation policy; Amina can require approval. Sold-out dates offer "Notify me" and an SMS when they free up.
- **Safety.**
  - Text HELP, dial 9 on USSD, press 9 on a call, or tap SOS. Amina, the caretaker and security are alerted together, and voice calls escalate until someone answers.
  - Emergency numbers (999 / 112 / 1199 / 1514) are always one tap away.
- **Operations.**
  - Checkout creates a cleaning task; guest problems become work orders assigned to the right person.
  - Staff reply DONE by SMS.
  - The guard gets the day's arrivals and car plates; Amina gets a morning digest.
- **Compliance built in.**
  - TRA licence on every listing and receipt, with renewal reminders before it expires.
  - An encrypted, consented guest register kept for the 5-year legal period, then purged.
  - A one-click monthly TRA return and the tourism levy in every quote.
  - Data Protection Act export and erasure; promotional SMS only 08:00–18:00, with STOP.

### Africa's Talking products used

**SMS** (two-way, delivery reports, opt-out) · **USSD** · **Voice** (IVR, bridging, recording, outbound safety calls) · **Airtime** (automatic apology when Amina cancels) · **Mobile Data** (optional welcome bundle) · **Insights SIM Swap** (before door codes) · WhatsApp (optional) · M-Pesa checkout via AT (optional; see [payments](#payments)).

---

## Quick start

You need three tools, or Docker on its own:
- [uv](https://docs.astral.sh/uv/), which also downloads the Python version the backend uses (3.14);
- Node.js 20.9+;
- PostgreSQL 16+.

Clone the repository (or download the ZIP) and open a terminal in its folder.

### Any system: Docker

With [Docker Desktop](https://www.docker.com/products/docker-desktop/) (Windows, macOS) or Docker Engine (Linux):

```bash
docker compose up --build
```

This starts PostgreSQL 18, the API, the scheduler and the website, and loads the demo data. Ctrl+C stops it; `docker compose down -v` also deletes the database.

### Linux

These steps are for Ubuntu 24.04+ and Debian 13+. Other distributions need the same tools from their own package manager.

1. Install the tools:

   ```bash
   sudo apt update && sudo apt install -y git curl postgresql
   curl -LsSf https://astral.sh/uv/install.sh | sh                                  # uv
   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash  # nvm, for Node.js
   ```

   Open a new terminal and run `nvm install --lts`. The distribution's own Node.js is too old for Next.js 16.

2. Create the database user and database:

   ```bash
   sudo -u postgres psql -c "CREATE ROLE amina LOGIN CREATEDB PASSWORD 'amina';"
   sudo -u postgres createdb -O amina amina
   ```

3. Start everything:

   ```bash
   export DATABASE_URL=postgres://amina:amina@localhost:5432/amina
   scripts/dev.sh
   ```

   The first run installs the dependencies, creates the tables and loads the demo data. After that, the API (port 8000), the scheduler and the website (port 3000) run until you press Ctrl+C. `scripts/dev.sh --reseed` resets the demo data.

If you can't use sudo, or your distribution's PostgreSQL is older than 16, leave PostgreSQL out of step 1 and skip step 2. Then run `scripts/dev.sh` without `DATABASE_URL`. It uses either:
- PostgreSQL 18 run from the project folder, which you set up with `scripts/db.sh install && scripts/db.sh init` (needs [micromamba](https://mamba.readthedocs.io/en/latest/installation/micromamba-installation.html)); or
- a database container, if Docker is installed.

<details>
<summary>Linux step by step, instead of <code>scripts/dev.sh</code></summary>

```bash
cp .env.example .env                       # demo mode and the database address
cd backend
uv sync
uv run python manage.py migrate
uv run python manage.py seed_demo
uv run python manage.py runserver          # API on :8000
uv run python manage.py run_scheduler      # second terminal, in backend/
npm install && npm run dev                 # third terminal, in frontend/ → http://localhost:3000
```
</details>

### Windows

**Recommended: WSL 2.**
1. In PowerShell opened as administrator, run `wsl --install`, then restart.
2. Open **Ubuntu** from the Start menu and clone the project into your Ubuntu home folder (`~`). Avoid `/mnt/c`: installs and live reload are much slower there.
3. Follow the Linux steps inside Ubuntu.
4. Open http://localhost:3000 in your Windows browser as usual.

If the database isn't running after a restart, start it with `sudo service postgresql start`.

**Or natively, in PowerShell** (Windows 10 or 11):

1. Install the tools:

   ```powershell
   winget install -e --id Git.Git
   winget install -e --id OpenJS.NodeJS.LTS
   winget install -e --id astral-sh.uv
   winget install -e --id PostgreSQL.PostgreSQL.18 --interactive
   ```

   In the PostgreSQL installer, choose a password for the `postgres` user and keep port 5432. Then close and reopen PowerShell so it finds the new commands, and allow it to run npm (once):

   ```powershell
   Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
   ```

2. Create the database user and database. Type the `postgres` password when asked:

   ```powershell
   & "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -c "CREATE ROLE amina LOGIN CREATEDB PASSWORD 'amina';"
   & "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -c "CREATE DATABASE amina OWNER amina;"
   ```

3. Start everything from the project folder:

   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts\dev.ps1
   ```

   This works like `scripts/dev.sh` on Linux. The first run installs the dependencies, creates the tables and loads the demo data. After that, the API (port 8000), the scheduler and the website (port 3000) run in this window until you press Ctrl+C. Add `-Reseed` to reset the demo data.

If you have Docker Desktop, you can skip installing PostgreSQL and step 2. When nothing is listening on port 5432, `scripts\dev.ps1` starts the database in a container.

<details>
<summary>Windows step by step, instead of <code>scripts\dev.ps1</code></summary>

1. In the project folder, copy the local settings (demo mode and the database address), then set up and start the API:

   ```powershell
   Copy-Item .env.example .env
   cd backend
   uv sync
   uv run python manage.py migrate
   uv run python manage.py seed_demo
   uv run python manage.py runserver
   ```

2. In a second PowerShell window, from the project folder, start the scheduler. It sends reminders, door codes and automated messages:

   ```powershell
   cd backend
   uv run python manage.py run_scheduler
   ```

3. In a third window, from the project folder, start the website:

   ```powershell
   cd frontend
   npm install
   npm run dev
   ```
</details>

### Open the app

| URL | What |
|---|---|
| http://localhost:3000 | Guest site |
| http://localhost:3000/demo | **Demo Lab**: SMS, USSD and voice phones in the browser, Amina's phone and a lifecycle time machine |
| http://localhost:3000/host | Host console: log in as **+254 700 000 001** (Amina); in demo mode the login code is shown on screen |
| http://localhost:8000/api/docs | OpenAPI docs |

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
| `DARAJA_TRANSACTION_TYPE` | `CustomerPayBillOnline` (default, a Paybill) · `CustomerBuyGoodsOnline` (a Till: set `DARAJA_SHORTCODE` to the store number and `DARAJA_PARTY_B` to the Till number) |
| `MPESA_SHORTCODE` | The Paybill guests can pay into when a prompt fails (defaults to `DARAJA_SHORTCODE`). Paybill only: a Till payment carries no account number, so it can't be matched to a booking. Set `DARAJA_CALLBACK_SECRET` (a hex value: Safaricom rejects callback URLs containing words such as `exe`, `cmd` or `sql`); the M-Pesa prompt and Paybill callbacks share it. Then register the Paybill callbacks once by running `uv run python manage.py register_c2b` in `backend/` (it prints the validation and confirmation URLs). |
| `CARD_PROVIDER` | `simulate` (default: a hosted test card page) · `paystack` (`PAYSTACK_SECRET_KEY`; webhook `https://<tunnel>/api/payments/paystack/webhook`) |

Africa's Talking no longer offers self-serve payments with a sandbox (see [research](docs/research/04-africas-talking.md)), so the payment layer is pluggable and Safaricom Daraja is the production path.

## Going live

Real guests need no code changes. Each simulated service switches to the real one as soon as its keys are set.

1. In `backend/`, run `uv run python manage.py check --deploy`. Along with Django's own checks, it lists every key or setting a live site still needs and the variable to set (warnings `amina.W001`–`W017`). It also catches the mistakes that only show up with real guests: no SMS sender, a `PUBLIC_URL` missing from `ALLOWED_HOSTS`, a tunnel URL with live M-Pesa, the sandbox shortcode in production and the demo host phone. Once those are gone, only hosting is left.
2. Fill in `.env` (or your host's environment variables):

   | For | Set |
   |---|---|
   | The site | `DEBUG=0`, `DEMO=0`, `SECRET_KEY`, `ALLOWED_HOSTS`, `FRONTEND_URL` and `PUBLIC_URL` (your https address), `ID_ENCRYPTION_KEY`, `AMINA_PHONE` (the host's own number) |
   | Africa's Talking | `AT_USERNAME`, `AT_API_KEY`, `AT_SENDER_ID` (a sender ID approved in the AT dashboard; without it or `AT_SMS_NUMBER`, AT's default sender only reaches Airtel numbers), `AT_SMS_NUMBER`, `AT_USSD_CODE`, `AT_VOICE_NUMBER`, `AT_WEBHOOK_SECRET`; optionally `AT_DATA_PRODUCT` and `AT_WHATSAPP_NUMBER` |
   | M-Pesa | `MPESA_PROVIDER=daraja`, `DARAJA_ENV=production`, `DARAJA_CONSUMER_KEY`, `DARAJA_CONSUMER_SECRET`, `DARAJA_SHORTCODE`, `DARAJA_PASSKEY` (emailed after Daraja Go-Live), `DARAJA_CALLBACK_SECRET`, `MPESA_SHORTCODE`; for a Till, `DARAJA_TRANSACTION_TYPE=CustomerBuyGoodsOnline` and `DARAJA_PARTY_B` |
   | Cards | `CARD_PROVIDER=paystack`, `PAYSTACK_SECRET_KEY` |
   | Smart locks (optional) | `IGLOOHOME_API_KEY`, `IGLOOHOME_API_BASE`, and each home's lock device ID in the listing editor |

3. Register the callback URLs:
   - the [Africa's Talking table above](#connecting-africas-talking);
   - the Paybill callbacks, with `register_c2b`;
   - the Paystack webhook, in the Paystack dashboard.

   M-Pesa prompts carry their own callback URL, so they need no registration. With live M-Pesa the callbacks must be on your own https domain: Safaricom blocks ngrok and similar tunnels in production.
4. Serve the site over HTTPS, on any host or with `docker compose up -d` behind a TLS proxy, and keep the scheduler running. Reminders, door codes and payment checks depend on it. `migrate` also creates the cache table that every API worker shares, so login-code limits and provider tokens hold across workers. Without Docker, also run `uv run python manage.py collectstatic --noinput` in `backend/` (with `DEBUG=0` set) after each update; the Docker image does this when it's built.

## Demo script (5 minutes)

1. **The problem.** Amina answers the same questions all day across WhatsApp, calls and SMS. Breakfast orders get lost, guests wait outside for keys, and she can't see who's arriving.
2. **Feature-phone booking.** In the Demo Lab, holding *New guest*'s phone, dial USSD and answer 1 (book) → 2 (Diani) → 3 (this weekend) → 2 nights → 2 guests → 1 (the home) → 1 (Swahili breakfast) → 1 (pay all now). About 6 seconds later the simulated M-Pesa payment confirms, and the confirmation SMS with a trip link arrives on the SMS phone.
3. **Ask Amina by SMS.** Text "Bei?" (Kiswahili for "price?"), then "WIFI", then "Nataka nyumba Diani 12 Dec siku 3 watu 2" (a booking in plain Kiswahili).
4. **Call Amina.** Press 2 for Kiswahili, then 2 for prices and breakfast. The IVR is read aloud in the browser.
5. **Web.** Search → listing → checkout with breakfast, paying in full. While the M-Pesa prompt is waiting, tap *Simulate "insufficient funds"*: the guest is told why and offered the 30% deposit instead, a card or the Paybill. Pay the deposit, then open the trip page: the checklist, directions unlocking 48 h before, the receipt and the tax invoice.
6. **Time machine.** Pick Hans's booking and press *Release door code*: it is held because the guest register (ID) is missing. Hold Hans's phone, text "ID C01X00T47", release again, and the door code arrives by SMS in German.
7. **Safety.** Holding Wanjiku's phone, text "HELP": she gets an instant reply in Kiswahili and Amina gets an SMS alert. Switch to Amina's phone and *Answer the SOS safety call*: it names the guest, home and booking, and pressing 1 connects Amina to her.
8. **Host console.** Today (the Today | Upcoming reservation cards), Calendar and Messages (Amina can also reply from her phone with "#3 …"). Then open the Menu for the kitchen sheet, insights and the one-click TRA return.

More flows, if there's time:
- **Change of plans.** On a confirmed trip, *Change dates or guests* (or *Extend your stay* once checked in) shows the new price before the guest commits; pay the difference and the dates move. Turn off *Instant date changes* in Settings and the request waits on Amina's Today page instead.
- **Paybill.** In the Demo Lab time machine, pick a booking that owes money and press *Simulate Paybill payment*: it is matched by reference, the guest gets a PAID SMS, and Host › Payments updates. Payments that match no booking land in the Unmatched queue.
- **Waitlist.** On a listing whose dates are taken, *Notify me*; cancel the blocking stay in the console and the waiting guest gets an SMS offer.

## Tests

They use the database from the quick start; pytest creates and drops its own test database. Run them from the project folder; the commands are the same in bash and PowerShell:

```bash
cd backend
uv run pytest            # 586 tests, incl. end-to-end flow suites (tests/test_flows_*.py)
uv run ruff check .
cd ../frontend
npx tsc --noEmit
npm run lint
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
scripts/                 dev.sh (run everything on Linux, macOS, WSL), dev.ps1 (the same on Windows), db.sh (local PostgreSQL)
```

More: [Architecture](docs/ARCHITECTURE.md) · [Research](docs/RESEARCH.md) · [Project brief](<AMINA-STAYS_Project_Brief (2).pdf>)

## Credits

- 3D icons: [Microsoft Fluent Emoji](https://github.com/microsoft/fluentui-emoji) (MIT licence), downscaled copies in `frontend/public/3d`.
- Photos: [Unsplash](https://unsplash.com) (Unsplash licence), loaded from their CDN.
- Map data: © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors.
- Typeface: [Figtree](https://fonts.google.com/specimen/Figtree) (SIL Open Font License).
- Interaction patterns follow the published Airbnb product (see [research 06/07](docs/RESEARCH.md#design-language)); all branding, names and artwork are Amina Stays' own.
