const db = require('./db');

// Units free for [checkIn, checkOut), optionally filtered by area/guests
function findAvailable({ checkIn, checkOut, area, guests }) {
  const now = Date.now();
  let sql = `
    SELECT * FROM units u WHERE u.id NOT IN (
      SELECT unit_id FROM bookings
      WHERE (status IN ('confirmed','checked_in')
         OR (status='held' AND expires_at > ?))
        AND check_in < ? AND check_out > ?
    )`;
  const params = [now, checkOut, checkIn];
  if (area)   { sql += ' AND LOWER(u.area)=LOWER(?)'; params.push(area); }
  if (guests) { sql += ' AND u.max_guests >= ?';      params.push(guests); }
  return db.prepare(sql).all(...params);
}

module.exports = { findAvailable };