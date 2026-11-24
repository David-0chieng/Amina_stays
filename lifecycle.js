const db = require('./db');
const { findAvailable } = require('./availability');
const { getBooking } = require('./bookings');
const { at, sendSMS } = require('./sms');
const { today, addDays } = require('./dates');

// tracks which messages we've already sent, so nothing goes out twice
db.exec(`CREATE TABLE IF NOT EXISTS notifications (
  booking_ref TEXT, kind TEXT, sent_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (booking_ref, kind))`);

const already = (ref, kind) =>
  !!db.prepare('SELECT 1 FROM notifications WHERE booking_ref=? AND kind=?').get(ref, kind);
const mark = (ref, kind) =>
  db.prepare('INSERT OR IGNORE INTO notifications (booking_ref,kind) VALUES (?,?)').run(ref, kind);

const kenyaHour = () => new Date(Date.now() + 3 * 3600 * 1000).getUTCHours();
const CHECKOUT_HOUR = +process.env.CHECKOUT_HOUR || 11;

function setConvo(phone, state, data) {
  db.prepare(`INSERT INTO conversations (phone,state,data,updated_at) VALUES (?,?,?,?)
    ON CONFLICT(phone) DO UPDATE SET state=excluded.state, data=excluded.data, updated_at=excluded.updated_at`)
    .run(phone, state, JSON.stringify(data), Date.now());
}

// Day before arrival: directions + wifi (NOT the door code)
async function sendDirections(b) {
  if (!b || already(b.ref, 'directions')) return;
  mark(b.ref, 'directions');
  await sendSMS(b.guest_phone,
    `Karibu! Tomorrow you check in at ${b.unit_name}. Directions: ${b.directions}. ` +
    `Wifi: ${b.wifi}. Your door code arrives by SMS on arrival day.`);
}

// Check-in day: release the access code, plus a same-day local-tips message
async function sendCode(b) {
  if (!b || b.status !== 'confirmed') return;
  const c = db.prepare('SELECT * FROM access_codes WHERE booking_ref=? AND invalidated_at IS NULL').get(b.ref);
  if (!c) return;
  db.prepare("UPDATE access_codes SET issued_at=CURRENT_TIMESTAMP WHERE id=?").run(c.id);
  db.prepare("UPDATE bookings SET status='checked_in' WHERE ref=?").run(b.ref);
  await sendSMS(b.guest_phone,
    `Welcome to ${b.unit_name}! Door code: ${c.code}. Valid until checkout (${CHECKOUT_HOUR}am, ${b.check_out}). ` +
    `Reply CHECKOUT when you leave, or HELP for urgent help.`);
  await sendTips(b);
}

async function sendTips(b) {
  if (already(b.ref, 'tips')) return;
  mark(b.ref, 'tips');
  const taxi = process.env.TAXI_CONTACT ? ` Taxi: Amina's trusted driver ${process.env.TAXI_CONTACT}.` : ' Taxi: Uber/Bolt work well, or text us for Amina\'s trusted driver.';
  await sendSMS(b.guest_phone,
    `Local tips for ${b.area || 'your stay'}: ${b.tips || 'Ask us anything by text.'}${taxi} ` +
    `Safety: keep valuables out of sight; police/ambulance 999 or 112; text HELP to reach Amina any time.`);
}

// Ask for a 1–5 rating once the stay ends (reply handled in smsbot.js)
async function requestReview(b) {
  if (!b || already(b.ref, 'review')) return;
  mark(b.ref, 'review');
  setConvo(b.guest_phone, 'review', { ref: b.ref });
  await sendSMS(b.guest_phone, `Asante for staying at ${b.unit_name}! How was your stay? Reply 1 (poor) to 5 (excellent).`);
}

// End a stay: complete it, kill the door code, free the unit. The review request follows
// REVIEW_DELAY_MIN later via the scheduler (stored in the DB, so it survives restarts).
async function completeStay(b) {
  db.prepare("UPDATE bookings SET status='completed' WHERE id=?").run(b.id);
  invalidate(b.ref);
  mark(b.ref, 'completed');
  await notifyWaitlist(b.unit_id);
}
const REVIEW_DELAY_MIN = () => process.env.REVIEW_DELAY_MIN !== undefined ? +process.env.REVIEW_DELAY_MIN : 60;

