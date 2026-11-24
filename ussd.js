const express = require('express');
const db = require('./db');
const { findAvailable } = require('./availability');
const { createHold } = require('./bookings');
const { startRemotePayment } = require('./payments');
const { sendSMS } = require('./sms');
const { today, addDays, weekendStart } = require('./dates');
const { checkout } = require('./lifecycle');

const router = express.Router();
const AREAS = ['Nyali', 'Diani', 'Old Town'];

function resolveDates(choice, nights) {
  const start = choice === '1' ? today() : choice === '2' ? addDays(today(), 1) : weekendStart();
  return { checkIn: start, checkOut: addDays(start, nights) };
}

const isAmina = phone => process.env.AMINA_PHONE &&
  phone.replace(/\D/g, '').slice(-9) === process.env.AMINA_PHONE.replace(/\D/g, '').slice(-9);

// Amina's own ops menu (shown when she dials from her number)
async function opsMenu(p) {
  if (p.length === 0) return 'CON Amina ops\n1. Unit status today\n2. Free tonight\n3. Text all current guests\n4. Text waitlist';
  const t = today();
  if (p[0] === '1') {
    const rows = db.prepare(`SELECT u.name, (SELECT status FROM bookings b WHERE b.unit_id=u.id AND b.check_in<=? AND b.check_out>?
      AND (b.status IN ('confirmed','checked_in') OR (b.status='held' AND b.expires_at>?)) LIMIT 1) st FROM units u`).all(t, t, Date.now());
    return 'END ' + rows.map(r => `${r.name}: ${r.st ? r.st.replace('_', ' ') : 'free'}`).join('\n');
  }
  if (p[0] === '2') {
    const free = findAvailable({ checkIn: t, checkOut: addDays(t, 1) });
    return 'END Free tonight:\n' + (free.map(u => `${u.name} KES ${u.price}`).join('\n') || 'none');
  }
  if (p[0] === '3' || p[0] === '4') {
    if (p.length === 1) return 'CON Type your message:';
    const msg = p.slice(1).join('*').slice(0, 300);
    const phones = p[0] === '3'
      ? db.prepare("SELECT DISTINCT guest_phone ph FROM bookings WHERE status='checked_in'").all()
      : db.prepare('SELECT DISTINCT phone ph FROM waitlist WHERE check_out > ?').all(t);
    for (const r of phones) await sendSMS(r.ph, `Amina-Stays: ${msg}`);
    return `END Sent to ${phones.length} guest(s).`;
  }
  return 'END Invalid choice.';
}

async function menu(phone, p) {
  if (isAmina(phone)) return opsMenu(p);
  // Returning guests get a greeting and a one-step "rebook my last place"
  const last = db.prepare(`SELECT b.unit_id, u.name, g.name guest FROM bookings b JOIN units u ON u.id=b.unit_id
    LEFT JOIN guests g ON g.phone=b.guest_phone
    WHERE b.guest_phone=? AND b.status IN ('confirmed','checked_in','completed') ORDER BY b.id DESC LIMIT 1`).get(phone);
  if (p.length === 0)
    return (last ? `CON Karibu tena${last.guest ? ' ' + last.guest.split(' ')[0] : ''}!` : 'CON Karibu Amina-Stays') +
      '\n1. Book a stay\n2. My booking\n3. Talk to Amina\n4. Check out' + (last ? `\n5. Rebook ${last.name}` : '');

  if (p[0] === '5' && last) {
    if (p.length === 1) return 'CON Check-in:\n1. Tonight\n2. Tomorrow\n3. This weekend';
    if (!['1', '2', '3'].includes(p[1])) return 'END Invalid choice.';
    if (p.length === 2) return 'CON How many nights? (1-7)';
    const n = +p[2];
    if (!(n >= 1 && n <= 7)) return 'END Please enter 1 to 7 nights.';
    const { checkIn, checkOut } = resolveDates(p[1], n);
    const hold = createHold({ unitId: last.unit_id, guestPhone: phone, checkIn, checkOut, channel: 'ussd' });
    if (hold.error) return `END ${last.name} isn't free then. Choose 1 to see other places.`;
    const pay = await startRemotePayment(hold.ref, phone, hold.total);
    return `END Holding ${last.name}. ${pay.text} Ref ${hold.ref}`;
  }

  if (p[0] === '2') {
    const b = db.prepare(`SELECT b.*, u.name unit_name FROM bookings b JOIN units u ON u.id=b.unit_id
      WHERE guest_phone=? AND status IN ('confirmed','checked_in','held') ORDER BY b.id DESC LIMIT 1`).get(phone);
    return b ? `END ${b.unit_name}\n${b.check_in} to ${b.check_out}\nRef ${b.ref} (${b.status})`
             : 'END No active booking found.';
  }

  if (p[0] === '3') {
    await sendSMS(process.env.AMINA_PHONE, `USSD request: guest ${phone} wants to talk. Please call them.`);
    return 'END Amina has been notified and will contact you shortly.';
  }

  if (p[0] === '4') return 'END ' + await checkout(phone);

  if (p[0] !== '1') return 'END Invalid choice.';

  if (p.length === 1) return 'CON Choose area:\n' + AREAS.map((a, i) => `${i + 1}. ${a}`).join('\n');
  const area = AREAS[+p[1] - 1];
  if (!area) return 'END Invalid area.';

  if (p.length === 2) return 'CON Check-in:\n1. Tonight\n2. Tomorrow\n3. This weekend';
  if (!['1', '2', '3'].includes(p[2])) return 'END Invalid choice.';

  if (p.length === 3) return 'CON How many nights? (1-7)';
  const nights = +p[3];
  if (!(nights >= 1 && nights <= 7)) return 'END Please enter 1 to 7 nights.';

  const { checkIn, checkOut } = resolveDates(p[2], nights);
  const units = findAvailable({ checkIn, checkOut, area });

  if (units.length === 0) {
    db.prepare('INSERT INTO waitlist (phone,check_in,check_out,area) VALUES (?,?,?,?)')
      .run(phone, checkIn, checkOut, area);
    return `END Nothing free in ${area} for those dates. We'll SMS you if something opens up.`;
  }

  if (p.length === 4)
    return 'CON Pick a unit:\n' + units.map((u, i) => `${i + 1}. ${u.name} KES ${u.price}/n`).join('\n');

  const unit = units[+p[4] - 1];
  if (!unit) return 'END Invalid choice.';

  const hold = createHold({ unitId: unit.id, guestPhone: phone, checkIn, checkOut, channel: 'ussd' });
  if (hold.error) return 'END ' + hold.error;
  const pay = await startRemotePayment(hold.ref, phone, hold.total);
  return `END Holding ${unit.name}. ${pay.text} Ref ${hold.ref}`;
}

router.post('/ussd', async (req, res) => {
  const { phoneNumber, text } = req.body;
  const parts = text === '' || text === undefined ? [] : text.split('*');
  res.set('Content-Type', 'text/plain');
  try { res.send(await menu(phoneNumber, parts)); }
  catch (e) { console.error(e); res.send('END Something went wrong. Please try again.'); }
});

module.exports = router;