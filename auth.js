// Phone-number identity for the website: enter your number, get a one-time SMS code.
// A guest who already booked by USSD/SMS/voice is the same account — no signup, no password.
const crypto = require('crypto');
const db = require('./db');
const { sendSMS } = require('./sms');
const { normalizePhone } = require('./phone');

db.exec(`
CREATE TABLE IF NOT EXISTS otps (phone TEXT PRIMARY KEY, code_hash TEXT, expires_at INTEGER, attempts INTEGER DEFAULT 0, sent_at INTEGER);
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, phone TEXT, expires_at INTEGER);
`);

const OTP_TTL = 5 * 60 * 1000, SESSION_TTL = 7 * 24 * 3600 * 1000, RESEND_GAP = 30 * 1000;
const hash = s => crypto.createHash('sha256').update(s).digest('hex');

async function requestOtp(rawPhone) {
  const phone = normalizePhone(rawPhone);
  if (!phone) return { error: 'Please enter a valid phone number, e.g. 0712 345 678 or +44…' };
  const prev = db.prepare('SELECT sent_at FROM otps WHERE phone=?').get(phone);
  if (prev && Date.now() - prev.sent_at < RESEND_GAP) return { error: 'Please wait 30 seconds before requesting another code.' };

  const code = String(crypto.randomInt(100000, 1000000));
  db.prepare(`INSERT INTO otps (phone,code_hash,expires_at,attempts,sent_at) VALUES (?,?,?,0,?)
    ON CONFLICT(phone) DO UPDATE SET code_hash=excluded.code_hash, expires_at=excluded.expires_at, attempts=0, sent_at=excluded.sent_at`)
    .run(phone, hash(code), Date.now() + OTP_TTL, Date.now());
  const sandbox = (process.env.AT_USERNAME || '').toLowerCase() === 'sandbox';
  const res = await sendSMS(phone, `Your Amina-Stays login code is ${code}. It expires in 5 minutes.`);
  const r = res && res.SMSMessageData && res.SMSMessageData.Recipients && res.SMSMessageData.Recipients[0];
  const delivered = r && /success|sent|queued/i.test(r.status || '');
  // Sandbox SMS never reach real phones, so print the code for whoever is running the server
  if (sandbox || process.env.DEMO === '1') console.log(`\n>>> Login code for ${phone}: ${code}\n`);
  if (!delivered && !sandbox) {
    db.prepare('DELETE FROM otps WHERE phone=?').run(phone);
    return { error: `We couldn't send the SMS${r && r.status ? ` (${r.status})` : ''}. Check the number and try again.` };
  }
  return { phone, sandbox };
}

function verifyOtp(rawPhone, code) {
  const phone = normalizePhone(rawPhone);
  const row = phone && db.prepare('SELECT * FROM otps WHERE phone=?').get(phone);
  if (!row || row.expires_at < Date.now()) return { error: 'Code expired. Please request a new one.' };
  if (row.attempts >= 5) return { error: 'Too many attempts. Please request a new code.' };
  if (row.code_hash !== hash(String(code || '').trim())) {
    db.prepare('UPDATE otps SET attempts=attempts+1 WHERE phone=?').run(phone);
    return { error: 'That code is not right.' };
  }
  db.prepare('DELETE FROM otps WHERE phone=?').run(phone);
  db.prepare('INSERT OR IGNORE INTO guests (phone) VALUES (?)').run(phone);
  const token = crypto.randomBytes(24).toString('hex');
  db.prepare('INSERT INTO sessions (token,phone,expires_at) VALUES (?,?,?)').run(token, phone, Date.now() + SESSION_TTL);
  return { token, phone };
}

// Express middleware: sets req.phone from "Authorization: Bearer <token>"
function requireGuest(req, res, next) {
  const token = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const s = token && db.prepare('SELECT phone FROM sessions WHERE token=? AND expires_at>?').get(token, Date.now());
  if (!s) return res.status(401).json({ error: 'Please log in with your phone number.' });
  req.phone = s.phone;
  next();
}

// Host dashboard: simple shared PIN from .env (HOST_PIN)
function requireHost(req, res, next) {
  const pin = process.env.HOST_PIN;
  if (!pin) return res.status(503).json({ error: 'Set HOST_PIN in .env to enable the host dashboard.' });
  const given = req.get('x-host-pin') || '';
  const ok = given.length === pin.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(pin));
  if (!ok) return res.status(401).json({ error: 'Wrong PIN' });
  next();
}

module.exports = { requestOtp, verifyOtp, requireGuest, requireHost };
