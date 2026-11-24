const db = require('./db');
const { findAvailable } = require('./availability');

const HOLD_MS = 5 * 60 * 1000;

function nights(checkIn, checkOut) {
  return Math.round((new Date(checkOut) - new Date(checkIn)) / 86400000);
}

function newRef() {
  const exists = db.prepare('SELECT 1 FROM bookings WHERE ref=?');
  for (let i = 0; i < 20; i++) {
    const ref = 'AMS-' + Math.floor(1000 + Math.random() * 9000);
    if (!exists.get(ref)) return ref;
  }
  return 'AMS-' + Date.now().toString(36).toUpperCase();
}

// Create a 5-minute hold. Returns booking or { error }
function createHold({ unitId, guestPhone, checkIn, checkOut, channel }) {
  const n = nights(checkIn, checkOut);
  if (n < 1) return { error: 'Check-out must be after check-in' };

  // make sure the unit is still free
  const free = findAvailable({ checkIn, checkOut }).find(u => u.id === unitId);
  if (!free) return { error: 'Sorry, that unit is no longer available' };

  db.prepare('INSERT OR IGNORE INTO guests (phone) VALUES (?)').run(guestPhone);

  const ref = newRef();
  const total = free.price * n;
  db.prepare(`INSERT INTO bookings
    (ref,unit_id,guest_phone,check_in,check_out,status,channel,total,expires_at)
    VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(ref, unitId, guestPhone, checkIn, checkOut, 'held', channel, total, Date.now() + HOLD_MS);

  return { ref, total, unit: free, nights: n };
}

function getBooking(ref) {
  return db.prepare(`SELECT b.*, u.name unit_name, u.area, u.wifi, u.directions, u.tips, g.name guest_name
    FROM bookings b JOIN units u ON u.id=b.unit_id LEFT JOIN guests g ON g.phone=b.guest_phone WHERE b.ref=?`).get(ref);
}

// Called when payment succeeds
function confirmBooking(ref) {
  db.prepare("UPDATE bookings SET status='confirmed', expires_at=NULL WHERE ref=? AND status='held'").run(ref);
  // generate access code now, but it is only SENT on check-in day
  if (!db.prepare('SELECT 1 FROM access_codes WHERE booking_ref=?').get(ref)) {
    const code = String(require('crypto').randomInt(100000, 1000000));
    db.prepare('INSERT INTO access_codes (booking_ref,code) VALUES (?,?)').run(ref, code);
  }
  // remember preferences for returning-guest recognition
  db.prepare(`UPDATE guests SET last_area=(SELECT u.area FROM bookings b JOIN units u ON u.id=b.unit_id WHERE b.ref=?)
    WHERE phone=(SELECT guest_phone FROM bookings WHERE ref=?)`).run(ref, ref);
  return getBooking(ref);
}

// Release expired holds (returns the released bookings so the waitlist can fire later)
function releaseExpiredHolds() {
  const expired = db.prepare("SELECT * FROM bookings WHERE status='held' AND expires_at < ?").all(Date.now());
  for (const b of expired) {
    db.prepare("UPDATE bookings SET status='expired' WHERE id=?").run(b.id);
    db.prepare("UPDATE payments SET status='expired' WHERE booking_ref=? AND status='pending'").run(b.ref);
  }
  return expired;
}

module.exports = { createHold, getBooking, confirmBooking, releaseExpiredHolds, nights };