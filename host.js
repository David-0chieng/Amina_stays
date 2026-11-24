// Host dashboard API (read-mostly view over data every channel already records).
const express = require('express');
const db = require('./db');
const { sendSMS } = require('./sms');
const { requireHost } = require('./auth');
const { today, addDays } = require('./dates');
const { cancelBooking, sendGoodwill } = require('./lifecycle');
const { resolveAlert } = require('./safety');

const router = express.Router();
router.use('/api/host', requireHost);

const LIVE = "('confirmed','checked_in','completed')";
const CHANNELS = ['web', 'ussd', 'sms', 'voice'];

function weekBounds() {
  const t = today();
  const dow = (new Date(t + 'T00:00:00Z').getUTCDay() + 6) % 7; // 0 = Monday
  const start = addDays(t, -dow);
  return { start, end: addDays(start, 7) };
}

router.get('/api/host/summary', (req, res) => {
  const t = today();
  const { start, end } = weekBounds();
  const month = t.slice(0, 7);
  const units = db.prepare('SELECT * FROM units').all();

  // occupancy: booked nights inside this Mon–Sun week / available unit-nights
  let booked = 0;
  for (const b of db.prepare(`SELECT check_in, check_out FROM bookings WHERE status IN ${LIVE} AND check_in < ? AND check_out > ?`).all(end, start)) {
    const from = b.check_in > start ? b.check_in : start, to = b.check_out < end ? b.check_out : end;
    booked += Math.round((new Date(to) - new Date(from)) / 86400000);
  }
  const occupancy = units.length ? Math.round(100 * booked / (units.length * 7)) : 0;

  const revenue = db.prepare(`SELECT COALESCE(SUM(amount),0) s FROM payments p JOIN bookings b ON b.ref=p.booking_ref
    WHERE p.status='success' AND b.status IN ${LIVE} AND substr(b.created_at,1,7)=?`).get(month).s;

  const byChannel = Object.fromEntries(CHANNELS.map(c => [c, { bookings: 0, revenue: 0 }]));
  for (const r of db.prepare(`SELECT channel, COUNT(*) n, SUM(total) rev FROM bookings WHERE status IN ${LIVE} GROUP BY channel`).all())
    byChannel[r.channel] = { bookings: r.n, revenue: r.rev || 0 };

  const upcoming = db.prepare(`SELECT b.ref, b.check_in, b.check_out, b.guest_phone, b.channel, b.status, u.name unit_name, g.name guest_name
    FROM bookings b JOIN units u ON u.id=b.unit_id LEFT JOIN guests g ON g.phone=b.guest_phone
    WHERE b.status IN ('confirmed','checked_in') AND b.check_in <= ? AND b.check_out >= ? ORDER BY b.check_in`).all(addDays(t, 7), t);

  // the "lock" panel: what each door would accept right now (stands in for TTLock/Nuki hardware)
  const locks = units.map(u => {
    const stay = db.prepare(`SELECT b.ref, b.guest_phone, b.check_out, a.code, a.issued_at FROM bookings b
      JOIN access_codes a ON a.booking_ref=b.ref AND a.invalidated_at IS NULL
      WHERE b.unit_id=? AND b.status='checked_in' LIMIT 1`).get(u.id);
    const held = db.prepare("SELECT ref FROM bookings WHERE unit_id=? AND status='held' AND expires_at>? AND check_in<=? AND check_out>? LIMIT 1")
      .get(u.id, Date.now(), t, t);
    return { unit: u.name, area: u.area, state: stay ? 'occupied' : held ? 'held' : 'free', ...(stay || {}) };
  });

  const alerts = db.prepare('SELECT * FROM alerts WHERE resolved_at IS NULL ORDER BY id DESC LIMIT 20').all();
  const inbox = db.prepare(`SELECT m.id, m.phone, m.text, m.created_at, g.rowid thread FROM messages m
    LEFT JOIN guests g ON g.phone=m.phone WHERE m.direction='in' AND m.handled='relayed' ORDER BY m.id DESC LIMIT 30`).all();
  const recent = db.prepare(`SELECT b.ref, b.status, b.channel, b.total, b.check_in, b.check_out, b.guest_phone, b.created_at, u.name unit_name
    FROM bookings b JOIN units u ON u.id=b.unit_id ORDER BY b.id DESC LIMIT 25`).all();
  const waitlist = db.prepare('SELECT COUNT(*) n FROM waitlist WHERE check_out > ?').get(t).n;

  const byMethod = db.prepare(`SELECT p.method, COUNT(*) n, SUM(p.amount) amount FROM payments p JOIN bookings b ON b.ref=p.booking_ref
    WHERE p.status='success' AND b.status IN ${LIVE} AND substr(b.created_at,1,7)=? GROUP BY p.method`).all(month);
  const reviewStats = db.prepare('SELECT COUNT(*) n, ROUND(AVG(rating),1) avg FROM reviews').get();
  const reviews = db.prepare(`SELECT r.rating, r.phone, r.created_at, b.ref, u.name unit_name FROM reviews r
    JOIN bookings b ON b.ref=r.booking_ref JOIN units u ON u.id=b.unit_id ORDER BY r.id DESC LIMIT 8`).all();

  res.json({ today: t, week: { start, end }, occupancy, revenue, byMethod, byChannel, upcoming, locks, alerts, inbox, recent, waitlist,
    reviews: { ...reviewStats, recent: reviews } });
});

router.post('/api/host/reply', async (req, res) => {
  const { phone, text } = req.body;
  if (!phone || !text) return res.status(400).json({ error: 'phone and text required' });
  db.prepare("UPDATE messages SET handled='answered' WHERE phone=? AND direction='in' AND handled='relayed'").run(phone);
  await sendSMS(phone, `Amina: ${text}`);
  res.json({ ok: true });
});

router.post('/api/host/alerts/:id/resolve', (req, res) => { resolveAlert(+req.params.id); res.json({ ok: true }); });
router.post('/api/host/cancel/:ref', async (req, res) => {
  const r = await cancelBooking(req.params.ref);
  if (!r.error) {
    const credit = r.wasPaid ? await sendGoodwill(r.phone, req.params.ref) : null;
    await sendSMS(r.phone, `Your Amina-Stays booking ${req.params.ref} has been cancelled.` +
      (r.wasPaid ? ' Amina will contact you about your refund.' : '') +
      (credit ? ` We've sent you KES ${credit} airtime as an apology.` : ''));
  }
  res.json(r);
});

module.exports = router;
