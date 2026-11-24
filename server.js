require('dotenv').config();
const express = require('express');
const db = require('./db');
const { findAvailable } = require('./availability');
const { sendSMS } = require('./sms');
const { createHold, getBooking, releaseExpiredHolds } = require('./bookings');
const { collectPayment, onPaymentSuccess, onPaymentFailed } = require('./payments');
const cardRouter = require('./cardpay');
const ussdRouter = require('./ussd');
const voiceRouter = require('./voice');
const hostRouter = require('./host');
const { handleSms } = require('./smsbot');
const { runScheduler, sendDirections, sendCode, cancelBooking, notifyWaitlist, checkout } = require('./lifecycle');
const { requestOtp, verifyOtp, requireGuest } = require('./auth');

const app = express();
app.use(express.urlencoded({ extended: false })); // AT sends form-encoded
app.use(express.json());
app.use(express.static('public'));

// ---------- Units ----------
app.get('/api/units', (req, res) => {
  const { checkIn, checkOut, area, guests } = req.query;
  if (checkIn && checkOut && checkOut <= checkIn) return res.status(400).json({ error: 'Check-out must be after check-in' });
  res.json(checkIn && checkOut
    ? findAvailable({ checkIn, checkOut, area, guests: +guests || 0 })
    : db.prepare('SELECT * FROM units').all());
});

// Public contact details for the website (the other three ways in)
app.get('/api/config', (req, res) => res.json({
  ussdCode: process.env.USSD_CODE || null,
  smsNumber: process.env.AT_SMS_NUMBER || null,
  voiceNumber: process.env.AT_VOICE_NUMBER || null,
  demo: process.env.DEMO === '1',
  simulatedPayments: (process.env.PAYMENT_MODE || '').toLowerCase() === 'simulate',
  cardProvider: process.env.CARD_PROVIDER || 'simulate'
}));

// ---------- Website login (phone + one-time SMS code) ----------
app.post('/api/auth/request', async (req, res) => {
  const r = await requestOtp(req.body.phone);
  res.status(r.error ? 400 : 200).json(r);
});
app.post('/api/auth/verify', (req, res) => {
  const r = verifyOtp(req.body.phone, req.body.code);
  res.status(r.error ? 400 : 200).json(r);
});

app.get('/api/me', requireGuest, (req, res) => {
  const guest = db.prepare('SELECT phone, name FROM guests WHERE phone=?').get(req.phone);
  const bookings = db.prepare(`SELECT b.ref, b.check_in, b.check_out, b.status, b.channel, b.total, u.name unit_name, u.area
    FROM bookings b JOIN units u ON u.id=b.unit_id WHERE b.guest_phone=? AND b.status NOT IN ('expired') ORDER BY b.check_in DESC`).all(req.phone);
  res.json({ ...guest, bookings });
});

app.post('/api/me/checkout', requireGuest, async (req, res) => res.json({ message: await checkout(req.phone) }));

// ---------- Booking + payment ----------
app.post('/api/book', requireGuest, async (req, res) => {
  const { unitId, checkIn, checkOut, name, method } = req.body;
  if (name) db.prepare('INSERT INTO guests (phone,name) VALUES (?,?) ON CONFLICT(phone) DO UPDATE SET name=excluded.name')
    .run(req.phone, String(name).slice(0, 60));
  const hold = createHold({ unitId: +unitId, guestPhone: req.phone, checkIn, checkOut, channel: 'web' });
  if (hold.error) return res.status(400).json(hold);
  const pay = await collectPayment(hold.ref, req.phone, hold.total, method);
  res.json({ ref: hold.ref, total: hold.total, nights: hold.nights, payment: pay });
});

app.get('/api/booking/:ref', requireGuest, (req, res) => {
  const b = getBooking(req.params.ref);
  if (!b || b.guest_phone !== req.phone) return res.status(404).json({ error: 'Not found' });
  res.json({ ref: b.ref, status: b.status, unit_name: b.unit_name, check_in: b.check_in, check_out: b.check_out, total: b.total });
});

