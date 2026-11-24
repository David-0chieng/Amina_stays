const db = require('./db');
const { at, sendSMS } = require('./sms');

db.exec(`CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT, phone TEXT, source TEXT, summary TEXT,
  call_status TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, resolved_at TEXT
)`);

// Who is this guest and where are they staying right now (or next)?
function guestContext(phone) {
  const g = db.prepare('SELECT name FROM guests WHERE phone=?').get(phone);
  const b = db.prepare(`SELECT b.ref, b.check_in, b.check_out, b.status, u.name unit_name, u.area
    FROM bookings b JOIN units u ON u.id=b.unit_id
    WHERE b.guest_phone=? AND b.status IN ('checked_in','confirmed')
    ORDER BY (b.status='checked_in') DESC, b.check_in LIMIT 1`).get(phone);
  const who = (g && g.name) ? `${g.name} (${phone})` : phone;
  const where = b ? `${b.status === 'checked_in' ? 'staying at' : 'booked at'} ${b.unit_name}, ${b.area}, ref ${b.ref}` : 'no active booking';
  return { who, where, summary: `${who}, ${where}` };
}

// Skip every queue: place a voice call to Amina immediately AND text her the details
// (the SMS is the fallback if the call can't connect).
async function escalate(phone, source, { call = true } = {}) {
  const ctx = guestContext(phone);
  const id = db.prepare('INSERT INTO alerts (phone,source,summary,call_status) VALUES (?,?,?,?)')
    .run(phone, source, ctx.summary, 'pending').lastInsertRowid;

  let callStatus = call ? 'not_configured' : 'bridged';
  if (call && process.env.AT_VOICE_NUMBER && process.env.AMINA_PHONE) {
    try {
      const r = await at.VOICE.call({
        callFrom: process.env.AT_VOICE_NUMBER,
        callTo: [process.env.AMINA_PHONE],
        clientRequestId: `alert-${id}`
      });
      console.log('Safety call:', JSON.stringify(r));
      const entry = r.entries && r.entries[0];
      callStatus = entry ? entry.status : 'requested';
    } catch (e) {
      console.error('Safety call failed:', e.message || e);
      callStatus = 'failed';
    }
  }
  db.prepare('UPDATE alerts SET call_status=? WHERE id=?').run(callStatus, id);

  await sendSMS(process.env.AMINA_PHONE, `URGENT HELP (${source}): ${ctx.summary}. ` +
    (callStatus === 'Queued' ? 'Calling you now.' : callStatus === 'bridged' ? 'Connecting the caller to you now.' : 'Please call them now.'));
  return { id, callStatus, ...ctx };
}

function getAlert(id) { return db.prepare('SELECT * FROM alerts WHERE id=?').get(id); }
function latestOpenAlert() { return db.prepare('SELECT * FROM alerts WHERE resolved_at IS NULL ORDER BY id DESC LIMIT 1').get(); }
function resolveAlert(id) { db.prepare('UPDATE alerts SET resolved_at=CURRENT_TIMESTAMP WHERE id=?').run(id); }

module.exports = { escalate, guestContext, getAlert, latestOpenAlert, resolveAlert };
