# Amina-Stays

Short-stay booking for Amina's units, reachable on four channels built on [Africa's Talking](https://africastalking.com): **web**, **USSD**, **SMS ("Ask Amina")** and **voice ("Call Amina")**. Payments are M-Pesa STK push, plus a card option for foreign guests.

## Setup

Requires Node.js 20+.

```bash
npm install
cp .env.example .env   # then fill in your values
npm start              # http://localhost:3000  (host dashboard: /host.html)
```

The SQLite database (`amina.db`) is created on first run and is not committed.

## Configuration

All settings live in `.env` — see `.env.example` for the full list. The main ones:

| Variable | Purpose |
| --- | --- |
| `AT_USERNAME`, `AT_API_KEY` | Africa's Talking credentials (`sandbox` for testing) |
| `AT_VOICE_NUMBER` | Voice number — voice has no sandbox, needs live credentials |
| `PAYMENT_MODE` | `live` or `simulate` (auto-confirms payments for demos) |
| `CARD_PROVIDER` | `simulate` (hosted test page) |
| `HOST_PIN` | PIN for the host dashboard |
| `PUBLIC_URL` | Public URL for AT callbacks (e.g. an ngrok tunnel) |
| `DEMO` | `1` enables `/demo/*` routes that bypass payment — never in production |

## Africa's Talking callbacks

Point these at `PUBLIC_URL`:

- USSD: `/ussd`
- SMS incoming: `/sms/incoming`
- Voice: `/voice`
- Payments: `/payments/callback`

## Tests

```bash
npm test
```

Runs `test/e2e.js`, which spawns its own server with fake credentials and a temporary database.