// Africa's Talking payment notification
app.post('/payments/callback', async (req, res) => {
  console.log('Payment callback:', req.body);
  res.sendStatus(200);
  const { status, transactionId } = req.body;
  const meta = req.body.requestMetadata || req.body.metadata || {};
  const ref = meta.ref;
  if (!ref) return;
  try {
    if (status === 'Success') await onPaymentSuccess(ref, transactionId, 'mpesa');
    else if (status === 'Failed') await onPaymentFailed(ref, 'mpesa');
  } catch (e) { console.error('Payment callback error:', e); }
});

// ---------- SMS (Ask Amina) ----------
app.post('/sms/incoming', async (req, res) => {
  const { from, text } = req.body;
  console.log('SMS from', from, ':', text);
  db.prepare('INSERT INTO messages (phone,text,direction,handled) VALUES (?,?,?,?)')
    .run(from, text, 'in', 'pending');
  res.sendStatus(200); // answer AT immediately
  try { await handleSms(from, text || ''); } catch (e) { console.error(e); }
});

// ---------- USSD, Voice, Host dashboard ----------
app.use(ussdRouter);
app.use(voiceRouter);
app.use(hostRouter);
app.use(cardRouter);

// ---------- Demo helpers (only with DEMO=1 in .env — they bypass payment) ----------
if (process.env.DEMO === '1') {
  console.log('DEMO routes enabled (/demo/*)');
  app.get('/demo/pay/:ref', async (req, res) => {
    await onPaymentSuccess(req.params.ref, 'DEMO');
    res.json(getBooking(req.params.ref));
  });
  app.get('/demo/checkin/:ref', async (req, res) => {
    const b = getBooking(req.params.ref);
    if (!b) return res.status(404).json({ error: 'no such booking' });
    await sendDirections(b);
    await sendCode(getBooking(req.params.ref));
    res.json(getBooking(req.params.ref));
  });
  app.get('/demo/tick', async (req, res) => { await runScheduler(); res.json({ ok: true }); }); // run scheduled jobs now
  app.get('/demo/cancel/:ref', async (req, res) => res.json(await cancelBooking(req.params.ref)));
  app.get('/demo/sms', async (req, res) => { // simulate an inbound SMS: /demo/sms?from=+2547..&text=hi
    const { from, text } = req.query;
    db.prepare('INSERT INTO messages (phone,text,direction,handled) VALUES (?,?,?,?)').run(from, text, 'in', 'pending');
    await handleSms(from, text || '');
    res.json(db.prepare('SELECT text, direction FROM messages WHERE phone=? ORDER BY id DESC LIMIT 4').all(from).reverse());
  });
}

// ---------- Background jobs (every 30s) ----------
setInterval(async () => {
  try {
    const released = releaseExpiredHolds();
    for (const r of released) {
      console.log('Released hold:', r.ref);
      await notifyWaitlist(r.unit_id);
    }
    await runScheduler();
  } catch (e) { console.error('Scheduler error:', e); }
}, 30000);

// ---------- Start ----------
const PORT = process.env.PORT || 3000;
// Express 5 passes listen errors to the callback instead of throwing — without this check a busy
// port prints "running" while the process serves nothing.
app.listen(PORT, err => {
  if (err) {
    console.error(err.code === 'EADDRINUSE'
      ? `\nPort ${PORT} is already in use — another Amina-Stays server (probably an old one) is still running.\n` +
        `Stop it (Ctrl+C in its terminal, or close that terminal) and run npm start again.\n`
      : `Could not start server: ${err.message}`);
    process.exit(1);
  }
  const sandbox = (process.env.AT_USERNAME || '').toLowerCase() === 'sandbox';
  console.log(`Amina-Stays running on http://localhost:${PORT}  (host dashboard: /host.html)`);
  if (sandbox) console.log('Africa\'s Talking SANDBOX: SMS go to the AT simulator, not real phones. Login codes are also printed here.');
});