// Runs every 30s from server.js
async function runScheduler() {
  const t = today();
  const hour = kenyaHour();
  if (hour >= 16) {
    const due = db.prepare("SELECT ref FROM bookings WHERE status='confirmed' AND check_in=?").all(addDays(t, 1));
    for (const r of due) await sendDirections(getBooking(r.ref));
  }
  if (hour >= 8) {
    const due = db.prepare("SELECT ref FROM bookings WHERE status='confirmed' AND check_in<=? AND check_out>?").all(t, t);
    for (const r of due) await sendCode(getBooking(r.ref));
  }
  // Guests who never texted CHECKOUT: end the stay at checkout time so the code can't stay valid
  const overdue = db.prepare(`SELECT * FROM bookings WHERE status='checked_in' AND (check_out < ? OR (check_out = ? AND ? >= ?))`)
    .all(t, t, hour, CHECKOUT_HOUR);
  for (const b of overdue) {
    console.log('Auto checkout:', b.ref);
    await sendSMS(b.guest_phone, `Checkout time has passed, so your door code for ${b.ref} is now deactivated. Safe travels!`);
    await completeStay(b);
  }
  // Post-stay review requests, a while after checkout (not between 9pm and 8am)
  if (process.env.REVIEW_QUIET_HOURS === 'off' || (hour >= 8 && hour < 21)) {
    const due = db.prepare(`SELECT n.booking_ref ref FROM notifications n
      WHERE n.kind='completed' AND n.sent_at <= datetime('now', ?)
        AND NOT EXISTS (SELECT 1 FROM notifications r WHERE r.booking_ref=n.booking_ref AND r.kind='review')`)
      .all(`-${REVIEW_DELAY_MIN()} minutes`);
    for (const r of due) await requestReview(getBooking(r.ref));
  }
}

// Text everyone waiting for dates this unit now covers. First BOOK reply wins.
async function notifyWaitlist(unitId) {
  const unit = db.prepare('SELECT * FROM units WHERE id=?').get(unitId);
  for (const w of db.prepare('SELECT * FROM waitlist').all()) {
    if (w.check_out <= today()) { db.prepare('DELETE FROM waitlist WHERE id=?').run(w.id); continue; }
    const free = findAvailable({ checkIn: w.check_in, checkOut: w.check_out, area: w.area || undefined });
    if (!free.some(u => u.id === unitId)) continue;
    db.prepare('DELETE FROM waitlist WHERE id=?').run(w.id);
    setConvo(w.phone, 'offer', { unitId, checkIn: w.check_in, checkOut: w.check_out });
    await sendSMS(w.phone,
      `Good news! ${unit.name} (KES ${unit.price}/night) is free ${w.check_in} to ${w.check_out}. ` +
      `Reply BOOK to grab it. First reply wins.`);
  }
}

function invalidate(ref) {
  db.prepare("UPDATE access_codes SET invalidated_at=CURRENT_TIMESTAMP WHERE booking_ref=? AND invalidated_at IS NULL").run(ref);
}

// Guest checks out (SMS, USSD or website). Returns the reply text.
async function checkout(phone) {
  const b = db.prepare("SELECT * FROM bookings WHERE guest_phone=? AND status='checked_in' ORDER BY check_in LIMIT 1").get(phone);
  if (!b) return 'No active stay found for this number.';
  await completeStay(b);
  return 'Thanks for staying with Amina-Stays! Your door code is now deactivated. Safe travels.';
}

// Optional goodwill: small airtime credit when Amina cancels a paid booking (GOODWILL_AIRTIME_KES, Kenyan numbers only)
async function sendGoodwill(phone, ref) {
  const amount = +process.env.GOODWILL_AIRTIME_KES || 0;
  if (!amount || !/^\+254/.test(phone) || already(ref, 'goodwill')) return null;
  mark(ref, 'goodwill');
  try {
    const r = await at.AIRTIME.send({ recipients: [{ phoneNumber: phone, currencyCode: 'KES', amount }] });
    console.log('Goodwill airtime:', JSON.stringify(r));
    return amount;
  } catch (e) { console.error('Airtime error:', e.message || e); return null; }
}

async function cancelBooking(ref) {
  const b = db.prepare("SELECT * FROM bookings WHERE ref=? AND status IN ('held','confirmed')").get(ref);
  if (!b) return { error: 'Nothing to cancel for that ref' };
  db.prepare("UPDATE bookings SET status='cancelled' WHERE id=?").run(b.id);
  invalidate(ref);
  await notifyWaitlist(b.unit_id);
  return { cancelled: ref, wasPaid: b.status === 'confirmed', phone: b.guest_phone };
}

module.exports = { runScheduler, sendDirections, sendCode, checkout, cancelBooking, notifyWaitlist, sendGoodwill };
